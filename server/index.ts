import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { PublicApiProvider, validWallet } from './provider.js';
import { INTERVALS, type Interval } from '../shared/market.js';
import { demoSnapshot } from './demo.js';
mkdirSync('data', { recursive: true });
const db = new DatabaseSync('data/replay.sqlite');
db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS snapshots (id INTEGER PRIMARY KEY, wallet TEXT NOT NULL, fetched_at INTEGER NOT NULL, payload TEXT NOT NULL); CREATE INDEX IF NOT EXISTS wallet_time ON snapshots(wallet, fetched_at DESC);');
const app = express();
app.disable('x-powered-by');
const provider = new PublicApiProvider();
let syncing = false;
let nextSync = 0;
app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.get('/api/demo', (_req, res) => res.json(demoSnapshot()));
// Cache candle windows independently from wallet snapshots. Bounded local cache
// keeps interval changes from repeatedly hitting the public API.
const candleCache = new Map<string, { at: number; payload: unknown }>();
let candleQueue: Promise<unknown> = Promise.resolve();
const candleInFlight = new Map<string, Promise<unknown>>();
app.get('/api/candles', async (req, res) => {
  const coin = String(req.query.coin ?? 'BTC');
  const interval = String(req.query.interval ?? '1h');
  const start = Number(req.query.start);
  const end = Number(req.query.end);
  if (!/^[a-zA-Z0-9@:/._-]{1,60}$/.test(coin) || !Object.hasOwn(INTERVALS, interval) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start || end > Date.now() + 86400000) {
    res.status(400).json({ error: 'Invalid market, interval, or time range' }); return;
  }
  const key = `${coin}:${interval}:${start}:${end}`;
  const cached = candleCache.get(key);
  if (cached && Date.now() - cached.at < 60000) { res.json(cached.payload); return; }
  let pending = candleInFlight.get(key);
  if (!pending) {
    pending = candleQueue.then(async () => {
      const candles = await provider.candles(coin, interval as Interval, start, end);
      const payload = { candles, fetchedAt: Date.now(), requestedStart: start, requestedEnd: end };
      if (candleCache.size >= 24) candleCache.delete(candleCache.keys().next().value!);
      candleCache.set(key, { at: Date.now(), payload });
      return payload;
    });
    candleInFlight.set(key, pending);
    candleQueue = pending.catch(() => undefined);
    void pending.finally(() => candleInFlight.delete(key)).catch(() => undefined);
  }
  try { res.json(await pending); }
  catch (error) { console.error('Candle fetch failed:', error); res.status(502).json({ error: 'Could not load market candles. Try another interval or retry.' }); }
});
app.get('/api/wallet/:wallet', (req, res) => {
  const wallet = req.params.wallet.toLowerCase();
  if (!validWallet(wallet)) { res.status(400).json({ error: 'Invalid wallet address' }); return; }
  const row = db.prepare('SELECT payload FROM snapshots WHERE wallet = ? ORDER BY fetched_at DESC, id DESC LIMIT 1').get(wallet);
  if (!row) { res.status(404).json({ error: 'No saved history. Sync this wallet first.' }); return; }
  res.json(JSON.parse(row.payload as string));
});
app.post('/api/wallet/:wallet/sync', async (req, res) => {
  const wallet = req.params.wallet.toLowerCase();
  if (!validWallet(wallet)) { res.status(400).json({ error: 'Invalid wallet address' }); return; }
  if (syncing || Date.now() < nextSync) { res.status(429).json({ error: 'Please wait before syncing again.' }); return; }
  syncing = true;
  nextSync = Date.now() + 10000;
  try {
    const snapshot = await provider.snapshot(wallet);
    db.prepare('INSERT INTO snapshots(wallet, fetched_at, payload) VALUES (?, ?, ?)').run(wallet, snapshot.fetchedAt, JSON.stringify(snapshot));
    res.json(snapshot);
  } catch (error) {
    console.error('Wallet sync failed:', error);
    res.status(502).json({ error: 'Could not fetch wallet history from Hyperliquid. Please retry.' });
  } finally { syncing = false; }
});
app.use(express.static(path.resolve('dist')));
app.get('/', (_req, res) => res.sendFile(path.resolve('dist/index.html')));
app.listen(3001, '127.0.0.1', () => console.log('Replay API listening on http://127.0.0.1:3001'));
