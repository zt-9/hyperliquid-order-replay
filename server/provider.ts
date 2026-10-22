import type { Fill, HistoricalOrder, Order, Snapshot } from '../shared/replay.js';
export interface HistoryProvider { snapshot(wallet: string): Promise<Snapshot> }
export const validWallet = (wallet: string) => /^0x[0-9a-fA-F]{40}$/.test(wallet);
export class PublicApiProvider implements HistoryProvider {
  async info<T>(type: string, wallet: string): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await fetch('https://api.hyperliquid.xyz/info', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, user: wallet }), signal: AbortSignal.timeout(15000),
      });
      if ((response.status === 429 || response.status >= 500) && attempt < 2) {
        await new Promise(resolve => setTimeout(resolve, 1000 * 2 ** attempt));
        continue;
      }
      if (!response.ok) throw new Error(`Hyperliquid ${type} request failed (${response.status})`);
      const data: unknown = await response.json();
      if (!Array.isArray(data)) throw new Error(`Unexpected ${type} response`);
      return data as T;
    }
    throw new Error('Hyperliquid is temporarily unavailable');
  }
  async snapshot(wallet: string): Promise<Snapshot> {
    if (!validWallet(wallet)) throw new Error('Enter a valid 0x wallet address');
    const historicalOrders = await this.info<HistoricalOrder[]>('historicalOrders', wallet);
    const fills = await this.info<Fill[]>('userFills', wallet);
    const openOrders = await this.info<Order[]>('frontendOpenOrders', wallet);
    return { wallet, fetchedAt: Date.now(), historicalOrders, fills, openOrders, warnings: [
      'Bounded history: this version fetches the latest 2,000 orders and 2,000 fills. Earlier activity may be missing.',
      'Placement is inferred from the latest order fields. Historical edits, intermediate statuses, and book priority are unavailable.',
      'Requests are separate observations. Current open orders do not establish a complete historical book.',
      ...(historicalOrders.length >= 2000 || fills.length >= 2000 ? ['A response reached its limit; history is likely truncated.'] : []),
    ] };
  }
}
