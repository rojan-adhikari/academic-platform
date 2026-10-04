// Student portal: every endpoint resolves the student from the session, so a
// student can only ever read their own record (no student id is accepted).
const crypto = require('crypto');
const db = require('../db');
const scope = require('../scope');
const views = require('../views');
const events = require('../engine/events');
const { forbidden, bad, notFound, toInt, toStr } = require('../lib');

// Offerings the student may ask to join: their own college and batch, open for registration,
// matching their section (or section-agnostic), and not already on their record.
function availableOfferings(s) {
  return db.all(`SELECT o.id AS offering_id, c.code, c.name, c.credits, c.course_type, c.category, c.semester_number,
      sec.name AS section, st.employee_code AS faculty_code, fu.name AS faculty_name
    FROM course_offerings o JOIN courses c ON c.id = o.course_id
    LEFT JOIN sections sec ON sec.id = o.section_id
    LEFT JOIN staff st ON st.id = o.staff_id LEFT JOIN users fu ON fu.id = st.user_id
    WHERE o.college_id = ? AND o.batch_id = ? AND o.active = 1 AND o.registration_open = 1
      AND (o.section_id IS NULL OR o.section_id = ?)
      AND o.id NOT IN (SELECT offering_id FROM course_registrations WHERE student_id = ?)
    ORDER BY c.semester_number, c.code`, s.college_id, s.batch_id, s.section_id, s.id);
}

function me(ctx) {
  const s = scope.studentRow(ctx.user);
  if (!s) throw forbidden('No active student record is linked to this account.');
  return s;
}
const ONLY = { roles: ['student'] };

// Upcoming events from the college's published campus guide, so an admin's published event shows in the portal.
function upcomingCampusEvents(collegeId, studentId, limit = 5) {
  const row = db.get('SELECT payload FROM campus_guides WHERE college_id = ?', collegeId);
  if (!row) return [];
  let data; try { data = JSON.parse(row.payload); } catch { return []; }
  const now = Date.now();
  const nodeName = (v) => (data.nodes || []).find((n) => n.id === v)?.name || v || '';
  const mine = new Set(db.all('SELECT event_id FROM campus_participations WHERE college_id = ? AND student_id = ?', collegeId, studentId).map((r) => r.event_id));
  return (data.events || [])
    .filter((e) => e.title && (!e.endsAt || Date.parse(e.endsAt) > now))
    .sort((a, b) => (Date.parse(a.startsAt) || Infinity) - (Date.parse(b.startsAt) || Infinity))
    .slice(0, limit)
    .map((e) => ({ id: e.id, title: e.title, startsAt: e.startsAt || null, endsAt: e.endsAt || null,
      venue: nodeName(e.venue), registrationOpen: !!e.registrationOpen, registered: mine.has(e.id) }));
}
function findGuideEvent(collegeId, eventId) {
  const row = db.get('SELECT payload FROM campus_guides WHERE college_id = ?', collegeId);
  if (!row) throw notFound('No campus guide is published for your college.');
  let data; try { data = JSON.parse(row.payload); } catch { throw notFound('Campus guide unavailable.'); }
  const event = (data.events || []).find((e) => e.id === eventId);
  if (!event) throw notFound('Event not found.');
  return event;
}

