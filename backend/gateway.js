import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'node:http';
import { loadLimitsConfig, watchLimitsFile, clientIp } from './lib/limits.js';
import { GatewayPolicy } from './lib/gateway-policy.js';

const PORT = Number(process.env.PORT || 9002);
const HOST = process.env.HOST || '127.0.0.1';
const BROKER_WS = process.env.BROKER_WS || 'ws://127.0.0.1:9001';
const LIMITS_FILE = process.env.LIMITS_FILE || '/opt/ncrypt/limits.json';

const limits = loadLimitsConfig(LIMITS_FILE);
const policy = new GatewayPolicy(limits);
const stopWatch = watchLimitsFile(LIMITS_FILE, policy, {
  intervalMs: 5000,
  log: (msg) => console.log(msg)
});

// --- Telemetry (instrument-first: count publishes per IP / per clientId, drop reasons) ---
// Aggregate counters only; no per-message payloads are stored. The per-key maps
// are hard-capped so a flood of unique clientIds/IPs cannot exhaust memory.
const MAX_TRACKED = 500;

const stats = {
  startedAt: Date.now(),
  connections: { total: 0, active: 0 },
  publishes: { total: 0, dropped: { rate: 0, blocked: 0 } },
  subscribes: { total: 0, dropped: { blocked: 0, 'room-cap': 0 } },
  byClientId: new Map(),
  byIp: new Map()
};

function bump(map, key, fields) {
  let entry = map.get(key);
  if (!entry) {
    if (map.size >= MAX_TRACKED) return;
    entry = { publishes: 0, drops: 0, connections: 0 };
    map.set(key, entry);
  }
  for (const k of Object.keys(fields)) entry[k] += fields[k];
}

