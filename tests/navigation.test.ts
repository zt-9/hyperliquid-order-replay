import test from 'node:test';
import assert from 'node:assert/strict';
import { walletFromUrl, walletUrl } from '../shared/navigation';
import { EXAMPLE_WALLET } from '../shared/market';
const wallet='0xdae4df7207feb3b350e4284c8efe5f7dac37f637';
test('shared wallet links select their wallet and normalize its case',()=>{
  assert.equal(walletFromUrl(`https://example.com/?wallet=${wallet.toUpperCase().replace('0X','0x')}`),wallet);
  assert.equal(walletFromUrl('https://example.com/'),EXAMPLE_WALLET);
  assert.throws(()=>walletFromUrl('https://example.com/?wallet=bad'),/invalid/);
  assert.throws(()=>walletFromUrl('https://example.com/?wallet='),/invalid/);
});
test('wallet changes preserve the current tab and other query parameters',()=>{
  assert.equal(walletUrl('https://example.com/?foo=bar#trade-history',wallet),`/?foo=bar&wallet=${wallet}#trade-history`);
});
