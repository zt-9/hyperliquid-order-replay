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
- Multiple markets, automatic starting intervals, candle/line view, and execution/order/buy/sell/label filters. Current account metrics are explicitly separate from historical reconstruction. The leverage card shows the selected market’s reported cross/isolated setting; the margin strip shows gross account notional/equity, selected-market notional/equity, margin used, and reported liquidation price. Exposure ratios are not liquidation-risk ratios. Historical leverage remains unknown without past account equity and leverage-setting snapshots.
- Node + Express service with input validation, upstream timeouts, retry/backoff, and a sync cooldown.
- SQLite saves raw API payloads as separate snapshots. Loading uses the latest snapshot; snapshots are not yet merged into continuous history.
- Shared deterministic replay model, partial-fill handling, fill deduplication, and position discontinuity detection.
- An execution summary shows buy/sell quantity, volume-weighted average price and partial-fill count at the replay cursor. Badges aggregate nearby same-side executions in screen space and separate as you zoom in; original fills remain available under Operations. Quantity, average price, notional and execution time range appear in a hover popover that can be pinned with a click. Candle quantities and raw fill dots are hidden. Estimated order lifetimes are off by default.
- Explicit reported/inferred evidence labels and a synthetic demo fixture.

## Read the replay correctly

This is **bounded, approximate wallet replay**, not a full historical order book. The first implementation uses `historicalOrders`, `userFills`, and `frontendOpenOrders`, fetching at most 2,000 historical orders and 2,000 recent fills per sync. Public `userFillsByTime` pagination can extend fill retrieval to the latest 10,000 fills; that follow-up is not implemented yet.

The latest order record supplies a timestamp and current fields, not its full edit history. Placement events and resting sizes are estimates. Terminal statuses and fill records are reported observations. Same-time events use a deterministic display order (placement, fill, status); equal-time fills preserve the API response chronology rather than sorting random trade IDs. This is not a complete intra-block order update sequence. The three API requests are not atomic.

The chart uses real Hyperliquid `candleSnapshot` OHLCV bars, with independent limits of 5,000 recent bars per interval. Each token loads its own candles. Market responses are cached briefly and requests are queued. No synthetic market bars are substituted. Position values anchor to each fill's `startPosition`; unknown starting positions stay unknown. These estimates apply to perpetual fills, not spot balances. Closed PnL is the sum of observed `closedPnl`, excludes funding, and is not an account performance return. Arithmetic is for visualization and is not suitable for execution or accounting.

Scope currently covers current positions from the default perp DEX and market identifiers returned in history. Additional perp DEX account discovery, live recording, archival providers, and full account balance reconstruction are future work. Historical records marked open but absent from current open orders are excluded from estimated lifetimes because their end time is unknown. No trading or key handling exists.

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