function topEntries(map, n, keyName, score) {
  return [...map.entries()]
    .map(([key, e]) => ({ [keyName]: key, ...e, score: score(e) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, n);
}

function statsSnapshot() {
  return {
    uptimeSec: Math.round((Date.now() - stats.startedAt) / 1000),
    connections: { total: stats.connections.total, active: stats.connections.active },
    publishes: { total: stats.publishes.total, dropped: { ...stats.publishes.dropped } },
    subscribes: { total: stats.subscribes.total, dropped: { ...stats.subscribes.dropped } },
    byClientId: topEntries(stats.byClientId, 50, 'clientId', (e) => e.publishes + e.drops),
    byIp: topEntries(stats.byIp, 50, 'ip', (e) => e.publishes + e.connections)
  };
}

// Reset the cumulative counters for a fresh observation window.
// connections.active is a live gauge (maintained by the connect/close
// handlers), so it is intentionally left untouched here.
function resetStats() {
  stats.connections.total = 0;
  stats.publishes.total = 0;
  stats.publishes.dropped = { rate: 0, blocked: 0 };
  stats.subscribes.total = 0;
  stats.subscribes.dropped = { blocked: 0, 'room-cap': 0 };
  stats.byClientId.clear();
  stats.byIp.clear();
}

function isLoopback(ip) {
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

// --- Minimal MQTT packet parsing (client -> broker direction) ---

function parseFixedHeader(buf) {
  if (buf.length < 2) return null;
  const type = buf[0] >> 4;
  let multiplier = 1;
  let value = 0;
  let pos = 1;
  let byte;
  do {
    if (pos >= buf.length) return null;
    byte = buf[pos];
    value += (byte & 0x7f) * multiplier;
    multiplier *= 128;
    pos++;
  } while ((byte & 0x80) !== 0);
  const totalLen = pos + value;
  if (buf.length < totalLen) return null;
  return { type, totalLen };
}

function skipRemainingLength(buf, pos) {
  let multiplier = 1;
  let value = 0;
  let byte;
  do {
    byte = buf[pos];
    value += (byte & 0x7f) * multiplier;
    multiplier *= 128;
    pos++;
  } while ((byte & 0x80) !== 0);
  return pos;
}

function parseConnect(buf) {
  let pos = skipRemainingLength(buf, 1);
  const protoLen = buf.readUInt16BE(pos);
  pos += 2 + protoLen;
  pos += 1; // protocol level
  pos += 1; // connect flags
  pos += 2; // keepalive
  const clientIdLen = buf.readUInt16BE(pos);
  pos += 2;
  const clientId = buf.slice(pos, pos + clientIdLen).toString('utf8');
  return { clientId };
}

function parseSubscribe(buf) {
  let pos = skipRemainingLength(buf, 1);
  pos += 2; // packet id
  const topics = [];
  const end = buf.length;
  while (pos + 3 <= end) {
    const topicLen = buf.readUInt16BE(pos);
    pos += 2;
    if (pos + topicLen + 1 > end) break;
    const topic = buf.slice(pos, pos + topicLen).toString('utf8');
    pos += topicLen + 1; // +1 for QoS byte
    topics.push(topic);
  }
  return { topics };
}

function parsePublish(buf) {
  let pos = skipRemainingLength(buf, 1);
  const topicLen = buf.readUInt16BE(pos);
  pos += 2;
  const topic = buf.slice(pos, pos + topicLen).toString('utf8');
  return { topic };
}

// Extract complete MQTT packets from a buffer.
// Returns { packets: [{ type, raw }], rest: Buffer }
function extractPackets(buf) {
  const packets = [];
  let offset = 0;
  while (offset < buf.length) {
    const view = buf.subarray(offset);
    const header = parseFixedHeader(view);
    if (!header) break;
    const raw = buf.subarray(offset, offset + header.totalLen);
    packets.push({ type: header.type, raw });
    offset += header.totalLen;
  }
  return { packets, rest: buf.subarray(offset) };
}

// --- Per-connection state ---

// Cap on the reassembled per-connection MQTT buffer. A single WebSocket frame
// is already bounded by the ws maxPayload below, but an MQTT packet may span
// many frames, so the accumulated buffer is capped independently to stop a
// client from exhausting memory with a large/incomplete packet.
const MAX_BUF = 1024 * 1024; // 1 MiB

const connections = new Map();
let connectionSeq = 0;

function releaseConnection(id) {
  if (connections.has(id)) {
    connections.delete(id);
    stats.connections.active--;
  }
}

function handleClientToBroker(ws, brokerWs, state, data) {
  state.buf = Buffer.concat([state.buf, Buffer.isBuffer(data) ? data : Buffer.from(data)]);
  if (state.buf.length > MAX_BUF) {
    // Reassembled packet exceeds the cap: drop the connection rather than
    // keep accumulating an unbounded buffer.
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close(1009, 'payload too large');
    }
    state.buf = Buffer.alloc(0);
    return;
  }
  const { packets, rest } = extractPackets(state.buf);
  state.buf = rest;
  for (const pkt of packets) {
    let forward = true;
    try {
      if (pkt.type === 1) {
        const { clientId } = parseConnect(pkt.raw);
        state.clientId = clientId;
      }
      if (pkt.type === 8) {
        const { topics } = parseSubscribe(pkt.raw);
        let allowed = true;
        for (const topic of topics) {
          stats.subscribes.total++;
          const res = policy.checkSubscribe(state.clientId || 'unknown', topic);
          if (!res.ok) {
            allowed = false;
            state.dropped[res.reason] = (state.dropped[res.reason] || 0) + 1;
            stats.subscribes.dropped[res.reason] = (stats.subscribes.dropped[res.reason] || 0) + 1;
            bump(stats.byClientId, state.clientId || 'unknown', { drops: 1 });
            break;
          }
        }
        if (!allowed) forward = false;
      }
      if (pkt.type === 3) {
        const { topic } = parsePublish(pkt.raw);
        const cid = state.clientId || 'unknown';
        stats.publishes.total++;
        bump(stats.byClientId, cid, { publishes: 1 });
        bump(stats.byIp, state.ip, { publishes: 1 });
        const res = policy.checkPublish(cid);
        if (!res.ok) {
          state.dropped[res.reason] = (state.dropped[res.reason] || 0) + 1;
          stats.publishes.dropped[res.reason] = (stats.publishes.dropped[res.reason] || 0) + 1;
          bump(stats.byClientId, cid, { drops: 1 });
          forward = false;
        }
      }
    } catch (err) {
      // Malformed packet: drop it (do not forward to the broker) instead of
      // crashing the whole gateway.
      forward = false;
    }
    if (forward && brokerWs.readyState === WebSocket.OPEN) {
      brokerWs.send(pkt.raw);
    }
  }
}

// Shared HTTP server: carries the WS upgrade plus loopback-only /stats.
const server = createServer((req, res) => {
  const url = (req.url || '').split('?')[0];
  const ip = req.socket.remoteAddress || '';
  if (!isLoopback(ip)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('forbidden');
    return;
  }
  if (req.method === 'GET' && url === '/stats') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(statsSnapshot()));
    return;
  }
  if (req.method === 'POST' && url === '/stats/reset') {
    resetStats();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('not found');
});

const wss = new WebSocketServer({ server, maxPayload: MAX_BUF });

wss.on('connection', (clientWs, req) => {
  const id = ++connectionSeq;
  const ip = clientIp(req);
  const state = {
    clientId: null,
    buf: Buffer.alloc(0),
    dropped: {},
    ip
  };
  connections.set(id, state);
  stats.connections.total++;
  stats.connections.active++;
  bump(stats.byIp, ip, { connections: 1 });

  const brokerWs = new WebSocket(BROKER_WS, ['mqtt']);
  const pending = [];

  clientWs.on('message', (data) => {
    if (brokerWs.readyState === WebSocket.OPEN) {
      handleClientToBroker(clientWs, brokerWs, state, data);
    } else {
      pending.push(data);
    }
  });

  brokerWs.on('open', () => {
    for (const data of pending.splice(0)) {
      handleClientToBroker(clientWs, brokerWs, state, data);
    }
  });

  brokerWs.on('message', (data) => {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(data);
    }
  });

  brokerWs.on('error', () => {
    clientWs.close(1011, 'broker error');
  });

  clientWs.on('close', () => {
    if (brokerWs.readyState === WebSocket.OPEN || brokerWs.readyState === WebSocket.CONNECTING) {
      brokerWs.close();
    }
    releaseConnection(id);
  });

  brokerWs.on('close', () => {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.close(1011, 'broker closed');
    }
    releaseConnection(id);
  });
});

const sweepTimer = setInterval(() => policy.sweep(Date.now()), 60000);
sweepTimer.unref();

server.listen(PORT, HOST, () => {
  console.log('[ncrypt-gateway] listening on ' + HOST + ':' + PORT + ' -> ' + BROKER_WS);
});

export { wss, server, policy, connections, stats, stopWatch };
