// Teaching operations shared by staff (their own offerings only) and admins
// (offerings inside their organisation scope): students, assessments, marks,
// attendance, voice entry, course analytics.
const db = require('../db');
const scope = require('../scope');
const settings = require('../settings');
const views = require('../views');
const events = require('../engine/events');
const voice = require('../engine/voice');
const att = require('../engine/attendance');
const { bad, forbidden, notFound, toInt, toNum, toStr, toDate, audit, paged } = require('../lib');

const r1 = (x) => (x === null || x === undefined ? null : Math.round(x * 10) / 10);
const TEACH = { roles: ['staff', 'super_admin', 'university_admin', 'college_admin', 'department_admin'] };

function offeringOr403(user, id) {
  const oid = toInt(id, 'Course', { min: 1 });
  if (!scope.canAccessOffering(user, oid) || user.role === 'student') throw forbidden();
  const o = db.get(`SELECT o.*, c.code, c.name, c.category, c.course_type, c.credits, c.semester_number, c.department_id,
      d.code AS department_code, b.name AS batch, sec.name AS section, sem.name AS semester, st.employee_code AS faculty_code, fu.name AS faculty_name,
      col.name AS college, col.short_name AS college_short
    FROM course_offerings o JOIN courses c ON c.id = o.course_id JOIN departments d ON d.id = c.department_id JOIN batches b ON b.id = o.batch_id
    LEFT JOIN sections sec ON sec.id = o.section_id JOIN semesters sem ON sem.id = o.semester_id LEFT JOIN staff st ON st.id = o.staff_id
    LEFT JOIN users fu ON fu.id = st.user_id JOIN colleges col ON col.id = o.college_id WHERE o.id = ?`, oid);
  if (!o) throw notFound();
  return o;
}
function need(user, perm) { if (!scope.can(user, perm)) throw forbidden('Your role is not permitted to make this change.'); }

function rosterWithStats(o) {
  const cfg = settings.forCollege(o.college_id);
  const rows = db.all(`SELECT s.id, s.roll_no, s.first_name, s.last_name, s.gender,
      (SELECT COUNT(*) FROM attendance a WHERE a.student_id = s.id AND a.offering_id = ?) AS conducted,
      (SELECT COALESCE(SUM(present),0) FROM attendance a WHERE a.student_id = s.id AND a.offering_id = ?) AS attended,
      (SELECT level FROM risk_analysis ra WHERE ra.student_id = s.id AND ra.offering_id = ? AND ra.is_latest = 1) AS risk,
      (SELECT factors FROM risk_analysis ra WHERE ra.student_id = s.id AND ra.offering_id = ? AND ra.is_latest = 1) AS factors
    FROM course_registrations r JOIN students s ON s.id = r.student_id
    WHERE r.offering_id = ? AND r.status = 'Registered' AND s.active = 1 ORDER BY s.roll_no`, o.id, o.id, o.id, o.id, o.id);
  const assessments = db.all('SELECT * FROM assessments WHERE offering_id = ? ORDER BY sequence, id', o.id);
  const marks = db.all('SELECT m.assessment_id, m.student_id, m.marks FROM marks m JOIN assessments a ON a.id = m.assessment_id WHERE a.offering_id = ?', o.id);
  const mm = new Map(marks.map((m) => [`${m.assessment_id}:${m.student_id}`, m.marks]));
  return rows.map((s) => {
    const pct = s.conducted ? (s.attended / s.conducted) * 100 : null;
    const scored = assessments.filter((a) => mm.has(`${a.id}:${s.id}`));
    const w = scored.reduce((x, a) => x + a.weight, 0);
    const perf = w ? scored.reduce((x, a) => x + (mm.get(`${a.id}:${s.id}`) / a.max_marks) * 100 * a.weight, 0) / w : null;
    const f = s.factors ? JSON.parse(s.factors).factors : [];
    const status = pct === null ? 'Safe' : att.predict(s.attended, s.conducted, cfg.attendance_threshold, cfg.attendance_recovery_target, cfg.attendance_attention_buffer).status;
    return { id: s.id, roll_no: s.roll_no, name: `${s.first_name} ${s.last_name}`.trim(), conducted: s.conducted, attended: s.attended, attendancePct: r1(pct),
      attendanceStatus: status, performancePct: r1(perf), risk: s.risk || 'Normal', topFactor: f[0]?.text || null,
      marks: Object.fromEntries(assessments.map((a) => [a.id, mm.has(`${a.id}:${s.id}`) ? mm.get(`${a.id}:${s.id}`) : null])) };
  });
}

