import{test}from'node:test';
import assert from'node:assert/strict';
import{DatabaseSync}from'node:sqlite';
import{aggregateFrame,historicalLeverage,interpolateEquity,type AccountFrame,type DexAccount}from'../shared/leverage.js';
import type{AccountState,Candle}from'../shared/market.js';
import type{Fill}from'../shared/replay.js';
import{AccountRecorder}from'../server/recorder.js';
import{AccountProvider}from'../server/account-provider.js';
import{PublicApiProvider}from'../server/provider.js';
const wallet='0x'+'1'.repeat(40);
const position=(coin:string,szi:string,positionValue:string)=>({position:{coin,szi,positionValue,entryPx:'10',unrealizedPnl:'0',liquidationPx:null}});
const dex=(name:string,equity:string,positions:AccountState['assetPositions'],collateralToken=0):DexAccount=>({dex:name,collateralToken,state:{marginSummary:{accountValue:equity,totalNtlPos:'0'},assetPositions:positions}});
const frame=(dexAccounts:DexAccount[],mode='disabled')=>aggregateFrame({wallet,mode,dexAccounts,startedAt:300000,capturedAt:300500,collateralRates:{'0':1,'360':1.02}});
test('wallet leverage adds absolute exposure across every DEX, never nets opposing positions',()=>{
 const f=frame([dex('','100',[position('BTC','2','20'),position('ETH','-3','60')]),dex('xyz','50',[position('xyz:GOLD','-1','30')])]);
 assert.equal(f.positionCount,3);assert.equal(f.notional,110);assert.equal(f.equity,150);assert.equal(f.leverage,110/150);
});
test('collateral conversion is applied consistently to equity and notional',()=>{
 const f=frame([dex('','100',[position('BTC','1','50')]),dex('km','100',[position('km:TEST','1','20')],360)]);
 assert.equal(f.equity,202);assert.equal(f.notional,70.4);
});
test('unsupported shared-equity modes and missing conversion are withheld rather than double counted',()=>{
 assert.equal(frame([dex('','100',[position('BTC','1','50')])],'unifiedAccount').leverage,null);
 assert.equal(frame([dex('km','100',[position('km:TEST','1','50')],999)]).leverage,null);
 assert.equal(frame([dex('','0',[])]).leverage,null);
});
const f=frame([dex('','70',[position('BTC','2','20'),position('ETH','3','60')]),dex('xyz','30',[position('xyz:GOLD','1','30')])]);
const fill=(coin:string,time:number,startPosition:string,sz:string,side:'A'|'B'):Fill=>({coin,time,startPosition,sz,side,oid:1,tid:time,px:'10',closedPnl:'0',fee:'0'});
const fills=[fill('SOL',180000,'4','4','A'),fill('BTC',60000,'1','1','B')];
const candles=(close:number):Candle[]=>[0,60,120,180,240].map(time=>({time,open:close,high:close,low:close,close,volume:1}));
const prices={BTC:candles(10),ETH:candles(20),'xyz:GOLD':candles(30),SOL:candles(5)};
const input={frame:f,fills,equity:[[0,'100'],[300000,'100']] as [number,string][],prices,collateralByCoin:{BTC:0,ETH:0,'xyz:GOLD':0,SOL:0},stepMs:60000};
test('historical leverage includes unchanged positions and markets closed before the current snapshot',()=>{
 const points=historicalLeverage(input);
 assert.equal(points[0].time,120000);assert.equal(points[0].positionCount,4);assert.equal(points[0].value,1.3);
 assert.equal(points[1].positionCount,3);assert.equal(points[1].value,1.1);
});
test('historical calculation never uses a candle close after the sample timestamp',()=>{
 const btc=candles(10);btc[2].close=999;
 const points=historicalLeverage({...input,prices:{...prices,BTC:btc}});
 assert.equal(points[0].value,1.3);
});
test('a missing market price makes a gap instead of understating total exposure',()=>{
 const points=historicalLeverage({...input,prices:{...prices,ETH:[]}});
 assert.ok(points.every(p=>p.value===null&&p.reason?.includes('ETH')));
});
test('missing, distant and non-positive equity samples do not produce leverage',()=>{
 assert.equal(interpolateEquity([[0,'100'],[10000,'200']],5000,10000),150);
 assert.equal(interpolateEquity([[0,'100'],[10000,'200']],5000,1000),null);
 assert.equal(interpolateEquity([[0,'0'],[10000,'200']],5000),null);
 assert.equal(interpolateEquity([[0,'100']],5000),null);
});
test('position discontinuity invalidates affected historical samples',()=>{
 const points=historicalLeverage({...input,fills:[fill('BTC',180000,'99','1','B'),...fills]});
 assert.ok(points.find(p=>p.time===180000)?.reason?.includes('continuity'));
});
test('recorder persists watches, complete raw frames, failures and restores status without the page',async()=>{
 const db=new DatabaseSync(':memory:');let fail=false;
 const accounts={capture:async()=>{if(fail)throw new Error('DEX unavailable');return f;}} as unknown as AccountProvider;
 const recorder=new AccountRecorder(db,accounts);recorder.register(wallet);await recorder.capture(wallet);
 assert.equal(recorder.status(wallet).samples,1);assert.equal(recorder.latest(wallet)?.positionCount,3);
 fail=true;await assert.rejects(()=>recorder.capture(wallet));
 assert.equal(recorder.status(wallet).lastError,'DEX unavailable');assert.ok(recorder.points(wallet).some(p=>p.value===null));
 const restored=new AccountRecorder(db,accounts);assert.equal(restored.status(wallet).enabled,true);assert.equal(restored.status(wallet).samples,1);
 db.close();
});
test('account provider refuses a partial DEX capture',async()=>{
 const api=new PublicApiProvider();api.info=async<T>(type:string,_wallet?:string,extra:Record<string,unknown>={})=>{
  if(type==='perpDexs')return [null,{name:'xyz'}] as T;
  if(type==='meta')return {collateralToken:0,universe:[{name:extra.dex?'xyz:GOLD':'BTC'}]} as T;
  if(type==='userAbstraction')return 'disabled' as T;
  if(type==='clearinghouseState'&&extra.dex==='xyz')throw new Error('DEX unavailable');
  return dex('','100',[position('BTC','1','10')]).state as T;
 };
 await assert.rejects(()=>new AccountProvider(api).capture(wallet),/DEX unavailable/);
});
test('recording gaps remain explicit instead of drawing continuous leverage through downtime',()=>{
 const db=new DatabaseSync(':memory:');const recorder=new AccountRecorder(db,{} as AccountProvider);const now=Date.now();
 for(const time of [now-180000,now])db.prepare('INSERT INTO account_frames(wallet,captured_at,payload) VALUES(?,?,?)').run(wallet,time,JSON.stringify({...f,capturedAt:time}));
 const points=recorder.points(wallet);assert.equal(points.length,3);assert.equal(points[1].value,null);assert.match(points[1].reason!,/offline/);db.close();
});
test('fill pagination fixes its cutoff, overlaps boundaries, and caps the newest 10000 fills',async()=>{
 const api=new PublicApiProvider();const starts:number[]=[];const ends:number[]=[];
 api.info=async<T>(_type:string,_wallet?:string,extra:Record<string,unknown>={})=>{
  const start=Math.max(1,Number(extra.startTime));starts.push(Number(extra.startTime));ends.push(Number(extra.endTime));
  return Array.from({length:2000},(_,i)=>({...fill('BTC',start+i,'0','1','B'),tid:start+i})) as T;
 };
 const result=await new AccountProvider(api).fills(wallet,20000);
 assert.equal(result.length,10000);assert.ok(ends.every(t=>t===20000));assert.equal(starts[1],2000);assert.ok(result[0].time>result.at(-1)!.time);
});
test('recorded chart metrics are persisted independently of raw JSON payloads',async()=>{
 const db=new DatabaseSync(':memory:');const fresh={...f,startedAt:Date.now()-10,capturedAt:Date.now()};
 const recorder=new AccountRecorder(db,{capture:async()=>fresh} as unknown as AccountProvider);
 recorder.register(wallet);await recorder.capture(wallet);
 const point=recorder.points(wallet)[0];assert.equal(point.value,f.leverage);assert.equal(point.positionCount,3);
 const row=db.prepare('SELECT leverage,position_count FROM account_frames').get()!;assert.equal(row.leverage,f.leverage);assert.equal(row.position_count,3);db.close();
});

