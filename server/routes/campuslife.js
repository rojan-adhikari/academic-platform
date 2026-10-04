// Clubs, weekly timetable, and the Google-Classroom-style course stream + deadlines.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('../db');
const scope = require('../scope');
const events = require('../engine/events');
const TT = require('../timetable');
const { bad, forbidden, notFound, toInt, toStr, toDate, audit } = require('../lib');

const UPLOADS = path.join(path.dirname(db.DB_PATH), 'uploads', 'classroom');
const MAX_PDF = 8 * 1024 * 1024;
// Store an uploaded PDF (base64 data URL) and return its record.
function savePdf(collegeId, offeringId, userId, name, dataUrl) {
  const m = /^data:application\/pdf;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) throw bad('Upload a PDF file.');
  const buf = Buffer.from(m[1], 'base64');
  if (!buf.length) throw bad('The PDF is empty.');
  if (buf.length > MAX_PDF) throw bad('The PDF must be under 8 MB.');
  fs.mkdirSync(UPLOADS, { recursive: true });
  const id = crypto.randomUUID();
  const rel = `${id}.pdf`;
  fs.writeFileSync(path.join(UPLOADS, rel), buf);
  const clean = (toStr(name, 'File name', { max: 120, optional: true }) || 'document.pdf').replace(/[^\w.\- ]/g, '_');
  db.run('INSERT INTO classroom_files (id, college_id, offering_id, uploaded_by, mime, name, size, path) VALUES (?,?,?,?,?,?,?,?)',
    id, collegeId, offeringId, userId, 'application/pdf', clean, buf.length, rel);
  return { id, name: clean, size: buf.length };
}

const student = (ctx) => { const s = scope.studentRow(ctx.user); if (!s) throw forbidden('No active student record is linked to this account.'); return s; };
const staff = (ctx) => { const s = scope.staffRow(ctx.user); if (!s) throw forbidden('No active staff record is linked to this account.'); return s; };
const isTeacherOrAdmin = (u) => u.role === 'staff' || scope.isAdmin(u);
// Validate that an attached file id belongs to this offering; returns {id, name} or nulls.
function linkFile(oid, fileId) {
  if (!fileId) return { id: null, name: null };
  const f = db.get('SELECT id, name, offering_id FROM classroom_files WHERE id = ?', String(fileId));
  if (!f || f.offering_id !== oid) throw bad('The attached file is not valid for this course.');
  return { id: f.id, name: f.name };
}

// Only the teacher who owns the offering may change its classroom (admins cannot manage assignments).
const canManageClass = (u, offeringId) => u.role === 'staff' && scope.canAccessOffering(u, offeringId);
function ownPost(ctx, postId) {
  const post = db.get('SELECT * FROM classroom_posts WHERE id = ?', postId);
  if (!post) throw notFound('This post no longer exists.');
  if (!canManageClass(ctx.user, post.offering_id)) throw forbidden();
  return post;
}

