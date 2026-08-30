export const GATEWAY_DEFAULTS = {
  rateMs: 2000,
  burst: 5,
  roomCap: 5,
  blockedClients: []
};

export function deepMergeGateway(base, extra) {
  const out = {};
  for (const key of Object.keys(base)) {
    const b = base[key];
    const e = extra ? extra[key] : undefined;
    if (
      b !== null && typeof b === 'object' && !Array.isArray(b) &&
      e !== undefined && e !== null && typeof e === 'object' && !Array.isArray(e)
    ) {
      out[key] = deepMergeGateway(b, e);
    } else if (e !== undefined) {
      out[key] = e;
    } else {
      out[key] = b;
    }
  }
  return out;
}

export class GatewayPolicy {
  constructor(cfg = {}) {
    this.cfg = deepMergeGateway(GATEWAY_DEFAULTS, cfg);
    this.byClient = new Map();
  }

  setConfig(cfg) {
    this.cfg = deepMergeGateway(GATEWAY_DEFAULTS, cfg);
  }

  _entry(clientId) {
    let entry = this.byClient.get(clientId);
    if (!entry) {
      entry = { stamps: [], topics: new Set() };
      this.byClient.set(clientId, entry);
    }
    return entry;
  }

  isBlocked(clientId) {
    return this.cfg.blockedClients.includes(clientId);
  }

  checkPublish(clientId, now = Date.now()) {
    if (this.isBlocked(clientId)) {
      return { ok: false, reason: 'blocked' };
    }
    const entry = this._entry(clientId);
    const cutoff = now - this.cfg.rateMs;
    while (entry.stamps.length > 0 && entry.stamps[0] < cutoff) {
      entry.stamps.shift();
    }
    if (entry.stamps.length >= this.cfg.burst) {
      return { ok: false, reason: 'rate' };
    }
    entry.stamps.push(now);
    return { ok: true };
  }

  checkSubscribe(clientId, topic, now = Date.now()) {
    if (this.isBlocked(clientId)) {
      return { ok: false, reason: 'blocked' };
    }
    const entry = this._entry(clientId);
    if (!entry.topics.has(topic)) {
      if (entry.topics.size >= this.cfg.roomCap) {
        return { ok: false, reason: 'room-cap' };
      }
      entry.topics.add(topic);
    }
    return { ok: true };
  }

  sweep(now = Date.now()) {
    for (const [id, entry] of this.byClient) {
      const active = entry.stamps.length > 0 && now - entry.stamps[entry.stamps.length - 1] <= this.cfg.rateMs;
      if (!active && entry.topics.size === 0) {
        this.byClient.delete(id);
      }
    }
  }
}
