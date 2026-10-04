// Notification centre, live event stream and role-aware global search.
const db = require('../db');
const scope = require('../scope');
const events = require('../engine/events');
const { paged, toInt, bad } = require('../lib');

module.exports = (api) => {
  // status=new -> unread inbox; status=read -> read archive (filtered by category/type).
  api.get('/api/notifications', (ctx) => {
    const where = ['n.user_id = ?']; const params = [ctx.user.id];
    if (ctx.query.type) { where.push('n.type = ?'); params.push(ctx.query.type); }
    if (ctx.query.unread === '1' || ctx.query.status === 'new') where.push('n.is_read = 0');
    else if (ctx.query.status === 'read') where.push('n.is_read = 1');
    if (ctx.query.q) { where.push('(lower(n.title) LIKE ? OR lower(n.body) LIKE ?)'); params.push(`%${ctx.query.q.toLowerCase()}%`, `%${ctx.query.q.toLowerCase()}%`); }
    const from = `FROM notifications n WHERE ${where.join(' AND ')}`;
    const res = paged(`SELECT COUNT(*) n ${from}`, `SELECT n.* ${from} ORDER BY n.created_at DESC, n.id DESC`, params, ctx.query);
    res.unread = db.get('SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND is_read = 0', ctx.user.id).n;
    res.counts = db.all('SELECT type, SUM(is_read = 0) AS unread, SUM(is_read = 1) AS read FROM notifications WHERE user_id = ? GROUP BY type', ctx.user.id);
    return res;
  });
  api.post('/api/notifications/:id/read', (ctx) => {
    db.run('UPDATE notifications SET is_read = ? WHERE id = ? AND user_id = ?', ctx.body.unread ? 0 : 1, toInt(ctx.params.id, 'Notification', { min: 1 }), ctx.user.id);
    return { ok: true };
  });
  api.post('/api/notifications/read-all', (ctx) => { db.run('UPDATE notifications SET is_read = 1 WHERE user_id = ?', ctx.user.id); return { ok: true }; });
  api.del('/api/notifications/:id', (ctx) => {
    const r = db.run('DELETE FROM notifications WHERE id = ? AND user_id = ?', toInt(ctx.params.id, 'Notification', { min: 1 }), ctx.user.id);
    return { ok: true, deleted: Number(r.changes) };
  });
  // Bulk delete: explicit ids, or every read notification (optionally one category).
  api.post('/api/notifications/delete', (ctx) => {
    const b = ctx.body || {};
    let r;
    if (Array.isArray(b.ids)) {
      const ids = b.ids.slice(0, 500).map((x) => toInt(x, 'Notification', { min: 1 }));
      if (!ids.length) return { ok: true, deleted: 0 };
      r = db.run(`DELETE FROM notifications WHERE user_id = ? AND id IN (${ids.map(() => '?').join(',')})`, ctx.user.id, ...ids);
    } else if (b.allRead) {
      r = b.type ? db.run('DELETE FROM notifications WHERE user_id = ? AND is_read = 1 AND type = ?', ctx.user.id, String(b.type))
        : db.run('DELETE FROM notifications WHERE user_id = ? AND is_read = 1', ctx.user.id);
    } else throw bad('Choose notifications to delete.');
    return { ok: true, deleted: Number(r.changes) };
  });

  // Server-Sent Events: near-real-time notification and dashboard refresh.
  api.get('/api/events', (ctx) => {
    const { res, req } = ctx;
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write(`event: hello\ndata: {"ok":true}\n\n`);
    const off = events.subscribe(ctx.user.id, res);
    const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* closed */ } }, 25000);
    req.on('close', () => { clearInterval(ping); off(); });
    return { __raw: true };
  });

  api.get('/api/search', (ctx) => {
    const q = String(ctx.query.q || '').trim().toLowerCase();
    if (q.length < 2) return { groups: [] };
    const like = `%${q}%`;
    const u = ctx.user;
    const groups = [];
    const add = (label, items) => { if (items.length) groups.push({ label, items }); };
    if (u.role === 'student') {
      const s = scope.studentRow(u);
      add('My courses', db.all(`SELECT c.code || ' ' || c.name AS title, 'Course' AS sub, '#/student/courses' AS link FROM course_registrations r JOIN course_offerings o ON o.id = r.offering_id JOIN courses c ON c.id = o.course_id
        WHERE r.student_id = ? AND (lower(c.name) LIKE ? OR lower(c.code) LIKE ?) LIMIT 6`, s.id, like, like));
      add('Notifications', db.all(`SELECT title, substr(body, 1, 80) AS sub, '#/student/notifications' AS link FROM notifications WHERE user_id = ? AND (lower(title) LIKE ? OR lower(body) LIKE ?) ORDER BY id DESC LIMIT 5`, u.id, like, like));
      return { groups };
    }
    if (u.role === 'staff') {
      const st = scope.staffRow(u);
      add('My courses', db.all(`SELECT c.code || ' ' || c.name || COALESCE(' · Sec ' || sec.name, '') AS title, b.name AS sub, '#/staff/course/' || o.id AS link FROM course_offerings o JOIN courses c ON c.id = o.course_id JOIN batches b ON b.id = o.batch_id LEFT JOIN sections sec ON sec.id = o.section_id
        WHERE o.staff_id = ? AND (lower(c.name) LIKE ? OR lower(c.code) LIKE ?) LIMIT 6`, st.id, like, like));
      add('My students', db.all(`SELECT DISTINCT s.first_name || ' ' || s.last_name AS title, s.roll_no || ' · ' || c.name AS sub, '#/staff/course/' || o.id || '/student/' || s.id AS link
        FROM course_registrations r JOIN students s ON s.id = r.student_id JOIN course_offerings o ON o.id = r.offering_id JOIN courses c ON c.id = o.course_id
        WHERE o.staff_id = ? AND r.status = 'Registered' AND (lower(s.first_name || ' ' || s.last_name) LIKE ? OR lower(s.roll_no) LIKE ?) GROUP BY s.id LIMIT 8`, st.id, like, like));
      return { groups };
    }
    const sf = scope.orgFilter(u, 's', { department: true });
    add('Students', db.all(`SELECT s.first_name || ' ' || s.last_name AS title, s.roll_no || ' · ' || c.short_name || ' · ' || d.code AS sub, '#/admin/student/' || s.id AS link
      FROM students s JOIN colleges c ON c.id = s.college_id JOIN departments d ON d.id = s.department_id WHERE ${sf.sql} AND (lower(s.first_name || ' ' || s.last_name) LIKE ? OR lower(s.roll_no) LIKE ?) LIMIT 8`, ...sf.params, like, like));
    const tf = scope.orgFilter(u, 't', { department: true });
    add('Staff', db.all(`SELECT us.name AS title, t.employee_code || ' · ' || c.short_name AS sub, '#/admin/records/staff?q=' || t.employee_code AS link FROM staff t JOIN users us ON us.id = t.user_id JOIN colleges c ON c.id = t.college_id
      WHERE ${tf.sql} AND (lower(us.name) LIKE ? OR lower(t.employee_code) LIKE ?) LIMIT 6`, ...tf.params, like, like));
    add('Courses', db.all(`SELECT t.code || ' ' || t.name AS title, c.short_name || ' · ' || t.course_type || ' · ' || t.credits || ' credits' AS sub, '#/admin/records/courses?q=' || t.code AS link FROM courses t JOIN colleges c ON c.id = t.college_id
      WHERE ${tf.sql} AND (lower(t.name) LIKE ? OR lower(t.code) LIKE ?) LIMIT 6`, ...tf.params, like, like));
    const of = scope.orgFilter(u, 't');
    if (u.role !== 'department_admin') add('Departments', db.all(`SELECT t.name AS title, t.code || ' · ' || c.short_name AS sub, '#/admin/drill/department/' || t.id AS link FROM departments t JOIN colleges c ON c.id = t.college_id
      WHERE ${of.sql} AND (lower(t.name) LIKE ? OR lower(t.code) LIKE ?) LIMIT 5`, ...of.params, like, like));
    if (u.role === 'super_admin' || u.role === 'university_admin') {
      add('Colleges', db.all(`SELECT t.name AS title, t.code || ' · ' || t.location AS sub, '#/admin/drill/college/' || t.id AS link FROM colleges t WHERE ${u.role === 'super_admin' ? '1=1' : 't.university_id = ?'} AND (lower(t.name) LIKE ? OR lower(t.code) LIKE ?) LIMIT 5`,
        ...(u.role === 'super_admin' ? [] : [u.university_id]), like, like));
    }
    if (u.role === 'super_admin') add('Universities', db.all(`SELECT name AS title, code || ' · ' || location AS sub, '#/admin/drill/university/' || id AS link FROM universities WHERE lower(name) LIKE ? OR lower(code) LIKE ? LIMIT 5`, like, like));
    return { groups };
  });
};
