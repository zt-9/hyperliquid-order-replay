import { EXAMPLE_WALLET } from './market';

export function walletFromUrl(href:string):string {
  const value=new URL(href).searchParams.get('wallet');
  if(value===null)return EXAMPLE_WALLET;
  if(!/^0x[0-9a-fA-F]{40}$/.test(value))throw new Error('The wallet address in this link is invalid. Click the address to enter a valid wallet.');
  return value.toLowerCase();
}

export function walletUrl(href:string,wallet:string):string {
  const url=new URL(href);
  url.searchParams.set('wallet',wallet.toLowerCase());
  return url.pathname+url.search+url.hash;
}
