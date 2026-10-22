import { candleIndexAt, type Candle } from './market.js';
import type { ReplayEvent } from './replay.js';
export interface ExecutionGroup {
  index: number; side: 'A'|'B'; size: number; notional: number; price: number; count: number; events: ReplayEvent[];
}
// Summaries are grouped by candle and side; original fills remain intact.
export function executionGroups(candles:Candle[],events:ReplayEvent[],barSeconds:number):ExecutionGroup[]{
  const groups=new Map<string,ExecutionGroup>();
  for(const event of events){
    if(event.kind!=='fill')continue;
    const index=candleIndexAt(candles,event.time/1000);
    if(index<0||event.time/1000>=candles[index].time+barSeconds)continue;
    const key=`${index}:${event.side}`;
    const group=groups.get(key)??{index,side:event.side,size:0,notional:0,price:0,count:0,events:[]};
    group.size+=Number(event.size);group.notional+=Number(event.size)*Number(event.price);group.count++;group.events.push(event);group.price=group.notional/group.size;groups.set(key,group);
  }
  return [...groups.values()].sort((a,b)=>a.index-b.index);
}
export function tradeBars(groups:ExecutionGroup[]){return [...new Set(groups.map(g=>g.index))].sort((a,b)=>a-b);}
export function nextTradeBar(bars:number[],cursor:number,direction:1|-1){return direction===1?bars.find(i=>i>cursor):bars.findLast(i=>i<cursor);}
