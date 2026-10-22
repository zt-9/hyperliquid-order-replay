import type { Candle, AccountState, Interval } from '../shared/market.js';
import { INTERVALS } from '../shared/market.js';
import type { Fill, HistoricalOrder, Order, Snapshot } from '../shared/replay.js';
export interface HistoryProvider { snapshot(wallet: string): Promise<Snapshot> }
export const validWallet = (wallet: string) => /^0x[0-9a-fA-F]{40}$/.test(wallet);
export class PublicApiProvider implements HistoryProvider {
  async info<T>(type: string, wallet?: string, extra: Record<string, unknown> = {}): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await fetch('https://api.hyperliquid.xyz/info', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, ...(wallet ? { user: wallet } : {}), ...extra }), signal: AbortSignal.timeout(15000),
      });
      if ((response.status === 429 || response.status >= 500) && attempt < 2) {
        await new Promise(resolve => setTimeout(resolve, 1000 * 2 ** attempt));
        continue;
      }
      if (!response.ok) throw new Error(`Hyperliquid ${type} request failed (${response.status})`);
      const data: unknown = await response.json();
      if (!data || typeof data !== 'object') throw new Error(`Unexpected ${type} response`);
      return data as T;
    }
    throw new Error('Hyperliquid is temporarily unavailable');
  }
  async candles(coin: string, interval: Interval, startTime: number, endTime: number): Promise<Candle[]> {
    const rows = await this.info<{ t: number; o: string; h: string; l: string; c: string; v: string }[]>('candleSnapshot', undefined, {
      req: { coin, interval, startTime: Math.max(startTime, endTime - INTERVALS[interval] * 1000 * 4990), endTime },
    });
    if (!Array.isArray(rows)) throw new Error('Invalid candle response');
    const unique = new Map<number, Candle>();
    for (const row of rows) {
      const candle = { time: Math.floor(row.t / 1000), open: Number(row.o), high: Number(row.h), low: Number(row.l), close: Number(row.c), volume: Number(row.v) };
      if (Object.values(candle).every(Number.isFinite) && candle.low > 0 && candle.high >= candle.low) unique.set(candle.time, candle);
    }
    return [...unique.values()].sort((a, b) => a.time - b.time);
  }
  async snapshot(wallet: string): Promise<Snapshot> {
    if (!validWallet(wallet)) throw new Error('Enter a valid 0x wallet address');
    const historicalOrders = await this.info<HistoricalOrder[]>('historicalOrders', wallet);
    const fills = await this.info<Fill[]>('userFills', wallet);
    const openOrders = await this.info<Order[]>('frontendOpenOrders', wallet);
    const account = await this.info<AccountState>('clearinghouseState', wallet);
    return { wallet, fetchedAt: Date.now(), historicalOrders, fills, openOrders, account, warnings: [
      'Bounded history: this version fetches the latest 2,000 orders and 2,000 fills. Earlier activity may be missing.',
      'Placement is inferred from the latest order fields. Historical edits, intermediate statuses, and book priority are unavailable.',
      'Requests are separate observations. Current open orders do not establish a complete historical book.',
      ...(historicalOrders.length >= 2000 || fills.length >= 2000 ? ['A response reached its limit; history is likely truncated.'] : []),
    ] };
  }
}
