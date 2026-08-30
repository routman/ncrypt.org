import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'node:net';

function buildConnect(clientId) {
  const proto = Buffer.from('MQTT', 'utf8');
  const cid = Buffer.from(clientId, 'utf8');
  const remaining = Buffer.concat([
    Buffer.from([0x00, 0x04]),
    proto,
    Buffer.from([0x04]),
    Buffer.from([0x02]),
    Buffer.from([0x00, 0x3c]),
    Buffer.from([0x00, cid.length]),
    cid
  ]);
  return Buffer.concat([Buffer.from([0x10, remaining.length]), remaining]);
}

function buildPublish(topic, payload) {
  const t = Buffer.from(topic, 'utf8');
  const p = Buffer.from(payload, 'utf8');
  const body = Buffer.concat([Buffer.from([t.length >> 8, t.length & 0xff]), t, p]);
  return Buffer.concat([Buffer.from([0x30, body.length]), body]);
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

test('gateway /stats: counts publishes + connections, and resets', async () => {
  // Mock broker that answers CONNACK when the 'mqtt' subprotocol is negotiated.
  const brokerWss = new WebSocketServer({ port: 0 });
  await new Promise((r) => brokerWss.on('listening', r));
  const brokerPort = brokerWss.address().port;
  brokerWss.on('connection', (ws) => {
    ws.on('message', (data) => {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
      if ((buf[0] >> 4) === 1 && ws.protocol === 'mqtt') {
        ws.send(Buffer.from([0x20, 0x02, 0x00])); // CONNACK rc=0
      }
    });
  });

  const gatewayPort = await findFreePort();
  process.env.PORT = String(gatewayPort);
  process.env.BROKER_WS = `ws://127.0.0.1:${brokerPort}`;
  process.env.LIMITS_FILE = '/nonexistent/ncrypt-test-limits.json';

  const { wss, server, stopWatch } = await import('../backend/gateway.js');
  const client = new WebSocket(`ws://127.0.0.1:${gatewayPort}`);
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no CONNACK')), 3000);
      client.on('open', () => {
        client.send(buildConnect('stats-test'));
        client.send(buildPublish('chat/abc', 'hello'));
      });
      client.on('message', (data) => {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
        if ((buf[0] >> 4) === 2) {
          clearTimeout(timer);
          resolve();
        }
      });
      client.on('error', (e) => { clearTimeout(timer); reject(e); });
    });

    // Let the gateway process the PUBLISH.
    await new Promise((r) => setTimeout(r, 50));

    const res = await fetch(`http://127.0.0.1:${gatewayPort}/stats`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.publishes.total, 1);
    assert.equal(body.connections.total, 1);
    assert.equal(body.connections.active, 1);
    assert.ok(body.byClientId.some((e) => e.clientId === 'stats-test' && e.publishes === 1));
    assert.ok(body.byIp.length >= 1);

    // Reset zeroes the cumulative counters (the live active gauge is kept).
    const resetRes = await fetch(`http://127.0.0.1:${gatewayPort}/stats/reset`, { method: 'POST' });
    assert.equal(resetRes.status, 200);
    const after = await (await fetch(`http://127.0.0.1:${gatewayPort}/stats`)).json();
    assert.equal(after.publishes.total, 0);
    assert.equal(after.connections.total, 0);
    assert.equal(after.connections.active, 1);
  } finally {
    try { client.close(); } catch {}
    wss.close();
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    server.close();
    brokerWss.close();
    stopWatch();
  }
});
