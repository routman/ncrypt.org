import { readFileSync, statSync } from 'node:fs';

export const LIMITS_DEFAULTS = {
  rateMs: 2000,
  burst: 5,
  perTopic: 100,
  globalRows: 50000,
  ttlDays: 30,
  blockedClients: [],
  blockedIps: []
};

export function deepMerge(base, extra) {
  const out = {};
  for (const key of Object.keys(base)) {
    const b = base[key];
    const e = extra ? extra[key] : undefined;
    if (
      b !== null && typeof b === 'object' && !Array.isArray(b) &&
      e !== undefined && e !== null && typeof e === 'object' && !Array.isArray(e)
    ) {
      out[key] = deepMerge(b, e);
    } else if (e !== undefined) {
      out[key] = e;
    } else {
      out[key] = b;
    }
  }
  return out;
}

export function loadLimitsConfig(file) {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return deepMerge(LIMITS_DEFAULTS, parsed);
    }
    console.warn('[ncrypt] limits config is not an object; using defaults (' + file + ')');
  } catch (error) {
    console.warn('[ncrypt] limits config unreadable (' + file + '); using defaults: ' + error.message);
  }
  return deepMerge(LIMITS_DEFAULTS, {});
}

export class Limits {
  constructor(cfg = {}) {
    this.cfg = deepMerge(LIMITS_DEFAULTS, cfg);
    this.byTopic = new Map();
  }

  setConfig(cfg) {
    this.cfg = deepMerge(LIMITS_DEFAULTS, cfg);
  }

  checkWrite(topicId, now = Date.now()) {
    const stamps = this.byTopic.get(topicId);
    if (stamps === undefined || stamps.length === 0) {
      return { ok: true };
    }
    const cutoff = now - this.cfg.rateMs;
    while (stamps.length > 0 && stamps[0] < cutoff) {
      stamps.shift();
    }
    if (stamps.length >= this.cfg.burst) {
      const retryAfterMs = Math.max(1000, stamps[0] + this.cfg.rateMs - now);
      return { ok: false, reason: 'topic-rate', retryAfterMs };
    }
    return { ok: true };
  }

  recordWrite(topicId, now = Date.now()) {
    let stamps = this.byTopic.get(topicId);
    if (stamps === undefined) {
      stamps = [];
      this.byTopic.set(topicId, stamps);
    }
    stamps.push(now);
  }

  sweep(now = Date.now()) {
    for (const [topicId, stamps] of this.byTopic) {
      if (stamps.length === 0 || now - stamps[stamps.length - 1] > this.cfg.rateMs) {
        this.byTopic.delete(topicId);
      }
    }
  }
}

export function watchLimitsFile(file, limits, { intervalMs = 5000, log = console.log } = {}) {
  let lastMtimeMs = -1;
  const tick = function () {
    try {
      const mtimeMs = statSync(file).mtimeMs;
      if (mtimeMs !== lastMtimeMs) {
        lastMtimeMs = mtimeMs;
        try {
          const parsed = JSON.parse(readFileSync(file, 'utf8'));
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            limits.setConfig(parsed);
            log('[ncrypt] limits reloaded from ' + file);
          } else {
            console.warn('[ncrypt] limits file is not an object; keeping current config (' + file + ')');
          }
        } catch (error) {
          console.warn('[ncrypt] limits reload failed, keeping current config: ' + error.message);
          lastMtimeMs = -1;
        }
      }
    } catch (error) {
      // File disappeared or transient IO error: keep the current config.
    }
  };
  tick();
  const timer = setInterval(tick, intervalMs);
  if (typeof timer.unref === 'function') {
    timer.unref();
  }
  return function stop() {
    clearInterval(timer);
  };
}

export function clientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  let raw = null;
  if (typeof xf === 'string' && xf.length > 0) {
    raw = xf;
  } else if (Array.isArray(xf) && xf.length > 0) {
    raw = xf.join(',');
  }
  if (raw !== null) {
    // Caddy (the only front proxy) appends the real client IP to the END of
    // the XFF chain, so the rightmost entry is the trusted client address.
    // Leftmost entries are client-controlled and must not be trusted, or a
    // client could spoof its way past the blockedIps list.
    const hops = raw.split(',');
    for (let i = hops.length - 1; i >= 0; i--) {
      const ip = hops[i].trim();
      if (ip.length > 0) {
        return ip;
      }
    }
  }
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}
