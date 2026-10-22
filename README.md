# Hyperliquid Replay

A local-first wallet visualization tool for Hyperliquid. Replay observed orders and executions, inspect estimated resting orders, and follow position changes without connecting a wallet or supplying keys.

## Run

Requires Node.js 24+ and npm. Node's bundled SQLite API is currently experimental.

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:5173. The app opens the most active fetched market in the multi-token example wallet `0x936cf4fb95c30ce83f658b5bbb247e4bb381bb0f`. **Load wallet** retrieves its saved snapshot (or syncs an unseen address); the refresh button syncs recent live history. Market shortcuts show current position direction and size. A snapshot fixture remains available at `/api/demo` for tests.

For a single local service:

```sh
npm run build
npm start
```

Open http://127.0.0.1:3001. The service binds to loopback. Wallet snapshots live in `data/replay.sqlite` (ignored by Git). Run commands from the repository root.

## First version

- React + TypeScript terminal interface with TradingView Lightweight Charts: market candles, volume, compact B/S execution badges with zoom-aware grouping and details on hover or click, estimated order lifetimes, observed position and closed PnL panes.
- All available operations are shown initially. **Replay** defaults to trade replay: it skips empty candles and reveals each candle containing executed trades, with future candles and operations hidden. Candle-by-candle playback remains available in the replay mode selector. Play/pause, bar stepping, seek, speed, zoom, pan, and candle inspection are supported.
- Multiple markets, automatic starting intervals, candle/line view, and execution/order/buy/sell filters. Current account metrics are explicitly separate from historical reconstruction. A compact wallet summary shows equity, exposure/equity, position count and recorder status. The effective-leverage graph has been removed to prioritize the execution chart. Choose the market above its compact position summary; shared labels no longer repeat token names. Each market tab shows its reported leverage multiplier. The selected market heading shows Cross/Isolated plus the multiplier; the expandable all-positions table exposes leverage for every open position, including builder DEXs. The market summary includes margin used, exposure over wallet equity and liquidation price. Exposure/equity is not a liquidation-risk ratio. Historical configured settings remain unknown before account recording began.
- Node + Express service with input validation, upstream timeouts, retry/backoff, and a sync cooldown.
- SQLite saves raw API payloads as separate snapshots. Loading uses the latest snapshot; snapshots are not yet merged into continuous history.
- Shared deterministic replay model, partial-fill handling, fill deduplication, and position discontinuity detection.
- An execution summary shows buy/sell quantity, volume-weighted average price and partial-fill count at the replay cursor. Badges aggregate nearby same-side executions in screen space and separate as you zoom in; original fills remain available under Activity. Quantity, average price, notional and execution time range appear in a hover popover that can be pinned with a click. Candle quantities and raw fill dots are hidden. Estimated order lifetimes are off by default.
- Explicit reported/inferred evidence labels and a synthetic demo fixture.

## Read the replay correctly

This is **bounded, approximate wallet replay**, not a full historical order book. The first implementation uses `historicalOrders`, `userFills`, and `frontendOpenOrders`, fetching at most 2,000 historical orders and 2,000 recent fills per sync. The separate leverage backfill paginates `userFillsByTime` with a fixed cutoff and timestamp overlap, capped at 10,000 retained fills. It does not change the bounded trade-replay snapshot or merge that snapshot into a continuous order stream.

The latest order record supplies a timestamp and current fields, not its full edit history. Placement events and resting sizes are estimates. Terminal statuses and fill records are reported observations. Same-time events use a deterministic display order (placement, fill, status); equal-time fills preserve the API response chronology rather than sorting random trade IDs. This is not a complete intra-block order update sequence. The three API requests are not atomic.

The chart uses real Hyperliquid `candleSnapshot` OHLCV bars, with independent limits of 5,000 recent bars per interval. Each token loads its own candles. Market responses are cached briefly and requests are queued. No synthetic market bars are substituted. Position values anchor to each fill's `startPosition`; unknown starting positions stay unknown. These estimates apply to perpetual fills, not spot balances. Closed PnL is the sum of observed `closedPnl`, excludes funding, and is not an account performance return. Arithmetic is for visualization and is not suitable for execution or accounting.