function offeringsFor(user, query) {
  const where = ['o.active = 1'];
  const params = [];
  if (user.role === 'staff') { const s = scope.staffRow(user); where.push('o.staff_id = ?'); params.push(s ? s.id : -1); }
  else {
    const f = scope.orgFilter(user, 'o'); where.push(f.sql); params.push(...f.params);
    if (user.role === 'department_admin') { where.push('c.department_id = ?'); params.push(user.department_id); }
  }
  if (query.collegeId) { where.push('o.college_id = ?'); params.push(Number(query.collegeId)); }
  if (query.departmentId) { where.push('c.department_id = ?'); params.push(Number(query.departmentId)); }
  if (query.q) { where.push('(lower(c.name) LIKE ? OR lower(c.code) LIKE ?)'); params.push(`%${query.q.toLowerCase()}%`, `%${query.q.toLowerCase()}%`); }
  const from = `FROM course_offerings o JOIN courses c ON c.id = o.course_id JOIN batches b ON b.id = o.batch_id LEFT JOIN sections sec ON sec.id = o.section_id
    LEFT JOIN staff st ON st.id = o.staff_id LEFT JOIN users fu ON fu.id = st.user_id JOIN colleges col ON col.id = o.college_id WHERE ${where.join(' AND ')}`;
  return paged(`SELECT COUNT(*) n ${from}`, `SELECT o.id, c.code, c.name, c.course_type, c.credits, c.category, b.name AS batch, sec.name AS section, col.short_name AS college,
      st.employee_code AS faculty_code, fu.name AS faculty_name,
      (SELECT COUNT(*) FROM course_registrations r WHERE r.offering_id = o.id AND r.status = 'Registered') AS students,
      (SELECT AVG(a.present) * 100 FROM attendance a WHERE a.offering_id = o.id) AS avg_attendance,
      (SELECT COUNT(*) FROM risk_analysis ra WHERE ra.offering_id = o.id AND ra.is_latest = 1 AND ra.level = 'High') AS high_risk,
      (SELECT COUNT(*) FROM risk_analysis ra WHERE ra.offering_id = o.id AND ra.is_latest = 1 AND ra.level = 'Attention') AS attention
    ${from} ORDER BY col.short_name, c.code, sec.name`, params, query, 200);
}

