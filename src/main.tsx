import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { eventsFrom, stateAt, type Snapshot, type ReplayEvent } from '../shared/replay';
import { EXAMPLE_WALLET, INTERVALS, candleIndexAt, exposureLeverage, type Candle, type Interval } from '../shared/market';
import { executionGroups, tradeBars, nextTradeBar } from '../shared/executions';
import type { LeverageResponse } from '../shared/leverage';
import { WalletLeverage } from './WalletLeverage';
import { MarketChart } from './MarketChart';
import type { OverlayOptions } from './OperationOverlay';
import './style.css';
const fmt=(n:number,precision=2)=>n.toLocaleString('en-US',{maximumFractionDigits:precision});
const usd=(n:number)=>`${n<0?'−':''}$${fmt(Math.abs(n))}`;
const price=(n:number)=>`$${fmt(n,n>=100?2:n>=1?4:n>=.01?6:8)}`;
const suggestedInterval=(span:number):Interval=>span<86400000?'1m':span<7*86400000?'15m':span<60*86400000?'1h':'4h';
const date=(seconds:number)=>new Date(seconds*1000).toISOString().replace('T',' ').slice(0,16);
async function request<T>(url:string,method='GET',signal?:AbortSignal):Promise<T>{const res=await fetch(url,{method,signal});const body=await res.json();if(!res.ok)throw new Error(body.error??'Request failed');return body as T;}
function App(){
  const [leverageData,setLeverageData]=useState<LeverageResponse|null>(null);
  const [leverageError,setLeverageError]=useState('');
  const [wallet,setWallet]=useState(EXAMPLE_WALLET);
  const [copyStatus,setCopyStatus]=useState('');
  const [snapshot,setSnapshot]=useState<Snapshot|null>(null);
  useEffect(()=>{setCopyStatus('');},[snapshot?.wallet]);
  async function copyAddress(){if(!snapshot)return;try{await navigator.clipboard.writeText(snapshot.wallet);setCopyStatus('Copied');}catch{setCopyStatus('Copy failed — select the address to copy');}}
  const [coin,setCoin]=useState('BTC');
  const [interval,setIntervalValue]=useState<Interval>('4h');
  const [candles,setCandles]=useState<Candle[]>([]);
  const [cursor,setCursor]=useState(0);
  const [replay,setReplay]=useState(false);
  const [playing,setPlaying]=useState(false);
  const [speed,setSpeed]=useState(1);
  const [replayMode,setReplayMode]=useState<'trades'|'candles'>('trades');
  const [busy,setBusy]=useState(false);
  const [chartBusy,setChartBusy]=useState(false);
  const [error,setError]=useState('');
  const [chartError,setChartError]=useState('');
  const [retry,setRetry]=useState(0);
  const [chartType,setChartType]=useState<'candles'|'line'>('candles');
  const [options,setOptions]=useState<OverlayOptions>({fills:true,orders:false,buys:true,sells:true,currentOnly:false});
  const [tab,setTab]=useState<'orders'|'events'>('events');
  const [selectedEvent,setSelectedEvent]=useState<ReplayEvent>();
  const [resetKey,setResetKey]=useState(0);
  const allEvents=useMemo(()=>snapshot?eventsFrom(snapshot):[],[snapshot]);
  const events=useMemo(()=>allEvents.filter(e=>e.coin===coin),[allEvents,coin]);
  const observedPositions=leverageData?.latest?.dexAccounts.flatMap(d=>d.state.assetPositions)??snapshot?.account?.assetPositions??[];
  const markets=[...new Set([...observedPositions.map(p=>p.position.coin),...allEvents.map(e=>e.coin),'BTC'])];
  async function loadWallet(sync=false,address=wallet){
    setBusy(true);setError('');setPlaying(false);setReplay(false);
    try{
      let next:Snapshot;
      if(sync)next=await request<Snapshot>(`/api/wallet/${address}/sync`,'POST');
      else{
        const response=await fetch(`/api/wallet/${address}`);
        if(response.status===404)next=await request<Snapshot>(`/api/wallet/${address}/sync`,'POST');
        else {const body=await response.json();if(!response.ok)throw new Error(body.error);next=body;}
      }
      setSnapshot(next);const normalized=eventsFrom(next);const available=[...new Set(normalized.map(e=>e.coin))];const counts=new Map<string,number>();for(const e of normalized)if(e.kind==='fill')counts.set(e.coin,(counts.get(e.coin)??0)+1);const selected=[...counts].sort((a,b)=>b[1]-a[1])[0]?.[0]??next.account?.assetPositions[0]?.position.coin??available[0]??'BTC';setCoin(selected);const first=normalized.find(e=>e.coin===selected)?.time;setIntervalValue(suggestedInterval(first?next.fetchedAt-first:30*86400000));setSelectedEvent(undefined);
    }catch(err){setError(err instanceof Error?err.message:'Could not load wallet');}
    finally{setBusy(false);}
  }
  useEffect(()=>{void loadWallet(false,EXAMPLE_WALLET);},[]);
  useEffect(()=>{
    if(!snapshot)return;let disposed=false;setLeverageData(null);setLeverageError('');
    const wallet=snapshot.wallet;
    async function refresh(){try{const response=await request<LeverageResponse>(`/api/wallet/${wallet}/leverage`);if(!disposed){setLeverageData(response);setLeverageError('');}return response;}catch(error){if(!disposed)setLeverageError(error instanceof Error?error.message:'Leverage data unavailable');}}
    void refresh().then(async response=>{
      if(disposed||!response)return;
      if(!response.recorder.enabled&&response.recorder.lastAttempt===null)await request(`/api/wallet/${wallet}/recording/start`,'POST');
      else if(response.recorder.enabled&&response.job.status==='idle')await request(`/api/wallet/${wallet}/leverage/rebuild`,'POST');
    }).catch(error=>{if(!disposed)setLeverageError(error.message);});
    const timer=window.setInterval(()=>void refresh(),5000);return()=>{disposed=true;clearInterval(timer);};
  },[snapshot?.wallet]);
  async function toggleRecording(){if(snapshot)try{await request(`/api/wallet/${snapshot.wallet}/recording/${leverageData?.recorder.enabled?'stop':'start'}`,'POST');setLeverageData(await request(`/api/wallet/${snapshot.wallet}/leverage`));}catch(error){setLeverageError(error instanceof Error?error.message:'Could not update recorder');}}
  useEffect(()=>{
    if(!snapshot)return;
    const controller=new AbortController();setChartBusy(true);setChartError('');setPlaying(false);setReplay(false);setCandles([]);
    const step=INTERVALS[interval];
    const end=snapshot.fetchedAt;
    // Candle retention is bounded independently of the available wallet history.
    const earliest=events[0]?.time??end-30*86400000;
    const start=Math.max(0,Math.min(earliest-step*1000*12,end-step*1000*240),end-step*1000*4800);
    const params=new URLSearchParams({coin,interval,start:String(Math.floor(start)),end:String(end)});
    request<{candles:Candle[]}>(`/api/candles?${params}`, 'GET',controller.signal).then(data=>{
      if(controller.signal.aborted)return;setCandles(data.candles);setCursor(Math.max(0,data.candles.length-1));
      if(!data.candles.length)setChartError('No candles available for this market and time range.');
    }).catch(err=>{if(!controller.signal.aborted)setChartError(err.message);}).finally(()=>{if(!controller.signal.aborted)setChartBusy(false);});
    return()=>controller.abort();
  },[snapshot,coin,interval,retry]);
  const groups=useMemo(()=>executionGroups(candles,events,INTERVALS[interval]),[candles,events,interval]);
  const bars=useMemo(()=>tradeBars(groups),[groups]);
  const replayStart=Math.max(0,(bars[0]??0)-1);
  useEffect(()=>{
    if(!playing)return;
    const timer=window.setInterval(()=>setCursor(value=>{const next=replayMode==='trades'?nextTradeBar(bars,value,1):value<candles.length-1?value+1:undefined;if(next===undefined){setPlaying(false);return value;}return next;}),1000/speed);
    return()=>window.clearInterval(timer);
  },[playing,speed,candles.length,bars,replayMode]);
  useEffect(()=>{
    function key(event:KeyboardEvent){if(event.target instanceof HTMLInputElement||event.target instanceof HTMLSelectElement||event.target instanceof HTMLTextAreaElement)return;
      if(event.code==='Space'){event.preventDefault();if(candles.length){if(!replay){setReplay(true);if(cursor>=candles.length-1||replayMode==='trades'&&nextTradeBar(bars,cursor,1)===undefined)setCursor(replayStart);}setPlaying(p=>!p);}}
      if(event.code==='ArrowRight'&&replay){event.preventDefault();setPlaying(false);setCursor(i=>replayMode==='trades'?nextTradeBar(bars,i,1)??i:Math.min(candles.length-1,i+1));}
      if(event.code==='ArrowLeft'&&replay){event.preventDefault();setPlaying(false);setCursor(i=>replayMode==='trades'?nextTradeBar(bars,i,-1)??i:Math.max(0,i-1));}
    }
    window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);
  },[replay,candles.length,cursor,replayStart,bars,replayMode]);
  const step=INTERVALS[interval];
  const cutoff=candles.length?Math.min(snapshot?.fetchedAt??Infinity,((candles[cursor+1]?.time??candles[cursor]?.time+step)*1000)-1):0;
  const index=events.findLastIndex(e=>e.time<=cutoff);
  const state=useMemo(()=>stateAt(events,index),[events,index]);
  const past=events.filter(e=>e.time<=cutoff);
  const fills=past.filter(e=>e.kind==='fill');
  const pnl=fills.reduce((sum,e)=>sum+Number(e.fill!.closedPnl),0);
  const marketEvents=events.filter(e=>candles.length&&e.time>=candles[0].time*1000&&e.time<(candles.at(-1)!.time+step)*1000);
  const renderedEvents=marketEvents.filter(e=>!replay||e.time<=cutoff);
  const revealedGroups=groups.filter(g=>!replay||g.index<=cursor);
  const focusGroups=replay?revealedGroups.filter(g=>g.index===cursor):revealedGroups.filter(g=>g.index===revealedGroups.at(-1)?.index);
  const buyCount=marketEvents.filter(e=>e.kind==='fill'&&e.side==='B').length;
  const sellCount=marketEvents.filter(e=>e.kind==='fill'&&e.side==='A').length;
  const current=observedPositions.find(p=>p.position.coin===coin)?.position;

  const equity=leverageData?.latest?.equity?.toString();
  const selectedExposure=exposureLeverage(current?.positionValue,equity);
  const configured=current?.leverage;
  const leverageText=configured&&Number.isFinite(configured.value)&&configured.value>0?`${configured.type==='cross'?'Cross':'Isolated'} ${fmt(configured.value)}×`:'Unavailable';
  const isSpot=coin.startsWith('@')||coin.includes('/');
  const toggle=(key:keyof OverlayOptions)=>setOptions(o=>({...o,[key]:!o[key]}));
  function selectMarket(market:string){setCoin(market);setSelectedEvent(undefined);const first=allEvents.find(e=>e.coin===market)?.time;setIntervalValue(suggestedInterval(first&&snapshot?snapshot.fetchedAt-first:30*86400000));}
  function startReplay(){if(!candles.length)return;setReplay(true);setPlaying(true);setTab('events');if(cursor>=candles.length-1||replayMode==='trades'&&nextTradeBar(bars,cursor,1)===undefined)setCursor(replayStart);}
  function latest(){setReplay(false);setPlaying(false);setCursor(Math.max(0,candles.length-1));setSelectedEvent(undefined);setResetKey(k=>k+1);}
  function seek(event:ReplayEvent){const at=candleIndexAt(candles,event.time/1000);if(at>=0){setCursor(at);setPlaying(false);setSelectedEvent(event);}}
  return <main className="terminal">
    <header className="topbar"><a href="/" className="brand"><span className="original-mark">H<span>↗</span></span><b className="original-wordmark">REPLAY</b></a><nav className="top-nav" aria-label="Workspace navigation"><a className="nav-active" href="#wallet-overview">Wallet explorer</a><a className="nav-history" href="#trade-history" onClick={()=>setTab('events')}>Trade history</a></nav><span className="local-badge"><i/> Local workspace</span></header>
    <section className="walletbar" id="wallet-overview" tabIndex={-1}><div className="wallet-title wallet-identity"><div><span className="wallet-identity-label">WALLET</span><div className="wallet-address-row"><h1>{snapshot?.wallet??'Load a wallet'}</h1><button type="button" className="copy-address" aria-label="Copy wallet address" disabled={!snapshot} onClick={()=>void copyAddress()}>{copyStatus==='Copied'?'Copied!':'Copy'}</button></div><span className="copy-feedback" role="status">{copyStatus!=='Copied'?copyStatus:''}</span></div></div><form onSubmit={e=>{e.preventDefault();void loadWallet(false);}}><input aria-label="Wallet address" value={wallet} onChange={e=>setWallet(e.target.value)} spellCheck={false}/><button disabled={busy||!/^0x[0-9a-fA-F]{40}$/.test(wallet)}>{busy?'Loading…':'Load wallet'}</button><button type="button" className="button-icon" title="Fetch latest wallet history" aria-label="Sync wallet" disabled={busy||!snapshot} onClick={()=>void loadWallet(true,snapshot!.wallet)}>↻</button></form></section>
    {error&&<div className="error-banner" role="alert">{error}</div>}
    {leverageError&&<div className="error-banner" role="alert">{leverageError}</div>}
    <WalletLeverage data={leverageData} onRecording={()=>void toggleRecording()} onSelect={selectMarket}/>
    <section className="market-shortcuts" aria-label="Wallet markets"><span>MARKET</span><select className="wallet-market-picker" aria-label="Wallet market" value={coin} onChange={e=>selectMarket(e.target.value)}>{markets.map(m=><option key={m} value={m}>{m}</option>)}</select>{markets.map(m=>{const position=observedPositions.find(p=>p.position.coin===m)?.position;return <button key={m} className={coin===m?'active':''} onClick={()=>selectMarket(m)}><b>{m}</b>{position?<small className={Number(position.szi)>=0?'positive':'negative'}>{Number(position.szi)>=0?'LONG':'SHORT'}{position.leverage&&position.leverage.value>0?` · ${fmt(position.leverage.value)}×`:' · —'}</small>:<small>HISTORY</small>}</button>;})}</section>
    <section className="selected-market-summary"><div className="market-summary-heading"><div><span className="selected-market-symbol">{coin}</span><span className="market-kind">PERPETUAL</span><span className="token-leverage" title="Current leverage setting reported by Hyperliquid">{leverageText}</span>{current&&<span className={Number(current.szi)>=0?'position-direction positive':'position-direction negative'}>{Number(current.szi)>=0?'LONG':'SHORT'}</span>}</div><span>Latest observed state · {leverageData?.latest?new Date(leverageData.latest.capturedAt).toISOString().slice(11,19):snapshot?new Date(snapshot.fetchedAt).toISOString().slice(11,19):'—'} UTC</span></div><div className="market-summary-values"><Metric label="Position" value={current?fmt(Math.abs(Number(current.szi)),5):'—'} detail={coin+' units'}/><Metric label="Entry price" value={current?price(Number(current.entryPx)):'—'} detail="Position average"/><Metric label="Unrealized PnL" value={current?usd(Number(current.unrealizedPnl)):'—'} detail="Latest snapshot" positive={current?Number(current.unrealizedPnl)>=0:undefined}/><Metric label="Margin used" value={current?.marginUsed?usd(Number(current.marginUsed)):'—'} detail={selectedExposure===null?'Exposure / wallet equity unavailable':`${fmt(selectedExposure,4)}× wallet equity`}/><Metric label="Liquidation price" value={current?.liquidationPx?price(Number(current.liquidationPx)):'—'} detail="Reported estimate"/></div></section>
    <section className="workspace">
      <div className="chart-column">
        <div className="chart-toolbar"><div className="chart-market-title"><b>{coin}</b><span>Price & executions</span></div><div className="intervals">{(Object.keys(INTERVALS) as Interval[]).map(item=><button key={item} className={item===interval?'active':''} onClick={()=>setIntervalValue(item)}>{item}</button>)}</div><div className="toolbar-spacer"/><select aria-label="Chart type" value={chartType} onChange={e=>setChartType(e.target.value as 'candles'|'line')}><option value="candles">Candles</option><option value="line">Line</option></select><button className={replay?'replay-button active':'replay-button'} disabled={!candles.length||chartBusy} onClick={startReplay}>◀◀ Replay</button><button onClick={latest} disabled={!candles.length}>⇥ Latest</button></div>
        <div className="overlay-toolbar"><span className="toolbar-label">OVERLAYS</span>{(['fills','orders'] as const).map(key=><label key={key}><input type="checkbox" checked={options[key]} onChange={()=>toggle(key)}/>{key==='fills'?'Executions':'Order lifetimes'}</label>)}<span className="execution-counts"><b className="positive">{buyCount} buys</b><b className="negative">{sellCount} sells</b></span><span className="divider"/>{(['buys','sells'] as const).map(key=><label className={key==='buys'?'positive':'negative'} key={key}><input type="checkbox" checked={options[key]} onChange={()=>toggle(key)}/>{key==='buys'?'Buy':'Sell'}</label>)}<label><input type="checkbox" checked={options.currentOnly} onChange={()=>toggle('currentOnly')}/>Open orders only</label><span className="marker-hint">B Buy · S Sell · Hover for details</span><span className="legend-info" title="B = buy, S = sell. Nearby fills are grouped as you zoom out. Hover or click a badge for quantity, average price, and fill count. Order lifetimes are optional estimates.">ⓘ Legend</span></div>
        <div className="trade-focus" aria-live="polite"><div className="trade-focus-title">{replay?'TRADES AT REPLAY CURSOR':'LATEST EXECUTED TRADES'}<small>{replay?'One step per candle containing executions':'Actual fills · grouped by candle and side'}</small></div>{focusGroups.length?focusGroups.map(g=><button key={`${g.index}:${g.side}`} className={`trade-card ${g.side==='B'?'trade-buy':'trade-sell'}`} onClick={()=>{seek(g.events.at(-1)!);setTab('events');}}><b>{g.side==='B'?'▲ BUY':'▼ SELL'} {fmt(g.size,5)} {coin}</b><span>Avg {price(g.price)} · {g.count} fill{g.count===1?'':'s'}</span><small>{date(candles[g.index].time)} UTC</small></button>):<span className="no-execution">{replay?'No executions in this candle. The next trade step jumps to the next execution.':'No executions for this market in the fetched history.'}</span>}</div>
        <div className="chart-container"><MarketChart coin={coin} barSeconds={step} candles={candles} events={events} cursor={cursor} replay={replay} options={options} chartType={chartType} resetKey={`${resetKey}:${coin}:${interval}`} onSelect={i=>{setCursor(i);setPlaying(false);setSelectedEvent(undefined);}}/>{(chartBusy||busy)&&<div className="chart-loading"><span className="spinner"/>Loading {busy?'wallet history':'market candles'}…</div>}{chartError&&<div className="chart-loading"><p>{chartError}</p><button onClick={()=>setRetry(r=>r+1)}>Retry candles</button></div>}</div>
        <div className={`replay-strip ${replay?'is-replay':''}`}><span className="mode-pill">{replay?'REPLAY':'HISTORICAL VIEW'}</span>{replay?<><button aria-label="Previous trade or candle" onClick={()=>{setPlaying(false);setCursor(i=>replayMode==='trades'?nextTradeBar(bars,i,-1)??i:Math.max(0,i-1));}}>◁</button><button className="play-button" onClick={()=>{if(cursor===candles.length-1||replayMode==='trades'&&nextTradeBar(bars,cursor,1)===undefined)setCursor(replayStart);setPlaying(p=>!p);}}>{playing?'Ⅱ Pause':'▶ Play'}</button><button aria-label="Next trade or candle" onClick={()=>{setPlaying(false);setCursor(i=>replayMode==='trades'?nextTradeBar(bars,i,1)??i:Math.min(candles.length-1,i+1));}}>▷</button><select aria-label="Replay mode" value={replayMode} onChange={e=>{setPlaying(false);setReplayMode(e.target.value as 'trades'|'candles');}}><option value="trades">Trade replay</option><option value="candles">Candle replay</option></select><select aria-label="Playback speed" value={speed} onChange={e=>setSpeed(Number(e.target.value))}>{[1,4,12,30].map(s=><option key={s} value={s}>{s} steps/s</option>)}</select><input aria-label="Replay timeline" type="range" min={0} max={Math.max(0,candles.length-1)} value={Math.min(cursor,Math.max(0,candles.length-1))} onChange={e=>{setPlaying(false);setCursor(Number(e.target.value));}}/><button onClick={latest}>Exit replay</button></>:<span className="replay-hint">Scroll to zoom · drag to pan · click a candle to inspect · Replay to follow executed trades</span>}<time>{candles[cursor]?`${date(candles[cursor].time)} UTC`:'—'}</time></div>
        <div className="coverage-strip"><span className="status-dot"/><span>{candles.length?`${candles.length.toLocaleString()} candles · ${date(candles[0].time).slice(0,10)} — ${date(candles.at(-1)!.time).slice(0,10)}`:'Waiting for market data'}</span><span>{marketEvents.filter(e=>e.kind==='fill').length} fills in chart window</span>{events.length>marketEvents.length&&<span className="amber">{events.length-marketEvents.length} operations outside candle coverage</span>}<a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">Charts by TradingView</a></div>
      </div>
      <aside className="inspector"><div className="inspector-heading"><h2>State at selected time</h2><span className={replay?'replay-dot':'pinned-dot'}>{replay?'REPLAY':'PINNED'}</span></div><div className="selected-date">{candles[cursor]?date(candles[cursor].time):'—'} <small>UTC · {candles[cursor]&&snapshot&&(candles[cursor].time+step)*1000>snapshot.fetchedAt?'forming candle':'candle close'}</small></div><dl><dt>{coin} close</dt><dd>{candles[cursor]?price(candles[cursor].close):'—'}</dd><dt>Observed position</dt><dd className={state.position!==null&&state.position<0?'negative':'positive'}>{state.position===null||isSpot?'Unknown':`${fmt(state.position,5)} ${coin}`}</dd><dt>Position notional</dt><dd>{state.position!==null&&!isSpot&&candles[cursor]?usd(Math.abs(state.position*candles[cursor].close)):'—'}</dd><dt>Observed closed PnL</dt><dd className={pnl>=0?'positive':'negative'}>{fills.length?usd(pnl):'—'}</dd><dt title="Wallet-wide effective leverage at or before this cursor; recorded samples take priority over estimates.">Wallet effective leverage</dt><dd>{(()=>{const recorded=leverageData?.recorded.findLast(p=>p.time<=cutoff);const estimated=leverageData?.estimated.findLast(p=>p.time<=cutoff);const p=recorded&&cutoff-recorded.time<=90000?recorded:estimated&&cutoff-estimated.time<=300000?estimated:null;return p?.value!==null&&p?.value!==undefined?`${fmt(p.value)}× ${p===recorded?'recorded':'est.'}`:'—';})()}</dd><dt>Observed executions</dt><dd>{fills.length}</dd><dt>Open orders at cursor</dt><dd>{state.orders.length}</dd></dl><p className="inspector-note">{events.some(e=>e.kind==='fill')?'':`No ${coin} fills were returned in the bounded wallet history. `}Historical position is reconstructed from fills. The token’s reported leverage above is the latest recorded setting, not a historical value at this cursor.</p>{!isSpot&&state.discontinuities>0&&<p className="gap-warning">{state.discontinuities} position gaps detected in the available fills.</p>}
        <div className="side-tabs" id="trade-history" tabIndex={-1} aria-label="Trade history"><button className={tab==='orders'?'active':''} onClick={()=>setTab('orders')}>Open orders <small>{state.orders.length}</small></button><button className={tab==='events'?'active':''} onClick={()=>setTab('events')}>Activity <small>{renderedEvents.length}</small></button></div>
        <div className="side-list">{tab==='orders'?<><div className="list-head"><span>Side / size</span><span>Limit price</span></div>{state.orders.length?state.orders.sort((a,b)=>Number(b.event.price)-Number(a.event.price)).map(({event,remaining})=><button className="order-item" key={event.id} onClick={()=>{setSelectedEvent(event);}}><div><b className={event.side==='B'?'positive':'negative'}>{event.side==='B'?'Buy':'Sell'}</b><span>{fmt(remaining,5)} {coin}</span></div><div><strong>{price(Number(event.price))}</strong><small>Estimated lifetime</small></div></button>):<p className="empty-note">No open orders reconstructed at this time.</p>}</>:<>{renderedEvents.length?renderedEvents.slice().reverse().slice(0,100).map(event=><button className="order-item event-item" key={event.id} onClick={()=>seek(event)}><div><b className={event.side==='B'?'positive':'negative'}>{event.side==='B'?'Buy':'Sell'} · {event.status??event.kind}</b><span>{date(event.time/1000)}</span></div><div><strong>{price(Number(event.price))}</strong><small>{event.size} {coin}</small></div></button>):<p className="empty-note">No activity within the current candle window.</p>}<p className="empty-note">Latest 100 activity records in this window.</p></>}</div>
        {selectedEvent&&<div className="event-detail"><button className="close-detail" aria-label="Close event detail" onClick={()=>setSelectedEvent(undefined)}>×</button><span className="toolbar-label">ORDER #{selectedEvent.oid}</span><h3>{selectedEvent.status??selectedEvent.kind} · {selectedEvent.side==='B'?'Buy':'Sell'}</h3><p>{selectedEvent.size} {coin} @ {price(Number(selectedEvent.price))}</p><p>{selectedEvent.evidence==='reported'?'API record: execution or status returned directly by Hyperliquid.':'Estimated placement: timestamp and latest fields, not a complete edit history.'}</p></div>}
      </aside>
    </section>
    <details className="data-notes"><summary><span>ⓘ Data coverage & reconstruction</span><span>Public API · limited history</span></summary><div><p><b>B/S badges</b> summarize actual fills. Nearby same-side executions are grouped based on chart zoom; hover or click to inspect quantity, average price, and fill count. <b>Dashed order lines</b> estimate lifetimes using the order timestamp, latest price/size, and final status. Order modifications are not available. Historical records marked open but absent from current open orders are excluded because their end time is unknown.</p>{snapshot?.warnings.map(w=><p key={w}>{w}</p>)}<p>At candle close, position and closed PnL use only fills observed up to that point. Closed PnL excludes fees, funding, transfers and unrealized PnL. Account and leverage metrics at the top are current snapshots. The leverage setting (cross/isolated) is reported by Hyperliquid. Gross account leverage is total perpetual notional divided by account equity; selected-market exposure uses that position’s notional over the same equity. These are exposure measures, not liquidation-risk ratios. Account snapshots are recorded in the background across every discovered DEX. The current reported leverage appears on each market tab and in the positions table. Historical configured leverage settings remain unavailable before recording began. Candles are limited to the most recent 5,000 bars per interval. No market data is synthesized.</p></div></details>
    <footer><span><i className="status-dot"/> Read-only · no wallet connection required</span><span>Hyperliquid public data / stored locally</span><span className="workspace-path">Wallet → Market → Replay</span></footer>
  </main>;
}
function Metric({label,value,detail,positive}:{label:string;value:string;detail:string;positive?:boolean}){return <div className="metric"><span>{label}</span><strong className={positive===undefined?'':positive?'positive':'negative'}>{value}</strong><small>{detail}</small></div>;}
createRoot(document.getElementById('root')!).render(<App/>);
