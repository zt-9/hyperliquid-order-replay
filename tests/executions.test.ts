import {test} from 'node:test';
import assert from 'node:assert/strict';
import {executionGroups,nextTradeBar,tradeBars} from '../shared/executions.js';
import type {ReplayEvent} from '../shared/replay.js';
const candles=[100,160,220,280].map(time=>({time,open:10,high:15,low:8,close:11,volume:1}));
const fill=(time:number,side:'A'|'B',size:string,price:string):ReplayEvent=>({id:`${time}`,time:time*1000,coin:'BTC',oid:1,side,size,price,kind:'fill',evidence:'reported'});
test('trade markers aggregate partial fills by candle and side with volume-weighted price',()=>{
 const events=[fill(101,'B','2','10'),fill(120,'B','1','13'),fill(130,'A','1','12')];
 const groups=executionGroups(candles,events,60);
 assert.equal(groups.length,2);assert.equal(groups[0].count,2);assert.equal(groups[0].size,3);assert.equal(groups[0].price,11);
 assert.equal(groups[1].side,'A');assert.equal(events.length,3);
});
test('trade replay skips empty candles and stops after the last observed execution',()=>{
 const groups=executionGroups(candles,[fill(101,'B','1','10'),fill(230,'A','1','12')],60);
 const bars=tradeBars(groups);assert.deepEqual(bars,[0,2]);
 assert.equal(nextTradeBar(bars,0,1),2);assert.equal(nextTradeBar(bars,2,1),undefined);assert.equal(nextTradeBar(bars,2,-1),0);
});
test('markers exclude executions outside candle coverage and put boundary fills in the next candle',()=>{
 const groups=executionGroups(candles,[fill(99,'B','1','10'),fill(160,'A','1','12'),fill(340,'B','1','10')],60);
 assert.equal(groups.length,1);assert.equal(groups[0].index,1);
});

test('zoom-aware clustering preserves fills and separates buy from sell',async()=>{
 const {clusterExecutions}=await import('../shared/executions.js');
 const groups=executionGroups(candles,[fill(101,'B','2','10'),fill(165,'B','1','13'),fill(170,'A','1','12')],60);
 const wide=clusterExecutions(groups,index=>index*40+20,300);
 assert.equal(wide.length,3);
 const narrow=clusterExecutions(groups,index=>index*4+20,300);
 assert.equal(narrow.length,2);
 const buy=narrow.find(g=>g.side==='B')!;
 assert.equal(buy.count,2);assert.equal(buy.size,3);assert.equal(buy.price,11);
 assert.equal(narrow.reduce((n,g)=>n+g.count,0),3);
});
test('offscreen executions never contribute to a visible marker',async()=>{
 const {clusterExecutions}=await import('../shared/executions.js');
 const groups=executionGroups(candles,[fill(101,'B','1','10'),fill(230,'A','1','12')],60);
 const clusters=clusterExecutions(groups,index=>index===0?-100:50,100);
 assert.equal(clusters.length,1);assert.equal(clusters[0].side,'A');
});

test('a single badge is centered on its candle, not a screen bucket or edge clamp',async()=>{
 const {clusterExecutions}=await import('../shared/executions.js');
 const groups=executionGroups(candles,[fill(101,'B','1','10')],60);
 for(const x of [2,17,31,47,98])assert.equal(clusterExecutions(groups,()=>x,100)[0].x,x);
});
test('crowded fills anchor to the latest real execution candle and track pan exactly',async()=>{
 const {clusterExecutions}=await import('../shared/executions.js');
 const groups=executionGroups(candles,[fill(101,'B','1','10'),fill(165,'B','1','13')],60);
 for(const offset of [0,3,17,31]){
  const cluster=clusterExecutions(groups,i=>20+i*4+offset,300)[0];
  assert.equal(cluster.x,24+offset);assert.equal(cluster.index,1);assert.equal(cluster.firstIndex,0);assert.equal(cluster.lastIndex,1);
 }
});
test('execution candle mapping rejects gaps and accepts exact next-candle boundaries',async()=>{
 const {executionCandleIndex}=await import('../shared/executions.js');
 const gapped=[candles[0],candles[2]];
 assert.equal(executionCandleIndex(gapped,fill(160,'B','1','10'),60),-1);
 assert.equal(executionCandleIndex(gapped,fill(220,'B','1','10'),60),1);
 assert.equal(executionCandleIndex(gapped,fill(280,'B','1','10'),60),-1);
});
test('merged badges use one real candle wick, and selection anchors to its own fill candle',async()=>{
 const {clusterExecutions,executionMarkerAnchor}=await import('../shared/executions.js');
 const varied=[{...candles[0],low:3,high:30},{...candles[1],low:7,high:19}];
 const first=fill(101,'B','1','10'),last=fill(165,'B','1','13');
 const cluster=clusterExecutions(executionGroups(varied,[first,last],60),i=>20+i*4,300)[0];
 assert.deepEqual(executionMarkerAnchor(cluster,varied),{index:1,price:7});
 assert.deepEqual(executionMarkerAnchor(cluster,varied,first),{index:0,price:3});
 assert.deepEqual(executionMarkerAnchor(cluster,varied,{...first,kind:'placement'}),{index:1,price:7});
});
