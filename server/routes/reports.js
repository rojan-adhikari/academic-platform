// Printable reports: student academic report, department report, college report.
const db = require('../db');
const scope = require('../scope');
const settings = require('../settings');
const views = require('../views');
const { forbidden, notFound, toInt } = require('../lib');

const r1 = (x) => (x === null || x === undefined ? null : Math.round(x * 10) / 10);

function groupReport(whereSql, params, collegeIdForThreshold) {
  const students = db.all(`SELECT s.id, s.batch_id, s.department_id, s.college_id FROM students s WHERE s.active = 1 AND ${whereSql}`, ...params);
  const ids = JSON.stringify(students.map((s) => s.id));
  const weekly = db.all(`SELECT MIN(se.held_on) AS week, AVG(a.present) * 100 AS pct FROM attendance a JOIN attendance_sessions se ON se.id = a.session_id
    WHERE a.student_id IN (SELECT value FROM json_each(?)) GROUP BY strftime('%Y-%W', se.held_on) ORDER BY week`, ids).map((w) => ({ week: w.week, pct: r1(w.pct) }));
  const perf = db.all(`SELECT a.kind, a.sequence, a.name, AVG(m.marks * 100.0 / a.max_marks) AS pct FROM marks m JOIN assessments a ON a.id = m.assessment_id
    WHERE m.student_id IN (SELECT value FROM json_each(?)) GROUP BY a.sequence, a.name ORDER BY a.sequence`, ids).map((p) => ({ name: p.name, pct: r1(p.pct) }));
  const risk = db.all(`SELECT level, COUNT(*) n FROM risk_analysis WHERE is_latest = 1 AND offering_id IS NULL AND student_id IN (SELECT value FROM json_each(?)) GROUP BY level`, ids);
  const perStudentAtt = db.all(`SELECT a.student_id, a.offering_id, AVG(a.present) * 100 AS pct FROM attendance a WHERE a.student_id IN (SELECT value FROM json_each(?)) GROUP BY a.student_id, a.offering_id`, ids);
  const t = settings.forCollege(collegeIdForThreshold).attendance_threshold;
  const studentAvg = new Map();
  for (const r of perStudentAtt) { const x = studentAvg.get(r.student_id) || []; x.push(r.pct); studentAvg.set(r.student_id, x); }
  const avgs = [...studentAvg.values()].map((l) => l.reduce((a, b) => a + b, 0) / l.length);
  const edges = [0, 50, 65, t, 85, 100];
  const attendanceDistribution = edges.slice(0, -1).map((e, i) => ({ label: `${e}–${edges[i + 1]}%`, count: avgs.filter((v) => v >= e && (i === edges.length - 2 ? v <= edges[i + 1] : v < edges[i + 1])).length }));
  const subjects = db.all(`SELECT c.code, c.name, sec.name AS section, COUNT(DISTINCT m.student_id) AS students, AVG(m.marks * 100.0 / a.max_marks) AS avg_pct,
      (SELECT AVG(present) * 100 FROM attendance x WHERE x.offering_id = o.id) AS att,
      (SELECT COUNT(*) FROM risk_analysis ra WHERE ra.offering_id = o.id AND ra.is_latest = 1 AND ra.level = 'High') AS high
    FROM marks m JOIN assessments a ON a.id = m.assessment_id JOIN course_offerings o ON o.id = a.offering_id JOIN courses c ON c.id = o.course_id LEFT JOIN sections sec ON sec.id = o.section_id
    WHERE m.student_id IN (SELECT value FROM json_each(?)) GROUP BY o.id ORDER BY avg_pct`, ids).map((s) => ({ ...s, avg_pct: r1(s.avg_pct), att: r1(s.att) }));
  return { studentCount: students.length, attendanceTrend: weekly, performanceTrend: perf, riskDistribution: ['Normal', 'Attention', 'High'].map((l) => ({ label: l, count: risk.find((x) => x.level === l)?.n || 0 })),
    attendanceDistribution, threshold: t, subjects, belowThreshold: avgs.filter((v) => v < t).length, students };
}

module.exports = (api) => {
  api.get('/api/reports/student/:id', (ctx) => {
    let sid;
    if (ctx.user.role === 'student') sid = scope.studentRow(ctx.user)?.id; // students can only ever get their own report
    else sid = toInt(ctx.params.id, 'Student', { min: 1 });
    if (!sid || !scope.canAccessStudent(ctx.user, sid)) throw forbidden();
    const technical = ctx.user.role !== 'student';
    return { generatedAt: new Date().toISOString(), profile: views.studentProfile(sid), courses: views.studentCourses(sid), attendance: views.studentAttendance(sid),
      performance: views.studentPerformance(sid), risk: views.studentRisk(sid, { technical }) };
  });

  api.get('/api/reports/department/:id', (ctx) => {
    if (!scope.isAdmin(ctx.user) || !scope.can(ctx.user, 'view_analytics')) throw forbidden();
    const d = db.get('SELECT d.*, c.name AS college, un.name AS university FROM departments d JOIN colleges c ON c.id = d.college_id JOIN universities un ON un.id = c.university_id WHERE d.id = ?', toInt(ctx.params.id, 'Department', { min: 1 }));
    if (!d) throw notFound();
    if (!scope.canAccessCollege(ctx.user, d.college_id) || (ctx.user.role === 'department_admin' && ctx.user.department_id !== d.id)) throw forbidden();
    const g = groupReport('s.department_id = ?', [d.id], d.college_id);
    const batches = db.all('SELECT b.id, b.name, b.current_semester FROM batches b JOIN programmes p ON p.id = b.programme_id WHERE p.department_id = ?', d.id)
      .map((b) => ({ ...b, students: g.students.filter((s) => s.batch_id === b.id).length }));
    delete g.students;
    return { generatedAt: new Date().toISOString(), department: d, batches, ...g };
  });

  api.get('/api/reports/college/:id', (ctx) => {
    if (!scope.isAdmin(ctx.user) || !scope.can(ctx.user, 'view_analytics') || ctx.user.role === 'department_admin') throw forbidden();
    const c = db.get('SELECT c.*, un.name AS university FROM colleges c JOIN universities un ON un.id = c.university_id WHERE c.id = ?', toInt(ctx.params.id, 'College', { min: 1 }));
    if (!c) throw notFound();
    if (!scope.canAccessCollege(ctx.user, c.id)) throw forbidden();
    const g = groupReport('s.college_id = ?', [c.id], c.id);
    const departments = db.all('SELECT id, code, name FROM departments WHERE college_id = ? ORDER BY code', c.id).map((d) => {
      const ids = g.students.filter((s) => s.department_id === d.id).map((s) => s.id);
      const j = JSON.stringify(ids);
      const att = db.get('SELECT AVG(present) * 100 AS pct FROM attendance WHERE student_id IN (SELECT value FROM json_each(?))', j).pct;
      const risk = db.all("SELECT level, COUNT(*) n FROM risk_analysis WHERE is_latest = 1 AND offering_id IS NULL AND student_id IN (SELECT value FROM json_each(?)) GROUP BY level", j);
      return { ...d, students: ids.length, avgAttendance: r1(att), high: risk.find((x) => x.level === 'High')?.n || 0, attention: risk.find((x) => x.level === 'Attention')?.n || 0 };
    });
    delete g.students;
    return { generatedAt: new Date().toISOString(), college: c, departments, ...g };
  });
};
