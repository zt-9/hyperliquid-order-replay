import type { ISeriesPrimitive, IPrimitivePaneView, IPrimitivePaneRenderer, SeriesAttachedParameter, Logical } from 'lightweight-charts';
import { executionGroups, clusterExecutions, type ScreenExecutionCluster } from '../shared/executions';
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
      if(this.options.fills){
        const groups=executionGroups(this.candles,visible.filter(permitted),this.barSeconds);
        const clusters=clusterExecutions(groups,index=>scale.logicalToCoordinate(index as Logical),mediaSize.width);
        for(const cluster of clusters){
          const buy=cluster.side==='B';
          const bars=this.candles.slice(cluster.firstIndex,cluster.lastIndex+1);
          const anchorPrice=buy?Math.min(...bars.map(c=>c.low)):Math.max(...bars.map(c=>c.high));
          const anchor=series.priceToCoordinate(anchorPrice);
          if(anchor===null||anchor<0||anchor>mediaSize.height)continue;
          const py=Math.max(12,Math.min(mediaSize.height-12,anchor+(buy?17:-17)));
          const highlighted=this.highlightedId===cluster.id;
          ctx.globalAlpha=highlighted?1:.9;
          ctx.strokeStyle=buy?'#39cea4':'#f2798c';ctx.lineWidth=highlighted?1.8:1;
          ctx.beginPath();ctx.moveTo(cluster.x,anchor+(buy?2:-2));ctx.lineTo(cluster.x,py+(buy?-9:9));ctx.stroke();
          ctx.fillStyle=buy?'#123c33':'#4b2530';ctx.beginPath();ctx.roundRect(cluster.x-9,py-9,18,18,4);ctx.fill();ctx.stroke();
          ctx.font='600 10px -apple-system,BlinkMacSystemFont,sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
          ctx.fillStyle=buy?'#74e8c5':'#ffa8b6';ctx.fillText(buy?'B':'S',cluster.x,py+.5);
          if(highlighted){const avg=series.priceToCoordinate(cluster.price);if(avg!==null){ctx.setLineDash([2,3]);ctx.globalAlpha=.6;ctx.beginPath();ctx.moveTo(cluster.x-18,avg);ctx.lineTo(cluster.x+18,avg);ctx.stroke();ctx.setLineDash([]);}}
          this.markers.push({id:cluster.id,x:cluster.x,y:py,cluster});
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
