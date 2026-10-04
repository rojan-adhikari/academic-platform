// Public, unauthenticated endpoints: platform info, university and college directory.
const db = require('../db');
const { notFound, bad, EMAIL } = require('../lib');

module.exports = (api) => {
  api.get('/api/public/platform', () => {
    const p = db.get('SELECT * FROM platform WHERE id = 1');
    const stats = {
      universities: db.get('SELECT COUNT(*) n FROM universities WHERE active = 1').n,
      colleges: db.get('SELECT COUNT(*) n FROM colleges WHERE active = 1').n,
      students: db.get('SELECT COUNT(*) n FROM students WHERE active = 1').n,
      staff: db.get('SELECT COUNT(*) n FROM staff WHERE active = 1').n,
    };
    return { name: p.name, demoMode: !!p.demo_mode, stats };
  }, { public: true });

  api.get('/api/public/universities', ({ query }) => {
    const q = `%${(query.q || '').trim().toLowerCase()}%`;
    const where = ['(lower(u.name) LIKE ? OR lower(u.code) LIKE ? OR lower(u.location) LIKE ? OR lower(u.short_name) LIKE ?)'];
    const params = [q, q, q, q];
    if (query.status === 'active') where.push('u.active = 1');
    if (query.status === 'inactive') where.push('u.active = 0');
    if (query.type) { where.push('u.type = ?'); params.push(query.type); }
    const rows = db.all(`SELECT u.id, u.code, u.name, u.short_name, u.location, u.affiliation, u.type, u.established, u.accent, u.logo, u.active,
      (SELECT COUNT(*) FROM colleges c WHERE c.university_id = u.id AND c.active = 1) AS colleges
      FROM universities u WHERE ${where.join(' AND ')} ORDER BY u.active DESC, u.id LIMIT 100`, ...params);
    const types = db.all('SELECT DISTINCT type FROM universities WHERE type IS NOT NULL ORDER BY type').map((r) => r.type);
    return { rows, types };
  }, { public: true });

  api.get('/api/public/universities/:id', ({ params, query }) => {
    const u = db.get('SELECT id, code, name, short_name, location, affiliation, type, established, accent, logo, active FROM universities WHERE id = ?', Number(params.id));
    if (!u) throw notFound('University not found.');
    const q = `%${(query.q || '').trim().toLowerCase()}%`;
    const colleges = db.all(`SELECT id, code, name, short_name, location, institution_code, category, established, accent, logo, active,
      EXISTS(SELECT 1 FROM campus_guides g WHERE g.college_id = colleges.id) AS campus_guide FROM colleges
      WHERE university_id = ? AND (lower(name) LIKE ? OR lower(code) LIKE ? OR lower(location) LIKE ? OR institution_code LIKE ?) ORDER BY active DESC, id`, u.id, q, q, q, q);
    for (const c of colleges) {
      c.programmes = db.all('SELECT code, name, degree_type FROM programmes WHERE college_id = ? AND active = 1 ORDER BY name', c.id);
      c.departments = db.all('SELECT code FROM departments WHERE college_id = ? AND active = 1 ORDER BY code', c.id).map((d) => d.code);
    }
    return { university: u, colleges };
  }, { public: true });

  // Support requests reach every platform super admin as an in-app notification.
  api.post('/api/public/support', ({ body, req }) => {
    if (!/application\/json/.test(req.headers['content-type'] || '')) throw bad('Send the form as JSON.');
    const name = String(body.name || '').trim(), email = String(body.email || '').trim(), inst = String(body.inst || '').trim(), msg = String(body.msg || '').trim();
    if (!name || name.length > 80 || !EMAIL.test(email) || inst.length > 120 || !msg || msg.length > 2000) throw bad('Fill in your name, a valid email and your message.');
    const ref = 'SR-' + Date.now().toString(36).toUpperCase();
    for (const u of db.all("SELECT id FROM users WHERE role = 'super_admin' AND active = 1")) {
      db.run("INSERT INTO notifications (college_id, user_id, type, severity, title, body, link) VALUES (NULL, ?, 'admin', 'info', ?, ?, NULL)", u.id, `Support request ${ref} from ${name}`, `${email}${inst ? ' · ' + inst : ''}: ${msg.slice(0, 500)}`);
    }
    return { ok: true, reference: ref };
  }, { public: true, limit: 8000 });

  // Institution finder used by the sign-in page: matches colleges and their universities in one search.
  api.get('/api/public/institutions', ({ query }) => {
    const q = `%${(query.q || '').trim().toLowerCase()}%`;
    return db.all(`SELECT c.id, c.name, c.short_name, c.code, c.location, c.accent, c.logo, u.name AS university, u.short_name AS university_short
      FROM colleges c JOIN universities u ON u.id = c.university_id
      WHERE c.active = 1 AND u.active = 1 AND (lower(c.name) LIKE ? OR lower(c.short_name) LIKE ? OR lower(c.code) LIKE ? OR lower(c.location) LIKE ? OR lower(u.name) LIKE ? OR lower(u.short_name) LIKE ?)
      ORDER BY c.id LIMIT 12`, q, q, q, q, q, q);
  }, { public: true });

  api.get('/api/public/colleges/:id', ({ params }) => {
    const c = db.get(`SELECT c.id, c.code, c.name, c.short_name, c.location, c.institution_code, c.category, c.established, c.website, c.accent, c.logo, c.active,
      u.id AS university_id, u.name AS university_name, u.short_name AS university_short, u.logo AS university_logo, u.active AS university_active
      FROM colleges c JOIN universities u ON u.id = c.university_id WHERE c.id = ?`, Number(params.id));
    if (!c) throw notFound('College not found.');
    c.campusGuide = !!db.get('SELECT 1 FROM campus_guides WHERE college_id = ?', c.id);
    return c;
  }, { public: true });
};
