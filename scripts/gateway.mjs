import test from 'node:test';
import assert from 'node:assert/strict';
import { GatewayPolicy } from '../backend/lib/gateway-policy.js';

test('token bucket: allows up to burst within the window', () => {
  const p = new GatewayPolicy({ rateMs: 2000, burst: 5 });
  const now = 1000000;
  for (let i = 0; i < 5; i++) {
    assert.equal(p.checkPublish('c1', now + i).ok, true);
  }
  const sixth = p.checkPublish('c1', now + 5);
  assert.equal(sixth.ok, false);
  assert.equal(sixth.reason, 'rate');
});

test('token bucket: recovers after the window slides', () => {
  const p = new GatewayPolicy({ rateMs: 2000, burst: 5 });
  const now = 1000000;
  for (let i = 0; i < 5; i++) {
    p.checkPublish('c1', now + i);
  }
  assert.equal(p.checkPublish('c1', now + 5).ok, false);
  assert.equal(p.checkPublish('c1', now + 2005).ok, true);
});

test('token bucket: independent per clientId', () => {
  const p = new GatewayPolicy({ rateMs: 2000, burst: 5 });
  const now = 1000000;
  for (let i = 0; i < 5; i++) {
    p.checkPublish('c1', now + i);
  }
  assert.equal(p.checkPublish('c1', now + 5).ok, false);
  assert.equal(p.checkPublish('c2', now + 5).ok, true);
});

test('room cap: allows up to roomCap distinct topics', () => {
  const p = new GatewayPolicy({ roomCap: 5 });
  for (let i = 0; i < 5; i++) {
    assert.equal(p.checkSubscribe('c1', 'topic' + i).ok, true);
  }
  const sixth = p.checkSubscribe('c1', 'topic5');
  assert.equal(sixth.ok, false);
  assert.equal(sixth.reason, 'room-cap');
});

test('room cap: resubscribing the same topic does not count', () => {
  const p = new GatewayPolicy({ roomCap: 5 });
  for (let i = 0; i < 5; i++) {
    p.checkSubscribe('c1', 'topic' + i);
  }
  assert.equal(p.checkSubscribe('c1', 'topic0').ok, true);
  assert.equal(p.checkSubscribe('c1', 'topic5').ok, false);
});

test('blocklist: blocked clientId is dropped', () => {
  const p = new GatewayPolicy({ blockedClients: ['bad'] });
  assert.equal(p.checkPublish('bad').ok, false);
  assert.equal(p.checkPublish('bad').reason, 'blocked');
  assert.equal(p.checkSubscribe('bad', 't').ok, false);
  assert.equal(p.checkSubscribe('bad', 't').reason, 'blocked');
  assert.equal(p.checkPublish('good').ok, true);
});

test('setConfig: updates blockedClients', () => {
  const p = new GatewayPolicy({});
  assert.equal(p.isBlocked('bad'), false);
  p.setConfig({ blockedClients: ['bad'] });
  assert.equal(p.isBlocked('bad'), true);
});
