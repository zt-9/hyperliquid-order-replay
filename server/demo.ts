import type { Snapshot, Order } from '../shared/replay.js';
export function demoSnapshot(): Snapshot {
  const base = Date.UTC(2026, 9, 20, 14);
  const order = (oid: number, side: 'A' | 'B', price: string, size: string, minutes: number): Order =>
    ({ oid, coin: 'BTC', side, limitPx: price, sz: size, origSz: size, timestamp: base + minutes * 60000, orderType: 'Limit' });
  const buy = order(1001, 'B', '67420', '1.2', 0);
  const canceled = order(1002, 'A', '67880', '0.8', 5);
  const sell = order(1003, 'A', '67750', '0.7', 12);
  return {
    wallet: 'demo', fetchedAt: base + 20 * 60000,
    historicalOrders: [
      { order: buy, status: 'filled', statusTimestamp: base + 4 * 60000 },
      { order: canceled, status: 'canceled', statusTimestamp: base + 10 * 60000 },
      { order: sell, status: 'filled', statusTimestamp: base + 16 * 60000 },
    ], openOrders: [order(1004, 'B', '67100', '0.4', 18)],
    fills: [
      { coin: 'BTC', oid: 1001, tid: 1, side: 'B', px: '67410', sz: '0.5', time: base + 2 * 60000, startPosition: '0', closedPnl: '0', fee: '10.11' },
      { coin: 'BTC', oid: 1001, tid: 2, side: 'B', px: '67420', sz: '0.7', time: base + 4 * 60000, startPosition: '0.5', closedPnl: '0', fee: '14.16' },
      { coin: 'BTC', oid: 1003, tid: 3, side: 'A', px: '67750', sz: '0.7', time: base + 16 * 60000, startPosition: '1.2', closedPnl: '233.92', fee: '14.23' },
    ], warnings: ['Synthetic demo data — not a real wallet or market history.', 'Placement events are inferred; only the displayed observations are replayed.'],
  };
}
