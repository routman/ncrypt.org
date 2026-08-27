import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { LIMITS_DEFAULTS, deepMerge } from './limits.js';

export const ADMIN_ALLOW_CIDRS = [
  '127.0.0.0/8',
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '100.64.0.0/10'
];

function ip4ToInt(ip) {
  const parts = String(ip).split('.');
  if (parts.length !== 4) {
    return null;
  }
  let n = 0;
  for (const part of parts) {
    if (!/^\d+$/.test(part)) {
      return null;
    }
    const v = Number(part);
    if (v > 255) {
      return null;
    }
    n = n * 256 + v;
  }
  return n >>> 0;
}

export function isAllowedAdminIp(ip) {
  let s = String(ip || '').trim().toLowerCase();
  if (s.startsWith('::ffff:')) {
    s = s.slice(7);
  }
  if (s === '::1' || s === '::') {
    return true;
  }
  const n = ip4ToInt(s);
  if (n === null) {
    return false;
  }
  for (const entry of ADMIN_ALLOW_CIDRS) {
    const slash = entry.lastIndexOf('/');
    const base = ip4ToInt(entry.slice(0, slash));
    const prefix = Number(entry.slice(slash + 1));
    if (base === null || Number.isNaN(prefix)) {
      continue;
    }
    const mask = (prefix === 0 ? 0 : (0xFFFFFFFF << (32 - prefix))) >>> 0;
    if ((((n ^ base) >>> 0) & mask) === 0) {
      return true;
    }
  }
  return false;
}

export function adminSourceIp(req, trustProxy) {
  if (trustProxy) {
    const xf = req.headers['x-forwarded-for'];
    const raw = Array.isArray(xf) ? xf.join(',') : xf;
    if (typeof raw === 'string' && raw.length > 0) {
      const hops = raw.split(',');
      const last = hops[hops.length - 1].trim();
      if (last.length > 0) {
        return last;
      }
    }
  }
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

export function rewriteLimitsFile(file, patch) {
  let current = {};
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      current = parsed;
    }
  } catch (error) {
    // Missing/unreadable file: rewrite from defaults + patch.
  }
  const merged = deepMerge(deepMerge(LIMITS_DEFAULTS, current), patch || {});
  const tmp = file + '.tmp';
  writeFileSync(tmp, JSON.stringify(merged, null, 2) + '\n', 'utf8');
  renameSync(tmp, file);
  return merged;
}

export class SqliteAudit {
  constructor(db) {
    this.db = db;
    this.insert = db.prepare('INSERT INTO audit_log (at, action, detail) VALUES (?, ?, ?)');
    this.tailStmt = db.prepare('SELECT at, action, detail FROM audit_log ORDER BY id DESC LIMIT ?');
  }

  record(action, detail) {
    this.insert.run(new Date().toISOString(), action, detail == null ? null : String(detail));
  }

  tail(n = 100) {
    const count = Math.max(0, n | 0);
    return this.tailStmt.all(count).reverse();
  }
}
