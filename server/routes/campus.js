// Campus guide (KPR Compass) API: the published map dataset, event participation, visitor badge and ID check-in,
// and the poster / floor-plan / ID image store. Visitor endpoints are public; everything else needs
// the manage_campus_guide permission for that college.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('../db');
const scope = require('../scope');
const events = require('../engine/events');
const { HttpError, bad, forbidden, notFound, audit, EMAIL, toCsv, clientMeta } = require('../lib');
const Compass = require('../../public/js/compass/data.js');

const UPLOADS = path.join(path.dirname(db.DB_PATH), 'uploads');
const MAX_IMAGE = 10_000_000;
const ID_QUOTA_PER_HOUR = 60;
const idQuota = new Map(); // ip:hour -> count

function guideRow(collegeId) { return db.get('SELECT * FROM campus_guides WHERE college_id = ?', collegeId); }
function readGuide(collegeId) {
  const row = guideRow(collegeId);
  if (!row) throw notFound('This college has not published a campus guide.');
  const data = JSON.parse(row.payload);
  data.version = row.version;
  return data;
}
function college(id) {
  const c = db.get(`SELECT c.id, c.name, c.short_name, c.university_id, c.location, c.website, c.accent, u.name AS university_name
    FROM colleges c JOIN universities u ON u.id = c.university_id WHERE c.id = ? AND c.active = 1`, Number(id));
  if (!c) throw notFound('College not found.');
  return c;
}
function requireManager(ctx, collegeId) {
  if (!ctx.user) throw new HttpError(401, 'Sign in as a campus administrator.');
  if (!scope.can(ctx.user, 'manage_campus_guide') || !scope.canAccessCollege(ctx.user, collegeId)) throw forbidden('Only administrators of this college can manage its campus guide.');
}
// Anonymous visitor posts must come from this site (blocks cross-site form spam; logged-in calls also pass CSRF).
function sameOrigin(ctx) {
  const origin = ctx.req.headers.origin;
  if (origin && origin !== `http://${ctx.req.headers.host}` && origin !== `https://${ctx.req.headers.host}`) throw forbidden('Invalid origin.');
  if (!/application\/json/.test(ctx.req.headers['content-type'] || '')) throw bad('Send the form as JSON.');
}

function imageType(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}
// Accepts a data: URL, checks the real file signature and size, stores it privately on disk.
function storeImage(collegeId, kind, dataUrl) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) throw bad('Upload a JPEG, PNG or WebP image.');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length < 500 || buf.length > MAX_IMAGE) throw bad('Images must be under 10 MB.');
  const type = imageType(buf);
  if (!type || type !== m[1]) throw bad('The file is not a valid JPEG, PNG or WebP image.');
  const id = crypto.randomUUID();
  const dir = path.join(UPLOADS, String(collegeId));
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, id);
  fs.writeFileSync(file, buf);
  db.run('INSERT INTO campus_files (id, college_id, kind, mime, path) VALUES (?,?,?,?,?)', id, collegeId, kind, type, path.relative(UPLOADS, file));
  return id;
}
function removeFile(id) {
  const f = db.get('SELECT * FROM campus_files WHERE id = ?', id);
  if (!f) return;
  try { fs.unlinkSync(path.join(UPLOADS, f.path)); } catch { /* already gone */ }
  db.run('DELETE FROM campus_files WHERE id = ?', id);
}
const fileUrl = (id) => `/api/campus/files/${id}`;
const fileIdFromUrl = (url) => (/^\/api\/campus\/files\/([a-f0-9-]{36})$/.exec(url || '') || [])[1];
function referencedFiles(data) {
  return new Set([...data.events.map((e) => fileIdFromUrl(e.posterUrl)), ...Object.values(data.mapImages || {}).map(fileIdFromUrl)].filter(Boolean));
}

function validate(data) {
  if (!Compass.validCampus(data)) throw bad('Invalid map data. Check points, paths, venues and the required lists.');
  if (new Set(data.events.map((e) => e.id)).size !== data.events.length) throw bad('Event IDs must be unique.');
  if (data.events.some((e) => e.startsAt && e.endsAt && Date.parse(e.endsAt) <= Date.parse(e.startsAt))) throw bad('An event ends before it starts. Check the event times.');
  if (data.events.some((e) => !e.title.trim())) throw bad('Every event needs a name.');
  for (const v of Object.values(data.mapImages || {})) if (!/^\/assets\/compass\/[\w.-]+$/.test(v) && !fileIdFromUrl(v)) throw bad('Map images must be uploaded through the campus guide.');
}

