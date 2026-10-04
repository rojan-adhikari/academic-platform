// Read models assembled from the central source of truth. Used by the student
// portal, staff views, the admin student profile and reports alike, so every
// portal shows the same numbers.
const db = require('./db');
const settings = require('./settings');
const att = require('./engine/attendance');

const r1 = (x) => Math.round(x * 10) / 10;

function studentProfile(studentId) {
  return db.get(`SELECT s.id, s.roll_no, s.first_name, s.last_name, s.gender, s.current_semester, s.active, s.user_id,
      u.email, u.name, un.id AS university_id, un.name AS university, c.id AS college_id, c.name AS college, c.short_name AS college_short,
      d.id AS department_id, d.name AS department, d.code AS department_code, p.id AS programme_id, p.name AS programme, p.degree_type,
      r.id AS regulation_id, r.code AS regulation, b.id AS batch_id, b.name AS batch, sec.id AS section_id, sec.name AS section,
      (SELECT name FROM academic_years WHERE college_id = s.college_id AND is_current = 1) AS academic_year,
      (SELECT term FROM semesters WHERE college_id = s.college_id AND is_current = 1) AS term,
      (SELECT name FROM semesters WHERE college_id = s.college_id AND is_current = 1) AS semester_name
    FROM students s JOIN users u ON u.id = s.user_id JOIN universities un ON un.id = s.university_id JOIN colleges c ON c.id = s.college_id
    JOIN departments d ON d.id = s.department_id JOIN programmes p ON p.id = s.programme_id JOIN regulations r ON r.id = s.regulation_id
    JOIN batches b ON b.id = s.batch_id LEFT JOIN sections sec ON sec.id = s.section_id WHERE s.id = ?`, studentId);
}

function studentCourses(studentId, { includeDropped = false } = {}) {
  return db.all(`SELECT r.id AS registration_id, r.status, r.registered_at, o.id AS offering_id, c.id AS course_id, c.code, c.name, c.category,
      c.course_type, c.credits, c.semester_number, st.employee_code AS faculty_code, fu.name AS faculty_name, sec.name AS section
    FROM course_registrations r JOIN course_offerings o ON o.id = r.offering_id JOIN courses c ON c.id = o.course_id
    LEFT JOIN staff st ON st.id = o.staff_id LEFT JOIN users fu ON fu.id = st.user_id LEFT JOIN sections sec ON sec.id = o.section_id
    WHERE r.student_id = ? ${includeDropped ? '' : "AND r.status != 'Dropped'"} ORDER BY c.code`, studentId);
}

function studentAttendance(studentId) {
  const s = db.get('SELECT college_id FROM students WHERE id = ?', studentId);
  const cfg = settings.forCollege(s.college_id);
  const courses = studentCourses(studentId).filter((c) => c.status === 'Registered');
  let A = 0, C = 0;
  const list = courses.map((c) => {
    const a = att.forStudentOffering(studentId, c.offering_id, cfg.risk_recent_window);
    A += a.attended; C += a.conducted;
    const p = att.predict(a.attended, a.conducted, cfg.attendance_threshold, cfg.attendance_recovery_target, cfg.attendance_attention_buffer);
    return { offering_id: c.offering_id, code: c.code, name: c.name, faculty: c.faculty_name, ...p, recentPct: a.recentPct,
      trend: a.recentPct === null ? 'Stable' : a.recentPct < p.percentage - 5 ? 'Declining' : a.recentPct > p.percentage + 5 ? 'Improving' : 'Stable',
      series: a.series.map((x) => x.pct), history: a.series.slice(-20).reverse().map((x) => ({ date: x.date, present: x.present })) };
  });
  const overall = att.predict(A, C, cfg.attendance_threshold, cfg.attendance_recovery_target, cfg.attendance_attention_buffer);
  // Weekly overall attendance for the trend chart
  const weekly = db.all(`SELECT strftime('%Y-%W', s.held_on) AS wk, MIN(s.held_on) AS start, AVG(a.present) * 100 AS pct
    FROM attendance a JOIN attendance_sessions s ON s.id = a.session_id JOIN course_registrations r ON r.offering_id = a.offering_id AND r.student_id = a.student_id
    WHERE a.student_id = ? AND r.status = 'Registered' GROUP BY wk ORDER BY wk`, studentId).map((w) => ({ week: w.start, pct: r1(w.pct) }));
  return { threshold: cfg.attendance_threshold, overall, courses: list, weekly };
}

