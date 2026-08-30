const POLL_MS = 5000;
const POS_INT_RE = /^[1-9][0-9]*$/;
const HEX64_RE = /^[0-9a-f]{64}$/;

let els = {};
let stopped = false;
let statsInFlight = false;
let auditInFlight = false;

function showError(text) {
  els.error.textContent = text;
}

function clearError() {
  els.error.textContent = '';
}

function stop() {
  stopped = true;
  showError('admin api http 403 (this host is not on an allowed network)');
}

// The admin page is served from two places:
//   - ncrypt.org/admin        -> API at /api/admin/
//   - <tailscale>/ncrypt-admin -> API at /ncrypt-admin/api/admin/
// Detect which deployment we're on from the page's own URL and use the
// matching API base, so the same static page works in both.
function apiBase() {
  return location.pathname.indexOf('/ncrypt-admin') === 0
    ? '/ncrypt-admin/api/admin/'
    : '/api/admin/';
}

async function adminPost(path, body) {
  if (stopped) {
    return { ok: false, status: 403, data: null };
  }
  let res;
  try {
    res = await fetch(apiBase() + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
  } catch (err) {
    return { ok: false, status: 0, data: null };
  }
  let data = null;
  try {
    data = await res.json();
  } catch (err) {
    data = null;
  }
  if (res.status === 403) {
    stop();
    return { ok: false, status: 403, data: data };
  }
  return { ok: res.ok, status: res.status, data: data };
}

function showHttpError(status) {
  showError(status === 0 ? 'network error' : 'http ' + status);
}

async function refreshStats() {
  if (statsInFlight || stopped) {
    return;
  }
  statsInFlight = true;
  const r = await adminPost('stats');
  statsInFlight = false;
  if (!r.ok) {
    if (r.status !== 403) {
      showHttpError(r.status);
    }
    return;
  }
  clearError();
  const s = r.data;
  els.messages60s.textContent = String(s.messages60s);
  els.messagesToday.textContent = String(s.messagesToday);
  els.topics.textContent = String(s.activeTopics);
  els.connections.textContent = String(s.connections);
  els.storage.textContent = String(s.storageRows);
  els.dropped.textContent = String(s.droppedTotal);
}

async function prefillLimits() {
  const r = await adminPost('limits');
  if (!r.ok || r.data === null) {
    return;
  }
  const cfg = r.data;
  els.limitRate.value = cfg.rateMs !== undefined ? String(cfg.rateMs) : '';
  els.limitBurst.value = cfg.burst !== undefined ? String(cfg.burst) : '';
  els.limitTopic.value = cfg.perTopic !== undefined ? String(cfg.perTopic) : '';
  els.limitRows.value = cfg.globalRows !== undefined ? String(cfg.globalRows) : '';
  els.limitTtl.value = cfg.ttlDays !== undefined ? String(cfg.ttlDays) : '';
  if (Array.isArray(cfg.blockedIps)) {
    els.blockedIpsCount.textContent = String(cfg.blockedIps.length);
  }
}

async function applyLimits() {
  const fields = [
    [els.limitRate, 'rateMs'],
    [els.limitBurst, 'burst'],
    [els.limitTopic, 'perTopic'],
    [els.limitRows, 'globalRows'],
    [els.limitTtl, 'ttlDays']
  ];
  const patch = {};
  let any = false;
  for (let i = 0; i < fields.length; i++) {
    const text = fields[i][0].value.trim();
    if (text === '') {
      continue;
    }
    if (!POS_INT_RE.test(text)) {
      showError('limit values must be positive integers');
      return;
    }
    patch[fields[i][1]] = Number(text);
    any = true;
  }
  if (!any) {
    showError('no changes to apply');
    return;
  }
  const r = await adminPost('set-limits', patch);
  if (!r.ok) {
    showHttpError(r.status);
    return;
  }
  clearError();
  els.limitsResult.textContent = 'applied ' + Object.keys(patch).join(', ');
  prefillLimits();
  refreshStats();
}

async function blockOrUnblock(unblock) {
  const clientId = els.blockClient.value.trim();
  if (clientId === '' || clientId.length > 128) {
    showError('client id required (max 128 chars)');
    return;
  }
  const r = await adminPost(unblock ? 'unblock' : 'block', { clientId: clientId });
  if (!r.ok) {
    showHttpError(r.status);
    return;
  }
  clearError();
  if (r.data && r.data.blockedClients !== undefined) {
    els.blockedCount.textContent = String(r.data.blockedClients);
  }
  els.blockResult.textContent = (unblock ? 'unblocked ' : 'blocked ') + clientId;
}

async function blockIpOrUnblockIp(unblock) {
  const ip = els.blockIp.value.trim();
  if (ip === '' || ip.length > 45) {
    showError('ip address required (max 45 chars)');
    return;
  }
  const r = await adminPost(unblock ? 'unblock-ip' : 'block-ip', { ip: ip });
  if (!r.ok) {
    showHttpError(r.status);
    return;
  }
  clearError();
  if (r.data && r.data.blockedIps !== undefined) {
    els.blockedIpsCount.textContent = String(r.data.blockedIps);
  }
  els.blockIpResult.textContent = (unblock ? 'unblocked ' : 'blocked ') + ip;
}

// The room id is SHA-256("ncrypt-chat:" + topic), derived in the browser
// (same as src/crypto.js roomTopic). The server only ever sees the hash.
async function roomTopicId(topic) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode('ncrypt-chat:' + topic)
  );
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function purgeTopic() {
  const input = els.purgeInput.value.trim();
  if (input === '') {
    showError('enter a topic name or 64-hex room id');
    return;
  }
  let id;
  if (HEX64_RE.test(input.toLowerCase())) {
    id = input.toLowerCase();
  } else {
    try {
      id = await roomTopicId(input);
    } catch (err) {
      showError('could not hash topic (paste the 64-hex room id instead)');
      return;
    }
  }
  const r = await adminPost('purge', { id: id });
  if (!r.ok) {
    showHttpError(r.status);
    return;
  }
  clearError();
  const deleted = r.data && r.data.deleted !== undefined ? r.data.deleted : 0;
  els.purgeResult.textContent = 'deleted ' + deleted + ' message' + (deleted === 1 ? '' : 's');
  refreshStats();
}

