import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demoSnapshot } from '../server/demo.js';
import { eventsFrom, stateAt } from '../shared/replay.js';
import { validWallet } from '../server/provider.js';
test('partial executions reduce resting size and anchor position', () => {
 const events = eventsFrom(demoSnapshot());
 const index = events.findIndex(e=>e.id==='fill:BTC:1');
 const state = stateAt(events,index);
 assert.equal(state.position,.5);
 assert.equal(state.orders[0].remaining,.7);
 assert.equal(state.discontinuities,0);
});
test('same-timestamp execution precedes terminal status and cancels remove orders',()=>{
 const events=eventsFrom(demoSnapshot());
 const end=stateAt(events,events.length-1);
 assert.ok(Math.abs(end.position!-.5)<1e-10);
 assert.equal(end.orders.length,1);
 assert.equal(end.orders[0].event.oid,1004);
 assert.equal(end.discontinuities,0);
 assert.ok(events.findIndex(e=>e.id==='fill:BTC:2')<events.findIndex(e=>e.oid===1001&&e.kind==='status'));
});
test('deduplicates fills and distinguishes inferred from reported events',()=>{
 const data=demoSnapshot(); data.fills.push(data.fills[0]);
 const events=eventsFrom(data);
 assert.equal(events.filter(e=>e.kind==='fill').length,3);
 assert.ok(events.filter(e=>e.kind==='placement').every(e=>e.evidence==='inferred'));
});
test('unknown position stays unknown until first fill; history gaps are detected',()=>{
 const data=demoSnapshot(); data.fills[1].startPosition='5';
 const events=eventsFrom(data);
 assert.equal(stateAt(events,-1).position,null);
 assert.ok(stateAt(events,events.length-1).discontinuities>0);
});
test('wallet addresses are strictly validated',()=>{
 assert.equal(validWallet('0x'+'a'.repeat(40)),true);
 assert.equal(validWallet('../../etc/passwd'),false);
 assert.equal(validWallet('0x123'),false);
});
