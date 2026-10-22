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

export interface ScreenExecutionCluster extends ExecutionGroup { id:string; x:number; firstIndex:number; lastIndex:number }
// Cluster in screen space so zooming in separates fills without losing records.
// Buy and sell groups stay separate; the badge is a summary, not an exact fill.
export function clusterExecutions(groups:ExecutionGroup[],xAt:(index:number)=>number|null,width:number,gap=32):ScreenExecutionCluster[]{
 const buckets=new Map<string,ScreenExecutionCluster>();
 for(const group of groups){
  const px=xAt(group.index);if(px===null||px<0||px>width)continue;
  const bucket=Math.floor(px/gap),key=`${group.side}:${bucket}`;
  const cluster=buckets.get(key)??{...group,id:key,x:Math.min(width-11,Math.max(11,(bucket+.5)*gap)),size:0,notional:0,price:0,count:0,events:[],firstIndex:group.index,lastIndex:group.index};
  cluster.size+=group.size;cluster.notional+=group.notional;cluster.count+=group.count;
  cluster.events.push(...group.events);cluster.price=cluster.notional/cluster.size;
  cluster.lastIndex=group.index;cluster.index=group.index;buckets.set(key,cluster);
 }
 return [...buckets.values()];
}
