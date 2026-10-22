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
    const index=executionCandleIndex(candles,event,barSeconds);
    if(index<0)continue;
    const key=`${index}:${event.side}`;
    const group=groups.get(key)??{index,side:event.side,size:0,notional:0,price:0,count:0,events:[]};
    group.size+=Number(event.size);group.notional+=Number(event.size)*Number(event.price);group.count++;group.events.push(event);group.price=group.notional/group.size;groups.set(key,group);
  }
  return [...groups.values()].sort((a,b)=>a.index-b.index);
}
export function tradeBars(groups:ExecutionGroup[]){return [...new Set(groups.map(g=>g.index))].sort((a,b)=>a-b);}
export function nextTradeBar(bars:number[],cursor:number,direction:1|-1){return direction===1?bars.find(i=>i>cursor):bars.findLast(i=>i<cursor);}

export interface ScreenExecutionCluster extends ExecutionGroup { id:string; x:number; firstIndex:number; lastIndex:number }
// Merge crowded summaries, but always anchor the badge to a real candle.
// The latest execution candle represents a merged group; never use an arbitrary
// pixel bucket center or clamp the marker away from its candle at the pane edge.
export function clusterExecutions(groups:ExecutionGroup[],xAt:(index:number)=>number|null,width:number,gap=26):ScreenExecutionCluster[]{
 const clusters:ScreenExecutionCluster[]=[];
 const lastBySide=new Map<'A'|'B',{cluster:ScreenExecutionCluster;firstX:number}>();
 for(const group of [...groups].sort((a,b)=>a.index-b.index)){
  const px=xAt(group.index);if(px===null||px<0||px>width)continue;
  const prior=lastBySide.get(group.side);
  if(prior&&px-prior.firstX<gap){
   const c=prior.cluster;c.size+=group.size;c.notional+=group.notional;c.count+=group.count;c.events.push(...group.events);
   c.price=c.notional/c.size;c.lastIndex=group.index;c.index=group.index;c.x=px;
  }else{
   const cluster:ScreenExecutionCluster={...group,id:`execution:${group.side}:${group.events[0].id}`,events:[...group.events],x:px,firstIndex:group.index,lastIndex:group.index};
   clusters.push(cluster);lastBySide.set(group.side,{cluster,firstX:px});
  }
 }
 return clusters;
}

// A fill is in [candle open, candle open + interval), never a gap or next bar.
export function executionCandleIndex(candles:Candle[],event:ReplayEvent,barSeconds:number){
 const index=candleIndexAt(candles,event.time/1000);
 return index>=0&&event.time/1000<candles[index].time+barSeconds?index:-1;
}

// Anchor to the wick of the representative candle, or the selected fill's candle.
export function executionMarkerAnchor(cluster:ScreenExecutionCluster,candles:Candle[],selected?:ReplayEvent|null){
 const selectedFill=selected?.kind==='fill'&&cluster.events.some(e=>e.id===selected.id);
 const index=selectedFill?candleIndexAt(candles,selected.time/1000):cluster.index;
 const candle=candles[index];
 return candle?{index,price:cluster.side==='B'?candle.low:candle.high}:null;
}
