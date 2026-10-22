import type { DatabaseSync } from 'node:sqlite';
import { EXAMPLE_WALLET } from '../shared/market.js';
import type { AccountFrame, LeveragePoint, RecorderStatus } from '../shared/leverage.js';
import { AccountProvider } from './account-provider.js';
export const RECORD_INTERVAL=30000;
export class AccountRecorder {
  private pending=new Map<string,Promise<AccountFrame>>();
  private timer?:ReturnType<typeof setInterval>;
  constructor(readonly db:DatabaseSync,readonly accounts:AccountProvider){
    db.exec(`CREATE TABLE IF NOT EXISTS watched_wallets(wallet TEXT PRIMARY KEY,enabled INTEGER NOT NULL DEFAULT 1,last_attempt INTEGER,last_success INTEGER,last_error TEXT);
      CREATE TABLE IF NOT EXISTS account_frames(id INTEGER PRIMARY KEY,wallet TEXT NOT NULL,captured_at INTEGER NOT NULL,payload TEXT,error TEXT);
      CREATE INDEX IF NOT EXISTS account_frame_time ON account_frames(wallet,captured_at);`);
    const columns=new Set(db.prepare('PRAGMA table_info(account_frames)').all().map(c=>String(c.name)));
    for(const [name,type] of [['leverage','REAL'],['equity','REAL'],['notional','REAL'],['position_count','INTEGER']])if(!columns.has(name))db.exec(`ALTER TABLE account_frames ADD COLUMN ${name} ${type}`);
    db.exec("UPDATE account_frames SET leverage=json_extract(payload,'$.leverage'),equity=json_extract(payload,'$.equity'),notional=json_extract(payload,'$.notional'),position_count=json_extract(payload,'$.positionCount') WHERE payload IS NOT NULL AND position_count IS NULL");
  }
  register(wallet:string){
    const active=Number(this.db.prepare('SELECT count(*) AS n FROM watched_wallets WHERE enabled=1').get()!.n);
    const existing=this.db.prepare('SELECT enabled FROM watched_wallets WHERE wallet=?').get(wallet);
    if(existing?.enabled!==1&&active>=5)throw new Error('Local recorder supports up to five watched wallets');
    this.db.prepare('INSERT INTO watched_wallets(wallet,enabled) VALUES(?,1) ON CONFLICT(wallet) DO UPDATE SET enabled=1').run(wallet);
  }
  start(){
    if(!this.db.prepare('SELECT wallet FROM watched_wallets LIMIT 1').get())this.register(EXAMPLE_WALLET);
    const tick=()=>{const rows=this.db.prepare('SELECT wallet FROM watched_wallets WHERE enabled=1 AND (last_attempt IS NULL OR last_attempt < ?)').all(Date.now()-RECORD_INTERVAL);
      for(const row of rows)void this.capture(String(row.wallet)).catch(()=>undefined);};
    tick();this.timer=setInterval(tick,5000);this.timer.unref();
  }
  stop(){if(this.timer)clearInterval(this.timer);}
  capture(wallet:string):Promise<AccountFrame>{
    const existing=this.pending.get(wallet);if(existing)return existing;
    const run=(async()=>{
      this.db.prepare('UPDATE watched_wallets SET last_attempt=? WHERE wallet=?').run(Date.now(),wallet);
      try{
        const frame=await this.accounts.capture(wallet);
        this.db.prepare('INSERT INTO account_frames(wallet,captured_at,payload,error,leverage,equity,notional,position_count) VALUES(?,?,?,?,?,?,?,?)').run(wallet,frame.capturedAt,JSON.stringify(frame),frame.complete?null:frame.reasons.join('; '),frame.leverage,frame.equity,frame.notional,frame.positionCount);
        this.db.prepare('UPDATE watched_wallets SET last_success=COALESCE(?,last_success),last_error=? WHERE wallet=?').run(frame.complete?frame.capturedAt:null,frame.complete?null:frame.reasons.join('; '),wallet);
        return frame;
      }catch(error){
        const message=error instanceof Error?error.message:'Account capture failed';
        this.db.prepare('INSERT INTO account_frames(wallet,captured_at,error) VALUES(?,?,?)').run(wallet,Date.now(),message);
        this.db.prepare('UPDATE watched_wallets SET last_error=? WHERE wallet=?').run(message,wallet);throw error;
      }
    })();
    this.pending.set(wallet,run);void run.finally(()=>this.pending.delete(wallet)).catch(()=>undefined);return run;
  }
  latest(wallet:string):AccountFrame|null{
    const row=this.db.prepare('SELECT payload FROM account_frames WHERE wallet=? AND payload IS NOT NULL ORDER BY captured_at DESC,id DESC LIMIT 1').get(wallet);
    return row?JSON.parse(String(row.payload)):null;
  }
  status(wallet:string):RecorderStatus{
    const row=this.db.prepare('SELECT * FROM watched_wallets WHERE wallet=?').get(wallet);
    const samples=Number(this.db.prepare('SELECT count(*) AS n FROM account_frames WHERE wallet=? AND payload IS NOT NULL AND error IS NULL').get(wallet)!.n);
    return {enabled:row?.enabled===1,intervalMs:RECORD_INTERVAL,lastAttempt:row?.last_attempt as number??null,lastSuccess:row?.last_success as number??null,lastError:row?.last_error as string??null,samples};
  }
  points(wallet:string):LeveragePoint[]{
    const rows=this.db.prepare('SELECT captured_at,leverage,equity,notional,position_count,error FROM account_frames WHERE wallet=? AND captured_at>=? ORDER BY captured_at,id').all(wallet,Date.now()-30*86400000);
    const points:LeveragePoint[]=[];
    for(const row of rows){
      const time=Number(row.captured_at);const previous=points.at(-1);
      if(previous&&time-previous.time>RECORD_INTERVAL*3)points.push({time:previous.time+RECORD_INTERVAL,value:null,equity:null,notional:null,positionCount:0,reason:'Recorder offline or delayed; no interpolation across this gap'});
      points.push({time,value:row.leverage===null?null:Number(row.leverage),equity:row.equity===null?null:Number(row.equity),notional:row.notional===null?null:Number(row.notional),positionCount:Number(row.position_count??0),...row.error?{reason:String(row.error)}:{}});
    }
    return points;
  }
}
