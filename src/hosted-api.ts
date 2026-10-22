// Static hosted edition: no public application server or database endpoints.
// Every visitor fetches public data from their own browser; credentials are never used.
import {PublicApiProvider,validWallet} from '../server/provider';
import {AccountProvider} from '../server/account-provider';
import type {Snapshot} from '../shared/replay';
import type {AccountFrame,LeverageResponse} from '../shared/leverage';
import {INTERVALS,type Interval} from '../shared/market';
const provider=new PublicApiProvider(),accounts=new AccountProvider(provider);
interface SavedWallet {snapshot?:Snapshot;latest:AccountFrame|null;recorded:LeverageResponse['recorded'];enabled:boolean;lastAttempt:number|null;lastSuccess:number|null;lastError:string|null}
const wallets=new Map<string,SavedWallet>(),loaded=new Map<string,Promise<SavedWallet>>(),captures=new Map<string,Promise<void>>(),syncs=new Map<string,Promise<Snapshot>>();
const candles=new Map<string,{at:number;payload:unknown}>(),inFlight=new Map<string,Promise<unknown>>();
let nextSync=0,storageWarning='';
function database():Promise<IDBDatabase>{return new Promise((resolve,reject)=>{const req=indexedDB.open('hyperliquid-replay',1);req.onupgradeneeded=()=>req.result.createObjectStore('wallets');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
async function read(wallet:string):Promise<SavedWallet>{
 const active=wallets.get(wallet);if(active)return active;
 let pending=loaded.get(wallet);if(pending)return pending;
 pending=(async()=>{let value:SavedWallet|undefined;try{const db=await database();value=await new Promise<SavedWallet|undefined>((resolve,reject)=>{const req=db.transaction('wallets').objectStore('wallets').get(wallet);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});db.close();}catch{storageWarning='Browser storage is unavailable; data will last only for this page session.';}
 const state=value??{latest:null,recorded:[],enabled:true,lastAttempt:null,lastSuccess:null,lastError:null};wallets.set(wallet,state);return state;})();loaded.set(wallet,pending);return pending;
}
async function save(wallet:string,state:SavedWallet){try{const db=await database();await new Promise<void>((resolve,reject)=>{const tx=db.transaction('wallets','readwrite');const store=tx.objectStore('wallets');store.put(state,wallet);const keys=store.getAllKeys();keys.onsuccess=()=>{if(keys.result.length>8)for(const key of keys.result.filter(k=>k!==wallet).slice(0,keys.result.length-8))store.delete(key);};tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});db.close();}catch{storageWarning='Browser storage could not be saved; this session still works.';}}
async function capture(wallet:string,state:SavedWallet){
 let pending=captures.get(wallet);if(pending)return pending;
 state.lastAttempt=Date.now();
 pending=(async()=>{try{const frame=await accounts.capture(wallet);state.latest=frame;state.lastSuccess=frame.capturedAt;state.lastError=null;
 if(state.recorded.length&&frame.capturedAt-state.recorded.at(-1)!.time>90000)state.recorded.push({time:frame.capturedAt-1,value:null,equity:null,notional:null,positionCount:0,reason:'Page closed or updates paused'});
 state.recorded.push({time:frame.capturedAt,value:frame.leverage,equity:frame.equity,notional:frame.notional,positionCount:frame.positionCount});state.recorded=state.recorded.slice(-2000);
 }catch(error){state.lastError=error instanceof Error?error.message:'Account update failed';}finally{await save(wallet,state);captures.delete(wallet);}})();captures.set(wallet,pending);return pending;
}
async function synchronize(wallet:string,state:SavedWallet){const existing=syncs.get(wallet);if(existing)return existing;if(Date.now()<nextSync)throw new Error('Please wait a few seconds before refreshing again.');nextSync=Date.now()+10000;
 const pending=provider.snapshot(wallet).then(async snapshot=>{state.snapshot=snapshot;await save(wallet,state);return snapshot;}).finally(()=>syncs.delete(wallet));syncs.set(wallet,pending);return pending;
}
export async function hostedRequest<T>(url:string,method='GET',signal?:AbortSignal):Promise<T>{
 if(signal?.aborted)throw new DOMException('Aborted','AbortError');
 const parsed=new URL(url,location.origin);
 let result:unknown;
 if(parsed.pathname==='/api/candles'){
  const coin=parsed.searchParams.get('coin')??'BTC',interval=parsed.searchParams.get('interval')??'1h',start=Number(parsed.searchParams.get('start')),end=Number(parsed.searchParams.get('end'));
  if(!/^[a-zA-Z0-9@:/._-]{1,60}$/.test(coin)||!Object.hasOwn(INTERVALS,interval)||!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<=start||end>Date.now()+86400000)throw new Error('Invalid candle request');
  const cached=candles.get(url);if(cached&&Date.now()-cached.at<60000)return cached.payload as T;
  let pending=inFlight.get(url);if(!pending){pending=provider.candles(coin,interval as Interval,start,end).then(rows=>{const payload={candles:rows,fetchedAt:Date.now(),requestedStart:start,requestedEnd:end};if(candles.size>=24)candles.delete(candles.keys().next().value!);candles.set(url,{at:Date.now(),payload});return payload;}).finally(()=>inFlight.delete(url));inFlight.set(url,pending);}result=await pending;
 }else{
  const match=parsed.pathname.match(/^\/api\/wallet\/(0x[0-9a-fA-F]{40})(\/.*)?$/);if(!match||!validWallet(match[1]))throw new Error('Invalid wallet request');
  const wallet=match[1].toLowerCase(),suffix=match[2]??'',state=await read(wallet);
  if(suffix===''&&method==='GET')result=state.snapshot??await synchronize(wallet,state);
  else if(suffix==='/sync'&&method==='POST')result=await synchronize(wallet,state);
  else if(suffix==='/leverage'&&method==='GET'){
   if(state.enabled&&(!state.lastAttempt||Date.now()-state.lastAttempt>=30000))await capture(wallet,state);
   result={latest:state.latest,recorded:state.recorded,estimated:[],recorder:{enabled:state.enabled,intervalMs:30000,lastAttempt:state.lastAttempt,lastSuccess:state.lastSuccess,lastError:state.lastError,samples:state.recorded.filter(p=>p.value!==null).length},job:{status:'ready',progress:'Browser account snapshots'},warnings:[...(storageWarning?[storageWarning]:[]),'Hosted edition: account snapshots update only while this page is open. History stays in this browser.']} satisfies LeverageResponse;
  }else if((suffix==='/recording/start'||suffix==='/recording/stop')&&method==='POST'){state.enabled=suffix.endsWith('/start');await save(wallet,state);if(state.enabled)await capture(wallet,state);result={enabled:state.enabled};}
  else if(suffix==='/leverage/rebuild'&&method==='POST')result={status:'ready'};
  else throw new Error('Unsupported hosted request');
 }
 if(signal?.aborted)throw new DOMException('Aborted','AbortError');return result as T;
}