test('unified accounts count each shared collateral balance once across all DEXs',()=>{
 const input=frame([dex('','999',[position('BTC','1','50')]),dex('xyz','999',[position('xyz:GOLD','1','25')]),dex('km','123',[position('km:TEST','1','20')],360)]);
 const result=aggregateFrame({...input,mode:'unifiedAccount',spotBalances:[{coin:'USDC',token:0,total:'100',hold:'60'},{coin:'USDH',token:360,total:'50',hold:'10'},{coin:'UNRELATED',token:555,total:'100000'}]});
 assert.equal(result.complete,true);assert.equal(result.equity,151);assert.equal(result.notional,95.4);assert.equal(result.leverage,95.4/151);assert.equal(result.positionCount,3);
});
test('unified account equity requires shared balances and rejects duplicate collateral rows',()=>{
 const input=frame([dex('','100',[position('BTC','1','50')])]);
 assert.equal(aggregateFrame({...input,mode:'unifiedAccount'}).equity,null);
 assert.equal(aggregateFrame({...input,mode:'unifiedAccount',spotBalances:[{coin:'USDC',token:0,total:'100'},{coin:'USDC',token:0,total:'100'}]}).equity,null);
});
test('a valid raw account capture is successful even when its equity mode is unsupported',async()=>{
 const db=new DatabaseSync(':memory:');const unsupported=frame([dex('','100',[position('BTC','1','50')])],'portfolioMargin');
 const accounts={capture:async()=>unsupported} as unknown as AccountProvider;
 const recorder=new AccountRecorder(db,accounts);recorder.register(wallet);await recorder.capture(wallet);
 assert.equal(recorder.status(wallet).lastSuccess,unsupported.capturedAt);assert.equal(recorder.status(wallet).lastError,null);assert.equal(recorder.status(wallet).samples,1);assert.equal(recorder.latest(wallet)?.complete,false);
 db.close();
});
