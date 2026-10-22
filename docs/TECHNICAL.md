# Technical notes

## Runtime and storage

React and TypeScript frontend, TradingView Lightweight Charts, and an Express server on Node.js 24+. SQLite stores wallet snapshots, account recordings, and saved leverage estimates in `data/replay.sqlite`. The local server binds to `127.0.0.1:3001`.

| Command | Purpose |
| --- | --- |
| `make start` | Install dependencies when needed, build, and start the app and recorder |
| `make dev` | API plus frontend live reload at `http://127.0.0.1:5173` |
| `make build` | Type-check and build |
| `make test` | Run tests |

The project uses npm with a committed lockfile. A synthetic snapshot fixture is available at `/api/demo` for testing.

## Replay and trade history

- Each sync saves a separate snapshot containing up to 2,000 historical orders and 2,000 recent fills. Snapshots are not merged into a continuous event stream.
- Fill and terminal status records are reported by Hyperliquid. Placement times, order lifetimes, and resting sizes are inferred from available order fields; full order-edit history is unavailable. Stale open records absent from current open orders are excluded from reconstructed lifetimes.
- Equal-time events use placement, fill, then status ordering. Equal-time fills preserve API chronology. The upstream requests are not an atomic account snapshot.
- Candles come from `candleSnapshot`, limited to the latest 5,000 bars per interval. No synthetic market data is substituted.
- Position uses each fill’s `startPosition`; missing coverage stays unknown and discontinuities are flagged. These position estimates apply to perpetual fills, not spot inventory.
- Closed PnL sums reported `closedPnl`, excluding fees, funding, transfers and unrealized PnL. It is not an account performance return. Calculations are for visualization, not execution or accounting.
- Trade history shows actual saved fills, with independent token filtering and 50-row pagination. Chart badges group nearby same-side fills at the current zoom; their displayed price is volume-weighted. Selection emphasizes the Buy/Sell badge and shows event details together with candle context.

## Account recording and leverage

The recorder discovers every perpetual DEX and captures raw account states approximately every 30 seconds, independently of browser visits. Captures include leverage settings, margin, liquidation prices and collateral conversion rates. Separate DEX requests are not atomic, and changes between polls can be missed. A durable watch list resumes after service restarts; up to five wallets can be watched locally.

Reported Cross/Isolated leverage is a token’s exchange setting. Wallet exposure/equity sums absolute perpetual notionals across DEXs and divides by account equity in USDC-equivalent terms. Longs and shorts are not netted; spot inventory, linked subaccounts and separate vault addresses are outside that wallet’s perpetual exposure.

Standard (`disabled`) account mode supports equity aggregation. Unified, DEX-abstraction and portfolio-margin states are saved raw, but wallet ratios are withheld pending mode-aware valuation. Recorded non-USDC collateral uses public spot conversion paths when available.

Historical leverage backfill is separate from the trade snapshot. It uses at most 10,000 timestamp-overlapped fills with a fixed cutoff, all known positions including unchanged and closed markets, completed 5-minute candles, and interpolated perpetual equity samples no more than four hours apart. Latest portfolio equity must approximately align with captured equity. Historical non-USDC conversion is unsupported. Missing prices, conversion or equity, non-positive equity, and fill discontinuities produce gaps. Recorder outages over 90 seconds also produce gaps.

SQLite tables: `snapshots`, `watched_wallets`, `account_frames`, `leverage_backfills`. The API returns 30 days of recorded samples; older raw data remains stored. Data grows with recording duration. Back up `data/` while the service is stopped.

## Hosting

The current application is intended for local use. A shared deployment needs persistent storage, access control for recording, shared request limits, retention and backups. Sites hosting uses Cloudflare Workers and would require adapting the Node/SQLite recorder or hosting it separately.

## References and attribution

- [Hyperliquid Info endpoint](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint)
- [Hyperliquid API limits](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/rate-limits-and-user-limits)
- [TradingView Lightweight Charts](https://www.tradingview.com/lightweight-charts/) — Apache-2.0; chart attribution remains visible.
- Chart workflow references: [Paul’s dashboard](https://paul.catseye.today/), [Binance execution icons](https://www.binance.com/en-AU/support/faq/detail/f32ddef520094124878ea6786bd743df), [TradingView execution marks](https://www.tradingview.com/support/solutions/43000763371-execution-marks/). Data is fetched directly from Hyperliquid.
