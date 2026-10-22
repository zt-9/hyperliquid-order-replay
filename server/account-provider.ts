import { PublicApiProvider } from './provider.js';
import { aggregateFrame, type AccountFrame, type DexAccount } from '../shared/leverage.js';
import type { AccountState } from '../shared/market.js';
interface Descriptor {dex:string;collateralToken:number;coins:string[]}
export class AccountProvider {
  private catalog:Descriptor[]=[];private catalogAt=0;
  constructor(readonly api:PublicApiProvider){}
  async descriptors():Promise<Descriptor[]>{
    if(this.catalog.length&&Date.now()-this.catalogAt<60000)return this.catalog;
    const dexes=await this.api.info<({name:string}|null)[]>('perpDexs');
    if(!Array.isArray(dexes)||!dexes.includes(null))throw new Error('Unexpected perpetual DEX catalog');
    const next:Descriptor[]=[];
    for(const dex of dexes){
      const name=dex?.name??'';
      const existing=this.catalog.find(d=>d.dex===name);
      if(existing){next.push(existing);continue;}
      const meta=await this.api.info<{collateralToken:number;universe:{name:string}[]}>('meta',undefined,{dex:name});
      if(!Number.isInteger(meta.collateralToken)||!Array.isArray(meta.universe))throw new Error(`Incomplete metadata for ${name||'native'}`);
      next.push({dex:name,collateralToken:meta.collateralToken,coins:meta.universe.map(c=>c.name)});
    }
    this.catalog=next;this.catalogAt=Date.now();return next;
  }
  async capture(wallet:string):Promise<AccountFrame>{
    const catalog=await this.descriptors();const startedAt=Date.now();
    const mode=await this.api.info<string>('userAbstraction',wallet);
    if(typeof mode!=='string')throw new Error('Unknown account abstraction mode');
    const dexAccounts:DexAccount[]=[];
    for(const dex of catalog){
      const state=await this.api.info<AccountState>('clearinghouseState',wallet,{dex:dex.dex});
      if(!state.marginSummary||!Array.isArray(state.assetPositions))throw new Error(`Incomplete account state for ${dex.dex||'native'}`);
      dexAccounts.push({dex:dex.dex,collateralToken:dex.collateralToken,state});
    }
    let spotBalances:AccountFrame['spotBalances'];
    if(mode==='unifiedAccount'){
      const spot=await this.api.info<{balances:NonNullable<AccountFrame['spotBalances']>}>('spotClearinghouseState',wallet);
      if(!Array.isArray(spot.balances)||spot.balances.some(b=>!Number.isInteger(b.token)||typeof b.total!=='string'))throw new Error('Incomplete unified account balances');
      spotBalances=spot.balances;
    }
    const collateralRates:Record<string,number>={'0':1};
    const required=new Set(dexAccounts.filter(d=>Number(d.state.marginSummary.accountValue)!==0||d.state.assetPositions.length).map(d=>d.collateralToken));
    const collateralTokens=new Set(catalog.map(d=>d.collateralToken));
    for(const b of spotBalances??[])if(collateralTokens.has(b.token)&&Number(b.total)!==0)required.add(b.token);
    if([...required].some(t=>t!==0)){
      const [meta,contexts]=await this.api.info<[{universe:{tokens:number[];index:number}[]},{midPx:string|null;markPx:string}[]]>('spotMetaAndAssetCtxs');
      for(let pass=0;pass<6;pass++)for(let i=0;i<meta.universe.length;i++){
        const pair=meta.universe[i],p=Number(contexts[i]?.midPx??contexts[i]?.markPx);if(!Number.isFinite(p)||p<=0)continue;
        const [base,quote]=pair.tokens;if(collateralRates[quote]&&!collateralRates[base])collateralRates[base]=p*collateralRates[quote];
        if(collateralRates[base]&&!collateralRates[quote])collateralRates[quote]=collateralRates[base]/p;
      }
    }
    return aggregateFrame({wallet,startedAt,capturedAt:Date.now(),mode,dexAccounts,collateralRates,...spotBalances?{spotBalances}:{}});
  }
  async fills(wallet:string,endTime=Date.now()){
    const seen=new Map<string,import('../shared/replay.js').Fill>();let startTime=0;
    for(let page=0;page<8;page++){
      const rows=await this.api.info<import('../shared/replay.js').Fill[]>('userFillsByTime',wallet,{startTime,endTime,aggregateByTime:false});
      if(!Array.isArray(rows))throw new Error('Unexpected fill history response');
      for(const row of rows)seen.set(`${row.coin}:${row.tid}`,row);
      if(rows.length<2000||seen.size>=10000)break;
      const next=Math.max(...rows.map(r=>r.time));
      if(next<=startTime)throw new Error('Ambiguous fill pagination boundary; complete coverage cannot be established');
      startTime=next; // inclusive overlap avoids dropping fills sharing a timestamp
    }
    // Stable time ties retain API chronology. userFillsByTime is ascending;
    // historicalLeverage accepts the same newest-first contract as userFills.
    return [...seen.values()].sort((a,b)=>a.time-b.time).reverse().slice(0,10000);
  }
}
