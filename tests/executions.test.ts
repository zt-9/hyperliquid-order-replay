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
