// Authentication: scrypt password hashes, opaque session tokens (stored hashed),
// HttpOnly cookies, per-session CSRF token, login throttling, demo OTP.
const crypto = require('crypto');
const db = require('./db');

const COOKIE = 'aip_session';
const SESSION_HOURS = 12;
const REMEMBER_DAYS = 30;

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 32, { N: 16384 });
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

// Fast deterministic hash used only for seeding thousands of demo users.
function hashPasswordFast(password, saltHex) {
  const salt = Buffer.from(saltHex, 'hex');
  const hash = crypto.scryptSync(password, salt, 32, { N: 1024 });
  return `scrypt1k$${saltHex}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [alg, saltHex, hashHex] = String(stored).split('$');
  if (!saltHex || !hashHex) return false;
  const N = alg === 'scrypt1k' ? 1024 : 16384;
  const hash = crypto.scryptSync(String(password), Buffer.from(saltHex, 'hex'), 32, { N });
  const expected = Buffer.from(hashHex, 'hex');
  return expected.length === hash.length && crypto.timingSafeEqual(hash, expected);
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function createSession(userId, remember) {
  const token = crypto.randomBytes(32).toString('base64url');
  const csrf = crypto.randomBytes(18).toString('base64url');
  const ms = remember ? REMEMBER_DAYS * 864e5 : SESSION_HOURS * 36e5;
  db.run('INSERT INTO sessions (token_hash, user_id, csrf, expires_at, remember) VALUES (?,?,?,?,?)',
    sha256(token), userId, csrf, Date.now() + ms, remember ? 1 : 0);
  db.run("UPDATE users SET last_login_at = datetime('now') WHERE id = ?", userId);
  // Remembered sessions get a persistent cookie (survives browser restarts); others get a
  // session cookie that the browser drops on close. The DB expiry still bounds both.
  return { token, csrf, maxAge: remember ? Math.floor(ms / 1000) : null };
}

function parseCookies(header) {
  const out = {};
  String(header || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

function sessionFromRequest(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (!token) return null;
  const s = db.get('SELECT * FROM sessions WHERE token_hash = ?', sha256(token));
  if (!s) return null;
  if (s.expires_at < Date.now()) { db.run('DELETE FROM sessions WHERE token_hash = ?', s.token_hash); return null; }
  const user = db.get('SELECT * FROM users WHERE id = ? AND active = 1', s.user_id);
  if (!user) return null;
  return { session: s, user };
}

function destroySession(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) db.run('DELETE FROM sessions WHERE token_hash = ?', sha256(token));
}

function cookieHeader(token, maxAge, secure) {
  // maxAge null => a session cookie (no Max-Age attribute).
  const age = (maxAge === null || maxAge === undefined) ? '' : `; Max-Age=${maxAge}`;
  return `${COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax${age}${secure ? '; Secure' : ''}`;
}
function clearCookieHeader() { return `${COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`; }

// Simple in-memory throttle: 8 failed attempts per key per 10 minutes.
const failures = new Map();
function throttled(key) {
  const f = failures.get(key);
  if (!f) return false;
  if (Date.now() - f.first > 10 * 60e3) { failures.delete(key); return false; }
  return f.count >= 8;
}
function recordFailure(key) {
  const f = failures.get(key);
  if (!f || Date.now() - f.first > 10 * 60e3) failures.set(key, { count: 1, first: Date.now() });
  else f.count++;
}
function clearFailures(key) { failures.delete(key); }

function createOtp(userId, purpose) {
  const code = String(crypto.randomInt(100000, 1000000));
  db.run('UPDATE otp_codes SET used = 1 WHERE user_id = ? AND purpose = ?', userId, purpose);
  db.run('INSERT INTO otp_codes (user_id, code_hash, purpose, expires_at) VALUES (?,?,?,?)',
    userId, sha256(code), purpose, Date.now() + 10 * 60e3);
  return code;
}
function consumeOtp(userId, purpose, code) {
  const row = db.get('SELECT * FROM otp_codes WHERE user_id = ? AND purpose = ? AND used = 0 AND expires_at > ? ORDER BY id DESC LIMIT 1',
    userId, purpose, Date.now());
  if (!row || row.code_hash !== sha256(String(code || '').trim())) return false;
  db.run('UPDATE otp_codes SET used = 1 WHERE id = ?', row.id);
  return true;
}

module.exports = {
  hashPassword, hashPasswordFast, verifyPassword, createSession, sessionFromRequest, destroySession,
  cookieHeader, clearCookieHeader, throttled, recordFailure, clearFailures, createOtp, consumeOtp,
};
