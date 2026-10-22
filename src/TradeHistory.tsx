import {useMemo,useState} from 'react';
import {eventsFrom,type Snapshot} from '../shared/replay';
const number=(value:string,digits=6)=>Number(value).toLocaleString('en-US',{maximumFractionDigits:digits});
const timestamp=(time:number)=>new Date(time).toISOString().replace('T',' ').slice(0,23);
const PAGE_SIZE=50;
export function TradeHistory({snapshot,busy}:{snapshot:Snapshot|null;busy:boolean}){
 const [token,setToken]=useState(''),[page,setPage]=useState(0);
 const trades=useMemo(()=>snapshot?eventsFrom(snapshot).filter(e=>e.kind==='fill').reverse().map(e=>e.fill!):[],[snapshot]);
 const tokens=useMemo(()=>[...new Set(trades.map(f=>f.coin))].sort(),[trades]);
 const filtered=token?trades.filter(f=>f.coin===token):trades;
 const pages=Math.max(1,Math.ceil(filtered.length/PAGE_SIZE));
 const currentPage=Math.min(page,pages-1),start=currentPage*PAGE_SIZE;
 return <section className="trade-history-panel">
  <div className="history-heading"><div><h2>Trade history</h2><p>Executed trades across the wallet · newest first</p></div><label>Token<select aria-label="Trade history token" value={token} onChange={e=>{setToken(e.target.value);setPage(0);}}><option value="">All tokens ({tokens.length})</option>{tokens.map(t=><option key={t} value={t}>{t}</option>)}</select></label></div>
  <div className="history-coverage"><strong>{filtered.length.toLocaleString()} trades{token?' · '+token:''}</strong><span>{trades.length?`${timestamp(trades.at(-1)!.time).slice(0,19)} — ${timestamp(trades[0].time).slice(0,19)} UTC`:'No trades loaded'}</span><span>Available snapshot · up to 2,000 recent fills · not the wallet’s complete lifetime history</span></div>
  <div className="history-table-scroll"><table aria-label="Wallet executed trades"><thead><tr><th scope="col">Time (UTC)</th><th scope="col">Token</th><th scope="col">Side</th><th scope="col">Price</th><th scope="col">Size</th><th scope="col">Closed PnL</th><th scope="col">Fee</th></tr></thead><tbody>{filtered.slice(start,start+PAGE_SIZE).map(f=><tr key={f.coin+':'+f.tid}><td><time dateTime={new Date(f.time).toISOString()}>{timestamp(f.time)}</time></td><th scope="row">{f.coin}</th><td><span className={f.side==='B'?'history-side positive':'history-side negative'}>{f.side==='B'?'Buy':'Sell'}</span></td><td>{number(f.px,8)}</td><td>{number(f.sz,8)}</td><td className={Number(f.closedPnl)>0?'positive':Number(f.closedPnl)<0?'negative':''}>{number(f.closedPnl,4)}</td><td>{number(f.fee,6)} <small>{f.feeToken??''}</small></td></tr>)}</tbody></table>{!filtered.length&&<p className="history-empty">{busy?'Loading wallet trades…':!snapshot?'Load a wallet to see its executed trades.':'No executed trades available for this token in the saved snapshot.'}</p>}</div>
  <div className="history-pagination"><span>{filtered.length?`${start+1}–${Math.min(start+PAGE_SIZE,filtered.length)} of ${filtered.length.toLocaleString()}`:'0 trades'}</span><div><button aria-label="Previous trades page" disabled={currentPage===0} onClick={()=>setPage(currentPage-1)}>Previous</button><span>Page {currentPage+1} of {pages}</span><button aria-label="Next trades page" disabled={currentPage>=pages-1} onClick={()=>setPage(currentPage+1)}>Next</button></div></div>
  <p className="history-note">Only actual fills are listed. Unfilled orders and cancellations remain in Wallet explorer. Closed PnL excludes fees and funding; values use the market’s settlement currency. The token filter applies to all saved wallet fills, independently of the chart’s selected market or replay cursor.</p>
 </section>;
}
