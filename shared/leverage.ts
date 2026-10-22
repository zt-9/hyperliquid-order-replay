import type { AccountState, Candle } from './market.js';
import type { Fill } from './replay.js';
export interface DexAccount { dex:string; collateralToken:number; state:AccountState }
export interface AccountFrame {
  wallet:string; startedAt:number; capturedAt:number; mode:string;
  dexAccounts:DexAccount[]; collateralRates:Record<string,number>;
  equity:number|null; notional:number|null; leverage:number|null;
  positionCount:number; complete:boolean; reasons:string[];
  spotBalances?:{token:number;coin:string;total:string;hold?:string}[];
}
export interface LeveragePoint {
  time:number; value:number|null; equity:number|null; notional:number|null;
  positionCount:number; reason?:string;
}
export interface RecorderStatus { enabled:boolean; intervalMs:number; lastAttempt:number|null; lastSuccess:number|null; lastError:string|null; samples:number }
export interface LeverageResponse {
  estimated:LeveragePoint[]; recorded:LeveragePoint[]; latest:AccountFrame|null;
  recorder:RecorderStatus; job:{status:'idle'|'building'|'ready'|'error';progress:string;error?:string};
  warnings:string[];
}
export function aggregateFrame(input:Omit<AccountFrame,'equity'|'notional'|'leverage'|'positionCount'|'complete'|'reasons'>):AccountFrame {
  let equity=0,notional=0,count=0;const reasons:string[]=[];
  // Standard balances are per DEX; unified collateral is valued once per token.
  // Other shared-equity modes retain raw data until their valuation is supported.
  const unified=input.mode==='unifiedAccount';
  if(input.mode!=='disabled'&&!unified)reasons.push(`Equity aggregation for account mode ${input.mode} is not supported; raw states are still recorded.`);
  const seen=new Set<string>();
  for(const {dex,collateralToken,state} of input.dexAccounts){
    if(seen.has(dex)){reasons.push(`Duplicate DEX state: ${dex}`);continue;}seen.add(dex);
    const rate=input.collateralRates[String(collateralToken)];
    const e=Number(state.marginSummary.accountValue);
    const active=state.assetPositions.filter(p=>Number(p.position.szi)!==0);
    count+=active.length;
    if(!unified&&!Number.isFinite(e)){reasons.push(`Invalid equity for ${dex||'native'}`);continue;}
    if(((!unified&&e!==0)||active.length>0)&&(!Number.isFinite(rate)||rate<=0)){reasons.push(`Missing collateral conversion for token ${collateralToken}`);continue;}
    if(!unified)equity+=e*(rate||1);
    for(const {position:p} of active){const n=Number(p.positionValue);if(!Number.isFinite(n)){reasons.push(`Missing notional for ${p.coin}`);continue;}notional+=Math.abs(n)*rate;}
  }
  if(unified){
    if(!input.spotBalances)reasons.push('Unified account balances have not been returned.');
    else{
      const collateral=new Set(input.dexAccounts.map(d=>d.collateralToken)),seenTokens=new Set<number>();
      for(const balance of input.spotBalances){
        if(!collateral.has(balance.token))continue;
        if(seenTokens.has(balance.token)){reasons.push(`Duplicate collateral balance for token ${balance.token}`);continue;}seenTokens.add(balance.token);
        const total=Number(balance.total),rate=input.collateralRates[String(balance.token)];
        if(!Number.isFinite(total)){reasons.push(`Invalid unified balance for ${balance.coin}`);continue;}
        if(total!==0&&(!Number.isFinite(rate)||rate<=0)){reasons.push(`Missing collateral conversion for token ${balance.token}`);continue;}
        // Spot totals are the authoritative shared balance, including holds.
        // Never add per-DEX accountValue or position PnL a second time.
        equity+=total*(rate||1);
      }
    }
  }
  if(!input.dexAccounts.length)reasons.push('No DEX states returned');
  if(equity<=0)reasons.push('Account equity is non-positive');
  const complete=reasons.length===0;
  return {...input,equity:complete?equity:null,notional:complete?notional:null,leverage:complete?notional/equity:null,positionCount:count,complete,reasons};
}
export interface HistoricalInputs {
  frame:AccountFrame; fills:Fill[]; equity:[number,string][];
  prices:Record<string,Candle[]>; collateralByCoin:Record<string,number>;
  stepMs:number; maxEquityGapMs?:number;
}
export function interpolateEquity(samples:[number,string][],time:number,maxGap=4*3600000):number|null {
  let left:[number,string]|undefined,right:[number,string]|undefined;
  for(const sample of samples){if(sample[0]===time){const n=Number(sample[1]);return Number.isFinite(n)&&n>0?n:null;}if(sample[0]<time)left=sample;else{right=sample;break;}}
  if(!left||!right||right[0]-left[0]>maxGap)return null;
  const a=Number(left[1]),b=Number(right[1]);if(!Number.isFinite(a)||!Number.isFinite(b)||a<=0||b<=0)return null;
  return a+(b-a)*(time-left[0])/(right[0]-left[0]);
}
export function historicalLeverage({frame,fills,equity,prices,collateralByCoin,stepMs,maxEquityGapMs}:HistoricalInputs):LeveragePoint[]{
  if(!frame.complete||!fills.length)return [];
  const sorted=[...fills].reverse().sort((a,b)=>a.time-b.time).filter(f=>!f.coin.startsWith('@')&&(!f.coin.includes('/')||Object.hasOwn(collateralByCoin,f.coin))&&f.time<=frame.startedAt);
  if(!sorted.length)return [];
  const positions=new Map<string,number>();
  for(const dex of frame.dexAccounts)for(const {position:p} of dex.state.assetPositions)positions.set(p.coin,Number(p.szi));
  // A market without fills retains its observed size over this bounded window.
  // A market with fills is anchored to its first reported startPosition, even
  // when that market is already fully closed in the current account snapshot.
  const anchored=new Set<string>();for(const f of sorted)if(!anchored.has(f.coin)){positions.set(f.coin,Number(f.startPosition));anchored.add(f.coin);}
  const samples=[...equity].sort((a,b)=>a[0]-b[0]);
  const end=Math.min(frame.startedAt,samples.at(-1)?.[0]??0);
  const start=Math.ceil((sorted[0].time+1)/stepMs)*stepMs;
  const result:LeveragePoint[]=[];let cursor=0,gap=false;
  for(let time=start;time<=end;time+=stepMs){
    while(cursor<sorted.length&&sorted[cursor].time<=time){
      const f=sorted[cursor++],reported=Number(f.startPosition),prior=positions.get(f.coin)??0;
      if(!Number.isFinite(reported)||!Number.isFinite(Number(f.sz))||Math.abs(prior-reported)>Math.max(1e-7,Math.abs(prior)*1e-8))gap=true;
      positions.set(f.coin,reported+(f.side==='B'?1:-1)*Number(f.sz));
    }
    const e=interpolateEquity(samples,time,maxEquityGapMs);let notional=0,count=0,reason=gap?'Position continuity gap in fill history':undefined;
    if(e===null)reason??='No sufficiently close portfolio equity samples';
    for(const [coin,size] of positions){
      if(!Number.isFinite(size)){reason??=`Invalid position for ${coin}`;continue;}
      if(Math.abs(size)<1e-9)continue;count++;
      // Historical quote conversion must be historical too, not today's rate.
      if(collateralByCoin[coin]!==0){reason??=`Historical collateral conversion unavailable for ${coin}`;continue;}
      const bars=prices[coin]??[];let bar:Candle|undefined;
      for(const c of bars){if(c.time*1000+stepMs<=time)bar=c;else break;}
      if(!bar||time-(bar.time*1000+stepMs)>stepMs){reason??=`Missing historical price for ${coin}`;continue;}
      notional+=Math.abs(size)*bar.close;
    }
    result.push({time,value:reason||e===null?null:notional/e,equity:e,notional:reason?null:notional,positionCount:count,...reason?{reason}:{}});
  }
  return result;
}
