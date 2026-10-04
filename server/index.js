// HTTP server: tiny router, JSON API, static files, security headers.
const http = require('http');
const fs = require('fs');
const path = require('path');
const db = require('./db');
const auth = require('./auth');
const { HttpError } = require('./lib');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC = path.join(__dirname, '..', 'public');

// The marker file means a first start was stopped while the demo data was being created; that start is redone.
const SEEDING = `${db.DB_PATH}-seeding`;
if (!fs.existsSync(db.DB_PATH) || fs.existsSync(SEEDING)) {
  console.log('Creating the demo database (first start, a few seconds)...');
  fs.mkdirSync(path.dirname(SEEDING), { recursive: true });
  fs.writeFileSync(SEEDING, '');
  require('./seed').seed();
  fs.unlinkSync(SEEDING);
}
db.open();

const routes = [];
function route(method, pattern, handler, opts = {}) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  routes.push({ method, re, keys, handler, opts });
}
const api = { route, get: (p, h, o) => route('GET', p, h, o), post: (p, h, o) => route('POST', p, h, o), put: (p, h, o) => route('PUT', p, h, o), del: (p, h, o) => route('DELETE', p, h, o) };

for (const mod of ['public', 'auth', 'student', 'academic', 'admin', 'crud', 'io', 'reports', 'common', 'campus', 'sheets', 'campuslife', 'assistant']) require(`./routes/${mod}`)(api);

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.csv': 'text/csv; charset=utf-8', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };

function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'microphone=(self), camera=(self), geolocation=(self)');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; worker-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; frame-src https://www.google.com https://maps.google.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
}

function sendJson(res, status, body, headers = {}) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(data);
}

function readBody(req, limit = 6 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new HttpError(413, `The upload is too large (limit ${Math.round(limit / 1048576)} MB).`)); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { reject(new HttpError(400, 'The request body is not valid JSON.')); }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res, pathname) {
  let p = decodeURIComponent(pathname);
  if (p === '/' || !path.extname(p)) p = '/index.html';
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  securityHeaders(res);
  const url = new URL(req.url, 'http://localhost');
  if (!url.pathname.startsWith('/api/')) return serveStatic(req, res, url.pathname);
  const r = routes.find((x) => x.method === req.method && x.re.test(url.pathname));
  if (!r) return sendJson(res, 404, { error: 'This endpoint does not exist.' });
  const m = url.pathname.match(r.re);
  const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
  const ctx = { req, res, params, query: Object.fromEntries(url.searchParams), body: {}, user: null, session: null };
  try {
    const s = auth.sessionFromRequest(req);
    if (s) { ctx.user = s.user; ctx.session = s.session; }
    if (!r.opts.public && !ctx.user) throw new HttpError(401, 'Your session has expired. Please sign in again.');
    if (r.opts.roles && !r.opts.roles.includes(ctx.user.role)) throw new HttpError(403, 'You do not have permission to access this record.');
    if (req.method !== 'GET' && ctx.session && !r.opts.skipCsrf && req.headers['x-csrf-token'] !== ctx.session.csrf) throw new HttpError(403, 'Your session could not be verified. Refresh the page and try again.');
    if (req.method !== 'GET') ctx.body = await readBody(req, r.opts.limit);
    const out = await r.handler(ctx);
    if (out && out.__raw) return; // handler wrote the response itself
    sendJson(res, 200, out === undefined ? { ok: true } : out, ctx.headers || {});
  } catch (e) {
    if (e instanceof HttpError) return sendJson(res, e.status, { error: e.message, details: e.details });
    if (e && e.code === 'ERR_SQLITE_ERROR' && /UNIQUE/.test(e.message)) return sendJson(res, 409, { error: 'A record with these details already exists.' });
    if (e && e.code === 'ERR_SQLITE_ERROR' && /CHECK|FOREIGN KEY|NOT NULL/.test(e.message)) return sendJson(res, 400, { error: 'Some values are invalid or refer to records that do not exist.' });
    console.error(`[error] ${req.method} ${url.pathname}:`, e);
    sendJson(res, 500, { error: 'Something went wrong on our side. Please try again.' });
  }
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`\n  nerd is running at http://localhost:${PORT}\n`);
    console.log('  Sample accounts (password 123456) at KPR Institute of Engineering and Technology:');
    console.log('  student 25CSE101 · faculty CS014 · admin kpriet.admin · super admin superadmin\n');
  });
}
module.exports = { server, sendJson };
