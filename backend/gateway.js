import { WebSocketServer, WebSocket } from 'ws';
import { loadLimitsConfig, watchLimitsFile } from './lib/limits.js';
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

const connections = new Map();
let connectionSeq = 0;

function handleClientToBroker(ws, brokerWs, state, data) {
  state.buf = Buffer.concat([state.buf, Buffer.isBuffer(data) ? data : Buffer.from(data)]);
  const { packets, rest } = extractPackets(state.buf);
  state.buf = rest;
  for (const pkt of packets) {
    if (pkt.type === 1) {
      const { clientId } = parseConnect(pkt.raw);
      state.clientId = clientId;
    }
    if (pkt.type === 8) {
      const { topics } = parseSubscribe(pkt.raw);
      let allowed = true;
      for (const topic of topics) {
        const res = policy.checkSubscribe(state.clientId || 'unknown', topic);
        if (!res.ok) {
          allowed = false;
          state.dropped[res.reason] = (state.dropped[res.reason] || 0) + 1;
          break;
        }
      }
      if (!allowed) continue;
    }
    if (pkt.type === 3) {
      const { topic } = parsePublish(pkt.raw);
      const res = policy.checkPublish(state.clientId || 'unknown');
      if (!res.ok) {
        state.dropped[res.reason] = (state.dropped[res.reason] || 0) + 1;
        continue;
      }
    }
    if (brokerWs.readyState === WebSocket.OPEN) {
      brokerWs.send(pkt.raw);
    }
  }
}

const wss = new WebSocketServer({ host: HOST, port: PORT });

wss.on('connection', (clientWs) => {
  const id = ++connectionSeq;
  const state = {
    clientId: null,
    buf: Buffer.alloc(0),
    dropped: {}
  };
  connections.set(id, state);

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
    connections.delete(id);
  });

  brokerWs.on('close', () => {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.close(1011, 'broker closed');
    }
    connections.delete(id);
  });
});

const sweepTimer = setInterval(() => policy.sweep(Date.now()), 60000);
sweepTimer.unref();

console.log('[ncrypt-gateway] listening on ' + HOST + ':' + PORT + ' -> ' + BROKER_WS);

export { wss, policy, connections, stopWatch };
