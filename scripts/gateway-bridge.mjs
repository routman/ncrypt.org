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

test('gateway bridge: broker-side connection negotiates the mqtt subprotocol', async () => {
  // Mock broker that only answers CONNACK when the client negotiated the
  // 'mqtt' WebSocket subprotocol — mirrors Mosquitto's WebSocket bridge.
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

  const { wss, stopWatch } = await import('../backend/gateway.js');
  const client = new WebSocket(`ws://127.0.0.1:${gatewayPort}`);
  let rc;
  try {
    rc = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no CONNACK through gateway')), 3000);
      client.on('open', () => client.send(buildConnect('e2e-bridge')));
      client.on('message', (data) => {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
        if ((buf[0] >> 4) === 2) {
          clearTimeout(timer);
          resolve(buf[2]);
        }
      });
      client.on('error', (e) => { clearTimeout(timer); reject(e); });
    });
    assert.equal(rc, 0, 'CONNACK rc=0 through the gateway');
  } finally {
    try { client.close(); } catch {}
    wss.close();
    brokerWss.close();
    stopWatch();
  }
});
