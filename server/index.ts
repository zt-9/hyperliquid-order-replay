import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { PublicApiProvider, validWallet } from './provider.js';
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