function renderAudit(entries) {
  els.audit.textContent = '';
  if (entries.length === 0) {
    const row = document.createElement('div');
    row.className = 'auditrow';
    row.textContent = 'no entries';
    els.audit.appendChild(row);
    return;
  }
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const parts = [
      e.at === undefined || e.at === null ? '' : String(e.at),
      e.action === undefined || e.action === null ? '' : String(e.action)
    ];
    if (e.detail !== undefined && e.detail !== null) {
      parts.push(String(e.detail));
    }
    const row = document.createElement('div');
    row.className = 'auditrow';
    row.textContent = parts.join('  ');
    els.audit.appendChild(row);
  }
}

async function refreshAudit() {
  if (auditInFlight || stopped) {
    return;
  }
  auditInFlight = true;
  const r = await adminPost('audit');
  auditInFlight = false;
  if (!r.ok || !r.data || !Array.isArray(r.data.entries)) {
    return;
  }
  renderAudit(r.data.entries);
}

function init() {
  els.error = document.getElementById('admin-error');
  els.messages60s = document.getElementById('admin-messages60s');
  els.messagesToday = document.getElementById('admin-messages-today');
  els.topics = document.getElementById('admin-topics');
  els.connections = document.getElementById('admin-connections');
  els.storage = document.getElementById('admin-storage');
  els.dropped = document.getElementById('admin-dropped');
  els.limitRate = document.getElementById('admin-limit-rate');
  els.limitBurst = document.getElementById('admin-limit-burst');
  els.limitTopic = document.getElementById('admin-limit-topic');
  els.limitRows = document.getElementById('admin-limit-rows');
  els.limitTtl = document.getElementById('admin-limit-ttl');
  els.limitsResult = document.getElementById('admin-limits-result');
  els.blockClient = document.getElementById('admin-block-client');
  els.blockedCount = document.getElementById('admin-blocked-count');
  els.blockResult = document.getElementById('admin-block-result');
  els.blockIp = document.getElementById('admin-block-ip');
  els.blockedIpsCount = document.getElementById('admin-blocked-ips-count');
  els.blockIpResult = document.getElementById('admin-block-ip-result');
  els.purgeInput = document.getElementById('admin-purge-input');
  els.purgeResult = document.getElementById('admin-purge-result');
  els.audit = document.getElementById('admin-audit');

  document.getElementById('admin-stats-btn').addEventListener('click', function() {
    refreshStats();
  });
  document.getElementById('admin-limits-btn').addEventListener('click', function() {
    applyLimits();
  });
  document.getElementById('admin-block-btn').addEventListener('click', function() {
    blockOrUnblock(false);
  });
  document.getElementById('admin-unblock-btn').addEventListener('click', function() {
    blockOrUnblock(true);
  });
  document.getElementById('admin-block-ip-btn').addEventListener('click', function() {
    blockIpOrUnblockIp(false);
  });
  document.getElementById('admin-unblock-ip-btn').addEventListener('click', function() {
    blockIpOrUnblockIp(true);
  });
  document.getElementById('admin-purge-btn').addEventListener('click', function() {
    purgeTopic();
  });
  document.getElementById('admin-audit-btn').addEventListener('click', function() {
    refreshAudit();
  });

  prefillLimits();
  refreshStats();
  refreshAudit();
  setInterval(function() {
    if (document.visibilityState === 'visible') {
      refreshStats();
    }
  }, POLL_MS);
  document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'visible') {
      refreshStats();
    }
  });
}

init();