Account recording discovers every perpetual DEX and queries each account state, including empty DEXs to establish coverage. The example currently has native and builder-DEX positions. Trade replay still uses its bounded public order/fill snapshot. Archival providers, live fill/order streams and full account balance reconstruction are future work. Historical records marked open but absent from current open orders are excluded from estimated lifetimes because their end time is unknown. No trading or key handling exists.

## Validation

```sh
npm test
npm run build
```

See [the evaluated implementation plan](docs/PLAN.md) for decisions and next milestones.

## Sources

- [Hyperliquid Info endpoint](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint)
- [API limits](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/rate-limits-and-user-limits)

This is an early local prototype. Before internet-facing deployment, add access control, durable worker ingestion, shared rate limiting, bounded retention, operational monitoring, and backup/restore. Do not expose the current local service directly to the internet.

## Chart attribution

Charts use [TradingView Lightweight Charts](https://www.tradingview.com/lightweight-charts/) under Apache-2.0; the chart logo and attribution link are preserved. The visual workflow was informed by [Paul’s dashboard](https://paul.catseye.today/). This implementation fetches public Hyperliquid data directly, not the reference site’s stored history.

The execution marker interaction follows [Binance’s B/S history icons](https://www.binance.com/en-AU/support/faq/detail/f32ddef520094124878ea6786bd743df) and [TradingView’s grouped executions](https://www.tradingview.com/support/solutions/43000763371-execution-marks/). Grouped badges summarize visible fills, not an exact single execution price; the popover explicitly shows the weighted average and fill count.

## Trade history tab

The dedicated Trade history view lists every actual fill in the saved wallet snapshot, newest first, independently of chart market selection or replay cursor. Filter by token and page through 50 rows at a time. Columns show UTC execution time, token, buy/sell side, price, size, closed PnL and fees. The view shows snapshot coverage and the 2,000-fill API limit; it does not claim lifetime history. Wallet explorer retains its chart, selection and replay state when switching tabs, and playback pauses on tab changes.

## Wallet-wide effective leverage and account recording

**Definition:** sum of absolute perpetual position notionals across all discovered DEXs, divided by their account equity, expressed in USDC-equivalent terms. Longs and shorts are never netted. Spot inventory is not added to perpetual exposure; linked subaccounts and vault wallets are separate addresses.

- **Recorded account states:** raw account states, margin mode, per-position leverage settings, margins, liquidation prices and collateral conversion rates are saved in SQLite approximately every 30 seconds. Each sample records its observation start and end; separate DEX requests are not an atomic block snapshot. The 30-second cadence can miss changes between observations.
- **Historical estimates (API / cursor readout):** all-position reconstruction from bounded fills, including positions without fills and positions closed before the current snapshot, valued using completed 5-minute market candles. Equity is interpolated between perpetual portfolio samples only when gaps are at most four hours. The latest portfolio equity must approximately align with the all-DEX account equity before a backfill is accepted.
- Missing prices for **any** active position, missing collateral conversion, non-positive equity, fill discontinuities and missing equity produce gaps rather than partial-wallet leverage. Recorder outages over 90 seconds produce gaps instead of interpolated observations.
- Standard (`disabled`) account mode supports equity aggregation. Unified, DEX-abstraction and portfolio-margin modes still retain all raw DEX states, but leverage is withheld until mode-specific shared-equity valuation is implemented, avoiding double-counted collateral. Non-USDC collateral is converted for recorded points when a public spot conversion path exists; historical non-USDC conversion is not yet supported and affected estimates remain gaps.

The watch list and raw samples survive service restarts. Recording runs inside the Node service and continues when the browser closes. It stops when the service/computer stops; run `npm start` continuously for ongoing coverage. The UI offers Pause/Start. Historical backfill remains available through the API. Up to five wallet watches are allowed locally. The API returns the last 30 days of recorded samples; older raw records are retained. Data storage grows with recording duration. Back up the `data` directory with the service stopped.

Tables: `watched_wallets`, `account_frames`, `leverage_backfills`, and existing `snapshots`. Account frames preserve all queried DEX payloads and failed attempts. Shared API rate budgeting and serialized price backfill keep public API usage bounded. A backfill across many markets may take several minutes and reports progress while recording continues.

**Open orders at cursor** are estimated orders still resting at the selected replay time. **Activity** includes placements, fills, cancellations and terminal statuses. Current recorded account metrics and historical replay state are intentionally separate.
