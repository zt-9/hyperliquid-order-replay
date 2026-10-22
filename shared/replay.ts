export interface Order {
  coin: string; oid: number; side: 'A' | 'B'; limitPx: string; sz: string;
  origSz?: string; timestamp: number; orderType?: string;
}
export interface HistoricalOrder { order: Order; status: string; statusTimestamp: number }
export interface Fill {
  coin: string; oid: number; tid: number; side: 'A' | 'B'; px: string; sz: string;
  time: number; startPosition: string; closedPnl: string; fee: string; feeToken?: string;
}
import type { AccountState } from './market.js';
export interface Snapshot {
  wallet: string; fetchedAt: number; account?: AccountState; historicalOrders: HistoricalOrder[];
  openOrders: Order[]; fills: Fill[]; warnings: string[];
}
export interface ReplayEvent {
  id: string; time: number; coin: string; oid: number; side: 'A' | 'B';
  kind: 'placement' | 'fill' | 'status'; price: string; size: string;
  evidence: 'reported' | 'inferred'; status?: string; fill?: Fill;
}
export function eventsFrom(snapshot: Snapshot): ReplayEvent[] {
  const events: ReplayEvent[] = [];
  const orders = new Map<string, Order>();
  const current = new Set(snapshot.openOrders.map(order => `${order.coin}:${order.oid}`));
  for (const { order, status } of snapshot.historicalOrders) {
    if (status === 'open' && !current.has(`${order.coin}:${order.oid}`)) continue;
    orders.set(`${order.coin}:${order.oid}`, order);
  }
  for (const order of snapshot.openOrders) orders.set(`${order.coin}:${order.oid}`, order);
  // The order timestamp implies placement; latest order fields are not guaranteed
  // to match the original placement when an order has been edited.
  for (const order of orders.values()) events.push({
    id: `order:${order.coin}:${order.oid}`, time: order.timestamp, coin: order.coin,
    oid: order.oid, side: order.side, kind: 'placement', price: order.limitPx,
    size: order.origSz ?? order.sz, evidence: 'inferred',
  });
  for (const row of snapshot.historicalOrders) {
    if (row.status === 'open') continue;
    events.push({ id: `status:${row.order.coin}:${row.order.oid}:${row.statusTimestamp}`,
      time: row.statusTimestamp, coin: row.order.coin, oid: row.order.oid,
      side: row.order.side, kind: 'status', price: row.order.limitPx, size: row.order.sz,
      evidence: 'reported', status: row.status });
  }
  const seen = new Set<string>();
  // userFills is newest first, including same-millisecond executions. Trade IDs
  // are not sequence numbers. Reverse source order before the stable time sort.
  for (const fill of [...snapshot.fills].reverse()) {
    const id = `fill:${fill.coin}:${fill.tid}`;
    if (seen.has(id)) continue;
    seen.add(id);
    events.push({ id, time: fill.time, coin: fill.coin, oid: fill.oid, side: fill.side,
      kind: 'fill', price: fill.px, size: fill.sz, evidence: 'reported', fill });
  }
  const priority = { placement: 0, fill: 1, status: 2 };
  return events.sort((a, b) => a.time - b.time || priority[a.kind] - priority[b.kind]);
}
// Call with one market only. Numeric conversions are for display, never execution.
export function stateAt(events: ReplayEvent[], index: number) {
  const orders = new Map<number, { event: ReplayEvent; remaining: number }>();
  let position: number | null = null;
  let discontinuities = 0;
  for (const event of events.slice(0, index + 1)) {
    if (event.kind === 'placement') orders.set(event.oid, { event, remaining: Number(event.size) });
    if (event.kind === 'fill' && event.fill) {
      const start = Number(event.fill.startPosition);
      if (position !== null && Math.abs(start - position) > 1e-8) discontinuities++;
      position = start + (event.side === 'B' ? 1 : -1) * Number(event.size);
      const order = orders.get(event.oid);
      if (order) order.remaining = Math.max(0, order.remaining - Number(event.size));
    }
    if (event.kind === 'status') orders.delete(event.oid);
  }
  return { orders: [...orders.values()].filter(o => o.remaining > 1e-10), position, discontinuities };
}
