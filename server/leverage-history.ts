import type { DatabaseSync } from 'node:sqlite';
import { historicalLeverage, type LeveragePoint, type LeverageResponse } from '../shared/leverage.js';
import type { Candle } from '../shared/market.js';
import { AccountRecorder } from './recorder.js';
export class LeverageHistory {
  private jobs=new Map<string,{status:'building'|'ready'|'error';progress:string;error?:string}>();
  constructor(readonly db:DatabaseSync,readonly recorder:AccountRecorder){db.exec('CREATE TABLE IF NOT EXISTS leverage_backfills(wallet TEXT PRIMARY KEY,built_at INTEGER NOT NULL,payload TEXT NOT NULL)');}
  start(wallet:string){
    if(this.jobs.get(wallet)?.status==='building')return;
    this.jobs.set(wallet,{status:'building',progress:'Capturing all DEX account states'});
    void this.build(wallet).catch(error=>this.jobs.set(wallet,{status:'error',progress:'Backfill failed',error:error instanceof Error?error.message:'Backfill failed'}));
  }
  response(wallet:string):LeverageResponse{
    const row=this.db.prepare('SELECT payload FROM leverage_backfills WHERE wallet=?').get(wallet);
    const saved=row?JSON.parse(String(row.payload)) as {points:LeveragePoint[];warnings:string[]}:null;
    return {estimated:saved?.points??[],recorded:this.recorder.points(wallet),latest:this.recorder.latest(wallet),recorder:this.recorder.status(wallet),job:this.jobs.get(wallet)??{status:saved?'ready':'idle',progress:saved?'Saved historical estimate':'No historical backfill yet'},warnings:saved?.warnings??[]};
  }
  private async build(wallet:string){
    const accounts=this.recorder.accounts;
    const frame=await this.recorder.capture(wallet);
    const warnings=[...frame.reasons];
    this.jobs.set(wallet,{status:'building',progress:'Fetching bounded fill history across all markets'});
    const fills=await accounts.fills(wallet,frame.startedAt);
    const portfolio=await accounts.api.info<[string,{accountValueHistory:[number,string][]}][]>('portfolio',wallet);
    const equityMap=new Map<number,string>();
    // Prefer the finer day/week samples when timestamps overlap coarse series.
    for(const name of ['perpAllTime','perpMonth','perpWeek','perpDay'])for(const [time,value] of portfolio.find(p=>p[0]===name)?.[1].accountValueHistory??[])equityMap.set(time,value);
    const equity=[...equityMap].sort((a,b)=>a[0]-b[0]) as [number,string][];
    const descriptors=await accounts.descriptors();const collateralByCoin:Record<string,number>={};
    for(const d of descriptors)for(const coin of d.coins)collateralByCoin[coin]=d.collateralToken;
    const coins=new Set(frame.dexAccounts.flatMap(d=>d.state.assetPositions.map(p=>p.position.coin)));
    for(const f of fills)if(!f.coin.startsWith('@')&&(!f.coin.includes('/')||Object.hasOwn(collateralByCoin,f.coin)))coins.add(f.coin);
    const prices:Record<string,Candle[]>={};
    const start=Math.min(...fills.map(f=>f.time),frame.startedAt)-600000;
    let completed=0;
    for(const coin of coins){
      this.jobs.set(wallet,{status:'building',progress:`Loading historical prices for all positions: ${completed}/${coins.size} markets (${coin})`});
      try{prices[coin]=await accounts.api.candles(coin,'5m',start,frame.startedAt);}catch(error){warnings.push(`Price history missing for ${coin}; affected leverage points remain gaps.`);}
      completed++;
    }
    // Check that the latest portfolio equity describes the same all-DEX scope.
    // Never combine native-only equity with all-DEX exposure silently.
    const last=equity.at(-1);const aligned=last&&frame.equity!==null&&Math.abs(last[0]-frame.startedAt)<30*60000&&Math.abs(Number(last[1])-frame.equity)/Math.max(1,frame.equity)<.02;
    let points:LeveragePoint[]=[];
    if(aligned)points=historicalLeverage({frame,fills,equity,prices,collateralByCoin,stepMs:300000});
    else warnings.push('Portfolio equity could not be aligned with all-DEX account equity; historical estimates are withheld.');
    warnings.push(`Backfill uses ${fills.length.toLocaleString()} bounded fills, all ${coins.size} relevant perpetual markets, 5-minute candle closes, and interpolated perpetual equity samples (maximum 4-hour sample gap).`);
    warnings.push('Estimated history assumes no unreported position changes within the fetched fill window. Recorded snapshots use observed all-DEX notionals and equity instead. Values are USDC-equivalent exposure/equity, not a liquidation-risk ratio.');
    if(fills.length>=10000)warnings.push('The 10,000-fill API history limit was reached; earlier leverage is unavailable.');
    this.db.prepare('INSERT INTO leverage_backfills(wallet,built_at,payload) VALUES(?,?,?) ON CONFLICT(wallet) DO UPDATE SET built_at=excluded.built_at,payload=excluded.payload').run(wallet,Date.now(),JSON.stringify({points,warnings}));
    this.jobs.set(wallet,{status:'ready',progress:`Historical estimate ready: ${points.filter(p=>p.value!==null).length} usable points; missing coverage remains gaps`});
  }
}
