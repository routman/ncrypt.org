import test from 'node:test';
import assert from 'node:assert/strict';
import { createService } from '../backend/server.js';

async function withService(options, fn) {
  const svc = createService(options || {});
  const server = svc.app.listen(0);
  await new Promise((resolve) => server.on('listening', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    await fn(svc, base);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    svc.close();
  }
}

const ADMIN = { 'content-type': 'application/json' };

test('history cap: keeps last 100 per topic', async () => {
  await withService({ limits: { burst: 100000, perTopic: 100 } }, async (svc, base) => {
    const id = 'a'.repeat(64);
    for (let i = 0; i < 150; i++) {
      svc.storeMessage(id, 'ct' + i, 1000000 + i);
    }
    const res = await fetch(base + '/api/history/' + id);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.messages.length, 100);
    assert.equal(body.messages[0].ct, 'ct50');
    assert.equal(body.messages[99].ct, 'ct149');
  });
});

test('rate limit: drops writes past burst within the window', async () => {
  await withService({ limits: { rateMs: 2000, burst: 5, perTopic: 100 } }, async (svc, base) => {
    const id = 'b'.repeat(64);
    const results = [];
    for (let i = 0; i < 6; i++) {
      results.push(svc.storeMessage(id, 'ct' + i, 2000000 + i));
    }
    assert.equal(results[0].stored, true);
    assert.equal(results[4].stored, true);
    assert.equal(results[5].stored, false);
    assert.equal(results[5].reason, 'rate');
    const body = await (await fetch(base + '/api/history/' + id)).json();
    assert.equal(body.messages.length, 5);
  });
});

test('history shape: oldest first with ct + ts', async () => {
  await withService({ limits: { burst: 100000 } }, async (svc, base) => {
    const id = 'c'.repeat(64);
    svc.storeMessage(id, 'first', 100);
    svc.storeMessage(id, 'second', 200);
    svc.storeMessage(id, 'third', 300);
    const res = await fetch(base + '/api/history/' + id + '?limit=100');
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.deepEqual(body.messages, [
      { ct: 'first', ts: 100 },
      { ct: 'second', ts: 200 },
      { ct: 'third', ts: 300 }
    ]);
  });
});

test('history: unknown id → 200 empty', async () => {
  await withService({}, async (svc, base) => {
    const res = await fetch(base + '/api/history/' + 'e'.repeat(64));
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.deepEqual(body, { messages: [] });
  });
});

test('history: bad id → 400', async () => {
  await withService({}, async (svc, base) => {
    assert.equal((await fetch(base + '/api/history/notahex')).status, 400);
    assert.equal((await fetch(base + '/api/history/' + 'a'.repeat(63))).status, 400);
  });
});

test('history: bad limit → 400', async () => {
  await withService({}, async (svc, base) => {
    const id = 'd'.repeat(64);
    assert.equal((await fetch(base + '/api/history/' + id + '?limit=0')).status, 400);
    assert.equal((await fetch(base + '/api/history/' + id + '?limit=101')).status, 400);
    assert.equal((await fetch(base + '/api/history/' + id + '?limit=abc')).status, 400);
  });
});

test('delete: valid token removes the matching row', async () => {
  await withService({ limits: { burst: 100000 } }, async (svc, base) => {
    const id = 'a'.repeat(64);
    svc.storeMessage(id, 'keep', 100, 'a'.repeat(64));
    svc.storeMessage(id, 'drop', 200, 'b'.repeat(64));
    const res = await fetch(base + '/api/delete/' + id, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'b'.repeat(64) })
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.deleted, 1);
    const hist = await (await fetch(base + '/api/history/' + id)).json();
    assert.deepEqual(hist.messages, [{ ct: 'keep', ts: 100 }]);
  });
});

test('delete: wrong token → 0 deleted, row remains', async () => {
  await withService({ limits: { burst: 100000 } }, async (svc, base) => {
    const id = 'b'.repeat(64);
    svc.storeMessage(id, 'x', 100, 'c'.repeat(64));
    const res = await fetch(base + '/api/delete/' + id, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'd'.repeat(64) })
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.deleted, 0);
    const hist = await (await fetch(base + '/api/history/' + id)).json();
    assert.equal(hist.messages.length, 1);
  });
});