function seedGuide(collegeId, name) {
  const data = JSON.parse(JSON.stringify(Compass.sample));
  delete data.version;
  db.run('INSERT INTO campus_guides (college_id, name, payload, version) VALUES (?,?,?,?)', collegeId, name, JSON.stringify(data), Compass.sample.version);
}

module.exports = (api) => {
  // ---------- visitor ----------
  api.get('/api/campus/:cid', ({ params }) => {
    const c = college(params.cid);
    const row = guideRow(c.id);
    if (!row) throw notFound('This college has not published a campus guide.');
    return { college: c, guideName: row.name, updatedAt: row.updated_at, data: readGuide(c.id) };
  }, { public: true });

  api.get('/api/campus/files/:id', (ctx) => {
    const f = db.get('SELECT * FROM campus_files WHERE id = ?', ctx.params.id);
    if (!f) throw notFound('File not found.');
    if (f.kind === 'id') requireManager(ctx, f.college_id);
    else if (f.kind === 'poster' && !referencedFiles(readGuide(f.college_id)).has(f.id)) requireManager(ctx, f.college_id); // unpublished posters stay private
    const buf = fs.readFileSync(path.join(UPLOADS, f.path));
    ctx.res.writeHead(200, { 'Content-Type': f.mime, 'Cache-Control': f.kind === 'id' ? 'no-store' : 'private, max-age=300', 'Content-Length': buf.length });
    ctx.res.end(buf);
    return { __raw: true };
  }, { public: true });

  api.post('/api/campus/:cid/participations', (ctx) => {
    sameOrigin(ctx);
    const c = college(ctx.params.cid);
    const b = ctx.body;
    const eventId = String(b.eventId || '').trim(), name = String(b.name || '').trim(), institution = String(b.institution || '').trim(), email = String(b.email || '').trim().toLowerCase();
    if (!eventId || !name || name.length > 100 || !institution || institution.length > 120 || !EMAIL.test(email) || email.length > 180 || b.consent !== true) throw bad('Complete your details and consent to registration.');
    const event = readGuide(c.id).events.find((e) => e.id === eventId);
    if (!event || !event.registrationOpen) throw new HttpError(409, 'Registration is not open for this event.');
    if (event.endsAt && Date.parse(event.endsAt) < Date.now()) throw new HttpError(409, 'This event has ended.');
    const existing = db.get('SELECT id FROM campus_participations WHERE college_id = ? AND event_id = ? AND email = ?', c.id, eventId, email);
    if (existing) return { id: existing.id, status: 'already_registered' };
    const id = crypto.randomUUID();
    db.run('INSERT INTO campus_participations (id, college_id, event_id, event_title, name, institution, email) VALUES (?,?,?,?,?,?,?)', id, c.id, event.id, event.title, name, institution, email);
    return { id, status: 'registered' };
  }, { public: true, limit: 8000 });

  api.post('/api/campus/:cid/id-checkins', (ctx) => {
    sameOrigin(ctx);
    const c = college(ctx.params.cid);
    const b = ctx.body;
    const name = String(b.name || '').trim(), institution = String(b.institution || '').trim(), eventName = String(b.eventName || '').trim();
    if (!name || name.length > 100 || institution.length > 100 || eventName.length > 100 || b.consent !== true) throw bad('Enter your name and confirm consent.');
    const key = `${c.id}:${clientMeta(ctx.req).ip || 'local'}:${new Date().toISOString().slice(0, 13)}`; // behind Cloudflare every visitor arrives from localhost
    const n = (idQuota.get(key) || 0) + 1;
    if (n > ID_QUOTA_PER_HOUR) throw new HttpError(429, 'Too many submissions from this connection. Ask the help desk for assistance.');
    idQuota.set(key, n);
    const ids = [];
    try {
      ids.push(storeImage(c.id, 'id', b.front));
      ids.push(storeImage(c.id, 'id', b.back));
    } catch (e) { ids.forEach(removeFile); throw e.status ? bad('Add both sides of the ID as JPEG, PNG or WebP images under 10 MB each.') : e; }
    const id = crypto.randomUUID();
    db.run('INSERT INTO campus_id_checkins (id, college_id, name, institution, event_name, front_file, back_file) VALUES (?,?,?,?,?,?,?)', id, c.id, name, institution, eventName, ids[0], ids[1]);
    return { id, status: 'received' };
  }, { public: true, limit: 28 * 1024 * 1024 });

  // ---------- administration ----------
  api.get('/api/campus/:cid/admin', (ctx) => {
    const c = college(ctx.params.cid); requireManager(ctx, c.id);
    const row = guideRow(c.id);
    return {
      college: c, enabled: !!row, guideName: row?.name || null, updatedAt: row?.updated_at || null,
      data: row ? readGuide(c.id) : null,
      counts: {
        participants: db.get('SELECT COUNT(*) n FROM campus_participations WHERE college_id = ?', c.id).n,
        visitors: db.get('SELECT COUNT(*) n FROM campus_visitors WHERE college_id = ?', c.id).n,
        idPending: db.get("SELECT COUNT(*) n FROM campus_id_checkins WHERE college_id = ? AND status = 'new'", c.id).n,
      },
    };
  });

  api.post('/api/campus/:cid/enable', (ctx) => {
    const c = college(ctx.params.cid); requireManager(ctx, c.id);
    if (guideRow(c.id)) throw new HttpError(409, 'The campus guide is already enabled.');
    // Colleges other than KPRIET start from the same structure; staff replace the points and paths with their own survey.
    seedGuide(c.id, `${c.short_name} Campus Guide`);
    audit(ctx, { action: 'create', entity: 'campus_guide', entityId: c.id, summary: `Enabled the campus guide for ${c.short_name}`, collegeId: c.id });
    return { ok: true };
  });

  api.put('/api/campus/:cid', (ctx) => {
    const c = college(ctx.params.cid); requireManager(ctx, c.id);
    const row = guideRow(c.id);
    if (!row) throw notFound('Enable the campus guide first.');
    const data = ctx.body?.data;
    validate(data);
    if (ctx.body.baseVersion && Number(ctx.body.baseVersion) !== row.version) throw new HttpError(409, `Someone published version ${row.version} while you were editing. Reload to get the latest data.`);
    const previous = readGuide(c.id);
    for (const id of referencedFiles(data)) if (!db.get('SELECT 1 FROM campus_files WHERE id = ? AND college_id = ?', id, c.id)) throw bad('An image does not belong to this campus guide.');
    const version = row.version + 1;
    const clean = { ...data }; delete clean.version;
    db.run("UPDATE campus_guides SET payload = ?, version = ?, updated_by = ?, updated_at = datetime('now') WHERE college_id = ?", JSON.stringify(clean), version, ctx.user.id, c.id);
    const keep = referencedFiles(clean);
    for (const id of referencedFiles(previous)) if (!keep.has(id)) removeFile(id);
    const summary = `Published campus guide version ${version}: ${clean.events.length} events, ${clean.nodes.length} map points, ${clean.edges.filter((e) => e.closed).length} closed paths`;
    audit(ctx, { action: 'update', entity: 'campus_guide', entityId: c.id, summary, previous: { version: row.version }, next: { version }, collegeId: c.id });
    // Tell students and staff about events this publish newly added, so the admin's action is visible across portals.
    const beforeIds = new Set((previous.events || []).map((e) => e.id));
    const newEvents = (clean.events || []).filter((e) => e.id && !beforeIds.has(e.id) && e.title && (!e.endsAt || Date.parse(e.endsAt) > Date.now()));
    events.onCampusEventsPublished({ collegeId: c.id, newEvents });
    return { ...clean, version };
  }, { limit: 4 * 1024 * 1024 });

  api.post('/api/campus/:cid/upload', (ctx) => {
    const c = college(ctx.params.cid); requireManager(ctx, c.id);
    const kind = ctx.body.kind === 'map' ? 'map' : 'poster';
    const id = storeImage(c.id, kind, ctx.body.image);
    return { url: fileUrl(id) };
  }, { limit: 14 * 1024 * 1024 });

  // Participants
  api.get('/api/campus/:cid/participations', (ctx) => {
    const c = college(ctx.params.cid); requireManager(ctx, c.id);
    const rows = db.all(`SELECT id, event_id AS eventId, event_title AS eventTitle, name, institution, email, status, created_at AS createdAt
      FROM campus_participations WHERE college_id = ? ORDER BY created_at DESC LIMIT 1000`, c.id);
    if (ctx.query.format === 'csv') {
      const csv = toCsv(['Event', 'Name', 'College / organisation', 'Email', 'Status', 'Registered at'], rows.filter((r) => !ctx.query.event || r.eventId === ctx.query.event).map((r) => ({ Event: r.eventTitle, Name: r.name, 'College / organisation': r.institution, Email: r.email, Status: r.status, 'Registered at': r.createdAt })));
      ctx.res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="event-participants.csv"', 'Cache-Control': 'no-store' });
      ctx.res.end('﻿' + csv);
      return { __raw: true };
    }
    return rows;
  });
  api.put('/api/campus/:cid/participations/:id', (ctx) => {
    const c = college(ctx.params.cid); requireManager(ctx, c.id);
    const b = ctx.body;
    const name = String(b.name || '').trim(), institution = String(b.institution || '').trim(), email = String(b.email || '').trim().toLowerCase(), status = String(b.status || '');
    if (!name || name.length > 100 || !institution || institution.length > 120 || !EMAIL.test(email) || !['registered', 'checked_in', 'cancelled'].includes(status)) throw bad('Check the participant details.');
    const r = db.run('UPDATE campus_participations SET name = ?, institution = ?, email = ?, status = ? WHERE id = ? AND college_id = ?', name, institution, email, status, ctx.params.id, c.id);
    if (!r.changes) throw notFound('Participant not found.');
    return { ok: true };
  });
  api.del('/api/campus/:cid/participations/:id', (ctx) => {
    const c = college(ctx.params.cid); requireManager(ctx, c.id);
    db.run('DELETE FROM campus_participations WHERE id = ? AND college_id = ?', ctx.params.id, c.id);
    return { ok: true };
  });

  // Badge desk
  api.get('/api/campus/:cid/visitors', (ctx) => {
    const c = college(ctx.params.cid); requireManager(ctx, c.id);
    return db.all('SELECT id, name, institution, badge_code AS badgeCode, event_name AS eventName, created_at AS createdAt FROM campus_visitors WHERE college_id = ? ORDER BY created_at DESC LIMIT 300', c.id);
  });
  api.post('/api/campus/:cid/visitors', (ctx) => {
    const c = college(ctx.params.cid); requireManager(ctx, c.id);
    const b = ctx.body;
    const name = String(b.name || '').trim(), institution = String(b.institution || '').trim(), badgeCode = String(b.badgeCode || '').trim(), eventName = String(b.eventName || '').trim();
    if (!name || !badgeCode || [name, institution, badgeCode, eventName].some((v) => v.length > 160)) throw bad('Name and badge code are required (160 characters maximum).');
    const id = crypto.randomUUID();
    db.run('INSERT INTO campus_visitors (id, college_id, name, institution, badge_code, event_name) VALUES (?,?,?,?,?,?)', id, c.id, name, institution, badgeCode, eventName);
    // A badge that matches a registration reference marks that participant as checked in.
    const ref = badgeCode.toLowerCase();
    if (/^[a-f0-9]{8}$/.test(ref)) db.run("UPDATE campus_participations SET status = 'checked_in' WHERE college_id = ? AND substr(id, 1, 8) = ? AND status = 'registered'", c.id, ref);
    return db.get('SELECT id, name, institution, badge_code AS badgeCode, event_name AS eventName, created_at AS createdAt FROM campus_visitors WHERE id = ?', id);
  });
  api.del('/api/campus/:cid/visitors/:id', (ctx) => {
    const c = college(ctx.params.cid); requireManager(ctx, c.id);
    db.run('DELETE FROM campus_visitors WHERE id = ? AND college_id = ?', ctx.params.id, c.id);
    return { ok: true };
  });

  // ID check-in review
  api.get('/api/campus/:cid/id-checkins', (ctx) => {
    const c = college(ctx.params.cid); requireManager(ctx, c.id);
    return db.all(`SELECT id, name, institution, event_name AS eventName, status, created_at AS createdAt, front_file AS front, back_file AS back
      FROM campus_id_checkins WHERE college_id = ? ORDER BY created_at DESC LIMIT 200`, c.id).map((r) => ({ ...r, front: fileUrl(r.front), back: fileUrl(r.back) }));
  });
  api.put('/api/campus/:cid/id-checkins/:id', (ctx) => {
    const c = college(ctx.params.cid); requireManager(ctx, c.id);
    if (!['new', 'reviewed'].includes(ctx.body.status)) throw bad('Invalid review status.');
    db.run('UPDATE campus_id_checkins SET status = ? WHERE id = ? AND college_id = ?', ctx.body.status, ctx.params.id, c.id);
    return { ok: true };
  });
  api.del('/api/campus/:cid/id-checkins/:id', (ctx) => {
    const c = college(ctx.params.cid); requireManager(ctx, c.id);
    const r = db.get('SELECT * FROM campus_id_checkins WHERE id = ? AND college_id = ?', ctx.params.id, c.id);
    if (!r) throw notFound('Submission not found.');
    removeFile(r.front_file); removeFile(r.back_file);
    db.run('DELETE FROM campus_id_checkins WHERE id = ?', r.id);
    audit(ctx, { action: 'delete', entity: 'campus_id_checkin', summary: `Deleted ID photos submitted by ${r.name}`, collegeId: c.id });
    return { ok: true };
  });
};
module.exports.seedGuide = seedGuide;
module.exports.UPLOADS = UPLOADS;
