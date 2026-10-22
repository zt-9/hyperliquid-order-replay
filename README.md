# Hyperliquid Replay

A local-first wallet visualization tool for Hyperliquid. Replay observed orders and executions, inspect estimated resting orders, and follow position changes without connecting a wallet or supplying keys.

## Run

Requires Node.js 24+ and npm. Node's bundled SQLite API is currently experimental.

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:5173. The synthetic demo works without calling Hyperliquid. Paste a public account address and choose **Sync wallet** for recent live history; **Load saved** retrieves the latest locally saved snapshot.

For a single local service:

```sh
npm run build
npm start
```

Open http://127.0.0.1:3001. The service binds to loopback. Wallet snapshots live in `data/replay.sqlite` (ignored by Git). Run commands from the repository root.

## First version

- React + TypeScript UI with an SVG event-price chart, play/pause, step, speed, seek, and market selection.
- Node + Express service with input validation, upstream timeouts, retry/backoff, and a sync cooldown.
- SQLite saves raw API payloads as separate snapshots. Loading uses the latest snapshot; snapshots are not yet merged into continuous history.
- Shared deterministic replay model, partial-fill handling, fill deduplication, and position discontinuity detection.
- Explicit reported/inferred evidence labels and a synthetic demo.

## Read the replay correctly

This is **bounded, approximate wallet replay**, not a full historical order book. The first implementation uses `historicalOrders`, `userFills`, and `frontendOpenOrders`, fetching at most 2,000 historical orders and 2,000 recent fills per sync. Public `userFillsByTime` pagination can extend fill retrieval to the latest 10,000 fills; that follow-up is not implemented yet.

The latest order record supplies a timestamp and current fields, not its full edit history. Placement events and resting sizes are estimates. Terminal statuses and fill records are reported observations. Same-time events use a deterministic display order (placement, fill, status), not proven intra-block sequencing. The three API requests are not atomic.

The chart plots wallet event prices, **not market candles**. Position values anchor to each fill's `startPosition`; unknown starting positions stay unknown. These estimates apply to perpetual fills, not spot balances. Closed PnL is the sum of observed `closedPnl`, excludes funding, and is not an account performance return. Arithmetic is for visualization and is not suitable for execution or accounting.

Scope currently covers the default perp DEX and returned spot identifiers. Additional perp DEX discovery, candles, live recording, archival providers, and full account balance reconstruction are future work. No trading or key handling exists.

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
