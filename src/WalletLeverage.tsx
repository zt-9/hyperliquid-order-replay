import {useEffect,useRef,useState} from 'react';
import {createChart,LineSeries,ColorType,LineStyle,type IChartApi,type ISeriesApi,type UTCTimestamp,type Time} from 'lightweight-charts';
import type {LeveragePoint,LeverageResponse} from '../shared/leverage';
function segments(points:LeveragePoint[],cutoff:number){
 const result:LeveragePoint[][]=[];let current:LeveragePoint[]=[];
 for(const p of points){if(p.time>cutoff)break;if(p.value===null){if(current.length)result.push(current);current=[];}else current.push(p);}
 if(current.length)result.push(current);return result;
}
export function WalletLeverage({data,wallet,cutoff,onRebuild,onRecording}:{data:LeverageResponse|null;wallet:string;cutoff:number;onRebuild:()=>void;onRecording:()=>void}){
 const host=useRef<HTMLDivElement>(null),chart=useRef<IChartApi|null>(null),lines=useRef<ISeriesApi<'Line'>[]>([]);
 const [hover,setHover]=useState<{point:LeveragePoint;source:string}>();
 useEffect(()=>setHover(undefined),[cutoff,wallet]);
 const points=useRef<{estimated:LeveragePoint[];recorded:LeveragePoint[]}>({estimated:[],recorded:[]});
 useEffect(()=>{
  if(!host.current)return;
  const c=createChart(host.current,{autoSize:true,layout:{background:{type:ColorType.Solid,color:'#101b25'},textColor:'#7f96aa',fontSize:9,attributionLogo:true},grid:{vertLines:{color:'#1c2b36'},horzLines:{color:'#1c2b36'}},rightPriceScale:{borderVisible:false,minimumWidth:50},timeScale:{borderVisible:false,timeVisible:true,secondsVisible:false,rightOffset:3},localization:{timeFormatter:(t:Time)=>new Date(Number(t)*1000).toISOString().replace('T',' ').slice(0,19)+' UTC'}});
  c.subscribeCrosshairMove(param=>{
   if(!param.time){setHover(undefined);return;}
   const time=Number(param.time)*1000;
   const observed=points.current.recorded.find(p=>Math.floor(p.time/1000)===Math.floor(time/1000));
   const estimated=points.current.estimated.find(p=>Math.floor(p.time/1000)===Math.floor(time/1000));
   const point=observed??estimated;setHover(point?{point,source:observed?'Recorded':'Estimated'}:undefined);
  });chart.current=c;
  return()=>{c.remove();chart.current=null;lines.current=[];};
 },[wallet]);
 useEffect(()=>{
  const c=chart.current;if(!c||!data)return;
  const previous=c.timeScale().getVisibleLogicalRange();
  for(const line of lines.current)c.removeSeries(line);lines.current=[];
  points.current={estimated:data.estimated.filter(p=>p.time<=cutoff),recorded:data.recorded.filter(p=>p.time<=cutoff)};
  for(const [source,color] of [['estimated','#c9a271'],['recorded','#4ed2ac']] as const){
   for(const segment of segments(data[source],cutoff)){
    const line=c.addSeries(LineSeries,{color,lineWidth:2,lineStyle:source==='estimated'?LineStyle.Dashed:LineStyle.Solid,pointMarkersVisible:true,pointMarkersRadius:source==='recorded'?3:1,lastValueVisible:false,priceLineVisible:false,priceFormat:{type:'custom',formatter:(n:number)=>n.toFixed(2)+'×'}});
    const unique=new Map<number,number>();for(const p of segment)unique.set(Math.floor(p.time/1000),p.value!);
    line.setData([...unique].map(([time,value])=>({time:time as UTCTimestamp,value})));lines.current.push(line);
   }
  }
  // Fit both sources initially; preserve the user's chosen zoom on later samples.
  if(previous&&previous.to-previous.from>1)c.timeScale().setVisibleLogicalRange(previous);else c.timeScale().fitContent();
 },[data,cutoff,wallet]);
 const frame=data?.latest,rec=data?.recorder;
 const recorded=data?.recorded.filter(p=>p.value!==null&&p.time<=cutoff).length??0;
 const estimated=data?.estimated.filter(p=>p.value!==null&&p.time<=cutoff).length??0;
 return <section className="wallet-observatory"><div className="section-kicker"><span>01 / WALLET OVERVIEW</span><span className={rec?.enabled?'recording-state':'recording-state paused'}><i/>{rec?.enabled?(rec.lastSuccess&&Date.now()-rec.lastSuccess>90000?'Recording delayed':'Recording every 30s'):'Recorder paused'}<button onClick={onRecording}>{rec?.enabled?'Pause':'Start recording'}</button></span></div><div className="observatory-grid"><div className="wallet-numbers"><small className="snapshot-caption">LATEST RECORDED SNAPSHOT</small><div><span>Total perp equity</span><strong>{frame?.equity!==null&&frame?.equity!==undefined?'$'+frame.equity.toLocaleString('en-US',{maximumFractionDigits:0}):'—'}</strong></div><div><span>Wallet effective leverage</span><strong className="accent-value">{frame?.leverage!==null&&frame?.leverage!==undefined?frame.leverage.toFixed(2)+'×':'—'}</strong></div><div className="wallet-scope"><b>{frame?.positionCount??'—'} positions</b><span>{frame?.dexAccounts.filter(d=>d.state.assetPositions.some(p=>Number(p.position.szi)!==0)).length??'—'} active DEXs · {frame?.dexAccounts.length??'—'} checked</span></div><small>{frame?`Observed ${new Date(frame.capturedAt).toISOString().slice(11,19)} UTC`:'Collecting all account states…'}</small></div><div className="wallet-leverage-plot"><div className="leverage-heading"><h2>Effective leverage <span>All wallet positions</span></h2><div><span className="legend-estimated">● Estimated</span><span className="legend-recorded">● Recorded</span><button disabled={data?.job.status==='building'} onClick={onRebuild}>↻ Backfill</button></div></div><div ref={host} className="wallet-leverage-canvas" role="img" aria-label="Wallet-wide historical effective leverage chart, estimated backfill and recorded all-DEX account snapshots"/>{!recorded&&!estimated&&<span className="leverage-empty">{data?.job.status==='building'?'Building historical estimate…':'No leverage samples for this time range yet.'}</span>}<div className="leverage-readout">{hover?<><b className={hover.source==='Recorded'?'legend-recorded':'legend-estimated'}>{hover.source} {hover.point.value?.toFixed(3)??'—'}×</b><span>{hover.point.positionCount} positions</span><span>Exposure ${hover.point.notional?.toLocaleString('en-US',{maximumFractionDigits:0})??'—'}</span><span>Equity ${hover.point.equity?.toLocaleString('en-US',{maximumFractionDigits:0})??'—'}</span></>:<><span>{estimated} estimated points</span><span>{recorded} recorded samples in view</span><span>Gross exposure ÷ equity · USDC equivalent · UTC</span></>}</div></div></div><div className="recording-footnote"><span>{data?.job.progress??'Connecting recorder…'}</span>{rec?.lastError?<span className="amber">Capture error: {rec.lastError}</span>:data?.job.error?<span className="amber">Backfill error: {data.job.error}</span>:<span>Recording continues with the local service running, even when this page is closed.</span>}</div>{data&&(!frame?.complete||data.warnings.length>0)&&<details className="leverage-coverage"><summary>Leverage coverage & calculation</summary>{frame?.reasons.map(r=><p key={r}>{r}</p>)}{data.warnings.map(w=><p key={w}>{w}</p>)}<p>Recorded points use observed position notionals and equity across every discovered DEX. Polls are separate observations, not an atomic block snapshot. Estimates use all known positions, bounded fills, historical candle closes and interpolated equity. Missing coverage remains gaps. Spot inventory is not counted as perpetual exposure. Pauses and outages are not interpolated.</p></details>}</section>;
}
