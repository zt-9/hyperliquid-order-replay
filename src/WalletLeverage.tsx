import type {LeverageResponse} from '../shared/leverage';
const money=(value:number|null|undefined)=>value===null||value===undefined?'—':'$'+value.toLocaleString('en-US',{maximumFractionDigits:0});
export function WalletLeverage({data,onRecording,onSelect}:{data:LeverageResponse|null;onRecording:()=>void;onSelect:(coin:string)=>void}){
 const frame=data?.latest,rec=data?.recorder;
 const positions=frame?.dexAccounts.flatMap(d=>d.state.assetPositions.map(({position})=>({...position,dex:d.dex}))).filter(p=>Number(p.szi)!==0)??[];
 const delayed=rec?.enabled&&(!rec.lastSuccess||Date.now()-rec.lastSuccess>90000);
 return <section className="wallet-summary" aria-label="Wallet overview">
  <div className="wallet-summary-bar">
   <div className="wallet-total"><span>Perp equity</span><strong>{money(frame?.equity)}</strong></div>
   <div><span title="Total absolute perpetual exposure divided by wallet equity across all DEXs">Wallet exposure / equity</span><strong>{frame?.leverage!=null?frame.leverage.toFixed(2)+'×':'—'}</strong></div>
   <div><span>Open positions</span><strong>{frame?.positionCount??'—'}<small>across {frame?.dexAccounts.filter(d=>d.state.assetPositions.some(p=>Number(p.position.szi)!==0)).length??'—'} DEXs</small></strong></div>
   <div className="wallet-recording"><span className={rec?.enabled&&!delayed?'recording-state':'recording-state paused'}><i/>{delayed?'Recording delayed':rec?.enabled?'Recording · 30s':'Recording paused'}</span><div><small>{frame?new Date(frame.capturedAt).toISOString().slice(11,19)+' UTC':'Awaiting account state'}</small><button onClick={onRecording}>{rec?.enabled?'Pause':'Start'}</button></div></div>
  </div>
  {rec?.lastError&&<p className="summary-warning" role="alert">Account capture: {rec.lastError}</p>}
  <details className="positions-disclosure"><summary>All positions & leverage <span>{positions.length} markets</span></summary><div className="positions-scroll"><table><thead><tr><th>Market</th><th>Side</th><th>Reported leverage</th><th>Position value</th><th>Margin used</th><th>Unrealized PnL</th></tr></thead><tbody>{positions.map(p=><tr key={p.dex+':'+p.coin}><td><button onClick={()=>onSelect(p.coin)}>{p.coin}</button></td><td className={Number(p.szi)>0?'positive':'negative'}>{Number(p.szi)>0?'Long':'Short'}</td><td>{p.leverage&&Number.isFinite(p.leverage.value)&&p.leverage.value>0?<><b>{p.leverage.value}×</b> <small>{p.leverage.type==='cross'?'Cross':'Isolated'}</small></>:'Unavailable'}</td><td>{money(p.positionValue==null?null:Math.abs(Number(p.positionValue)))}</td><td>{money(p.marginUsed==null?null:Number(p.marginUsed))}</td><td className={Number(p.unrealizedPnl)>=0?'positive':'negative'}>{money(Number(p.unrealizedPnl))}</td></tr>)}</tbody></table></div><p>Latest recorded account state · Reported leverage is each position’s Cross/Isolated setting. Wallet exposure / equity is a separate calculated measure. Recording requires the local service to stay running.</p></details>
 </section>;
}
