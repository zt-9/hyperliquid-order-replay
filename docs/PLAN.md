# Plan evaluation and implementation direction

## Goal

Visualization is the product: inspect how a wallet enters, modifies, fills, and exits orders over time. Local use first, with a practical deployment path. Analysis and possible copy trading can reuse the data layer, but must not dictate the initial product.

The earlier assistant plan was unavailable as readable content. This evaluation uses the user's requirements retrieved from “Hyperliquid Position History Availability” and the requirements in this chat.

## Verdict

Proceed with public-data replay, but frame it as bounded and evidence-aware. A fills-only explorer misses the main differentiation. Public historical orders make an approximate lifecycle visualization possible immediately; complete modification history requires recording updates or archive data. Never present inferred placement details as a complete factual timeline.

## Stack

- TypeScript end to end: shared event contracts between ingestion, replay, and UI.
- React and Vite: responsive interactive visualization with a small local setup.
- TradingView Lightweight Charts: actual candle/volume visualization, execution bubbles and estimated lifecycle primitives, with aligned position and observed PnL panes.
- Node 24 and Express: a small service, no separate backend runtime.
- SQLite WAL: persist original payloads for debugging and future replay corrections.
- npm lockfile: reproducible installs; Node test runner for replay correctness.

A single repository is appropriate for now. Keep analysis in this repository as a read-only consumer until its dependencies or workflows justify extraction. Future copy trading needs a separate execution module/service, exact decimal arithmetic, isolated credentials, explicit trade sizing/risk controls, idempotency, paper trading, and reconciliation. UI estimates must never become executable orders directly.

## Milestones

### 1. Bounded replay foundation — implemented

Wallet sync and raw snapshot storage; deterministic event normalization; inferred placement vs reported execution/status; partial fills; cursor-anchored positions; demo; visualization, seeking, stepping and event playback; basic error and empty states.

### 2. Market chart and multi-token workflow — implemented initial slice

Replaced the event-price SVG with Lightweight Charts. Real market candles and volume are overlaid with execution bubbles at fill prices and estimated order lifetimes. Added aligned observed-position/closed-PnL panes, current-account metrics including the reported leverage setting, cross/isolated margin mode, margin used, liquidation price and separately defined exposure/equity ratios, candle inspection, zoom/pan, filters, and candle-driven replay that hides future observations. Market shortcuts expose current long/short positions, use token-specific price precision, and choose an initial interval based on history duration. The original H↗ REPLAY logo is preserved. Compact B/S badges summarize executions without persistent price/quantity text. Nearby same-side groups merge in screen space when zoomed out and separate when zoomed in; hovering opens execution details, and clicking pins the popover. Raw execution dots are removed and estimated order lifetimes are off by default. A visible execution summary follows the replay cursor. Trade replay is the default and skips empty candles; candle replay remains optional. The example opens the market with the largest number of fetched fills rather than defaulting to sparse BTC activity.

The default example is `0x936cf4fb95c30ce83f658b5bbb247e4bb381bb0f`, a multi-token wallet. The earlier example `0xdae4df7207feb3b350e4284c8efe5f7dac37f637` was also checked with live API data. Neither address is embedded in test fixtures or credentials.

Same-millisecond fill ordering now preserves source chronology: trade IDs cannot be used as execution sequence numbers. Stale historical open records absent from current open orders are excluded from estimated lifetimes. Candles are fetched separately, briefly cached, and queued to avoid conflicting requests during token/interval switches.

### 2b. Wallet leverage observatory and account recorder — implemented

Added a separate wallet-wide effective-leverage chart. All perpetual DEXs are discovered and queried; the example exposes 43 positions across native and builder DEXs rather than only the 37 native positions. Numerators sum absolute notionals. Recorded equity uses non-duplicated standard-mode DEX balances with collateral conversion. Shared-equity account modes are retained raw but ratios are withheld pending mode-aware valuation.

SQLite stores raw account frames approximately every 30 seconds in a worker independent of browser visits, with a durable watch list, error observations and pause/resume. Watchers resume after service restarts. Missing or delayed recording creates explicit chart gaps.

Backfill uses up to 10,000 timestamp-overlapped fills with a fixed cutoff, all relevant markets (including unchanged and closed positions), completed 5-minute market prices and bounded interpolation of historical perpetual equity samples. Missing any position price or valid equity, unsupported historical collateral conversion, or fill continuity gaps withhold affected points. Current portfolio-equity alignment is checked before building estimates. The chart distinguishes estimates from observations and follows replay cutoff without filtering to the selected market.

The UI now separates Wallet Overview, market selection and market details. Token names appear in the market heading instead of every metric; Resting Orders and Operations are renamed Open Orders and Activity. The original H↗ REPLAY logo remains.

### 2c. Extend observed history — next

Reuse the leverage backfill’s timestamp overlap/deduplication in the trade-replay timeline; show per-source coverage bounds; validate upstream payload schemas. Merge recorded observations with stable event identities while retaining provenance and retrieval times. Add wallet bookmarks, shareable cursor URLs, raw export, and full DEX order/market metadata support. Add independent server/API integration tests.

### 3. Record forward and deploy reliably

Persist websocket order updates and fills. Distinguish subscription snapshots from new events; reconnect and backfill with explicit gap tracking. Extend the account-state recorder with websocket state/fill/order updates and explicit reconciliation so changes between periodic snapshots are retained. Existing fill-only history cannot supply past margin settings or equity. Add a provider contract for archive/node history. Run ingestion as a worker independent of page visits. Package deployment, add health/readiness, metrics, retention, backups, authentication and rate limits. SQLite is sufficient for one host; adopt Postgres when concurrent writers or deployment needs justify it.

### 4. Optional analysis

Derive position episodes, holding time, execution patterns, observed PnL and fees with clear denominators and coverage. Keep all analysis tied to source events. Return unknown where incomplete data cannot support a conclusion.

### 5. Optional copy trading

First establish forward stream quality and replay correctness. Start with paper trading and delay/slippage simulation. Treat real execution as a distinct system with key isolation, exact arithmetic, risk limits, stale-feed protection, kill switch, and reconciliation. No execution is in the current implementation.

## Key limitations of milestone 1

No live websocket fill/order recording, archival data, trade-snapshot merging, order edit reconstruction, spot balances, full performance statistics, Docker packaging, authentication, or production hardening. The latest snapshot remains a bounded observation even if multiple raw snapshots have been saved. Same-millisecond placement/fill/status ordering is a deterministic display convention; fills retain source chronology.
