import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { eventsFrom, stateAt, type Snapshot, type ReplayEvent } from '../shared/replay';
import './style.css';
const number = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 5 });
const clock = (time: number) => new Date(time).toLocaleTimeString([], { hour12: false });
function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [wallet, setWallet] = useState('');
  const [coin, setCoin] = useState('BTC');
  const [index, setIndex] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function load(url: string, method = 'GET') {
    setBusy(true); setError(''); setPlaying(false);
    try {
      const response = await fetch(url, { method });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Request failed');
      const snapshot = data as Snapshot;
      setSnapshot(snapshot);
      setCoin(eventsFrom(snapshot)[0]?.coin ?? 'BTC'); setIndex(-1);
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not load history'); }
    finally { setBusy(false); }
  }
  useEffect(() => { void load('/api/demo'); }, []);
  const allEvents = useMemo(() => snapshot ? eventsFrom(snapshot) : [], [snapshot]);
  const markets = [...new Set(allEvents.map(event => event.coin))];
  const events = useMemo(() => allEvents.filter(event => event.coin === coin), [allEvents, coin]);
  const state = useMemo(() => stateAt(events, index), [events, index]);
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => setIndex(value => {
      if (value >= events.length - 1) { setPlaying(false); return value; }
      return value + 1;
    }), 1000 / speed);
    return () => clearInterval(timer);
  }, [playing, speed, events.length]);
  const selected = events[index];
  const fills = events.slice(0, index + 1).filter(e => e.fill);
  const pnl = fills.reduce((sum, event) => sum + Number(event.fill!.closedPnl), 0);
  const feeTotals = new Map<string, number>();
  for (const event of fills) { const token = event.fill!.feeToken ?? (snapshot?.wallet === "demo" ? "USDC" : "unknown token"); feeTotals.set(token, (feeTotals.get(token) ?? 0) + Number(event.fill!.fee)); }
  const fees = [...feeTotals].map(([token, amount]) => `${number(amount)} ${token}`).join(", ") || "No observed fees";
  const isSpot = coin.startsWith("@") || coin.includes("/");
  const valid = /^0x[0-9a-fA-F]{40}$/.test(wallet.trim());
  return <main>
    <header><a className="brand" href="/">H<span>↗</span> <b>REPLAY</b></a><span className="tag">HYPERLIQUID / WALLET EXPLORER</span><span className="local"><i/> LOCAL WORKSPACE</span></header>
    <section className="intro"><div><div className="eyebrow">EVERY ORDER TELLS A STORY</div><h1>See the trade unfold<span>.</span></h1><p>Walk through a wallet’s orders, executions, and position changes.</p></div><button disabled={busy} className="quiet" onClick={() => void load('/api/demo')}>Explore demo ↗</button></section>
    <form className="search" onSubmit={e => {e.preventDefault(); if(valid) void load(`/api/wallet/${wallet.trim()}/sync`, 'POST');}}><span>⌕</span><input aria-label="Wallet address" placeholder="Enter a wallet address · 0x…" value={wallet} onChange={e => setWallet(e.target.value)}/><button type="button" className="quiet" disabled={!valid || busy} onClick={() => void load(`/api/wallet/${wallet.trim()}`)}>Load saved</button><button disabled={!valid || busy}>{busy ? 'Loading…' : 'Sync wallet →'}</button></form>
    {error && <p role="alert" className="error">{error}</p>}
    <div className="workspace-title"><div><span className="tag">{snapshot?.wallet === 'demo' ? 'SYNTHETIC DEMO' : 'SAVED WALLET SNAPSHOT'}</span><h2>{snapshot?.wallet === 'demo' ? 'A trade, from entry to exit' : snapshot?.wallet ? `${snapshot.wallet.slice(0, 10)}…${snapshot.wallet.slice(-6)}` : 'Loading workspace'}</h2></div><label className="market">Market <select value={coin} onChange={e => {setCoin(e.target.value);setIndex(-1);setPlaying(false);}}>{markets.length ? markets.map(m => <option key={m}>{m}</option>) : <option>BTC</option>}</select></label></div>
    <section className="metrics"><Metric label="POSITION AT CURSOR" value={state.position === null || isSpot ? 'Unknown' : `${number(state.position)} ${coin}`} detail="Anchored to observed fills"/><Metric label="OBSERVED CLOSED PNL" value={`$${number(pnl)}`} detail="Before fees · excludes funding"/><Metric label="FILLS / FEES AT CURSOR" value={`${fills.length} fills`} detail={fees}/><Metric label="REPLAY COVERAGE" value={`${events.length} events`} detail={snapshot ? `Snapshot ${new Date(snapshot.fetchedAt).toLocaleString()}` : 'Loading'}/></section>
    <section className="replay-layout"><div className="panel chart-panel"><div className="panel-heading"><h3>{coin} <span>/ Order & execution map</span></h3><div className="legend"><span className="buy">● Buy</span><span className="sell">● Sell</span><span>◇ Inferred</span></div></div><Chart events={events} index={index}/><div className="transport"><button aria-label="Restart replay" className="quiet" onClick={() => {setIndex(-1);setPlaying(false);}}>↺</button><button disabled={!events.length} onClick={() => {if(index === events.length - 1) setIndex(-1);setPlaying(!playing);}}>{playing ? 'Ⅱ Pause' : '▶ Play'}</button><button className="quiet" aria-label="Next event" disabled={index >= events.length - 1} onClick={() => {setPlaying(false);setIndex(index + 1);}}>Step →</button><label><select aria-label="Playback speed" value={speed} onChange={e => setSpeed(Number(e.target.value))}><option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option></select></label><span className="cursor-time">{selected ? clock(selected.time) : 'Before first event'}</span></div><input className="scrubber" aria-label="Replay timeline" type="range" min={-1} max={Math.max(-1, events.length - 1)} value={index} onChange={e => {setPlaying(false);setIndex(Number(e.target.value));}}/><div className="timeline-labels"><span>{events[0] ? clock(events[0].time) : 'No events'}</span><span>EVENT {index + 1} OF {events.length} · EVENT-STEP PLAYBACK</span><span>{events.at(-1) ? clock(events.at(-1)!.time) : '—'}</span></div></div>
    <aside className="panel"><div className="panel-heading"><h3>At this moment</h3><span className="tag">{selected?.evidence ?? 'READY'}</span></div><div className="moment"><span className="eyebrow">SELECTED EVENT</span><h2>{selected ? selected.kind === 'status' ? selected.status : selected.kind === 'fill' ? 'Trade executed' : 'Order placed*' : 'Ready to replay'}</h2><p>{selected ? `${selected.side === 'B' ? 'Buy' : 'Sell'} ${selected.size} ${coin} @ $${number(Number(selected.price))}` : 'Press play or select an event to explore the sequence.'}</p>{selected && <code>ORDER #{selected.oid}</code>}</div><div className="order-list"><h4>Estimated resting orders <span>{state.orders.length}</span></h4>{state.orders.map(({event,remaining}) => <div className="order-row" key={event.id}><b className={event.side === 'B' ? 'buy' : 'sell'}>{event.side === 'B' ? 'BUY' : 'SELL'}</b><span>{number(remaining)} {coin}</span><span>${number(Number(event.price))}</span></div>)}{!state.orders.length && <p className="muted">No resting orders in the observed sequence.</p>}<p className="footnote">* Inferred from current order fields. Edits and missing events can change these estimates.</p></div></aside></section>
    <section className="panel events"><div className="panel-heading"><h3>Event sequence <span>/ {coin}</span></h3><span className="tag">CLICK AN EVENT TO SEEK</span></div><div className="table-scroll"><table><thead><tr><th>Time</th><th>Event</th><th>Side</th><th>Price</th><th>Size</th><th>Order</th><th>Evidence</th></tr></thead><tbody>{events.map((event, i) => <tr key={event.id} className={`${i === index ? 'selected' : ''} ${i > index ? 'future' : ''}`}><td><button className="seek" onClick={() => {setIndex(i);setPlaying(false);}}>{clock(event.time)} ↗</button></td><td>{event.status ?? event.kind}</td><td className={event.side === 'B' ? 'buy' : 'sell'}>{event.side === 'B' ? 'BUY' : 'SELL'}</td><td>${number(Number(event.price))}</td><td>{event.size}</td><td>#{event.oid}</td><td><span className={`evidence ${event.evidence}`}>{event.evidence}</span></td></tr>)}</tbody></table>{!events.length && <p className="empty">No events were returned for this wallet.</p>}</div></section>
    <details className="coverage" open><summary>◈ History & confidence · bounded replay</summary>{snapshot?.warnings.map(w => <p key={w}>{w}</p>)}{state.discontinuities > 0 && <p className="error">{state.discontinuities} position discontinuities detected. Fills may be missing or other balance changes may have occurred.</p>}<p>Scope: default perpetual DEX and spot identifiers. Additional perpetual DEX discovery and spot balance reconstruction are not implemented. The chart shows wallet event prices, not market candles. Position estimates are meaningful for perpetual fills.</p></details>
    <footer><span>H / REPLAY</span><span>Public data. Local history. A closer look.</span><span>READ-ONLY · v0.1</span></footer>
  </main>;
}
function Metric({label,value,detail}:{label:string;value:string;detail:string}) {return <div className="metric"><span className="eyebrow">{label}</span><strong>{value}</strong><small>{detail}</small></div>;}
function Chart({events,index}:{events:ReplayEvent[];index:number}) {
  if(!events.length) return <div className="empty chart-empty">Sync a wallet or explore the demo to see its order sequence.</div>;
  const width=900,height=310,left=70,right=25,top=25,bottom=35;
  const prices=events.map(e=>Number(e.price));const min=Math.min(...prices),max=Math.max(...prices);const pad=Math.max((max-min)*.18,max*.0001,1);
  const lo=min-pad,hi=max+pad;const start=events[0].time,end=events.at(-1)!.time;
  const x=(t:number)=>left+(t-start)/Math.max(1,end-start)*(width-left-right);
  const y=(p:number)=>top+(hi-p)/(hi-lo)*(height-top-bottom);
  const visible=events.slice(0,index+1);const fills=visible.filter(e=>e.kind==='fill');
  return <svg className="chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Order and fill prices over time; diamonds show inferred placements and circles show executions">
    {[0,1,2,3,4].map(i=>{const p=lo+(hi-lo)*i/4;return <g key={i}><line x1={left} x2={width-right} y1={y(p)} y2={y(p)} stroke="#26332f" strokeDasharray="3 5"/><text x={left-12} y={y(p)+4} textAnchor="end" fill="#8eaaa0" fontSize="11">{Math.round(p).toLocaleString()}</text></g>;})}
    <polyline points={fills.map(e=>`${x(e.time)},${y(Number(e.price))}`).join(' ')} fill="none" stroke="#b4c7bf" strokeWidth="1.5"/>
    {visible.filter(e=>e.kind==='placement').map(e=>{const closing=visible.find(v=>v.oid===e.oid&&v.kind==='status');return <line key={`line${e.id}`} x1={x(e.time)} x2={x(closing?.time??events[Math.max(0,index)].time)} y1={y(Number(e.price))} y2={y(Number(e.price))} stroke={e.side==='B'?'#76e4b8':'#ee968c'} opacity=".45" strokeDasharray="5 5"/>;})}
    {visible.map(e=><g key={e.id}><title>{e.kind} · {e.size} @ {e.price} · {e.evidence}</title>{e.kind==='fill'?<circle cx={x(e.time)} cy={y(Number(e.price))} r="6" fill={e.side==='B'?'#76e4b8':'#ee968c'}/>:e.kind==='placement'?<path d={`M ${x(e.time)} ${y(Number(e.price))-6} l 6 6 l -6 6 l -6 -6 Z`} fill="#101816" stroke={e.side==='B'?'#76e4b8':'#ee968c'}/>:<text x={x(e.time)} y={y(Number(e.price))+4} textAnchor="middle" fill="#b2c0ba" fontSize="17">×</text>}</g>)}
    {index>=0&&<line x1={x(events[index].time)} x2={x(events[index].time)} y1={top} y2={height-bottom} stroke="#d3f6e5" opacity=".5"/>}
    <text x={left} y={height-8} fill="#8eaaa0" fontSize="11">{clock(start)}</text><text x={width-right} y={height-8} textAnchor="end" fill="#8eaaa0" fontSize="11">{clock(end)}</text>
  </svg>;
}
createRoot(document.getElementById('root')!).render(<App/>);