test('delete: bad token → 400', async () => {
  await withService({}, async (svc, base) => {
    const id = 'c'.repeat(64);
    assert.equal((await fetch(base + '/api/delete/' + id, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'XYZ' })
    })).status, 400);
    assert.equal((await fetch(base + '/api/delete/' + id, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({})
    })).status, 400);
  });
});

test('delete: bad id → 400', async () => {
  await withService({}, async (svc, base) => {
    assert.equal((await fetch(base + '/api/delete/notahex', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'abc' })
    })).status, 400);
  });
});

test('admin: disallowed source IP → 403', async () => {
  await withService({ trustProxy: true }, async (svc, base) => {
    const res = await fetch(base + '/api/admin/stats', {
      method: 'POST',
      headers: { ...ADMIN, 'x-forwarded-for': '8.8.8.8' },
      body: '{}'
    });
    assert.equal(res.status, 403);
  });
});

test('admin: allowed source IP → 200 stats', async () => {
  await withService({ trustProxy: true }, async (svc, base) => {
    const res = await fetch(base + '/api/admin/stats', {
      method: 'POST',
      headers: { ...ADMIN, 'x-forwarded-for': '127.0.0.1' },
      body: '{}'
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(typeof body.messages60s, 'number');
    assert.equal(typeof body.storageRows, 'number');
    assert.equal(typeof body.droppedTotal, 'number');
  });
});

test('admin: limits reflects current config', async () => {
  await withService({ trustProxy: true, limits: { rateMs: 3000, burst: 7 } }, async (svc, base) => {
    const res = await fetch(base + '/api/admin/limits', {
      method: 'POST',
      headers: { ...ADMIN, 'x-forwarded-for': '127.0.0.1' },
      body: '{}'
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.rateMs, 3000);
    assert.equal(body.burst, 7);
  });
});

test('admin: purge deletes a topic', async () => {
  await withService({ trustProxy: true, limits: { burst: 100000 } }, async (svc, base) => {
    const id = 'f'.repeat(64);
    svc.storeMessage(id, 'x', 100);
    svc.storeMessage(id, 'y', 200);
    const res = await fetch(base + '/api/admin/purge', {
      method: 'POST',
      headers: { ...ADMIN, 'x-forwarded-for': '127.0.0.1' },
      body: JSON.stringify({ id })
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.deleted, 2);
    assert.deepEqual((await (await fetch(base + '/api/history/' + id)).json()), { messages: [] });
  });
});

test('admin: audit records actions', async () => {
  await withService({ trustProxy: true }, async (svc, base) => {
    const headers = { ...ADMIN, 'x-forwarded-for': '127.0.0.1' };
    await fetch(base + '/api/admin/block', {
      method: 'POST',
      headers,
      body: JSON.stringify({ clientId: 'abc' })
    });
    const res = await fetch(base + '/api/admin/audit', { method: 'POST', headers, body: '{}' });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.ok(body.entries.some((e) => e.action === 'block'));
  });
});

test('blockedIps: blocked source ip → 403 on /api/history', async () => {
  await withService({ trustProxy: true, limits: { blockedIps: ['8.8.8.8'] } }, async (svc, base) => {
    const res = await fetch(base + '/api/history/' + 'a'.repeat(64), {
      headers: { 'x-forwarded-for': '8.8.8.8' }
    });
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.error, 'blocked');
  });
});

test('blockedIps: unblocked source ip → 200 on /api/history', async () => {
  await withService({ trustProxy: true, limits: { blockedIps: ['8.8.8.8'] } }, async (svc, base) => {
    const res = await fetch(base + '/api/history/' + 'a'.repeat(64), {
      headers: { 'x-forwarded-for': '9.9.9.9' }
    });
    assert.equal(res.status, 200);
  });
});

test('blockedIps: spoofed leftmost XFF hop cannot bypass the block', async () => {
  // Caddy appends the real (blocked) client IP to the END of the XFF chain.
  // An attacker's spoofed leftmost hop must not be trusted.
  await withService({ trustProxy: true, limits: { blockedIps: ['8.8.8.8'] } }, async (svc, base) => {
    const res = await fetch(base + '/api/history/' + 'a'.repeat(64), {
      headers: { 'x-forwarded-for': '1.1.1.1, 8.8.8.8' }
    });
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.error, 'blocked');
  });
});

test('clientIp: rightmost XFF hop is the trusted client address', async () => {
  await withService({ trustProxy: true, limits: { blockedIps: ['8.8.8.8'] } }, async (svc, base) => {
    // Real client 9.9.9.9 (unblocked) behind a spoofed leftmost hop → allowed.
    const res = await fetch(base + '/api/history/' + 'a'.repeat(64), {
      headers: { 'x-forwarded-for': '8.8.8.8, 9.9.9.9' }
    });
    assert.equal(res.status, 200);
  });
});

test('admin: block-ip adds to blockedIps', async () => {
  await withService({ trustProxy: true }, async (svc, base) => {
    const headers = { ...ADMIN, 'x-forwarded-for': '127.0.0.1' };
    const res = await fetch(base + '/api/admin/block-ip', {
      method: 'POST',
      headers,
      body: JSON.stringify({ ip: '1.2.3.4' })
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.blockedIps, 1);
    assert.deepEqual(svc.limits.cfg.blockedIps, ['1.2.3.4']);
  });
});

test('admin: unblock-ip removes from blockedIps', async () => {
  await withService({ trustProxy: true, limits: { blockedIps: ['1.2.3.4', '5.6.7.8'] } }, async (svc, base) => {
    const headers = { ...ADMIN, 'x-forwarded-for': '127.0.0.1' };
    const res = await fetch(base + '/api/admin/unblock-ip', {
      method: 'POST',
      headers,
      body: JSON.stringify({ ip: '1.2.3.4' })
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.blockedIps, 1);
    assert.deepEqual(svc.limits.cfg.blockedIps, ['5.6.7.8']);
  });
});

test('global cap: sweep prunes oldest rows down to globalRows', async () => {
  await withService({ limits: { perTopic: 100000, globalRows: 10, ttlDays: 30, burst: 100000 } }, async (svc) => {
    const idA = 'a'.repeat(64);
    const idB = 'b'.repeat(64);
    const now = Date.now();
    for (let i = 0; i < 8; i++) {
      svc.storeMessage(idA, 'a' + i, now - 16000 + i * 1000);
    }
    for (let i = 0; i < 7; i++) {
      svc.storeMessage(idB, 'b' + i, now - 8000 + i * 1000);
    }
    svc.sweep(now);
    const total = svc.db.prepare('SELECT COUNT(*) AS n FROM messages').get().n;
    assert.equal(total, 10);
    const countA = svc.db.prepare('SELECT COUNT(*) AS n FROM messages WHERE topic_id = ?').get(idA).n;
    const countB = svc.db.prepare('SELECT COUNT(*) AS n FROM messages WHERE topic_id = ?').get(idB).n;
    assert.equal(countA, 3);
    assert.equal(countB, 7);
  });
});

test('ttl: sweep prunes rows older than ttlDays', async () => {
  await withService({ limits: { perTopic: 100000, globalRows: 100000, ttlDays: 30, burst: 100000 } }, async (svc) => {
    const old = 'c'.repeat(64);
    const recent = 'd'.repeat(64);
    const now = Date.now();
    svc.storeMessage(old, 'old', now - 31 * 86400000);
    svc.storeMessage(recent, 'recent', now - 86400000);
    svc.sweep(now);
    const oldRows = svc.db.prepare('SELECT COUNT(*) AS n FROM messages WHERE topic_id = ?').get(old).n;
    const recentRows = svc.db.prepare('SELECT COUNT(*) AS n FROM messages WHERE topic_id = ?').get(recent).n;
    assert.equal(oldRows, 0);
    assert.equal(recentRows, 1);
  });
});
