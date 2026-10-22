export const INTERVALS = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400 } as const;
export type Interval = keyof typeof INTERVALS;
export interface Candle { time: number; open: number; high: number; low: number; close: number; volume: number }
export interface CandleResponse { candles: Candle[]; fetchedAt: number; requestedStart: number; requestedEnd: number }
export interface AccountState {
  marginSummary: { accountValue: string; totalNtlPos: string };
  assetPositions: { position: { coin: string; szi: string; entryPx: string; unrealizedPnl: string; liquidationPx: string | null; leverage?: { type: 'cross' | 'isolated'; value: number }; positionValue?: string; marginUsed?: string; maxLeverage?: number } }[];
  time?: number;
}
export const EXAMPLE_WALLET = '0x936cf4fb95c30ce83f658b5bbb247e4bb381bb0f';
export function candleIndexAt(candles: Candle[], time: number) {
  let lo = 0, hi = candles.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (candles[mid].time <= time) lo = mid + 1; else hi = mid; }
  return lo - 1;
}

// Lightweight Charts accepts integer logical indices only. Executions can land
// between candle opens, so interpolate already-converted integer coordinates.
export function interpolateLogical(logical: number, coordinateAt: (index: number) => number | null) {
  const lower = Math.floor(logical);
  const left = coordinateAt(lower);
  const right = coordinateAt(lower + 1);
  return left === null || right === null ? null : left + (right - left) * (logical - lower);
}

// Exposure/equity is distinct from the user-selected leverage setting.
// Non-positive equity does not produce a meaningful finite leverage ratio.
export function exposureLeverage(notional: string | undefined, equity: string | undefined): number | null {
  if (notional === undefined || equity === undefined || notional.trim() === '' || equity.trim() === '') return null;
  const n = Number(notional), e = Number(equity);
  return Number.isFinite(n) && Number.isFinite(e) && e > 0 ? Math.abs(n) / e : null;
}
