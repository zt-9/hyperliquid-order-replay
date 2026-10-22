import type { ISeriesPrimitive, IPrimitivePaneView, IPrimitivePaneRenderer, SeriesAttachedParameter, Logical } from 'lightweight-charts';
import type { Candle } from '../shared/market';
import { candleIndexAt, interpolateLogical } from '../shared/market';
import type { ReplayEvent } from '../shared/replay';
export interface OverlayOptions { fills: boolean; orders: boolean; labels: boolean; buys: boolean; sells: boolean; currentOnly: boolean }
export class OperationOverlay implements ISeriesPrimitive {
  private attachedTo?: SeriesAttachedParameter;
  candles: Candle[] = [];
  events: ReplayEvent[] = [];
  cutoff = Infinity;
  options: OverlayOptions = { fills:true, orders:true, labels:false, buys:true, sells:true, currentOnly:false };
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
      if(this.options.fills) for(const event of visible) {
        if(event.kind!=='fill' || !permitted(event) || event.time/1000 < first || event.time/1000 > last + 86400) continue;
        const px=x(event.time/1000), py=series.priceToCoordinate(Number(event.price));
        if(px===null || py===null || px<0 || px>mediaSize.width || py<0 || py>mediaSize.height) continue;
        const radius=Math.min(13,Math.max(3,Math.sqrt(Number(event.size)*Number(event.price))/40));
        const color=event.side==='B'?'#2dd4aa':'#fa6b7c';
        ctx.globalAlpha=.22;ctx.fillStyle=color;ctx.beginPath();ctx.arc(px,py,radius,0,Math.PI*2);ctx.fill();
        ctx.globalAlpha=.95;ctx.strokeStyle=color;ctx.lineWidth=1.2;ctx.stroke();
        ctx.beginPath();ctx.moveTo(px-2,py+(event.side==='B'?2:-2));ctx.lineTo(px,py+(event.side==='B'?-2:2));ctx.lineTo(px+2,py+(event.side==='B'?2:-2));ctx.stroke();
        if(this.options.labels) {ctx.font='10px ui-monospace,monospace';ctx.fillStyle=color;ctx.fillText(`${event.side==='B'?'+':'−'}${event.size}`,px+radius+3,py+3);}
      }
      ctx.restore();
    });
  }};
  attached(param: SeriesAttachedParameter) { this.attachedTo=param; }
  detached() {this.attachedTo=undefined;}
  paneViews() { return [this.view]; }
  refresh() { this.attachedTo?.requestUpdate(); }
}