module.exports = (api) => {
  // ---------------- Timetable ----------------
  api.get('/api/timetable', (ctx) => {
    const meta = { periods: TT.PERIODS, breaks: TT.BREAKS, days: TT.DAYS, mentor: TT.MENTOR_HOUR };
    if (ctx.user.role === 'student') {
      const s = student(ctx);
      const sec = db.get(`SELECT sec.id, sec.name, b.name AS batch, p.name AS programme, d.name AS department
        FROM sections sec JOIN batches b ON b.id = sec.batch_id JOIN programmes p ON p.id = b.programme_id JOIN departments d ON d.id = p.department_id
        WHERE sec.id = ?`, s.section_id);
      const slots = db.all(`SELECT t.day, t.period, t.kind, t.label, c.code AS course_code, c.name AS course_name, c.course_type,
          u.name AS faculty_name, st.employee_code AS faculty_code
        FROM timetable_slots t LEFT JOIN course_offerings o ON o.id = t.offering_id LEFT JOIN courses c ON c.id = o.course_id
        LEFT JOIN staff st ON st.id = o.staff_id LEFT JOIN users u ON u.id = st.user_id
        WHERE t.section_id = ? ORDER BY t.day, t.period`, s.section_id);
      return { view: 'section', section: sec, slots, ...meta };
    }
    if (ctx.user.role === 'staff') {
      const st = staff(ctx);
      const slots = db.all(`SELECT t.day, t.period, t.kind, c.code AS course_code, c.name AS course_name, c.course_type,
          sec.name AS section, b.name AS batch, d.code AS dept
        FROM timetable_slots t JOIN course_offerings o ON o.id = t.offering_id JOIN courses c ON c.id = o.course_id
        JOIN sections sec ON sec.id = t.section_id JOIN batches b ON b.id = sec.batch_id JOIN departments d ON d.id = c.department_id
        WHERE o.staff_id = ? ORDER BY t.day, t.period`, st.id);
      return { view: 'teaching', slots, ...meta };
    }
    throw forbidden('Timetables are shown in the student and staff portals.');
  });

  // ---------------- Clubs ----------------
  api.get('/api/clubs', (ctx) => {
    const cid = ctx.user.college_id;
    if (!cid) throw forbidden('Clubs are organised per college.');
    const mine = ctx.user.role === 'student' ? student(ctx) : null;
    const rows = db.all(`SELECT cl.id, cl.name, cl.category, cl.description, u.name AS lead_name,
        (SELECT COUNT(*) FROM club_memberships m WHERE m.club_id = cl.id AND m.status = 'Active') AS members
      FROM clubs cl LEFT JOIN staff s ON s.id = cl.lead_staff_id LEFT JOIN users u ON u.id = s.user_id
      WHERE cl.college_id = ? AND cl.active = 1 ORDER BY cl.category, cl.name`, cid);
    if (mine) {
      const joined = new Set(db.all("SELECT club_id FROM club_memberships WHERE student_id = ? AND status = 'Active'", mine.id).map((r) => r.club_id));
      rows.forEach((r) => { r.joined = joined.has(r.id); });
    }
    return { clubs: rows, canManage: isTeacherOrAdmin(ctx.user) };
  });

  api.post('/api/clubs/:id/join', (ctx) => {
    const s = student(ctx);
    const club = db.get('SELECT * FROM clubs WHERE id = ? AND active = 1', toInt(ctx.params.id, 'Club'));
    if (!club || club.college_id !== s.college_id) throw notFound('This club is not open to you.');
    const phone = toStr(ctx.body.phone, 'Phone number', { max: 20, pattern: /^[0-9+\-\s]{7,20}$/, patternMsg: 'Enter a valid phone number.' });
    const interest = toStr(ctx.body.interest, 'Reason for joining', { max: 500 });
    const existing = db.get('SELECT * FROM club_memberships WHERE club_id = ? AND student_id = ?', club.id, s.id);
    if (existing) db.run("UPDATE club_memberships SET status = 'Active', phone = ?, interest = ?, joined_at = datetime('now') WHERE id = ?", phone, interest, existing.id);
    else db.run("INSERT INTO club_memberships (club_id, college_id, student_id, role, status, phone, interest) VALUES (?,?,?,'Member','Active',?,?)", club.id, club.college_id, s.id, phone, interest);
    audit(ctx, { action: 'create', entity: 'club_membership', entityId: club.id, summary: `Joined club ${club.name}` });
    return { ok: true };
  }, { roles: ['student'] });

  api.del('/api/clubs/:id/leave', (ctx) => {
    const s = student(ctx);
    db.run("UPDATE club_memberships SET status = 'Left' WHERE club_id = ? AND student_id = ?", toInt(ctx.params.id, 'Club'), s.id);
    return { ok: true };
  }, { roles: ['student'] });

  // Staff / admin see who is in a club.
  api.get('/api/clubs/:id/members', (ctx) => {
    if (!isTeacherOrAdmin(ctx.user)) throw forbidden();
    const club = db.get('SELECT * FROM clubs WHERE id = ?', toInt(ctx.params.id, 'Club'));
    if (!club || !scope.canAccessCollege(ctx.user, club.college_id)) throw notFound();
    const members = db.all(`SELECT st.roll_no, st.first_name || ' ' || st.last_name AS name, d.code AS dept, sec.name AS section, m.role, m.phone, m.interest, m.joined_at
      FROM club_memberships m JOIN students st ON st.id = m.student_id JOIN departments d ON d.id = st.department_id
      LEFT JOIN sections sec ON sec.id = st.section_id
      WHERE m.club_id = ? AND m.status = 'Active' ORDER BY m.role DESC, name`, club.id);
    return { club: { id: club.id, name: club.name, category: club.category }, members };
  });

  // ---------------- Classroom ----------------
  // Courses the user takes (student) or teaches (staff), with post + deadline counts.
  api.get('/api/classroom/courses', (ctx) => {
    let offerings;
    if (ctx.user.role === 'student') {
      const s = student(ctx);
      offerings = db.all(`SELECT o.id, c.code, c.name, u.name AS faculty_name FROM course_registrations r
        JOIN course_offerings o ON o.id = r.offering_id JOIN courses c ON c.id = o.course_id
        LEFT JOIN staff st ON st.id = o.staff_id LEFT JOIN users u ON u.id = st.user_id
        WHERE r.student_id = ? AND r.status = 'Registered' ORDER BY c.code`, s.id);
    } else if (ctx.user.role === 'staff') {
      const st = staff(ctx);
      offerings = db.all(`SELECT o.id, c.code, c.name, sec.name AS section FROM course_offerings o JOIN courses c ON c.id = o.course_id
        LEFT JOIN sections sec ON sec.id = o.section_id WHERE o.staff_id = ? ORDER BY c.code`, st.id);
    } else throw forbidden('The classroom is in the student and staff portals.');
    for (const o of offerings) {
      o.posts = db.get('SELECT COUNT(*) n FROM classroom_posts WHERE offering_id = ?', o.id).n;
      const next = db.get("SELECT title, due_on FROM classroom_posts WHERE offering_id = ? AND kind = 'assignment' AND due_on >= date('now') ORDER BY due_on LIMIT 1", o.id);
      o.nextDue = next || null;
    }
    return { role: ctx.user.role, courses: offerings };
  });

  // The stream for one course.
  api.get('/api/classroom/:offeringId', (ctx) => {
    const oid = toInt(ctx.params.offeringId, 'Course');
    if (!scope.canAccessOffering(ctx.user, oid)) throw forbidden();
    const course = db.get(`SELECT o.id, c.code, c.name, c.course_type, sec.name AS section, u.name AS faculty_name
      FROM course_offerings o JOIN courses c ON c.id = o.course_id LEFT JOIN sections sec ON sec.id = o.section_id
      LEFT JOIN staff st ON st.id = o.staff_id LEFT JOIN users u ON u.id = st.user_id WHERE o.id = ?`, oid);
    const posts = db.all(`SELECT p.*, u.name AS author_name FROM classroom_posts p LEFT JOIN users u ON u.id = p.author_id
      WHERE p.offering_id = ? ORDER BY p.created_at DESC, p.id DESC`, oid);
    const canManage = canManageClass(ctx.user, oid);
    if (ctx.user.role === 'student') {
      const s = scope.studentRow(ctx.user);
      const subs = new Map(db.all('SELECT post_id, status, submitted_at FROM classroom_submissions WHERE student_id = ?', s.id).map((r) => [r.post_id, r]));
      posts.forEach((p) => { p.mySubmission = subs.get(p.id) || null; });
    } else {
      posts.forEach((p) => { if (p.kind === 'assignment') p.submissions = db.get('SELECT COUNT(*) n FROM classroom_submissions WHERE post_id = ?', p.id).n; });
    }
    return { course, posts, canManage, role: ctx.user.role };
  });

  // Upload a PDF for this course (teacher material/note, or student submission). Anyone who can
  // access the offering may upload; it is linked to a post or submission in the next request.
  api.post('/api/classroom/:offeringId/files', (ctx) => {
    const oid = toInt(ctx.params.offeringId, 'Course');
    if (!scope.canAccessOffering(ctx.user, oid)) throw forbidden();
    const collegeId = db.get('SELECT college_id FROM course_offerings WHERE id = ?', oid).college_id;
    return savePdf(collegeId, oid, ctx.user.id, ctx.body.name, ctx.body.data);
  }, { limit: 12 * 1024 * 1024 });

  // Serve an uploaded PDF inline to anyone who can access its offering.
  api.get('/api/classroom/files/:id', (ctx) => {
    const f = db.get('SELECT * FROM classroom_files WHERE id = ?', ctx.params.id);
    if (!f) throw notFound('This file no longer exists.');
    if (!scope.canAccessOffering(ctx.user, f.offering_id)) throw forbidden();
    const full = path.join(UPLOADS, f.path);
    if (!fs.existsSync(full)) throw notFound('This file is missing.');
    ctx.res.writeHead(200, { 'Content-Type': f.mime, 'Content-Disposition': `inline; filename="${f.name}"`, 'Cache-Control': 'private, max-age=300' });
    ctx.res.end(fs.readFileSync(full));
    return { __raw: true };
  });

  api.post('/api/classroom/:offeringId/posts', (ctx) => {
    const oid = toInt(ctx.params.offeringId, 'Course');
    if (!canManageClass(ctx.user, oid)) throw forbidden();
    const kind = toStr(ctx.body.kind, 'Type');
    if (!['assignment', 'note', 'material'].includes(kind)) throw bad('Choose assignment, note or material.');
    const row = {
      college_id: db.get('SELECT college_id FROM course_offerings WHERE id = ?', oid).college_id,
      offering_id: oid, author_id: ctx.user.id, kind,
      title: toStr(ctx.body.title, 'Title', { max: 160 }),
      body: toStr(ctx.body.body, 'Details', { max: 4000, optional: true }),
      link: toStr(ctx.body.link, 'Link', { max: 400, optional: true }),
      due_on: kind === 'assignment' ? toDate(ctx.body.dueOn, 'Due date', { optional: true }) : null,
      points: kind === 'assignment' && ctx.body.points !== '' && ctx.body.points != null ? Number(ctx.body.points) : null,
    };
    const file = linkFile(oid, ctx.body.fileId);
    const id = db.run(`INSERT INTO classroom_posts (college_id, offering_id, author_id, kind, title, body, link, file_id, file_name, due_on, points) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      row.college_id, row.offering_id, row.author_id, row.kind, row.title, row.body, row.link, file.id, file.name, row.due_on, row.points).lastInsertRowid;
    audit(ctx, { action: 'create', entity: 'classroom_post', entityId: Number(id), summary: `Posted ${kind}: ${row.title}` });
    // Tell the registered students a new assignment is up.
    if (kind === 'assignment') {
      const course = db.get('SELECT c.name FROM course_offerings o JOIN courses c ON c.id = o.course_id WHERE o.id = ?', oid);
      for (const r of db.all("SELECT st.user_id, st.college_id FROM course_registrations cr JOIN students st ON st.id = cr.student_id WHERE cr.offering_id = ? AND cr.status = 'Registered'", oid)) {
        events.notify(r.user_id, r.college_id, { type: 'classroom', severity: 'info', title: `New assignment: ${row.title}`, body: `${course.name}${row.due_on ? ` — due ${row.due_on}` : ''}.`, link: `#/student/classroom/${oid}`, dedupeKey: `cls:${id}` });
      }
    }
    return { ok: true, id: Number(id) };
  });

  api.put('/api/classroom/posts/:id', (ctx) => {
    const post = ownPost(ctx, toInt(ctx.params.id, 'Post'));
    const title = toStr(ctx.body.title, 'Title', { max: 160 });
    const body = toStr(ctx.body.body, 'Details', { max: 4000, optional: true });
    const link = toStr(ctx.body.link, 'Link', { max: 400, optional: true });
    const dueOn = post.kind === 'assignment' ? toDate(ctx.body.dueOn, 'Due date', { optional: true }) : null;
    const points = post.kind === 'assignment' && ctx.body.points !== '' && ctx.body.points != null ? Number(ctx.body.points) : null;
    // fileId: a new/kept file id, or empty to remove the attachment.
    const file = linkFile(post.offering_id, ctx.body.fileId);
    db.run("UPDATE classroom_posts SET title=?, body=?, link=?, file_id=?, file_name=?, due_on=?, points=?, updated_at=datetime('now') WHERE id=?", title, body, link, file.id, file.name, dueOn, points, post.id);
    audit(ctx, { action: 'update', entity: 'classroom_post', entityId: post.id, summary: `Edited ${post.kind}: ${title}` });
    return { ok: true };
  });

  api.del('/api/classroom/posts/:id', (ctx) => {
    const post = ownPost(ctx, toInt(ctx.params.id, 'Post'));
    db.run('DELETE FROM classroom_posts WHERE id = ?', post.id);
    audit(ctx, { action: 'delete', entity: 'classroom_post', entityId: post.id, summary: `Deleted ${post.kind}: ${post.title}` });
    return { ok: true };
  });

  api.get('/api/classroom/posts/:id/submissions', (ctx) => {
    const post = ownPost(ctx, toInt(ctx.params.id, 'Post'));
    const rows = db.all(`SELECT st.roll_no, st.first_name || ' ' || st.last_name AS name, sub.status, sub.note, sub.link, sub.file_id, sub.file_name, sub.submitted_at
      FROM classroom_submissions sub JOIN students st ON st.id = sub.student_id WHERE sub.post_id = ? ORDER BY sub.submitted_at DESC`, post.id);
    return { post: { id: post.id, title: post.title }, submissions: rows };
  });

  api.post('/api/classroom/posts/:id/submit', (ctx) => {
    const s = student(ctx);
    const post = db.get('SELECT * FROM classroom_posts WHERE id = ?', toInt(ctx.params.id, 'Post'));
    if (!post || post.kind !== 'assignment') throw notFound('This assignment no longer exists.');
    if (!scope.canAccessOffering(ctx.user, post.offering_id)) throw forbidden();
    const note = toStr(ctx.body.note, 'Note', { max: 1000, optional: true });
    const link = toStr(ctx.body.link, 'Submission link', { max: 400, optional: true });
    const file = linkFile(post.offering_id, ctx.body.fileId);
    if (!note && !link && !file.id) throw bad('Attach a PDF, add a submission link or a note.');
    db.run(`INSERT INTO classroom_submissions (post_id, student_id, note, link, file_id, file_name) VALUES (?,?,?,?,?,?)
      ON CONFLICT(post_id, student_id) DO UPDATE SET note=excluded.note, link=excluded.link, file_id=excluded.file_id, file_name=excluded.file_name, status='Submitted', submitted_at=datetime('now')`,
      post.id, s.id, note, link, file.id, file.name);
    return { ok: true };
  }, { roles: ['student'] });

  // ---------------- Deadlines (student, read-only) ----------------
  api.get('/api/student/deadlines', (ctx) => {
    const s = student(ctx);
    const rows = db.all(`SELECT p.id, p.title, p.due_on, p.points, c.code AS course_code, c.name AS course_name, o.id AS offering_id,
        (SELECT status FROM classroom_submissions sub WHERE sub.post_id = p.id AND sub.student_id = ?) AS my_status
      FROM classroom_posts p JOIN course_offerings o ON o.id = p.offering_id JOIN courses c ON c.id = o.course_id
      JOIN course_registrations r ON r.offering_id = o.id AND r.student_id = ? AND r.status = 'Registered'
      WHERE p.kind = 'assignment' AND p.due_on IS NOT NULL ORDER BY p.due_on`, s.id, s.id);
    const today = new Date().toISOString().slice(0, 10);
    return { upcoming: rows.filter((r) => r.due_on >= today), past: rows.filter((r) => r.due_on < today) };
  }, { roles: ['student'] });
};