function studentPerformance(studentId) {
  const courses = studentCourses(studentId).filter((c) => c.status === 'Registered');
  const out = courses.map((c) => {
    const rows = db.all(`SELECT a.id, a.name, a.short_name, a.kind, a.max_marks, a.weight, a.sequence, a.held_on, a.due_on, m.marks, m.updated_at,
        (SELECT AVG(m2.marks) FROM marks m2 WHERE m2.assessment_id = a.id) AS class_avg
      FROM assessments a LEFT JOIN marks m ON m.assessment_id = a.id AND m.student_id = ?
      WHERE a.offering_id = ? AND a.published = 1 ORDER BY a.sequence, a.id`, studentId, c.offering_id);
    const scored = rows.filter((r) => r.marks !== null);
    const w = scored.reduce((s, r) => s + r.weight, 0);
    const pct = w ? scored.reduce((s, r) => s + (r.marks / r.max_marks) * 100 * r.weight, 0) / w : null;
    const byKind = (k) => { const l = scored.filter((r) => (k === 'assignment' ? r.kind === 'assignment' : k === 'lab' ? r.kind === 'lab' : !['assignment', 'lab'].includes(r.kind))); return l.length ? r1(l.reduce((s, r) => s + (r.marks / r.max_marks) * 100, 0) / l.length) : null; };
    const series = scored.map((r) => r1((r.marks / r.max_marks) * 100));
    const trend = series.length < 2 ? 'Not enough data' : series[series.length - 1] < series.slice(0, -1).reduce((a, b) => a + b, 0) / (series.length - 1) - 5 ? 'Declining'
      : series[series.length - 1] > series.slice(0, -1).reduce((a, b) => a + b, 0) / (series.length - 1) + 5 ? 'Improving' : 'Stable';
    return { offering_id: c.offering_id, code: c.code, name: c.name, credits: c.credits, course_type: c.course_type,
      overallPct: pct === null ? null : r1(pct), internalPct: byKind('internal'), assignmentPct: byKind('assignment'), labPct: byKind('lab'), trend, series,
      assessments: rows.map((r) => ({ ...r, pct: r.marks === null ? null : r1((r.marks / r.max_marks) * 100), class_avg: r.class_avg === null ? null : r1(r.class_avg) })) };
  });
  const history = db.all('SELECT semester_number, sgpa, attendance_pct, credits_earned FROM academic_history WHERE student_id = ? ORDER BY semester_number', studentId);
  const withPct = out.filter((c) => c.overallPct !== null);
  const totalCredits = withPct.reduce((s, c) => s + c.credits, 0);
  const current = totalCredits ? r1(withPct.reduce((s, c) => s + c.overallPct * c.credits, 0) / totalCredits) : null;
  return { courses: out, history, currentPct: current, previousSgpa: history.length ? history[history.length - 1].sgpa : null,
    cgpa: history.length ? r1(history.reduce((s, h) => s + h.sgpa, 0) / history.length * 100) / 100 : null };
}

// At-a-glance numbers behind a course's risk level (the student's own data, never the model probability).
function riskSignals(f) {
  const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? r1(v) : null);
  return {
    attendance: f.conducted === 0 ? null : n(f.attPct), attendanceRecent: n(f.attRecentPct), threshold: f.threshold ?? null,
    attended: f.attended ?? null, conducted: f.conducted ?? null, safeMisses: f.safeMisses ?? null, classesToRecover: f.classesToRecover ?? null,
    tests: f.hasAssess === 0 ? null : n(f.assessPct), testsTrend: n(f.assessTrend),
    assignments: f.hasAssign === 0 ? null : n(f.assignPct), assignmentsTrend: n(f.assignTrend),
    sgpa: n(f.prevSgpa), sgpaTrend: n(f.prevTrend),
  };
}

function studentRisk(studentId, { technical = false } = {}) {
  const rows = db.all(`SELECT r.*, c.code, c.name FROM risk_analysis r LEFT JOIN course_offerings o ON o.id = r.offering_id LEFT JOIN courses c ON c.id = o.course_id
    WHERE r.student_id = ? AND r.is_latest = 1 ORDER BY c.code`, studentId);
  const map = (r) => {
    const f = JSON.parse(r.factors);
    const out = { offering_id: r.offering_id, code: r.code, name: r.name, level: r.level, factors: f.factors, positives: f.positives, rules: f.rules, recommendations: f.recommendations, assessedAt: r.created_at };
    if (r.offering_id !== null) out.signals = riskSignals(JSON.parse(r.features || '{}'));
    if (technical) Object.assign(out, { probability: r.probability, features: JSON.parse(r.features), modelVersion: r.model_version, datasetVersion: r.dataset_version, trigger: r.trigger });
    return out;
  };
  const overall = rows.find((r) => r.offering_id === null);
  const history = db.all(`SELECT level, created_at, trigger FROM risk_analysis WHERE student_id = ? AND offering_id IS NULL ORDER BY id DESC LIMIT 10`, studentId);
  return { overall: overall ? map(overall) : null, courses: rows.filter((r) => r.offering_id !== null).map(map), history };
}

module.exports = { studentProfile, studentCourses, studentAttendance, studentPerformance, studentRisk };