module.exports = (api) => {
  api.get('/api/student/dashboard', (ctx) => {
    const s = me(ctx);
    const profile = views.studentProfile(s.id);
    const attendance = views.studentAttendance(s.id);
    const performance = views.studentPerformance(s.id);
    const risk = views.studentRisk(s.id);
    const notifications = db.all('SELECT * FROM notifications WHERE user_id = ? AND is_read = 0 ORDER BY created_at DESC, id DESC LIMIT 6', ctx.user.id);
    const announcements = db.all(`SELECT a.title, a.body, a.created_at, c.name AS course FROM announcements a LEFT JOIN course_offerings o ON o.id = a.offering_id LEFT JOIN courses c ON c.id = o.course_id
      WHERE a.audience IN ('all','students') AND ((a.college_id = ? AND (a.offering_id IS NULL OR a.offering_id IN (SELECT offering_id FROM course_registrations WHERE student_id = ? AND status = 'Registered')))
      OR (a.college_id IS NULL AND a.university_id = ?)) ORDER BY a.created_at DESC LIMIT 4`, s.college_id, s.id, s.university_id);
    // Alerts that need attention first: critical attendance, high risk, then attention.
    const alerts = [];
    for (const c of attendance.courses) {
      if (c.status === 'Critical') alerts.push({ severity: 'critical', title: `${c.name}: attendance ${c.percentage}%`, text: `${c.message} ${c.guidance[0] || ''}`, link: '#/student/attendance' });
      else if (c.status === 'Attention') alerts.push({ severity: 'warning', title: `${c.name}: attendance ${c.percentage}%`, text: c.message, link: '#/student/attendance' });
    }
    for (const r of risk.courses) if (r.level === 'High') alerts.push({ severity: 'critical', title: `${r.name}: high academic risk`, text: r.factors.slice(0, 2).map((f) => f.text).join('. '), link: '#/student/risk' });
    alerts.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'critical' ? -1 : 1));
    return { profile, attendance: { overall: attendance.overall, threshold: attendance.threshold, courses: attendance.courses.map(({ series, history, ...c }) => c), weekly: attendance.weekly },
      performance: { currentPct: performance.currentPct, previousSgpa: performance.previousSgpa, cgpa: performance.cgpa, courses: performance.courses.map(({ assessments, ...c }) => c), history: performance.history },
      risk: { overall: risk.overall, courses: risk.courses.map((c) => ({ offering_id: c.offering_id, code: c.code, name: c.name, level: c.level, top: c.factors[0]?.text || null })) },
      alerts: alerts.slice(0, 6), notifications, announcements, campusEvents: upcomingCampusEvents(s.college_id, s.id), collegeId: s.college_id,
      unread: db.get('SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND is_read = 0', ctx.user.id).n };
  }, ONLY);

  api.get('/api/student/profile', (ctx) => {
    const s = me(ctx);
    return { profile: views.studentProfile(s.id), courses: views.studentCourses(s.id, { includeDropped: true }), history: views.studentPerformance(s.id).history };
  }, ONLY);
  api.get('/api/student/courses', (ctx) => { const s = me(ctx); return { profile: views.studentProfile(s.id), courses: views.studentCourses(s.id, { includeDropped: true }) }; }, ONLY);
  api.get('/api/student/attendance', (ctx) => views.studentAttendance(me(ctx).id), ONLY);
  api.get('/api/student/performance', (ctx) => views.studentPerformance(me(ctx).id), ONLY);
  api.get('/api/student/risk', (ctx) => views.studentRisk(me(ctx).id), ONLY);

  // ---- campus event registration (one tap from the dashboard) ----
  api.post('/api/student/events/register', (ctx) => {
    const s = me(ctx);
    const eventId = toStr(ctx.body.eventId, 'Event', { max: 80 });
    const event = findGuideEvent(s.college_id, eventId);
    if (!event.registrationOpen) throw bad('Registration is not open for this event.');
    if (event.endsAt && Date.parse(event.endsAt) < Date.now()) throw bad('This event has already ended.');
    const existing = db.get('SELECT id FROM campus_participations WHERE college_id = ? AND event_id = ? AND student_id = ?', s.college_id, eventId, s.id);
    if (existing) return { status: 'already_registered' };
    const u = db.get('SELECT name, email FROM users WHERE id = ?', ctx.user.id);
    const col = db.get('SELECT short_name FROM colleges WHERE id = ?', s.college_id);
    try {
      db.run('INSERT INTO campus_participations (id, college_id, event_id, event_title, name, institution, email, student_id) VALUES (?,?,?,?,?,?,?,?)',
        crypto.randomUUID(), s.college_id, event.id, event.title, u.name, col.short_name, (u.email || '').toLowerCase(), s.id);
    } catch { return { status: 'already_registered' }; } // unique (college,event,email)
    return { status: 'registered' };
  }, ONLY);
  api.post('/api/student/events/cancel', (ctx) => {
    const s = me(ctx);
    const eventId = toStr(ctx.body.eventId, 'Event', { max: 80 });
    db.run('DELETE FROM campus_participations WHERE college_id = ? AND event_id = ? AND student_id = ?', s.college_id, eventId, s.id);
    return { status: 'cancelled' };
  }, ONLY);

  // ---- course registration (student requests, college admin approves) ----
  api.get('/api/student/registration', (ctx) => {
    const s = me(ctx);
    const mine = views.studentCourses(s.id, { includeDropped: true });
    return {
      registered: mine.filter((c) => c.status === 'Registered'),
      pending: mine.filter((c) => c.status === 'Pending'),
      available: availableOfferings(s),
    };
  }, ONLY);

  api.post('/api/student/registration', (ctx) => {
    const s = me(ctx);
    const offeringId = toInt(ctx.body.offeringId, 'Course', { min: 1 });
    const o = db.get('SELECT * FROM course_offerings WHERE id = ?', offeringId);
    if (!o || !o.active) throw notFound('That course is not available.');
    if (o.college_id !== s.college_id || o.batch_id !== s.batch_id || (o.section_id && o.section_id !== s.section_id)) throw forbidden('That course is not offered to your class.');
    if (!o.registration_open) throw bad('Registration is closed for that course.');
    const existing = db.get('SELECT * FROM course_registrations WHERE student_id = ? AND offering_id = ?', s.id, offeringId);
    if (existing && existing.status === 'Registered') throw bad('You are already registered for that course.');
    if (existing && existing.status === 'Pending') throw bad('Your request for that course is already awaiting approval.');
    if (existing) db.run("UPDATE course_registrations SET status = 'Pending', registered_at = datetime('now') WHERE id = ?", existing.id);
    else db.run('INSERT INTO course_registrations (university_id, college_id, student_id, offering_id, status) VALUES (?,?,?,?,?)', s.university_id, s.college_id, s.id, offeringId, 'Pending');
    const course = db.get('SELECT c.code, c.name FROM courses c WHERE c.id = ?', o.course_id);
    // Let the college's registration managers know a request is waiting.
    const admins = db.all("SELECT id, college_id FROM users WHERE college_id = ? AND role IN ('college_admin','department_admin') AND active = 1", s.college_id);
    events.enqueue(() => db.tx(() => { for (const a of admins) events.notify(a.id, a.college_id, { type: 'registration', title: 'Course registration request', body: `${s.first_name} ${s.last_name} (${s.roll_no}) requested ${course.code} ${course.name}.`, link: '#/admin/registrations', dedupeKey: `reg-req-${s.id}-${offeringId}` }); }));
    return { ok: true, status: 'Pending' };
  }, ONLY);

  api.del('/api/student/registration/:offeringId', (ctx) => {
    const s = me(ctx);
    const offeringId = toInt(ctx.params.offeringId, 'Course', { min: 1 });
    const r = db.get('SELECT * FROM course_registrations WHERE student_id = ? AND offering_id = ?', s.id, offeringId);
    if (!r) throw notFound('No request found for that course.');
    if (r.status !== 'Pending') throw bad('Only a request that is still awaiting approval can be withdrawn.');
    db.run('DELETE FROM course_registrations WHERE id = ?', r.id);
    return { ok: true };
  }, ONLY);
};
