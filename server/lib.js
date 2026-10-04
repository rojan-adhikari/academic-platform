// Shared helpers: errors, validation, audit logging, pagination, CSV.
const db = require('./db');

class HttpError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}
const bad = (msg, details) => new HttpError(400, msg, details);
const forbidden = (msg = 'You do not have permission to access this record.') => new HttpError(403, msg);
const notFound = (msg = 'The requested record was not found.') => new HttpError(404, msg);

function toInt(v, name, { min = -Infinity, max = Infinity, optional = false } = {}) {
  if (v === undefined || v === null || v === '') { if (optional) return null; throw bad(`${name} is required`); }
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`${name} must be a whole number${Number.isFinite(min) ? ` between ${min} and ${max}` : ''}`);
  return n;
}
function toNum(v, name, { min = -Infinity, max = Infinity, optional = false } = {}) {
  if (v === undefined || v === null || v === '') { if (optional) return null; throw bad(`${name} is required`); }
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw bad(`${name} must be a number between ${min} and ${max}`);
  return n;
}
function toStr(v, name, { max = 200, min = 1, optional = false, pattern = null, patternMsg = null } = {}) {
  if (v === undefined || v === null || String(v).trim() === '') { if (optional) return null; throw bad(`${name} is required`); }
  const s = String(v).trim();
  if (s.length < min || s.length > max) throw bad(`${name} must be ${min}-${max} characters`);
  if (pattern && !pattern.test(s)) throw bad(patternMsg || `${name} has an invalid format`);
  return s;
}
function toDate(v, name, { optional = false } = {}) {
  if (!v) { if (optional) return null; throw bad(`${name} is required`); }
  const s = String(v).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s + 'T00:00:00Z'))) throw bad(`${name} must be a date (YYYY-MM-DD)`);
  return s;
}
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clientMeta(req) {
  // Through a tunnel on this machine (cloudflared) the visitor's address is in the headers Cloudflare sets.
  // A direct connection could fake those headers, so its own address is used instead.
  const remote = req.socket.remoteAddress || '';
  const viaLocalProxy = /^(::1|127\.|::ffff:127\.)/.test(remote);
  const forwarded = String(req.headers['cf-connecting-ip'] || String(req.headers['x-forwarded-for'] || '').split(',').pop() || '').trim();
  const ip = (viaLocalProxy && forwarded) || remote;
  return { ip, ua: String(req.headers['user-agent'] || '').slice(0, 200) };
}

function audit(ctx, { action, entity, entityId = null, summary, previous = null, next = null, collegeId = null, universityId = null }) {
  const u = ctx.user;
  const meta = clientMeta(ctx.req);
  let cId = collegeId ?? u?.college_id ?? null;
  let uId = universityId ?? u?.university_id ?? null;
  if (cId && !uId) { const c = db.get('SELECT university_id FROM colleges WHERE id = ?', cId); uId = c?.university_id ?? null; }
  db.run(`INSERT INTO audit_logs (university_id, college_id, user_id, user_name, role, action, entity, entity_id, summary, previous_value, new_value, ip, user_agent)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, uId, cId, u?.id ?? null, u?.name ?? 'system', u?.role ?? 'system', action, entity, entityId, summary,
  previous === null ? null : JSON.stringify(previous), next === null ? null : JSON.stringify(next), meta.ip, meta.ua);
}

function diff(prev, next) {
  const p = {}, n = {};
  for (const k of Object.keys(next)) if (String(prev?.[k] ?? '') !== String(next[k] ?? '')) { p[k] = prev?.[k] ?? null; n[k] = next[k]; }
  return { prev: p, next: n, changed: Object.keys(n).length > 0 };
}

function pageParams(query, maxSize = 100) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const pageSize = Math.min(maxSize, Math.max(1, parseInt(query.pageSize, 10) || 25));
  return { page, pageSize, offset: (page - 1) * pageSize };
}
function paged(countSql, listSql, params, query, maxSize) {
  const { page, pageSize, offset } = pageParams(query, maxSize);
  const total = db.get(countSql, ...params).n;
  const rows = db.all(`${listSql} LIMIT ? OFFSET ?`, ...params, pageSize, offset);
  return { rows, total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)) };
}

// RFC-4180 style CSV
function parseCsv(text) {
  const rows = []; let row = []; let field = ''; let q = false;
  const s = String(text || '').replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && s[i + 1] === '\n') i++; row.push(field); rows.push(row); row = []; field = ''; }
    else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const clean = rows.filter((r) => r.some((c) => c.trim() !== ''));
  if (!clean.length) return { headers: [], records: [] };
  const headers = clean[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
  return { headers, records: clean.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? '').trim()]))) };
}
function toCsv(headers, rows) {
  const esc = (v) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? `"${(/^[=+\-@]/.test(s) ? "'" : '') + s.replace(/"/g, '""')}"` : s; };
  return [headers.map((h) => esc(h.label || h)).join(','), ...rows.map((r) => headers.map((h) => esc(r[h.key || h])).join(','))].join('\r\n');
}

// Official institution logos live in public/assets/logos/<code>.<ext>. Returns the served URL if a
// matching file exists, else null (the UI then shows the generated crest).
const LOGO_DIR = require('path').join(__dirname, '..', 'public', 'assets', 'logos');
const LOGO_EXTS = ['svg', 'png', 'webp', 'jpg', 'jpeg'];
function logoFor(code) {
  if (!code) return null;
  const base = String(code).toLowerCase().replace(/[^a-z0-9_-]/g, '');
  for (const ext of LOGO_EXTS) {
    try { require('fs').accessSync(require('path').join(LOGO_DIR, `${base}.${ext}`)); return `/assets/logos/${base}.${ext}`; } catch { /* keep looking */ }
  }
  return null;
}

module.exports = { HttpError, bad, forbidden, notFound, toInt, toNum, toStr, toDate, EMAIL, audit, diff, pageParams, paged, parseCsv, toCsv, clientMeta, logoFor, LOGO_DIR, LOGO_EXTS };
