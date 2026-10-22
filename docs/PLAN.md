# Plan evaluation and implementation direction

## Goal

Visualization is the product: inspect how a wallet enters, modifies, fills, and exits orders over time. Local use first, with a practical deployment path. Analysis and possible copy trading can reuse the data layer, but must not dictate the initial product.

The earlier assistant plan was unavailable as readable content. This evaluation uses the user's requirements retrieved from “Hyperliquid Position History Availability” and the requirements in this chat.

## Verdict

Proceed with public-data replay, but frame it as bounded and evidence-aware. A fills-only explorer misses the main differentiation. Public historical orders make an approximate lifecycle visualization possible immediately; complete modification history requires recording updates or archive data. Never present inferred placement details as a complete factual timeline.

## Stack

- TypeScript end to end: shared event contracts between ingestion, replay, and UI.
- React and Vite: responsive interactive visualization with a small local setup.
- SVG initially: price/time marks, order lifetimes, and cursor. Evaluate a market chart library when adding candles.
- Node 24 and Express: a small service, no separate backend runtime.
- SQLite WAL: persist original payloads for debugging and future replay corrections.
- npm lockfile: reproducible installs; Node test runner for replay correctness.

A single repository is appropriate for now. Keep analysis in this repository as a read-only consumer until its dependencies or workflows justify extraction. Future copy trading needs a separate execution module/service, exact decimal arithmetic, isolated credentials, explicit trade sizing/risk controls, idempotency, paper trading, and reconciliation. UI estimates must never become executable orders directly.

## Milestones

### 1. Bounded replay foundation — implemented

Wallet sync and raw snapshot storage; deterministic event normalization; inferred placement vs reported execution/status; partial fills; cursor-anchored positions; demo; visualization, seeking, stepping and event playback; basic error and empty states.

### 2. Make observed history more useful — next

Paginate fills with timestamp overlap and deduplication; flag ambiguous page boundaries; show per-source coverage bounds; validate upstream payload schemas. Merge recorded observations with stable event identities while retaining provenance and retrieval times. Add candle context and filters, wallet bookmarks, shareable cursor URLs, raw export, and additional perp DEX discovery. Add independent server/API integration tests.

### 3. Record forward and deploy reliably

Persist websocket order updates and fills. Distinguish subscription snapshots from new events; reconnect and backfill with explicit gap tracking. Add a provider contract for archive/node history. Run ingestion as a worker independent of page visits. Package deployment, add health/readiness, metrics, retention, backups, authentication and rate limits. SQLite is sufficient for one host; adopt Postgres when concurrent writers or deployment needs justify it.

### 4. Optional analysis

Derive position episodes, holding time, execution patterns, observed PnL and fees with clear denominators and coverage. Keep all analysis tied to source events. Return unknown where incomplete data cannot support a conclusion.

### 5. Optional copy trading

First establish forward stream quality and replay correctness. Start with paper trading and delay/slippage simulation. Treat real execution as a distinct system with key isolation, exact arithmetic, risk limits, stale-feed protection, kill switch, and reconciliation. No execution is in the current implementation.

## Key limitations of milestone 1

No candles, live websocket recording, archival data, fill pagination, snapshot merging, order edit reconstruction, spot balances, full performance statistics, Docker packaging, authentication, or production hardening. The latest snapshot remains a bounded observation even if multiple raw snapshots have been saved. Same-millisecond ordering is a deterministic display convention.