module.exports = (api) => {
  api.get('/api/staff/dashboard', (ctx) => {
    const list = offeringsFor(ctx.user, { pageSize: 200 }).rows.map((o) => ({ ...o, avg_attendance: r1(o.avg_attendance) }));
    const ids = list.map((o) => o.id);
    const ph = ids.map(() => '?').join(',') || 'NULL';
    const pendingMarks = ids.length ? db.all(`SELECT a.id, a.name, c.name AS course, sec.name AS section, a.offering_id,
        (SELECT COUNT(*) FROM course_registrations r WHERE r.offering_id = a.offering_id AND r.status = 'Registered') - (SELECT COUNT(*) FROM marks m WHERE m.assessment_id = a.id) AS missing
      FROM assessments a JOIN course_offerings o ON o.id = a.offering_id JOIN courses c ON c.id = o.course_id LEFT JOIN sections sec ON sec.id = o.section_id
      WHERE a.offering_id IN (${ph})`, ...ids).filter((x) => x.missing > 0) : [];
    const atRisk = ids.length ? db.all(`SELECT ra.level, s.id, s.roll_no, s.first_name || ' ' || s.last_name AS name, c.name AS course, ra.offering_id, ra.factors
      FROM risk_analysis ra JOIN students s ON s.id = ra.student_id JOIN course_offerings o ON o.id = ra.offering_id JOIN courses c ON c.id = o.course_id
      WHERE ra.is_latest = 1 AND ra.offering_id IN (${ph}) AND ra.level = 'High' ORDER BY ra.probability DESC LIMIT 8`, ...ids)
      .map((r) => ({ ...r, factors: undefined, top: JSON.parse(r.factors).factors[0]?.text || null })) : [];
    const notifications = db.all('SELECT * FROM notifications WHERE user_id = ? AND is_read = 0 ORDER BY created_at DESC, id DESC LIMIT 5', ctx.user.id);
    const unread = db.get('SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND is_read = 0', ctx.user.id).n;
    const staff = scope.staffRow(ctx.user);
    return { offerings: list, pendingMarks, atRisk, notifications, unread, staff,
      totals: { courses: list.length, students: db.get(`SELECT COUNT(DISTINCT student_id) n FROM course_registrations WHERE offering_id IN (${ph}) AND status = 'Registered'`, ...ids).n,
        highRisk: list.reduce((s, o) => s + o.high_risk, 0), attention: list.reduce((s, o) => s + o.attention, 0) } };
  }, { roles: ['staff'] });

  api.get('/api/offerings', (ctx) => {
    const res = offeringsFor(ctx.user, ctx.query);
    res.rows = res.rows.map((o) => ({ ...o, avg_attendance: r1(o.avg_attendance) }));
    return res;
  }, TEACH);

  api.get('/api/offerings/:id', (ctx) => {
    const o = offeringOr403(ctx.user, ctx.params.id);
    const cfg = settings.forCollege(o.college_id);
    const assessments = db.all(`SELECT a.*, (SELECT COUNT(*) FROM marks m WHERE m.assessment_id = a.id) AS entered, (SELECT AVG(marks) FROM marks m WHERE m.assessment_id = a.id) AS avg
      FROM assessments a WHERE a.offering_id = ? ORDER BY a.sequence, a.id`, o.id).map((a) => ({ ...a, avg: r1(a.avg) }));
    let students = rosterWithStats(o);
    if (ctx.query.q) { const q = ctx.query.q.toLowerCase(); students = students.filter((s) => s.name.toLowerCase().includes(q) || s.roll_no.toLowerCase().includes(q)); }
    if (ctx.query.risk) students = students.filter((s) => s.risk === ctx.query.risk);
    const sessions = db.get('SELECT COUNT(*) n, MAX(held_on) last FROM attendance_sessions WHERE offering_id = ?', o.id);
    return { offering: o, assessments, students, sessions, threshold: cfg.attendance_threshold,
      canEditMarks: scope.can(ctx.user, 'manage_marks'), canEditAttendance: scope.can(ctx.user, 'manage_attendance'), canManageAssessments: scope.can(ctx.user, 'manage_assessments') };
  }, TEACH);

  api.get('/api/offerings/:id/students/:sid', (ctx) => {
    const o = offeringOr403(ctx.user, ctx.params.id);
    const sid = toInt(ctx.params.sid, 'Student', { min: 1 });
    if (!db.get("SELECT 1 FROM course_registrations WHERE offering_id = ? AND student_id = ? AND status = 'Registered'", o.id, sid)) throw forbidden();
    const p = views.studentProfile(sid);
    const attendance = views.studentAttendance(sid);
    const perf = views.studentPerformance(sid);
    const risk = views.studentRisk(sid, { technical: true });
    // Staff see this course in full and only summary signals for the student's other courses.
    return { profile: { id: p.id, roll_no: p.roll_no, name: p.name, email: p.email, department: p.department, batch: p.batch, section: p.section, semester: p.current_semester, programme: p.programme },
      course: { attendance: attendance.courses.find((c) => c.offering_id === o.id), performance: perf.courses.find((c) => c.offering_id === o.id), risk: risk.courses.find((c) => c.offering_id === o.id) },
      overall: { attendance: attendance.overall.percentage, risk: risk.overall?.level, previousSgpa: perf.previousSgpa } };
  }, TEACH);

  // ----- assessments / assignments -----
  function readAssessment(body) {
    return {
      name: toStr(body.name, 'Name', { max: 80 }), short_name: toStr(body.short_name, 'Short name', { max: 12, optional: true }),
      kind: (() => { if (!['internal', 'quiz', 'assignment', 'lab', 'exam'].includes(body.kind)) throw bad('Type must be internal, quiz, assignment, lab or exam.'); return body.kind; })(),
      max_marks: toNum(body.max_marks, 'Maximum marks', { min: 1, max: 1000 }), weight: toNum(body.weight ?? 1, 'Weight', { min: 0, max: 100 }),
      sequence: toInt(body.sequence ?? 1, 'Order', { min: 1, max: 100 }), held_on: toDate(body.held_on, 'Date', { optional: true }), due_on: toDate(body.due_on, 'Due date', { optional: true }),
      description: toStr(body.description, 'Description', { max: 1000, optional: true }), published: body.published === false || body.published === 0 ? 0 : 1,
    };
  }
  api.post('/api/offerings/:id/assessments', (ctx) => {
    need(ctx.user, 'manage_assessments');
    const o = offeringOr403(ctx.user, ctx.params.id);
    const a = readAssessment(ctx.body);
    const r = db.run(`INSERT INTO assessments (college_id, offering_id, name, short_name, kind, max_marks, weight, sequence, held_on, due_on, description, published)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, o.college_id, o.id, a.name, a.short_name, a.kind, a.max_marks, a.weight, a.sequence, a.held_on, a.due_on, a.description, a.published);
    const id = Number(r.lastInsertRowid);
    audit(ctx, { action: 'create', entity: 'assessment', entityId: id, collegeId: o.college_id, summary: `Created ${a.kind} "${a.name}" (out of ${a.max_marks}) in ${o.name}`, next: a });
    if (a.kind === 'assignment' && a.published) {
      for (const s of db.all("SELECT s.user_id FROM course_registrations r JOIN students s ON s.id = r.student_id WHERE r.offering_id = ? AND r.status = 'Registered'", o.id))
        events.notify(s.user_id, o.college_id, { type: 'course', title: `New assignment in ${o.name}`, body: `${a.name}${a.due_on ? ` is due on ${a.due_on}` : ' has been posted'}.`, link: '#/student/performance' });
    }
    return { id };
  }, TEACH);

  api.put('/api/assessments/:id', (ctx) => {
    need(ctx.user, 'manage_assessments');
    const cur = db.get('SELECT * FROM assessments WHERE id = ?', toInt(ctx.params.id, 'Assessment', { min: 1 }));
    if (!cur) throw notFound();
    const o = offeringOr403(ctx.user, cur.offering_id);
    const a = readAssessment({ ...cur, ...ctx.body });
    const maxMark = db.get('SELECT MAX(marks) m FROM marks WHERE assessment_id = ?', cur.id).m;
    if (maxMark !== null && a.max_marks < maxMark) throw bad(`Maximum marks cannot be lower than an existing mark (${maxMark}).`);
    db.run('UPDATE assessments SET name=?, short_name=?, kind=?, max_marks=?, weight=?, sequence=?, held_on=?, due_on=?, description=?, published=? WHERE id = ?',
      a.name, a.short_name, a.kind, a.max_marks, a.weight, a.sequence, a.held_on, a.due_on, a.description, a.published, cur.id);
    audit(ctx, { action: 'update', entity: 'assessment', entityId: cur.id, collegeId: o.college_id, summary: `Updated assessment "${a.name}" in ${o.name}`, previous: cur, next: a });
    return { ok: true };
  }, TEACH);

  api.del('/api/assessments/:id', (ctx) => {
    need(ctx.user, 'manage_assessments');
    const cur = db.get('SELECT * FROM assessments WHERE id = ?', toInt(ctx.params.id, 'Assessment', { min: 1 }));
    if (!cur) throw notFound();
    const o = offeringOr403(ctx.user, cur.offering_id);
    if (db.get('SELECT COUNT(*) n FROM marks WHERE assessment_id = ?', cur.id).n) throw bad('This assessment already has marks. Unpublish it instead of deleting it.');
    db.run('DELETE FROM assessments WHERE id = ?', cur.id);
    audit(ctx, { action: 'delete', entity: 'assessment', entityId: cur.id, collegeId: o.college_id, summary: `Deleted assessment "${cur.name}" in ${o.name}`, previous: cur });
    return { ok: true };
  }, TEACH);

  // ----- marks -----
  api.get('/api/offerings/:id/marks', (ctx) => {
    const o = offeringOr403(ctx.user, ctx.params.id);
    const assessments = db.all('SELECT * FROM assessments WHERE offering_id = ? ORDER BY sequence, id', o.id);
    return { offering: o, assessments, students: rosterWithStats(o).map(({ id, roll_no, name, marks, risk }) => ({ id, roll_no, name, marks, risk })) };
  }, TEACH);

  api.post('/api/marks', (ctx) => {
    need(ctx.user, 'manage_marks');
    const a = db.get('SELECT * FROM assessments WHERE id = ?', toInt(ctx.body.assessmentId, 'Assessment', { min: 1 }));
    if (!a) throw notFound('Assessment not found.');
    const o = offeringOr403(ctx.user, a.offering_id);
    const method = ['manual', 'voice', 'import', 'admin'].includes(ctx.body.method) ? ctx.body.method : 'manual';
    const entries = Array.isArray(ctx.body.entries) ? ctx.body.entries : [];
    if (!entries.length || entries.length > 500) throw bad('Provide between 1 and 500 mark entries.');
    const errors = [];
    const clean = [];
    for (const [i, e] of entries.entries()) {
      const sid = Number(e.studentId);
      const reg = db.get(`SELECT s.id, s.first_name || ' ' || s.last_name AS name, s.roll_no FROM course_registrations r JOIN students s ON s.id = r.student_id
        WHERE r.offering_id = ? AND r.student_id = ? AND r.status = 'Registered'`, o.id, sid);
      if (!reg) { errors.push({ row: i, error: 'Student is not registered in this course.' }); continue; }
      if (e.marks === null || e.marks === '') { clean.push({ reg, value: null }); continue; }
      const v = Number(e.marks);
      if (!Number.isFinite(v) || v < 0) { errors.push({ row: i, studentId: sid, error: `${reg.name}: marks must be a positive number.` }); continue; }
      if (v > a.max_marks) { errors.push({ row: i, studentId: sid, error: `${reg.name}: ${v} / ${a.max_marks} is not valid. Marks cannot exceed the maximum.` }); continue; }
      if (Math.round(v * 100) !== v * 100) { errors.push({ row: i, studentId: sid, error: `${reg.name}: use at most two decimal places.` }); continue; }
      clean.push({ reg, value: v });
    }
    if (errors.length) throw bad(errors.length === 1 ? errors[0].error : `${errors.length} entries are invalid. Nothing was saved.`, errors);
    const created = [], updated = [];
    db.tx(() => {
      for (const { reg, value } of clean) {
        const prev = db.get('SELECT marks FROM marks WHERE assessment_id = ? AND student_id = ?', a.id, reg.id);
        if (value === null) {
          if (prev) { db.run('DELETE FROM marks WHERE assessment_id = ? AND student_id = ?', a.id, reg.id); updated.push(reg.id); }
        } else if (!prev) {
          db.run("INSERT INTO marks (college_id, assessment_id, student_id, marks, entry_method, updated_by, updated_at) VALUES (?,?,?,?,?,?,datetime('now'))", o.college_id, a.id, reg.id, value, method, ctx.user.id);
          created.push(reg.id);
        } else if (prev.marks !== value) {
          db.run("UPDATE marks SET marks = ?, entry_method = ?, updated_by = ?, updated_at = datetime('now') WHERE assessment_id = ? AND student_id = ?", value, method, ctx.user.id, a.id, reg.id);
          updated.push(reg.id);
        } else continue;
        audit(ctx, { action: prev ? 'update' : 'create', entity: 'marks', entityId: reg.id, collegeId: o.college_id,
          summary: `${prev ? 'Updated' : 'Entered'} mark for ${reg.name} (${reg.roll_no}) in ${o.name} — ${a.name}${method === 'voice' ? ' via voice entry' : ''}`,
          previous: prev ? { marks: prev.marks, max: a.max_marks } : null, next: { marks: value, max: a.max_marks } });
      }
    });
    if (created.length) events.onMarksChanged({ assessment: a, studentIds: created, actor: ctx.user, isUpdate: false });
    if (updated.length) events.onMarksChanged({ assessment: a, studentIds: updated, actor: ctx.user, isUpdate: true });
    return { ok: true, created: created.length, updated: updated.length };
  }, TEACH);

  // ----- voice entry: parse only; saving goes through POST /api/marks after confirmation -----
  api.post('/api/offerings/:id/voice/parse', (ctx) => {
    need(ctx.user, 'manage_marks');
    const o = offeringOr403(ctx.user, ctx.params.id);
    const transcript = toStr(ctx.body.transcript, 'Transcript', { max: 2000 });
    const students = db.all(`SELECT s.id, s.first_name, s.last_name, s.roll_no FROM course_registrations r JOIN students s ON s.id = r.student_id
      WHERE r.offering_id = ? AND r.status = 'Registered' AND s.active = 1`, o.id);
    const assessments = db.all('SELECT id, name, short_name, kind, sequence, max_marks FROM assessments WHERE offering_id = ? ORDER BY sequence, id', o.id);
    const existing = new Map(db.all('SELECT m.assessment_id, m.student_id, m.marks FROM marks m JOIN assessments a ON a.id = m.assessment_id WHERE a.offering_id = ?', o.id)
      .map((m) => [`${m.assessment_id}:${m.student_id}`, m.marks]));
    const defaultId = ctx.body.defaultAssessmentId ? Number(ctx.body.defaultAssessmentId) : null;
    const res = voice.parse(transcript, students, assessments, existing, defaultId);
    return { ...res, assessments, students: students.map((s) => ({ id: s.id, name: `${s.first_name} ${s.last_name}`.trim(), roll_no: s.roll_no })) };
  }, TEACH);

  // ----- attendance -----
  api.get('/api/offerings/:id/attendance', (ctx) => {
    const o = offeringOr403(ctx.user, ctx.params.id);
    const sessions = db.all(`SELECT s.id, s.held_on, s.period, s.topic, COUNT(a.id) AS total, COALESCE(SUM(a.present),0) AS present
      FROM attendance_sessions s LEFT JOIN attendance a ON a.session_id = s.id WHERE s.offering_id = ? GROUP BY s.id ORDER BY s.held_on DESC, s.period DESC`, o.id);
    return { offering: o, sessions, students: rosterWithStats(o).map(({ id, roll_no, name, attendancePct, attendanceStatus, conducted, attended }) => ({ id, roll_no, name, attendancePct, attendanceStatus, conducted, attended })) };
  }, TEACH);

  api.get('/api/attendance-sessions/:id', (ctx) => {
    const s = db.get('SELECT * FROM attendance_sessions WHERE id = ?', toInt(ctx.params.id, 'Session', { min: 1 }));
    if (!s) throw notFound();
    offeringOr403(ctx.user, s.offering_id);
    return { session: s, records: db.all('SELECT student_id, present FROM attendance WHERE session_id = ?', s.id) };
  }, TEACH);

  api.post('/api/offerings/:id/attendance', (ctx) => {
    need(ctx.user, 'manage_attendance');
    const o = offeringOr403(ctx.user, ctx.params.id);
    const date = toDate(ctx.body.date, 'Date');
    if (date > new Date().toISOString().slice(0, 10)) throw bad('Attendance cannot be recorded for a future date.');
    const period = toInt(ctx.body.period ?? 1, 'Period', { min: 1, max: 12 });
    const topic = toStr(ctx.body.topic, 'Topic', { max: 200, optional: true });
    const absent = new Set((ctx.body.absent || []).map(Number));
    const roster = db.all(`SELECT s.id, s.first_name || ' ' || s.last_name AS name FROM course_registrations r JOIN students s ON s.id = r.student_id
      WHERE r.offering_id = ? AND r.status = 'Registered' AND s.active = 1`, o.id);
    const ids = new Set(roster.map((r) => r.id));
    for (const a of absent) if (!ids.has(a)) throw bad('One of the absent students is not registered in this course.');
    let changedIds = [];
    let sessionId;
    db.tx(() => {
      const existing = db.get('SELECT * FROM attendance_sessions WHERE offering_id = ? AND held_on = ? AND period = ?', o.id, date, period);
      if (existing) { sessionId = existing.id; db.run('UPDATE attendance_sessions SET topic = COALESCE(?, topic) WHERE id = ?', topic, sessionId); }
      else sessionId = Number(db.run('INSERT INTO attendance_sessions (college_id, offering_id, held_on, period, topic, created_by) VALUES (?,?,?,?,?,?)', o.college_id, o.id, date, period, topic, ctx.user.id).lastInsertRowid);
      const prev = new Map(db.all('SELECT student_id, present FROM attendance WHERE session_id = ?', sessionId).map((r) => [r.student_id, r.present]));
      for (const st of roster) {
        const p = absent.has(st.id) ? 0 : 1;
        if (prev.get(st.id) === p) continue;
        db.run('INSERT INTO attendance (college_id, session_id, offering_id, student_id, present) VALUES (?,?,?,?,?) ON CONFLICT(session_id, student_id) DO UPDATE SET present = excluded.present',
          o.college_id, sessionId, o.id, st.id, p);
        changedIds.push(st.id);
      }
      audit(ctx, { action: existing ? 'update' : 'create', entity: 'attendance', entityId: sessionId, collegeId: o.college_id,
        summary: `${existing ? 'Corrected' : 'Recorded'} attendance for ${o.name} on ${date} (period ${period}): ${roster.length - absent.size} present, ${absent.size} absent`,
        previous: existing ? { changed: changedIds.length } : null, next: { absent: [...absent].map((id) => roster.find((r) => r.id === id)?.name) } });
    });
    events.onAttendanceChanged({ offeringId: o.id, studentIds: changedIds });
    return { ok: true, sessionId, changed: changedIds.length };
  }, TEACH);

  // ----- analytics -----
  api.get('/api/offerings/:id/analytics', (ctx) => {
    const o = offeringOr403(ctx.user, ctx.params.id);
    const cfg = settings.forCollege(o.college_id);
    let roster = rosterWithStats(o);
    const assessments = db.all('SELECT * FROM assessments WHERE offering_id = ? ORDER BY sequence, id', o.id);
    if (ctx.query.risk) roster = roster.filter((s) => s.risk === ctx.query.risk);
    if (ctx.query.performance === 'low') roster = roster.filter((s) => s.performancePct !== null && s.performancePct < 50);
    if (ctx.query.performance === 'mid') roster = roster.filter((s) => s.performancePct !== null && s.performancePct >= 50 && s.performancePct < 75);
    if (ctx.query.performance === 'high') roster = roster.filter((s) => s.performancePct !== null && s.performancePct >= 75);
    const bins = (vals, edges) => edges.slice(0, -1).map((e, i) => ({ label: `${e}–${edges[i + 1]}`, count: vals.filter((v) => v >= e && (i === edges.length - 2 ? v <= edges[i + 1] : v < edges[i + 1])).length }));
    const attVals = roster.map((s) => s.attendancePct).filter((v) => v !== null);
    const focus = ctx.query.assessmentId ? assessments.find((a) => a.id === Number(ctx.query.assessmentId)) : assessments.filter((a) => a.kind !== 'assignment').slice(-1)[0];
    const markVals = focus ? roster.map((s) => s.marks[focus.id]).filter((v) => v !== null && v !== undefined).map((v) => (v / focus.max_marks) * 100) : [];
    const perAssessment = assessments.map((a) => {
      const v = roster.map((s) => s.marks[a.id]).filter((x) => x !== null && x !== undefined);
      return { id: a.id, name: a.name, kind: a.kind, max: a.max_marks, entered: v.length, avg: v.length ? r1(v.reduce((x, y) => x + y, 0) / v.length) : null, avgPct: v.length ? r1((v.reduce((x, y) => x + y, 0) / v.length / a.max_marks) * 100) : null };
    });
    const ids = roster.map((s) => s.id);
    const weekly = ids.length ? db.all(`SELECT MIN(s.held_on) AS week, AVG(a.present) * 100 AS pct FROM attendance a JOIN attendance_sessions s ON s.id = a.session_id
      WHERE a.offering_id = ? AND a.student_id IN (${ids.map(() => '?').join(',')}) GROUP BY strftime('%Y-%W', s.held_on) ORDER BY week`, o.id, ...ids).map((w) => ({ week: w.week, pct: r1(w.pct) })) : [];
    const perf = roster.map((s) => s.performancePct).filter((v) => v !== null);
    return {
      offering: o, threshold: cfg.attendance_threshold, count: roster.length, assessments,
      classAverage: perf.length ? r1(perf.reduce((a, b) => a + b, 0) / perf.length) : null,
      avgAttendance: attVals.length ? r1(attVals.reduce((a, b) => a + b, 0) / attVals.length) : null,
      belowThreshold: attVals.filter((v) => v < cfg.attendance_threshold).length,
      attendanceDistribution: bins(attVals, [0, 50, 65, cfg.attendance_threshold, 85, 100]),
      markDistribution: { assessment: focus ? focus.name : null, bins: bins(markVals, [0, 40, 50, 60, 75, 90, 100]) },
      assignmentPerformance: perAssessment.filter((a) => a.kind === 'assignment'), assessmentTrend: perAssessment,
      riskDistribution: ['Normal', 'Attention', 'High'].map((l) => ({ label: l, count: roster.filter((s) => s.risk === l).length })),
      atRisk: roster.filter((s) => s.risk !== 'Normal').sort((a, b) => (a.risk === b.risk ? (a.attendancePct ?? 100) - (b.attendancePct ?? 100) : a.risk === 'High' ? -1 : 1)),
      attendanceTrend: weekly,
    };
  }, TEACH);

  api.get('/api/staff/risk', (ctx) => {
    const ids = offeringsFor(ctx.user, { pageSize: 200 }).rows.map((o) => o.id);
    if (!ids.length) return { rows: [] };
    const where = [`ra.offering_id IN (${ids.map(() => '?').join(',')})`, 'ra.is_latest = 1'];
    const params = [...ids];
    if (ctx.query.level) { where.push('ra.level = ?'); params.push(ctx.query.level); } else where.push("ra.level != 'Normal'");
    const rows = db.all(`SELECT ra.level, ra.probability, ra.factors, ra.offering_id, s.id, s.roll_no, s.first_name || ' ' || s.last_name AS name, c.name AS course, c.code, sec.name AS section
      FROM risk_analysis ra JOIN students s ON s.id = ra.student_id JOIN course_offerings o ON o.id = ra.offering_id JOIN courses c ON c.id = o.course_id LEFT JOIN sections sec ON sec.id = o.section_id
      WHERE ${where.join(' AND ')} ORDER BY CASE ra.level WHEN 'High' THEN 0 WHEN 'Attention' THEN 1 ELSE 2 END, ra.probability DESC LIMIT 300`, ...params);
    return { rows: rows.map((r) => ({ ...r, factors: JSON.parse(r.factors).factors.slice(0, 3).map((f) => f.text), chips: JSON.parse(r.factors).factors.slice(0, 3).map(({ key, text }) => ({ key, text })) })) };
  }, TEACH);

  api.post('/api/offerings/:id/announce', (ctx) => {
    need(ctx.user, 'send_announcements');
    const o = offeringOr403(ctx.user, ctx.params.id);
    const title = toStr(ctx.body.title, 'Title', { max: 120 }); const body = toStr(ctx.body.body, 'Message', { max: 2000 });
    db.run('INSERT INTO announcements (university_id, college_id, offering_id, audience, title, body, created_by) VALUES (?,?,?,?,?,?,?)', o.university_id, o.college_id, o.id, 'students', title, body, ctx.user.id);
    const users = db.all("SELECT s.user_id FROM course_registrations r JOIN students s ON s.id = r.student_id WHERE r.offering_id = ? AND r.status = 'Registered'", o.id);
    for (const u of users) events.notify(u.user_id, o.college_id, { type: 'course', title: `${o.name}: ${title}`, body, link: '#/student/notifications' });
    audit(ctx, { action: 'create', entity: 'announcement', collegeId: o.college_id, summary: `Course announcement in ${o.name}: ${title}`, next: { recipients: users.length } });
    return { ok: true, recipients: users.length };
  }, TEACH);
};

module.exports.offeringOr403 = offeringOr403;
