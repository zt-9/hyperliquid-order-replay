import {test} from 'node:test';
import assert from 'node:assert/strict';
import {candleIndexAt,interpolateLogical,type Candle} from '../shared/market.js';
import {PublicApiProvider} from '../server/provider.js';
const candles=[100,200,300].map(time=>({time,open:10,high:12,low:9,close:11,volume:1}));
test('candle seeking handles exact boundaries, gaps, and missing coverage',()=>{
 assert.equal(candleIndexAt(candles,99),-1);
 assert.equal(candleIndexAt(candles,100),0);
 assert.equal(candleIndexAt(candles,299),1);
 assert.equal(candleIndexAt(candles,300),2);
 assert.equal(candleIndexAt([],100),-1);
});
test('candle provider bounds retrieval, sorts, deduplicates and rejects invalid prices',async()=>{
 const provider=new PublicApiProvider();let params:Record<string,unknown>={};
 provider.info=async<T>(_type:string,_wallet?:string,extra:Record<string,unknown>={})=>{
  params=extra;
  return [{t:200000,o:'10',h:'12',l:'9',c:'11',v:'1'},{t:100000,o:'9',h:'10',l:'8',c:'9',v:'2'},{t:200000,o:'10',h:'12',l:'9',c:'11',v:'3'},{t:300000,o:'NaN',h:'12',l:'9',c:'11',v:'1'}] as T;
 };
 const result=await provider.candles('BTC','1m',0,999999999);
 assert.equal(result.length,2);assert.equal(result[0].time,100);assert.equal(result[1].volume,3);
 assert.ok((params.req as {startTime:number}).startTime>=999999999-60*1000*4990);
});

test('sub-candle operations interpolate pixels without passing fractional logical indices',()=>{
 const at=(index:number)=>{assert.ok(Number.isInteger(index));return index*10;};
 assert.equal(interpolateLogical(4.25,at),42.5);
 assert.equal(interpolateLogical(-.5,at),-5);
 assert.equal(interpolateLogical(4,()=>null),null);
});
