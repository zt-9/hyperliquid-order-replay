import type { ISeriesPrimitive, IPrimitivePaneView, IPrimitivePaneRenderer, SeriesAttachedParameter, Logical } from 'lightweight-charts';
import { executionGroups, clusterExecutions, executionCandleIndex, executionMarkerAnchor, type ScreenExecutionCluster } from '../shared/executions';
import type { Candle } from '../shared/market';
import { candleIndexAt, interpolateLogical } from '../shared/market';
import type { ReplayEvent } from '../shared/replay';
export interface OverlayOptions { fills: boolean; orders: boolean; buys: boolean; sells: boolean; currentOnly: boolean }
export class OperationOverlay implements ISeriesPrimitive {
  private attachedTo?: SeriesAttachedParameter;
  candles: Candle[] = [];
  events: ReplayEvent[] = [];
  cutoff = Infinity;
  barSeconds = 60;
  highlightedId: string | null = null;
  selectedEvent:ReplayEvent|null=null;
  markers: { id:string; x:number; y:number; cluster:ScreenExecutionCluster }[] = [];
  options: OverlayOptions = { fills:true, orders:false, buys:true, sells:true, currentOnly:false };
  private view: IPrimitivePaneView = { zOrder: () => 'top', renderer: () => this.renderer };
  private renderer: IPrimitivePaneRenderer = { draw: target => {
    const attached = this.attachedTo;
    if (!attached || !this.candles.length) return;
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      const { chart, series } = attached;
      const scale = chart.timeScale();
      const first = this.candles[0].time;
      const last = this.candles.at(-1)!.time;
      const x = (seconds: number) => {
        const index = candleIndexAt(this.candles, seconds);
        const step = this.candles[1] ? this.candles[1].time - first : 3600;
        const logical = index < 0 ? (seconds-first)/step : index + (seconds - this.candles[index].time) / (this.candles[index+1] ? this.candles[index+1].time-this.candles[index].time : step);
        // The library requires integer logical indices. Interpolate pixel
        // coordinates for executions that happen between candle boundaries.
        return interpolateLogical(logical, index => scale.logicalToCoordinate(index as Logical));
      };
      const visible = this.events.filter(e => e.time / 1000 <= this.cutoff);
      const statuses = new Map(visible.filter(e=>e.kind==='status').map(e=>[e.oid,e]));
      const permitted = (e: ReplayEvent) => e.side === 'B' ? this.options.buys : this.options.sells;
      ctx.save(); ctx.beginPath(); ctx.rect(0,0,mediaSize.width,mediaSize.height); ctx.clip();
      if (this.options.orders) for (const event of visible) {
        if (event.kind !== 'placement' || !permitted(event)) continue;
        const terminal = statuses.get(event.oid);
        if (this.options.currentOnly && terminal) continue;
        const end = Math.min(terminal ? terminal.time / 1000 : this.cutoff, last + (this.candles[1]?.time-first || 3600));
        if (end < first || event.time/1000 > last) continue;
        const a = x(Math.max(first,event.time/1000)), b = x(end), py = series.priceToCoordinate(Number(event.price));
        if (a === null || b === null || py === null || py < 0 || py > mediaSize.height || b < 0 || a > mediaSize.width) continue;
        const color = event.side === 'B' ? '#2bbfa4' : '#ed6a78';
        ctx.strokeStyle = color; ctx.globalAlpha = terminal ? .24 : .55;
        ctx.lineWidth = 1; ctx.setLineDash([3,5]); ctx.beginPath();ctx.moveTo(a,py);ctx.lineTo(b,py);ctx.stroke();ctx.setLineDash([]);
        ctx.globalAlpha=.75;
        if(a>=0) {ctx.beginPath();ctx.moveTo(a,py-3);ctx.lineTo(a+3,py);ctx.lineTo(a,py+3);ctx.lineTo(a-3,py);ctx.closePath();ctx.stroke();}
        if(terminal && b>=0 && b<=mediaSize.width) {ctx.beginPath();ctx.moveTo(b-2,py-2);ctx.lineTo(b+2,py+2);ctx.moveTo(b-2,py+2);ctx.lineTo(b+2,py-2);ctx.stroke();}
      }
      this.markers=[];
      let selectionShown=false;
      const selectedIndex=this.selectedEvent?executionCandleIndex(this.candles,this.selectedEvent,this.barSeconds):-1;
      if(this.options.fills){
        const groups=executionGroups(this.candles,visible.filter(permitted),this.barSeconds);
        const clusters=clusterExecutions(groups,index=>scale.logicalToCoordinate(index as Logical),mediaSize.width);
        for(const cluster of clusters){
          const buy=cluster.side==='B';
          const selected=this.selectedEvent?.kind==='fill'&&cluster.events.some(e=>e.id===this.selectedEvent?.id);
          const anchorInfo=executionMarkerAnchor(cluster,this.candles,this.selectedEvent);if(!anchorInfo)continue;
          const anchorIndex=anchorInfo.index;
          const px=scale.logicalToCoordinate(anchorIndex as Logical);if(px===null||px<0||px>mediaSize.width)continue;
          const anchor=series.priceToCoordinate(anchorInfo.price);
          if(anchor===null||anchor<0||anchor>mediaSize.height)continue;
          const py=anchor+(buy?17:-17);
          if(selected)selectionShown=true;
          const highlighted=this.highlightedId===cluster.id||selected;
          ctx.globalAlpha=highlighted?1:.9;
          ctx.strokeStyle=buy?'#39cea4':'#f2798c';ctx.lineWidth=highlighted?1.8:1;
          ctx.beginPath();ctx.moveTo(px,anchor+(buy?2:-2));ctx.lineTo(px,py+(buy?-9:9));ctx.stroke();
          ctx.fillStyle=buy?(selected?'#226a54':'#123c33'):(selected?'#7d3549':'#4b2530');ctx.beginPath();ctx.roundRect(px-9,py-9,18,18,4);ctx.fill();ctx.stroke();
          if(selected){ctx.save();ctx.globalAlpha=1;ctx.strokeStyle='#ffe173';ctx.shadowColor='#ffd447';ctx.shadowBlur=9;ctx.lineWidth=2;ctx.beginPath();ctx.roundRect(px-12,py-12,24,24,6);ctx.stroke();ctx.restore();}
          ctx.font='600 10px -apple-system,BlinkMacSystemFont,sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
          ctx.fillStyle=buy?'#74e8c5':'#ffa8b6';ctx.fillText(buy?'B':'S',px,py+.5);

          this.markers.push({id:cluster.id,x:px,y:py,cluster});
        }
      }
      const selected=this.selectedEvent;
      if(selected?.kind==='fill'&&!selectionShown&&selectedIndex>=0&&selected.time/1000<=this.cutoff){
        const bar=this.candles[selectedIndex],px=scale.logicalToCoordinate(selectedIndex as Logical),buy=selected.side==='B';
        const anchor=series.priceToCoordinate(buy?bar.low:bar.high);
        if(px!==null&&anchor!==null&&px>=0&&px<=mediaSize.width){
          const py=anchor+(buy?17:-17);
          ctx.globalAlpha=1;ctx.strokeStyle=buy?'#62e8bf':'#ffa4b6';ctx.fillStyle=buy?'#226a54':'#7d3549';ctx.lineWidth=2;
          ctx.beginPath();ctx.roundRect(px-10,py-10,20,20,4);ctx.fill();ctx.stroke();ctx.save();ctx.strokeStyle='#ffe173';ctx.shadowColor='#ffd447';ctx.shadowBlur=9;ctx.lineWidth=2;ctx.beginPath();ctx.roundRect(px-13,py-13,26,26,6);ctx.stroke();ctx.restore();
          ctx.font='600 10px -apple-system,BlinkMacSystemFont,sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle=buy?'#b8ffe5':'#ffd4dd';ctx.fillText(buy?'B':'S',px,py+.5);
        }
      }
      ctx.restore();
    });
  }};
  hitTest(x:number,y:number) {
    const marker=this.markers.find(m=>Math.abs(m.x-x)<=12&&Math.abs(m.y-y)<=12);
    return marker?{externalId:marker.id,cursorStyle:'pointer',zOrder:'top' as const,hitTestPriority:2,distance:Math.hypot(marker.x-x,marker.y-y)}:null;
  }
  attached(param: SeriesAttachedParameter) { this.attachedTo=param; }
  detached() {this.attachedTo=undefined;}
  paneViews() { return [this.view]; }
  refresh() { this.attachedTo?.requestUpdate(); }
}
