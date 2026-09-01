import express from 'express';
import mqtt from 'mqtt';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { Limits, loadLimitsConfig, watchLimitsFile, clientIp } from './lib/limits.js';
import { isAllowedAdminIp, adminSourceIp, rewriteLimitsFile, SqliteAudit } from './lib/admin.js';

const HEX64 = /^[0-9a-f]{64}$/;
const STAMP_CAP = 10000;
// Cap on the stored ciphertext (base64 string). A legitimate message is a
// 500-char payload → well under 1 KB of base64, so 4 KB is generous. This
// stops an attacker from inflating the DB with arbitrarily large rows.
const MAX_CT_LEN = 4096;

export function createService(options = {}) {
  const dbPath = options.dbPath || ':memory:';
  const db = new DatabaseSync(dbPath);
  if (dbPath !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL;');
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      topic_id TEXT NOT NULL,
      ct TEXT NOT NULL,
      ts INTEGER NOT NULL,
      del_token TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_messages_topic ON messages (topic_id, id);
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at TEXT NOT NULL,
      action TEXT NOT NULL,
      detail TEXT
    );
  `);
  const msgCols = db.prepare('PRAGMA table_info(messages)').all().map((c) => c.name);
  if (!msgCols.includes('del_token')) {
    db.exec(`ALTER TABLE messages ADD COLUMN del_token TEXT NOT NULL DEFAULT ''`);
  }

  const limitsFile = options.limitsFile || null;
  const limits = new Limits(limitsFile ? loadLimitsConfig(limitsFile) : (options.limits || {}));
  const audit = new SqliteAudit(db);

  const insertMsg = db.prepare('INSERT INTO messages (topic_id, ct, ts, del_token) VALUES (?, ?, ?, ?)');
  const deleteByToken = db.prepare('DELETE FROM messages WHERE topic_id = ? AND del_token = ?');
  const countTopic = db.prepare('SELECT COUNT(*) AS n FROM messages WHERE topic_id = ?');
  const pruneTopic = db.prepare(`
    DELETE FROM messages WHERE id IN (
      SELECT id FROM messages WHERE topic_id = ? ORDER BY id ASC LIMIT ?
    )
  `);
  const historyStmt = db.prepare(`
    SELECT ct, ts FROM messages WHERE topic_id = ? ORDER BY id DESC LIMIT ?
  `);
  const purgeTopic = db.prepare('DELETE FROM messages WHERE topic_id = ?');
  const pruneTtl = db.prepare('DELETE FROM messages WHERE ts < ?');
  const countAll = db.prepare('SELECT COUNT(*) AS n FROM messages');
  const pruneGlobal = db.prepare(`
    DELETE FROM messages WHERE id IN (
      SELECT id FROM messages ORDER BY id ASC LIMIT ?
    )
  `);
  const countToday = db.prepare('SELECT COUNT(*) AS n FROM messages WHERE ts >= ?');
  const countDistinct = db.prepare('SELECT COUNT(DISTINCT topic_id) AS n FROM messages');

  const storedStamps = [];
  const dropStamps = [];
  let droppedTotal = 0;
  let brokerClients = 0;

  function pushBounded(arr, ts) {
    arr.push(ts);
    if (arr.length > STAMP_CAP) {
      arr.shift();
    }
  }

  function storeMessage(topicId, ct, ts = Date.now(), token = '') {
    if (typeof topicId !== 'string' || !HEX64.test(topicId)) {
      return { stored: false, reason: 'bad-id' };
    }
    if (typeof ct !== 'string' || ct.length === 0) {
      return { stored: false, reason: 'bad-ct' };
    }
    if (ct.length > MAX_CT_LEN) {
      return { stored: false, reason: 'ct-too-large' };
    }
    const check = limits.checkWrite(topicId, ts);
    if (!check.ok) {
      droppedTotal += 1;
      pushBounded(dropStamps, ts);
      return { stored: false, reason: 'rate' };
    }
    limits.recordWrite(topicId, ts);
    insertMsg.run(topicId, ct, ts, token);
    const { n } = countTopic.get(topicId);
    if (n > limits.cfg.perTopic) {
      pruneTopic.run(topicId, n - limits.cfg.perTopic);
    }
    pushBounded(storedStamps, ts);
    return { stored: true };
  }

  function sweepStorage(now = Date.now()) {
    const cfg = limits.cfg;
    pruneTtl.run(now - cfg.ttlDays * 86400000);
    const { n } = countAll.get();
    if (n > cfg.globalRows) {
      pruneGlobal.run(n - cfg.globalRows);
    }
    const cutoff = now - 60000;
    while (storedStamps.length > 0 && storedStamps[0] < cutoff) {
      storedStamps.shift();
    }
    while (dropStamps.length > 0 && dropStamps[0] < cutoff) {
      dropStamps.shift();
    }
    limits.sweep(now);
  }

  function startOfTodayUtcMs(now = Date.now()) {
    const d = new Date(now);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  }

  function stats() {
    const now = Date.now();
    const cutoff = now - 60000;
    let messages60s = 0;
    for (const t of storedStamps) {
      if (t >= cutoff) {
        messages60s += 1;
      }
    }
    let droppedRate = 0;
    for (const t of dropStamps) {
      if (t >= cutoff) {
        droppedRate += 1;
      }
    }
    return {
      messages60s,
      messagesToday: countToday.get(startOfTodayUtcMs(now)).n,
      activeTopics: countDistinct.get().n,
      connections: brokerClients,
      storageRows: countAll.get().n,
      droppedRate,
      droppedTotal
    };
  }

  const sweepTimer = setInterval(() => {
    sweepStorage();
  }, 60000);
  if (typeof sweepTimer.unref === 'function') {
    sweepTimer.unref();
  }

  let watcher = null;
  if (limitsFile) {
    watcher = watchLimitsFile(limitsFile, limits);
  }

  function persistLimits() {
    if (!limitsFile) {
      return null;
    }
    return rewriteLimitsFile(limitsFile, limits.cfg);
  }

  const app = express();
  app.use(express.json());

  app.use('/api', (req, res, next) => {
    const ip = clientIp(req);
    if (limits.cfg.blockedIps.includes(ip)) {
      return res.status(403).json({ error: 'blocked' });
    }
    const ipCheck = limits.checkIp(ip, Date.now());
    if (!ipCheck.ok) {
      return res.status(429).json({ error: 'rate', retryAfterMs: ipCheck.retryAfterMs });
    }
    limits.recordIp(ip, Date.now());
    next();
  });

  app.get('/api/history/:id', (req, res) => {
    const id = String(req.params.id || '');
    if (!HEX64.test(id)) {
      return res.status(400).json({ error: 'bad id' });
    }
    let limit = 100;
    if (req.query.limit !== undefined) {
      limit = Number(req.query.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        return res.status(400).json({ error: 'bad limit' });
      }
    }
    const rows = historyStmt.all(id, limit);
    rows.reverse();
    res.json({ messages: rows.map((r) => ({ ct: r.ct, ts: r.ts })) });
  });

  app.post('/api/delete/:id', (req, res) => {
    const id = String(req.params.id || '');
    if (!HEX64.test(id)) {
      return res.status(400).json({ error: 'bad id' });
    }
    const token = req.body && typeof req.body.token === 'string' ? req.body.token : '';
    if (!/^[0-9a-f]{1,64}$/.test(token)) {
      return res.status(400).json({ error: 'bad token' });
    }
    const now = Date.now();
    const check = limits.checkWrite(id, now);
    if (!check.ok) {
      return res.status(429).json({ error: 'rate', retryAfterMs: check.retryAfterMs });
    }
    limits.recordWrite(id, now);
    const info = deleteByToken.run(id, token);
    audit.record('delete', JSON.stringify({ id, deleted: info.changes, ip: clientIp(req) }));
    res.json({ deleted: info.changes });
  });

  const admin = express.Router();
  admin.use((req, res, next) => {
    const ip = adminSourceIp(req, options.trustProxy === true);
    if (!isAllowedAdminIp(ip)) {
      audit.record('admin-denied', JSON.stringify({ ip, path: req.path }));
      return res.status(403).json({ error: 'forbidden' });
    }
    next();
  });

  admin.post('/stats', (req, res) => {
    res.json(stats());
  });

  admin.post('/limits', (req, res) => {
    const cfg = limits.cfg;
    res.json({
      rateMs: cfg.rateMs,
      burst: cfg.burst,
      perTopic: cfg.perTopic,
      globalRows: cfg.globalRows,
      ttlDays: cfg.ttlDays,
      blockedIps: cfg.blockedIps
    });
  });

  admin.post('/set-limits', (req, res) => {
    const patch = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    if (limitsFile) {
      const merged = rewriteLimitsFile(limitsFile, patch);
      limits.setConfig(merged);
    } else {
      limits.setConfig(patch);
    }
    audit.record('set-limits', JSON.stringify(patch));
    res.json({ ok: true, file: limitsFile || false });
  });

  admin.post('/block', (req, res) => {
    const clientId = req.body && req.body.clientId;
    if (typeof clientId !== 'string' || clientId.length === 0 || clientId.length > 128) {
      return res.status(400).json({ error: 'bad clientId' });
    }
    if (!limits.cfg.blockedClients.includes(clientId)) {
      limits.cfg.blockedClients.push(clientId);
    }
    persistLimits();
    audit.record('block', JSON.stringify({ clientId }));
    res.json({ ok: true, blockedClients: limits.cfg.blockedClients.length });
  });

  admin.post('/unblock', (req, res) => {
    const clientId = req.body && req.body.clientId;
    if (typeof clientId !== 'string' || clientId.length === 0) {
      return res.status(400).json({ error: 'bad clientId' });
    }
    limits.cfg.blockedClients = limits.cfg.blockedClients.filter((c) => c !== clientId);
    persistLimits();
    audit.record('unblock', JSON.stringify({ clientId }));
    res.json({ ok: true, blockedClients: limits.cfg.blockedClients.length });
  });

  admin.post('/block-ip', (req, res) => {
    const ip = req.body && req.body.ip;
    if (typeof ip !== 'string' || ip.length === 0 || ip.length > 45) {
      return res.status(400).json({ error: 'bad ip' });
    }
    if (!limits.cfg.blockedIps.includes(ip)) {
      limits.cfg.blockedIps.push(ip);
    }
    persistLimits();
    audit.record('block-ip', JSON.stringify({ ip }));
    res.json({ ok: true, blockedIps: limits.cfg.blockedIps.length });
  });

  admin.post('/unblock-ip', (req, res) => {
    const ip = req.body && req.body.ip;
    if (typeof ip !== 'string' || ip.length === 0) {
      return res.status(400).json({ error: 'bad ip' });
    }
    limits.cfg.blockedIps = limits.cfg.blockedIps.filter((c) => c !== ip);
    persistLimits();
    audit.record('unblock-ip', JSON.stringify({ ip }));
    res.json({ ok: true, blockedIps: limits.cfg.blockedIps.length });
  });

  admin.post('/purge', (req, res) => {
    const id = req.body && req.body.id;
    if (typeof id !== 'string' || !HEX64.test(id)) {
      return res.status(400).json({ error: 'bad id' });
    }
    const info = purgeTopic.run(id);
    audit.record('purge', JSON.stringify({ id, deleted: info.changes }));
    res.json({ deleted: info.changes });
  });

  admin.post('/audit', (req, res) => {
    res.json({ entries: audit.tail(100) });
  });

  app.use('/api/admin', admin);

  let brokerClient = null;
  if (options.mqttUrl) {
    brokerClient = mqtt.connect(options.mqttUrl, {
      clientId: 'ncrypt-history-1',
      clean: false,
      reconnectPeriod: 5000,
      resubscribe: true
    });
    brokerClient.on('connect', () => {
      brokerClient.subscribe(['chat/#', '$SYS/broker/clients/connected'], { qos: 0 });
    });
    brokerClient.on('message', (topic, payload) => {
      if (topic === '$SYS/broker/clients/connected') {
        brokerClients = Number(payload.toString('utf8')) || 0;
        return;
      }
      const m = /^chat\/([0-9a-f]{64})$/.exec(topic);
      if (!m) {
        return;
      }
      const raw = payload.toString('utf8');
      const dot = raw.lastIndexOf('.');
      const ct = dot === -1 ? raw : raw.slice(0, dot);
      let token = '';
      if (dot !== -1) {
        const t = raw.slice(dot + 1);
        if (/^[0-9a-f]{1,64}$/.test(t)) {
          token = t;
        }
      }
      storeMessage(m[1], ct, Date.now(), token);
    });
  }

  function close() {
    clearInterval(sweepTimer);
    if (watcher) {
      watcher();
    }
    if (brokerClient) {
      brokerClient.end();
    }
    db.close();
  }

  return { app, storeMessage, close, limits, db, stats, sweep: (now) => sweepStorage(now) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const dbIdx = args.indexOf('--db');
  const dbPath = dbIdx !== -1 ? args[dbIdx + 1] : (process.env.DB_PATH || ':memory:');
  const port = Number(process.env.PORT || 3002);
  const host = process.env.HOST || '127.0.0.1';
  const mqttUrl = process.env.MQTT_URL !== undefined ? process.env.MQTT_URL : 'ws://127.0.0.1:9001';
  const limitsFile = process.env.LIMITS_FILE || null;
  const trustProxy = process.env.TRUST_PROXY === '1';
  const svc = createService({ dbPath, mqttUrl, limitsFile, trustProxy });
  const server = svc.app.listen(port, host, () => {
    console.log('[ncrypt] history service on ' + host + ':' + port + ' (db: ' + dbPath + ', mqtt: ' + mqttUrl + ')');
  });
  const shutdown = () => {
    server.close();
    svc.close();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
