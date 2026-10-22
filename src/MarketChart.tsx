import { useEffect, useRef, useState } from 'react';
import { createChart, CandlestickSeries, LineSeries, HistogramSeries, ColorType, CrosshairMode, type IChartApi, type ISeriesApi, type UTCTimestamp, type Time } from 'lightweight-charts';
import type { Candle } from '../shared/market';
import { candleIndexAt } from '../shared/market';
import { executionGroups, type ScreenExecutionCluster } from '../shared/executions';
import type { ReplayEvent } from '../shared/replay';
import { OperationOverlay, type OverlayOptions } from './OperationOverlay';
interface Props { coin:string; barSeconds:number; candles:Candle[]; events:ReplayEvent[]; cursor:number; replay:boolean; options:OverlayOptions; chartType:'candles'|'line'; onSelect:(index:number)=>void; resetKey:string; selectedEvent?:ReplayEvent; focusKey:number; onSelectEvent:(event:ReplayEvent)=>void; }
export function MarketChart({coin,barSeconds,candles,events,cursor,replay,options,chartType,onSelect,resetKey,selectedEvent,focusKey,onSelectEvent}:Props) {
  const host=useRef<HTMLDivElement>(null);
  const api=useRef<{ chart:IChartApi; price:ISeriesApi<'Candlestick'>; line:ISeriesApi<'Line'>; volume:ISeriesApi<'Histogram'>; position:ISeriesApi<'Line'>; pnl:ISeriesApi<'Line'>; overlay:OperationOverlay; overlayOn: 'candles'|'line' } | null>(null);
  const latest=useRef({candles,onSelect,onSelectEvent});latest.current={candles,onSelect,onSelectEvent};
  const [hover,setHover]=useState<Candle>();
  useEffect(()=>{setHover(undefined);setHoverValues(undefined);},[coin,candles]);
  const [hoverValues,setHoverValues]=useState<{time:number;position:number|null;pnl:number|null}>();
  const [tradeTooltip,setTradeTooltip]=useState<{cluster:ScreenExecutionCluster;x:number;y:number}>();
  useEffect(()=>{setTradeTooltip(undefined);if(api.current){api.current.overlay.highlightedId=null;api.current.overlay.refresh();}},[coin,candles,replay,cursor]);
  useEffect(()=>{
    if(!host.current)return;
    const chart=createChart(host.current,{
      autoSize:true, layout:{background:{type:ColorType.Solid,color:'#11151e'},textColor:'#8d98ab',fontFamily:'ui-monospace, SFMono-Regular, monospace',fontSize:10,attributionLogo:true,panes:{separatorColor:'#252b39',separatorHoverColor:'#3a475f',enableResize:true}},
      grid:{vertLines:{color:'#1c2230'},horzLines:{color:'#1c2230'}},
      crosshair:{mode:CrosshairMode.Normal,vertLine:{color:'#63718a',labelBackgroundColor:'#34405a'},horzLine:{color:'#63718a',labelBackgroundColor:'#34405a'}},
      rightPriceScale:{borderColor:'#262e3e',minimumWidth:78},timeScale:{borderColor:'#262e3e',timeVisible:true,secondsVisible:false,rightOffset:4,minBarSpacing:.15},
      localization:{locale:'en-US',timeFormatter:(time:Time)=>new Date(Number(time)*1000).toISOString().replace('T',' ').slice(0,16)+' UTC'},
    });
    const price=chart.addSeries(CandlestickSeries,{upColor:'#29b69a',downColor:'#e56477',borderVisible:false,wickUpColor:'#29b69a',wickDownColor:'#e56477',priceFormat:{type:'price',precision:1,minMove:.1}});
    price.priceScale().applyOptions({scaleMargins:{top:.08,bottom:.2}});
    const line=chart.addSeries(LineSeries,{color:'#7d9aff',lineWidth:2,visible:false,lastValueVisible:false,priceLineVisible:false});
    const volume=chart.addSeries(HistogramSeries,{priceScaleId:'volume',priceFormat:{type:'volume'},lastValueVisible:false,priceLineVisible:false});
    volume.priceScale().applyOptions({scaleMargins:{top:.86,bottom:0}});
    const position=chart.addSeries(LineSeries,{color:'#6399f5',lineWidth:2,title:'Position',priceFormat:{type:'custom',formatter:(value:number)=>`${value.toLocaleString('en-US',{maximumFractionDigits:5})}`},priceLineVisible:false},1);
    const pnl=chart.addSeries(LineSeries,{color:'#2ec6a1',lineWidth:2,title:'Closed PnL',priceFormat:{type:'custom',formatter:(value:number)=>`$${value.toLocaleString('en-US',{maximumFractionDigits:4})}`},priceLineVisible:false},2);
    chart.panes()[0].setStretchFactor(6);chart.panes()[1].setStretchFactor(1);chart.panes()[2].setStretchFactor(1);
    const overlay=new OperationOverlay();price.attachPrimitive(overlay);
    function showMarker(id:unknown){
      const marker=overlay.markers.find(m=>m.id===id);
      if(!marker)return false;
      setTradeTooltip({cluster:marker.cluster,x:Math.max(8,Math.min(host.current!.clientWidth-278,marker.x+16)),y:Math.max(34,Math.min(host.current!.clientHeight-225,marker.y+72))});
      overlay.highlightedId=marker.id;overlay.refresh();return true;
    }
    chart.subscribeCrosshairMove(param=>{
      if(param.time){const i=candleIndexAt(latest.current.candles,Number(param.time));setHover(latest.current.candles[i]);}else setHover(undefined);
      const positionData=param.seriesData.get(position),pnlData=param.seriesData.get(pnl);
      setHoverValues(param.time?{time:Number(param.time),position:positionData&&'value' in positionData?positionData.value:null,pnl:pnlData&&'value' in pnlData?pnlData.value:null}:undefined);
      if(!showMarker(param.hoveredObjectId)){setTradeTooltip(undefined);overlay.highlightedId=null;overlay.refresh();}
    });
    chart.subscribeClick(param=>{
      const marker=overlay.markers.find(m=>m.id===param.hoveredObjectId);
      if(marker){setTradeTooltip(undefined);latest.current.onSelectEvent(marker.cluster.events.at(-1)!);return;}
      setTradeTooltip(undefined);overlay.highlightedId=null;overlay.refresh();
      if(param.time){const i=candleIndexAt(latest.current.candles,Number(param.time));if(i>=0)latest.current.onSelect(i);}
    });
    chart.timeScale().subscribeVisibleLogicalRangeChange(()=>{setTradeTooltip(undefined);overlay.highlightedId=null;overlay.refresh();});
    api.current={chart,price,line,volume,position,pnl,overlay,overlayOn:'candles'};
    return()=>{chart.remove();api.current=null;};
  },[]);
  useEffect(()=>{
    const a=api.current;if(!a)return;
    const full=candles.map(c=>({...c,time:c.time as UTCTimestamp}));
    const cutoff=replay ? candles[cursor]?.time ?? -Infinity : Infinity;
    const lastPrice=candles.at(-1)?.close??100;
    const precision=lastPrice>=100?2:lastPrice>=1?4:lastPrice>=.01?6:8;
    const format={type:'price' as const,precision,minMove:10**-precision};
    a.price.applyOptions({priceFormat:format});a.line.applyOptions({priceFormat:format});
    a.price.setData(full.map(c=>c.time<=cutoff?c:{time:c.time}));
    a.line.setData(full.map(c=>c.time<=cutoff?{time:c.time,value:c.close}:{time:c.time}));
    if(a.overlayOn!==chartType){(a.overlayOn==='candles'?a.price:a.line).detachPrimitive(a.overlay);(chartType==='candles'?a.price:a.line).attachPrimitive(a.overlay);a.overlayOn=chartType;}
    a.price.applyOptions({visible:chartType==='candles'});a.line.applyOptions({visible:chartType==='line'});
    a.volume.setData(full.map(c=>c.time<=cutoff?{time:c.time,value:c.volume,color:c.close>=c.open?'#29b69a30':'#e5647730'}:{time:c.time}));
    const fills=events.filter(e=>e.fill);let j=0,position:number|null=null,pnl=0;
    const positions:({time:UTCTimestamp;value:number}|{time:UTCTimestamp})[]=[],pnls:({time:UTCTimestamp;value:number}|{time:UTCTimestamp})[]=[];
    for(let i=0;i<full.length;i++){
      const candle=full[i];const end=candles[i+1]?.time ?? candle.time+(candles[1]?candles[1].time-candles[0].time:3600);
      while(j<fills.length&&fills[j].time/1000<end){const f=fills[j++];position=Number(f.fill!.startPosition)+(f.side==='B'?1:-1)*Number(f.size);pnl+=Number(f.fill!.closedPnl);}
      positions.push(!coin.startsWith('@')&&!coin.includes('/')&&candle.time<=cutoff&&position!==null?{time:candle.time,value:position}:{time:candle.time});
      pnls.push(candle.time<=cutoff&&j>0?{time:candle.time,value:pnl}:{time:candle.time});
    }
    a.position.setData(positions);a.pnl.setData(pnls);
    a.position.applyOptions({title:`Position (${coin})`});
    a.overlay.barSeconds=barSeconds;a.overlay.candles=candles;a.overlay.events=events;a.overlay.cutoff=replay?(candles[cursor+1]?.time??(candles[cursor]?.time??0)+barSeconds)-.001:Infinity;a.overlay.options=options;a.overlay.refresh();
  },[candles,events,cursor,replay,options,chartType,coin,barSeconds]);
  useEffect(()=>{if(replay&&candles.length)api.current?.chart.timeScale().setVisibleLogicalRange({from:Math.max(-5,cursor-100),to:Math.max(100,cursor+15)});},[cursor,replay,candles]);
  useEffect(()=>{const a=api.current;if(!a||!candles.length)return;const executions=executionGroups(candles,events,barSeconds);if(executions.length)a.chart.timeScale().setVisibleLogicalRange({from:Math.max(-2,executions[0].index-10),to:candles.length+7});else a.chart.timeScale().fitContent();},[candles,resetKey]);
  useEffect(()=>{
    const a=api.current;if(!a)return;
    a.overlay.selectedEvent=selectedEvent??null;a.overlay.refresh();
    if(!selectedEvent||!candles.length)return;
    const index=candleIndexAt(candles,selectedEvent.time/1000);if(index<0)return;
    const range=a.chart.timeScale().getVisibleLogicalRange();
    const span=Math.min(100,Math.max(24,range?range.to-range.from:70));
    a.chart.timeScale().setVisibleLogicalRange({from:index-span/2,to:index+span/2});
  },[selectedEvent,focusKey,candles,chartType]);
  const formatPrice=(value:number)=>value.toLocaleString('en-US',{maximumFractionDigits:value>=100?2:value>=1?4:value>=.01?6:8});
  const candle=(hover && (!replay || hover.time <= (candles[cursor]?.time ?? 0)) ? hover : undefined)??candles[replay?cursor:candles.length-1];
  return <div className="chart-frame"><div className="ohlc"><b>OHLC</b>{candle?<><span>O <em>{formatPrice(candle.open)}</em></span><span>H <em>{formatPrice(candle.high)}</em></span><span>L <em>{formatPrice(candle.low)}</em></span><span>C <em className={candle.close>=candle.open?'positive':'negative'}>{formatPrice(candle.close)}</em></span></>:<span>No candle selected</span>}<span className="utc-label">UTC</span></div><div className="chart-hover-values"><span>{hoverValues?new Date(hoverValues.time*1000).toISOString().replace('T',' ').slice(0,19)+' UTC':'Hover a candle to read position and PnL'}</span><span>Position <b>{hoverValues?.position!=null?hoverValues.position.toLocaleString('en-US',{maximumFractionDigits:8})+' '+coin:'—'}</b></span><span>Closed PnL <b>{hoverValues?.pnl!=null?'$'+hoverValues.pnl.toLocaleString('en-US',{maximumFractionDigits:6}):'—'}</b></span></div><div className="chart-host" ref={host} role="img" aria-label="Interactive candlestick chart with volume, historical fills, order lifetimes, position, and observed closed PnL"/>{tradeTooltip&&<div className="execution-tooltip" style={{left:tradeTooltip.x,top:tradeTooltip.y}} role="tooltip" aria-label="Execution details"><div className="tooltip-heading"><b className={tradeTooltip.cluster.side==='B'?'positive':'negative'}>{tradeTooltip.cluster.side==='B'?'BUY':'SELL'} · {tradeTooltip.cluster.count} fill{tradeTooltip.cluster.count===1?'':'s'}</b><small>Click to select</small></div><dl><dt>Quantity</dt><dd>{tradeTooltip.cluster.size.toLocaleString('en-US',{maximumFractionDigits:6})} {coin}</dd><dt>Average price</dt><dd>${formatPrice(tradeTooltip.cluster.price)}</dd><dt>Notional</dt><dd>${tradeTooltip.cluster.notional.toLocaleString('en-US',{maximumFractionDigits:2})}</dd><dt>Time (UTC)</dt><dd>{new Date(Math.min(...tradeTooltip.cluster.events.map(e=>e.time))).toISOString().replace('T',' ').slice(0,19)}{tradeTooltip.cluster.count>1&&<><br/>– {new Date(Math.max(...tradeTooltip.cluster.events.map(e=>e.time))).toISOString().replace('T',' ').slice(0,19)}</>}</dd></dl><p>{tradeTooltip.cluster.firstIndex===tradeTooltip.cluster.lastIndex?'Grouped by candle and side':'Nearby executions grouped at this zoom level'}</p></div>}<span className="pane-label position-label">POSITION · {hoverValues?.position!=null?hoverValues.position.toLocaleString('en-US',{maximumFractionDigits:8})+' '+coin:'OBSERVED FILLS'}</span><span className="pane-label pnl-label">CLOSED PNL · {hoverValues?.pnl!=null?'$'+hoverValues.pnl.toLocaleString('en-US',{maximumFractionDigits:6}):'BEFORE FEES & FUNDING'}</span></div>;
}
