// Administrator analytics, drill-down, risk monitoring, student 360 view,
// audit log, settings, permissions, model monitoring and announcements.
const db = require('../db');
const scope = require('../scope');
const settings = require('../settings');
const views = require('../views');
const events = require('../engine/events');
const risk = require('../engine/risk');
const { bad, forbidden, notFound, toInt, toStr, audit, paged } = require('../lib');

const ADMIN = { roles: scope.ADMIN_ROLES };
const r1 = (x) => (x === null || x === undefined || Number.isNaN(x) ? null : Math.round(x * 10) / 10);
function need(user, perm) { if (!scope.can(user, perm)) throw forbidden('Your role is not permitted to do this.'); }

// ---- cached aggregate maps (short TTL keeps dashboards fast on large datasets) ----
let cache = { at: 0 };
function maps() {
  if (Date.now() - cache.at < 4000) return cache;
  const so = db.all(`SELECT a.student_id, a.offering_id, SUM(a.present) AS p, COUNT(*) AS n FROM attendance a
    JOIN course_registrations r ON r.student_id = a.student_id AND r.offering_id = a.offering_id AND r.status = 'Registered' GROUP BY a.student_id, a.offering_id`);
  const perStudent = new Map();
  for (const r of so) {
    const x = perStudent.get(r.student_id) || { p: 0, n: 0, courses: [] };
    x.p += r.p; x.n += r.n; x.courses.push({ offering_id: r.offering_id, pct: (r.p / r.n) * 100 });
    perStudent.set(r.student_id, x);
  }
  const riskMap = new Map(db.all('SELECT student_id, level FROM risk_analysis WHERE is_latest = 1 AND offering_id IS NULL').map((r) => [r.student_id, r.level]));
  cache = { at: Date.now(), perStudent, riskMap };
  return cache;
}
function invalidateMaps() { cache = { at: 0 }; }

function stats(students) {
  const { perStudent, riskMap } = maps();
  let p = 0, n = 0, concern = 0, high = 0, attention = 0;
  for (const s of students) {
    const t = settings.forCollege(s.college_id).attendance_threshold;
    const a = perStudent.get(s.id);
    if (a) { p += a.p; n += a.n; if (a.courses.some((c) => c.pct < t)) concern++; }
    const lv = riskMap.get(s.id);
    if (lv === 'High') high++; else if (lv === 'Attention') attention++;
  }
  const c = students.length;
  return { students: c, avgAttendance: n ? r1((p / n) * 100) : null, attendanceConcern: concern, attendanceConcernPct: c ? r1((concern / c) * 100) : 0,
    highRisk: high, highRiskPct: c ? r1((high / c) * 100) : 0, attention };
}

function scopedStudents(user, extra = '', params = []) {
  const f = scope.orgFilter(user, 's', { department: true });
  return db.all(`SELECT s.id, s.college_id, s.department_id, s.programme_id, s.batch_id FROM students s WHERE s.active = 1 AND ${f.sql} ${extra}`, ...f.params, ...params);
}
function collegeFilter(ctx) {
  if (!ctx.query.collegeId) return { sql: '', params: [] };
  const cid = toInt(ctx.query.collegeId, 'College', { min: 1 });
  if (!scope.canAccessCollege(ctx.user, cid)) throw forbidden();
  return { sql: 'AND s.college_id = ?', params: [cid], cid };
}

module.exports = (api) => {
  api.get('/api/admin/dashboard', (ctx) => {
    const cf = collegeFilter(ctx);
    const students = scopedStudents(ctx.user, cf.sql, cf.params);
    const u = ctx.user;
    const org = scope.orgFilter(u, 't', { department: true });
    const orgNoDept = scope.orgFilter(u, 't');
    const cnt = (table, dept = false) => db.get(`SELECT COUNT(*) n FROM ${table} t WHERE t.active = 1 AND ${(dept ? org : orgNoDept).sql} ${cf.cid ? 'AND t.college_id = ?' : ''}`, ...(dept ? org : orgNoDept).params, ...(cf.cid ? [cf.cid] : [])).n;
    const totals = {
      ...stats(students), staff: cnt('staff', true), departments: u.role === 'department_admin' ? 1 : cnt('departments'), programmes: cnt('programmes', true), courses: cnt('courses', true),
      colleges: u.role === 'super_admin' || u.role === 'university_admin' ? db.get(`SELECT COUNT(*) n FROM colleges t WHERE t.active = 1 AND ${u.role === 'super_admin' ? '1=1' : 't.university_id = ?'}`, ...(u.role === 'super_admin' ? [] : [u.university_id])).n : 1,
      universities: u.role === 'super_admin' ? db.get('SELECT COUNT(*) n FROM universities WHERE active = 1').n : 1,
    };
    const of = scope.orgFilter(u, 'o');
    const deptSql = u.role === 'department_admin' ? 'AND c.department_id = ?' : '';
    const deptP = u.role === 'department_admin' ? [u.department_id] : [];
    const highRiskSubjects = db.all(`SELECT o.id, c.code, c.name, sec.name AS section, col.short_name AS college,
        SUM(CASE WHEN ra.level = 'High' THEN 1 ELSE 0 END) AS high, SUM(CASE WHEN ra.level = 'Attention' THEN 1 ELSE 0 END) AS attention, COUNT(*) AS total
      FROM risk_analysis ra JOIN course_offerings o ON o.id = ra.offering_id JOIN courses c ON c.id = o.course_id LEFT JOIN sections sec ON sec.id = o.section_id JOIN colleges col ON col.id = o.college_id
      WHERE ra.is_latest = 1 AND ${of.sql} ${deptSql} ${cf.cid ? 'AND o.college_id = ?' : ''} GROUP BY o.id ORDER BY (high * 2 + attention) * 1.0 / total DESC LIMIT 6`, ...of.params, ...deptP, ...(cf.cid ? [cf.cid] : []));
    const sf = scope.orgFilter(u, 's', { department: true });
    const highRiskStudents = db.all(`SELECT s.id, s.roll_no, s.first_name || ' ' || s.last_name AS name, col.short_name AS college, d.code AS department, ra.factors, ra.probability
      FROM risk_analysis ra JOIN students s ON s.id = ra.student_id JOIN colleges col ON col.id = s.college_id JOIN departments d ON d.id = s.department_id
      WHERE ra.is_latest = 1 AND ra.offering_id IS NULL AND ra.level = 'High' AND ${sf.sql} ${cf.sql} ORDER BY ra.probability DESC LIMIT 6`, ...sf.params, ...cf.params)
      .map((r) => ({ ...r, factors: undefined, top: JSON.parse(r.factors).factors[0]?.text || null }));
    const af = scope.orgFilter(u, 'al');
    const recentMarks = db.all(`SELECT al.summary, al.previous_value, al.new_value, al.user_name, al.role, al.created_at, al.entity_id FROM audit_logs al
      WHERE al.entity = 'marks' AND ${af.sql} ${cf.cid ? 'AND al.college_id = ?' : ''} ORDER BY al.id DESC LIMIT 6`, ...af.params, ...(cf.cid ? [cf.cid] : []));
    const nf = scope.orgFilter(u, 'n', { viaCollege: true });
    const recentAlerts = db.all(`SELECT n.title, n.body, n.severity, n.created_at, us.name AS student FROM notifications n JOIN users us ON us.id = n.user_id
      WHERE n.type IN ('attendance','risk') AND ${nf.sql} ${cf.cid ? 'AND n.college_id = ?' : ''} ${u.role === 'department_admin' ? 'AND us.department_id = ?' : ''} ORDER BY n.id DESC LIMIT 6`,
    ...nf.params, ...(cf.cid ? [cf.cid] : []), ...(u.role === 'department_admin' ? [u.department_id] : []));
    const ids = students.map((s) => s.id);
    const weekly = ids.length ? db.all(`SELECT MIN(s2.held_on) AS week, AVG(a.present) * 100 AS pct FROM attendance a JOIN attendance_sessions s2 ON s2.id = a.session_id
      WHERE a.student_id IN (SELECT value FROM json_each(?)) GROUP BY strftime('%Y-%W', s2.held_on) ORDER BY week`, JSON.stringify(ids)).map((w) => ({ week: w.week, pct: r1(w.pct) })) : [];
    // Comparison across colleges (multi-college scope) or departments (single college)
    let comparison;
    if (!cf.cid && (u.role === 'super_admin' || u.role === 'university_admin')) {
      const cols = db.all(`SELECT c.id, c.short_name, c.name, un.short_name AS university FROM colleges c JOIN universities un ON un.id = c.university_id WHERE c.active = 1 ${u.role === 'university_admin' ? 'AND c.university_id = ?' : ''} ORDER BY un.name, c.name`, ...(u.role === 'university_admin' ? [u.university_id] : []));
      comparison = { by: 'College', rows: cols.map((c) => ({ id: c.id, label: c.short_name, sub: c.university, ...stats(students.filter((s) => s.college_id === c.id)) })) };
    } else {
      const deps = db.all(`SELECT id, code, name FROM departments WHERE college_id = ? AND active = 1 ${u.role === 'department_admin' ? 'AND id = ?' : ''} ORDER BY code`, cf.cid || u.college_id, ...(u.role === 'department_admin' ? [u.department_id] : []));
      comparison = { by: 'Department', rows: deps.map((d) => ({ id: d.id, label: d.code, sub: d.name, ...stats(students.filter((s) => s.department_id === d.id)) })) };
    }
    const riskDist = ['Normal', 'Attention', 'High'].map((l) => ({ label: l, count: [...maps().riskMap.entries()].filter(([sid, lv]) => lv === l && ids.includes(sid)).length }));
    return { totals, highRiskSubjects, highRiskStudents, recentMarks, recentAlerts, weekly, comparison, riskDistribution: riskDist, jobsPending: events.pending() };
  }, ADMIN);

  // ---- institution overview: people, accounts, portals, requests (no academic data) ----
  api.get('/api/admin/overview', (ctx) => {
    const u = ctx.user;
    const cf = collegeFilter(ctx);
    const multi = !cf.cid && (u.role === 'super_admin' || u.role === 'university_admin');
    const of = scope.orgFilter(u, 't', { department: true });
    const where = (alias = 't') => `${of.sql.replaceAll('t.', alias + '.')} ${cf.cid ? `AND ${alias}.college_id = ?` : ''}`;
    const P = [...of.params, ...(cf.cid ? [cf.cid] : [])];
    const acct = (table) => db.get(`SELECT COUNT(*) AS total, SUM(t.active = 1) AS active, SUM(t.active = 0) AS inactive,
        SUM(t.active = 1 AND us.last_login_at >= datetime('now','-7 days')) AS recent, SUM(t.active = 1 AND us.last_login_at IS NULL) AS never
      FROM ${table} t JOIN users us ON us.id = t.user_id WHERE ${where('t')}`, ...P);
    const students = acct('students'), staff = acct('staff');
    const ofNoDept = scope.orgFilter(u, 't');
    const PN = [...ofNoDept.params, ...(cf.cid ? [cf.cid] : [])];
    const departments = u.role === 'department_admin' ? 1 : db.get(`SELECT COUNT(*) n FROM departments t WHERE t.active = 1 AND ${ofNoDept.sql} ${cf.cid ? 'AND t.college_id = ?' : ''}`, ...PN).n;
    const colleges = multi ? db.get(`SELECT COUNT(*) n FROM colleges t WHERE t.active = 1 ${u.role === 'university_admin' ? 'AND t.university_id = ?' : ''}`, ...(u.role === 'university_admin' ? [u.university_id] : [])).n : 1;
    const universities = u.role === 'super_admin' && !cf.cid ? db.get('SELECT COUNT(*) n FROM universities WHERE active = 1').n : 1;
    const sf = scope.orgFilter(u, 's', { department: true });
    const requests = scope.can(u, 'manage_registrations') ? db.get(`SELECT COUNT(*) n FROM course_registrations r JOIN students s ON s.id = r.student_id WHERE r.status = 'Pending' AND ${sf.sql} ${cf.sql}`, ...sf.params, ...cf.params).n : 0;
    // Breakdown: colleges for multi-college admins, otherwise departments.
    let breakdown;
    if (multi) {
      const cols = db.all(`SELECT c.id, c.short_name AS label, un.short_name AS sub, c.logo FROM colleges c JOIN universities un ON un.id = c.university_id WHERE c.active = 1 ${u.role === 'university_admin' ? 'AND c.university_id = ?' : ''} ORDER BY un.name, c.name`, ...(u.role === 'university_admin' ? [u.university_id] : []));
      const cnt = (table, key) => new Map(db.all(`SELECT ${key} AS k, COUNT(*) n FROM ${table} WHERE active = 1 GROUP BY ${key}`).map((r) => [r.k, r.n]));
      const st = cnt('students', 'college_id'), sa = cnt('staff', 'college_id'), dp = cnt('departments', 'college_id');
      breakdown = { by: 'College', rows: cols.map((c) => ({ id: c.id, label: c.label, sub: c.sub, logo: c.logo, students: st.get(c.id) || 0, staff: sa.get(c.id) || 0, departments: dp.get(c.id) || 0 })) };
    } else {
      const cid = cf.cid || u.college_id;
      const deps = db.all(`SELECT d.id, d.code AS label, d.name AS sub, (SELECT COUNT(*) FROM students s WHERE s.department_id = d.id AND s.active = 1) AS students,
          (SELECT COUNT(*) FROM staff t WHERE t.department_id = d.id AND t.active = 1) AS staff FROM departments d WHERE d.college_id = ? AND d.active = 1 ${u.role === 'department_admin' ? 'AND d.id = ?' : ''} ORDER BY d.code`, cid, ...(u.role === 'department_admin' ? [u.department_id] : []));
      breakdown = { by: 'Department', rows: deps };
    }
    // Recent administrative activity only (no marks or attendance changes).
    const af = scope.orgFilter(u, 'al');
    const activity = db.all(`SELECT al.action, al.entity, al.summary, al.user_name, al.created_at FROM audit_logs al
      WHERE al.entity NOT IN ('marks','attendance','attendance_session','assessment','assessments','session','classroom','classroom_post','classroom_submission') AND al.summary NOT LIKE '%attendance%' AND al.summary NOT LIKE '%marks%' AND ${af.sql} ${cf.cid ? 'AND al.college_id = ?' : ''} ORDER BY al.id DESC LIMIT 6`, ...af.params, ...(cf.cid ? [cf.cid] : []));
    const portalCid = cf.cid || u.college_id || 0;
    const portal = settings.forCollege(portalCid);
    const mods = (role) => settings.PORTAL_KEYS.filter((k) => k.startsWith(`portal_${role}_`) && !k.endsWith('_open'));
    const portals = ['student', 'staff'].map((role) => ({ role, open: !!portal[`portal_${role}_open`], on: mods(role).filter((k) => portal[k]).length, total: mods(role).length }));
    return { totals: { universities, colleges, departments, students: students.active || 0, staff: staff.active || 0 }, accounts: { students, staff }, requests, breakdown, activity, portals };
  }, ADMIN);

  // ---- portals: what the student and teacher portals offer, per scope ----
  const PORTAL_LABEL = { open: 'Portal sign-in', timetable: 'Timetable', classroom: 'Classroom', clubs: 'Clubs & events', voice: 'Voice mark entry', campus: 'Campus guide', assistant: 'nerd AI assistant' };
  api.get('/api/admin/portals', (ctx) => {
    const t = settingsTarget(ctx, ctx.query);
    let eff = { ...settings.DEFAULTS };
    if (t.type === 'college') eff = settings.forCollege(t.id);
    else for (const r of db.all(`SELECT key, value FROM settings WHERE scope_type = 'platform' ${t.type === 'university' ? "OR (scope_type = 'university' AND scope_id = ?)" : ''} ORDER BY scope_type = 'university'`, ...(t.type === 'university' ? [t.id] : []))) eff[r.key] = Number(r.value);
    const portals = ['student', 'staff'].map((role) => ({ role, items: settings.PORTAL_KEYS.filter((k) => k.startsWith(`portal_${role}_`)).map((k) => ({ key: k, label: PORTAL_LABEL[k.split('_')[2]], on: !!eff[k] })) }));
    return { scope: t, portals, editable: scope.can(ctx.user, 'manage_settings') };
  }, ADMIN);
  api.put('/api/admin/portals', (ctx) => {
    need(ctx.user, 'manage_settings');
    const t = settingsTarget(ctx, ctx.body);
    const key = String(ctx.body.key || ''), on = ctx.body.on ? 1 : 0;
    if (!settings.PORTAL_KEYS.includes(key)) throw bad('Unknown portal setting.');
    const prev = db.get('SELECT value FROM settings WHERE scope_type = ? AND scope_id = ? AND key = ?', t.type, t.id, key)?.value ?? null;
    db.run('INSERT INTO settings (scope_type, scope_id, key, value) VALUES (?,?,?,?) ON CONFLICT(scope_type, scope_id, key) DO UPDATE SET value = excluded.value', t.type, t.id, key, String(on));
    settings.invalidate();
    const [, role, feat] = key.split('_');
    audit(ctx, { action: 'update', entity: 'portal', entityId: t.id, collegeId: t.collegeId, universityId: t.type === 'university' ? t.id : null, summary: `${on ? 'Turned on' : 'Turned off'} ${PORTAL_LABEL[feat]} in the ${role === 'staff' ? 'teacher' : 'student'} portal`, previous: { value: prev }, next: { value: on } });
    return { ok: true };
  }, ADMIN);

  // ---- organisational drill-down ----
  api.get('/api/admin/drill', (ctx) => {
    const u = ctx.user;
    let level = ctx.query.level;
    let id = ctx.query.id;
    if (!level) {
      if (u.role === 'super_admin') level = 'platform';
      else if (u.role === 'university_admin') { level = 'university'; id = u.university_id; }
      else if (u.role === 'college_admin') { level = 'college'; id = u.college_id; }
      else { level = 'department'; id = u.department_id; }
    }
    const crumbs = [];
    const S = (extra, params) => scopedStudents(u, extra, params);
    const node = (lvl, nid, name, extra, params, sub) => ({ level: lvl, id: nid, name, sub, ...stats(S(extra, params)) });
    let children = [], childLevel = null, title = '';
    const assertCollege = (cid) => { if (!scope.canAccessCollege(u, cid)) throw forbidden(); };
    if (level === 'platform') {
      if (u.role !== 'super_admin') throw forbidden();
      title = 'All universities'; childLevel = 'university';
      children = db.all('SELECT id, name, short_name, active FROM universities ORDER BY name').map((x) => node('university', x.id, x.name, 'AND s.university_id = ?', [x.id], x.active ? null : 'Inactive'));
    } else if (level === 'university') {
      const un = db.get('SELECT * FROM universities WHERE id = ?', Number(id));
      if (!un || (u.role !== 'super_admin' && u.university_id !== un.id)) throw forbidden();
      title = un.name; childLevel = 'college';
      if (u.role === 'super_admin') crumbs.push({ level: 'platform', name: 'Platform' });
      let cols = db.all('SELECT id, name, short_name FROM colleges WHERE university_id = ? ORDER BY name', un.id);
      if (!['super_admin', 'university_admin'].includes(u.role)) cols = cols.filter((c) => c.id === u.college_id);
      children = cols.map((c) => node('college', c.id, c.name, 'AND s.college_id = ?', [c.id], c.short_name));
    } else if (level === 'college') {
      const c = db.get('SELECT c.*, un.name AS uname FROM colleges c JOIN universities un ON un.id = c.university_id WHERE c.id = ?', Number(id));
      if (!c) throw notFound(); assertCollege(c.id);
      title = c.name; childLevel = 'department';
      if (u.role === 'super_admin') crumbs.push({ level: 'platform', name: 'Platform' });
      if (['super_admin', 'university_admin'].includes(u.role)) crumbs.push({ level: 'university', id: c.university_id, name: c.uname });
      let deps = db.all('SELECT id, code, name FROM departments WHERE college_id = ? ORDER BY code', c.id);
      if (u.role === 'department_admin') deps = deps.filter((d) => d.id === u.department_id);
      children = deps.map((d) => node('department', d.id, d.name, 'AND s.department_id = ?', [d.id], d.code));
    } else if (level === 'department') {
      const d = db.get('SELECT d.*, c.name AS cname, c.university_id, un.name AS uname FROM departments d JOIN colleges c ON c.id = d.college_id JOIN universities un ON un.id = c.university_id WHERE d.id = ?', Number(id));
      if (!d) throw notFound(); assertCollege(d.college_id);
      if (u.role === 'department_admin' && d.id !== u.department_id) throw forbidden();
      title = d.name; childLevel = 'programme';
      if (u.role === 'super_admin') crumbs.push({ level: 'platform', name: 'Platform' });
      if (['super_admin', 'university_admin'].includes(u.role)) crumbs.push({ level: 'university', id: d.university_id, name: d.uname });
      if (u.role !== 'department_admin') crumbs.push({ level: 'college', id: d.college_id, name: d.cname });
      children = db.all('SELECT id, code, name FROM programmes WHERE department_id = ? ORDER BY name', d.id).map((p) => node('programme', p.id, p.name, 'AND s.programme_id = ?', [p.id], p.code));
    } else if (['programme', 'batch', 'semester', 'subject'].includes(level)) {
      let p, b, semNo, o;
      if (level === 'subject') {
        o = db.get('SELECT o.*, c.name AS cname, c.code, c.semester_number, sec.name AS section FROM course_offerings o JOIN courses c ON c.id = o.course_id LEFT JOIN sections sec ON sec.id = o.section_id WHERE o.id = ?', Number(id));
        if (!o || !scope.canAccessOffering(u, o.id)) throw forbidden();
        b = db.get('SELECT * FROM batches WHERE id = ?', o.batch_id); semNo = o.semester_number;
      } else if (level === 'semester') {
        const [bid, sn] = String(id).split(':').map(Number);
        b = db.get('SELECT * FROM batches WHERE id = ?', bid); semNo = sn;
      } else if (level === 'batch') b = db.get('SELECT * FROM batches WHERE id = ?', Number(id));
      if (b) p = db.get('SELECT * FROM programmes WHERE id = ?', b.programme_id);
      else if (level === 'programme') p = db.get('SELECT * FROM programmes WHERE id = ?', Number(id));
      if (!p) throw notFound(); assertCollege(p.college_id);
      if (u.role === 'department_admin' && p.department_id !== u.department_id) throw forbidden();
      const d = db.get('SELECT d.*, c.name AS cname, c.university_id, un.name AS uname FROM departments d JOIN colleges c ON c.id = d.college_id JOIN universities un ON un.id = c.university_id WHERE d.id = ?', p.department_id);
      if (u.role === 'super_admin') crumbs.push({ level: 'platform', name: 'Platform' });
      if (['super_admin', 'university_admin'].includes(u.role)) crumbs.push({ level: 'university', id: d.university_id, name: d.uname });
      if (u.role !== 'department_admin') crumbs.push({ level: 'college', id: d.college_id, name: d.cname });
      crumbs.push({ level: 'department', id: d.id, name: d.name });
      if (level === 'programme') {
        title = p.name; childLevel = 'batch';
        children = db.all('SELECT * FROM batches WHERE programme_id = ? ORDER BY start_year DESC', p.id).map((x) => node('batch', x.id, `Batch ${x.name}`, 'AND s.batch_id = ?', [x.id], `Semester ${x.current_semester}`));
      } else {
        crumbs.push({ level: 'programme', id: p.id, name: p.name });
        if (level === 'batch') {
          title = `Batch ${b.name}`; childLevel = 'semester';
          const sems = db.all('SELECT DISTINCT c.semester_number AS n FROM course_offerings o JOIN courses c ON c.id = o.course_id WHERE o.batch_id = ? ORDER BY n', b.id);
          children = sems.map((x) => node('semester', `${b.id}:${x.n}`, `Semester ${x.n}`, 'AND s.batch_id = ?', [b.id], x.n === b.current_semester ? 'Current' : null));
        } else {
          crumbs.push({ level: 'batch', id: b.id, name: `Batch ${b.name}` });
          if (level === 'semester') {
            title = `Semester ${semNo}`; childLevel = 'subject';
            const offs = db.all(`SELECT o.id, c.code, c.name, sec.name AS section FROM course_offerings o JOIN courses c ON c.id = o.course_id LEFT JOIN sections sec ON sec.id = o.section_id
              WHERE o.batch_id = ? AND c.semester_number = ? ORDER BY c.code, sec.name`, b.id, semNo);
            children = offs.map((x) => node('subject', x.id, `${x.code} ${x.name}`, "AND s.id IN (SELECT student_id FROM course_registrations WHERE offering_id = ? AND status = 'Registered')", [x.id], x.section ? `Section ${x.section}` : null));
          } else {
            crumbs.push({ level: 'semester', id: `${b.id}:${semNo}`, name: `Semester ${semNo}` });
            title = `${o.code} ${o.cname}${o.section ? ` · Section ${o.section}` : ''}`; childLevel = 'student';
            const { perStudent } = maps();
            const rows = db.all(`SELECT s.id, s.roll_no, s.first_name || ' ' || s.last_name AS name, s.college_id,
                (SELECT level FROM risk_analysis ra WHERE ra.student_id = s.id AND ra.offering_id = ? AND ra.is_latest = 1) AS risk,
                (SELECT COALESCE(SUM(present),0) * 100.0 / MAX(COUNT(*),1) FROM attendance a WHERE a.student_id = s.id AND a.offering_id = ?) AS att
              FROM course_registrations r JOIN students s ON s.id = r.student_id WHERE r.offering_id = ? AND r.status = 'Registered' ORDER BY s.roll_no`, o.id, o.id, o.id);
            children = rows.map((x) => ({ level: 'student', id: x.id, name: x.name, sub: x.roll_no, students: 1, avgAttendance: r1(x.att), courseRisk: x.risk || 'Normal', overallAttendance: perStudent.get(x.id) ? r1((perStudent.get(x.id).p / perStudent.get(x.id).n) * 100) : null }));
          }
        }
      }
    } else throw bad('Unknown level.');
    return { level, id, title, crumbs, childLevel, children };
  }, ADMIN);

  // ---- risk monitoring ----
  api.get('/api/admin/risk', (ctx) => {
    need(ctx.user, 'view_analytics');
    const cf = collegeFilter(ctx);
    const sf = scope.orgFilter(ctx.user, 's', { department: true });
    const where = ['ra.is_latest = 1', ctx.query.view === 'subject' ? 'ra.offering_id IS NOT NULL' : 'ra.offering_id IS NULL', sf.sql];
    const params = [...sf.params];
    if (cf.sql) { where.push('s.college_id = ?'); params.push(cf.cid); }
    if (ctx.query.level) { where.push('ra.level = ?'); params.push(ctx.query.level); } else where.push("ra.level != 'Normal'");
    if (ctx.query.departmentId) { where.push('s.department_id = ?'); params.push(Number(ctx.query.departmentId)); }
    if (ctx.query.q) { where.push("(lower(s.first_name || ' ' || s.last_name) LIKE ? OR lower(s.roll_no) LIKE ?)"); params.push(`%${ctx.query.q.toLowerCase()}%`, `%${ctx.query.q.toLowerCase()}%`); }
    const from = `FROM risk_analysis ra JOIN students s ON s.id = ra.student_id JOIN colleges col ON col.id = s.college_id JOIN departments d ON d.id = s.department_id
      JOIN batches b ON b.id = s.batch_id LEFT JOIN course_offerings o ON o.id = ra.offering_id LEFT JOIN courses c ON c.id = o.course_id WHERE ${where.join(' AND ')}`;
    const res = paged(`SELECT COUNT(*) n ${from}`, `SELECT ra.level, ra.probability, ra.factors, ra.created_at, ra.model_version, s.id, s.roll_no, s.first_name || ' ' || s.last_name AS name,
      col.short_name AS college, d.code AS department, b.name AS batch, c.code AS course_code, c.name AS course ${from}
      ORDER BY CASE ra.level WHEN 'High' THEN 0 WHEN 'Attention' THEN 1 ELSE 2 END, ra.probability DESC`, params, ctx.query);
    res.rows = res.rows.map((r) => ({ ...r, factors: JSON.parse(r.factors).factors.slice(0, 3).map((f) => f.text), chips: JSON.parse(r.factors).factors.slice(0, 3).map(({ key, text }) => ({ key, text })) }));
    return res;
  }, ADMIN);

  api.get('/api/admin/students/:id', (ctx) => {
    const sid = toInt(ctx.params.id, 'Student', { min: 1 });
    if (!scope.canAccessStudent(ctx.user, sid)) throw forbidden();
    const p = views.studentProfile(sid);
    const notifications = db.all('SELECT title, body, type, severity, is_read, created_at FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 15', p.user_id);
    const auditRows = db.all(`SELECT summary, previous_value, new_value, user_name, role, action, created_at, ip FROM audit_logs
      WHERE (entity IN ('marks') AND entity_id = ?) OR (entity IN ('students','course_registrations') AND (entity_id = ? OR summary LIKE ?)) ORDER BY id DESC LIMIT 25`, sid, sid, `%${p.roll_no}%`);
    return { profile: p, courses: views.studentCourses(sid, { includeDropped: true }), attendance: views.studentAttendance(sid), performance: views.studentPerformance(sid),
      risk: views.studentRisk(sid, { technical: true }), notifications, audit: auditRows };
  }, ADMIN);

  // ---- audit log ----
  api.get('/api/admin/audit', (ctx) => {
    need(ctx.user, 'view_audit');
    const f = scope.orgFilter(ctx.user, 'al');
    const where = [f.sql]; const params = [...f.params];
    if (ctx.query.entity) { where.push('al.entity = ?'); params.push(ctx.query.entity); }
    if (ctx.query.action) { where.push('al.action = ?'); params.push(ctx.query.action); }
    if (ctx.query.q) { where.push('(lower(al.summary) LIKE ? OR lower(al.user_name) LIKE ?)'); params.push(`%${ctx.query.q.toLowerCase()}%`, `%${ctx.query.q.toLowerCase()}%`); }
    const from = `FROM audit_logs al LEFT JOIN colleges c ON c.id = al.college_id WHERE ${where.join(' AND ')}`;
    const res = paged(`SELECT COUNT(*) n ${from}`, `SELECT al.*, c.short_name AS college ${from} ORDER BY al.id DESC`, params, ctx.query);
    res.entities = db.all(`SELECT DISTINCT entity FROM audit_logs al WHERE ${f.sql} ORDER BY entity`, ...f.params).map((r) => r.entity);
    return res;
  }, ADMIN);

  // ---- settings ----
  function settingsTarget(ctx, input) {
    const u = ctx.user;
    const level = input.scope || (u.role === 'super_admin' && !input.collegeId && !input.universityId ? 'platform' : input.collegeId ? 'college' : u.role === 'university_admin' ? 'university' : 'college');
    if (level === 'platform') { if (u.role !== 'super_admin') throw forbidden(); return { type: 'platform', id: 0, collegeId: null }; }
    if (level === 'university') {
      const uid = Number(input.universityId || u.university_id);
      if (u.role !== 'super_admin' && !(u.role === 'university_admin' && u.university_id === uid)) throw forbidden();
      return { type: 'university', id: uid, collegeId: null };
    }
    const cid = Number(input.collegeId || u.college_id);
    if (!cid || !scope.canAccessCollege(u, cid) || u.role === 'department_admin') throw forbidden();
    return { type: 'college', id: cid, collegeId: cid };
  }
  api.get('/api/admin/settings', (ctx) => {
    const t = settingsTarget(ctx, ctx.query);
    let effective = { ...settings.DEFAULTS };
    if (t.type === 'college') effective = settings.forCollege(t.id);
    else {
      const rows = db.all(`SELECT key, value FROM settings WHERE scope_type = 'platform' ${t.type === 'university' ? "OR (scope_type = 'university' AND scope_id = ?)" : ''} ORDER BY scope_type = 'university'`, ...(t.type === 'university' ? [t.id] : []));
      for (const r of rows) effective[r.key] = Number(r.value);
    }
    const own = new Set(db.all('SELECT key FROM settings WHERE scope_type = ? AND scope_id = ?', t.type, t.id).map((r) => r.key));
    return { scope: t, settings: Object.keys(settings.DEFAULTS).filter((k) => !settings.PORTAL_KEYS.includes(k)).map((k) => ({ key: k, value: effective[k], description: settings.DESCRIPTIONS[k], limits: settings.LIMITS[k], overridden: own.has(k) })) };
  }, ADMIN);
  api.put('/api/admin/settings', (ctx) => {
    need(ctx.user, 'manage_settings');
    const t = settingsTarget(ctx, ctx.body);
    const changes = ctx.body.values || {};
    const errors = [];
    for (const [k, v] of Object.entries(changes)) { const e = settings.validate(k, v); if (e) errors.push(`${k}: ${e}`); }
    if (errors.length) throw bad(errors.join('; '));
    const vals = { ...settings.forCollege(t.collegeId || 0), ...changes };
    if (Number(vals.risk_high_probability) <= Number(vals.risk_attention_probability)) throw bad('High-risk probability must be greater than the Attention probability.');
    const prev = {};
    db.tx(() => {
      for (const [k, v] of Object.entries(changes)) {
        prev[k] = db.get('SELECT value FROM settings WHERE scope_type = ? AND scope_id = ? AND key = ?', t.type, t.id, k)?.value ?? null;
        db.run('INSERT INTO settings (scope_type, scope_id, key, value) VALUES (?,?,?,?) ON CONFLICT(scope_type, scope_id, key) DO UPDATE SET value = excluded.value', t.type, t.id, k, String(Number(v)));
      }
    });
    settings.invalidate();
    audit(ctx, { action: 'update', entity: 'settings', entityId: t.id, collegeId: t.collegeId, universityId: t.type === 'university' ? t.id : null, summary: `Updated ${t.type} settings: ${Object.keys(changes).join(', ')}`, previous: prev, next: changes });
    // Thresholds affect predictions and risk: recompute in the background.
    const affected = t.type === 'platform' ? db.all('SELECT id FROM students WHERE active = 1') : t.type === 'university' ? db.all('SELECT id FROM students WHERE active = 1 AND university_id = ?', t.id) : db.all('SELECT id FROM students WHERE active = 1 AND college_id = ?', t.id);
    for (const s of affected) events.enqueue(() => risk.recomputeStudent(s.id, 'settings'));
    invalidateMaps();
    return { ok: true, recomputing: affected.length };
  }, ADMIN);

  // ---- permissions (configurable RBAC) ----
  api.get('/api/admin/permissions', (ctx) => {
    const roles = ['university_admin', 'college_admin', 'department_admin', 'staff', 'student'];
    return { roles: roles.map((r) => ({ role: r, label: scope.ROLE_LABEL[r] })), permissions: Object.entries(scope.PERMISSIONS).map(([k, label]) => ({ key: k, label })),
      grants: Object.fromEntries(roles.map((r) => [r, Object.keys(scope.PERMISSIONS).filter((p) => scope.can({ role: r }, p))])), editable: scope.can(ctx.user, 'manage_permissions') };
  }, ADMIN);
  api.put('/api/admin/permissions', (ctx) => {
    need(ctx.user, 'manage_permissions');
    const { role, permission, allowed } = ctx.body;
    if (!['university_admin', 'college_admin', 'department_admin', 'staff', 'student'].includes(role) || !scope.PERMISSIONS[permission]) throw bad('Unknown role or permission.');
    const prev = scope.can({ role }, permission);
    db.run('INSERT INTO role_permissions (role, permission, allowed) VALUES (?,?,?) ON CONFLICT(role, permission) DO UPDATE SET allowed = excluded.allowed', role, permission, allowed ? 1 : 0);
    scope.invalidatePermissions();
    audit(ctx, { action: 'update', entity: 'permissions', summary: `${allowed ? 'Granted' : 'Revoked'} "${scope.PERMISSIONS[permission]}" for ${scope.ROLE_LABEL[role]}`, previous: { allowed: prev }, next: { allowed: !!allowed } });
    return { ok: true };
  }, ADMIN);

  // ---- model monitoring ----
  api.get('/api/admin/model', (ctx) => {
    need(ctx.user, 'view_analytics');
    const m = risk.getModel();
    const sf = scope.orgFilter(ctx.user, 'ra', { viaCollege: true });
    const recent = db.all(`SELECT ra.created_at, ra.level, ra.probability, ra.trigger, ra.features, s.roll_no FROM risk_analysis ra JOIN students s ON s.id = ra.student_id
      WHERE ra.offering_id IS NOT NULL AND ${sf.sql} ORDER BY ra.id DESC LIMIT 12`, ...sf.params);
    const dist = db.all(`SELECT level, COUNT(*) n FROM risk_analysis ra WHERE ra.is_latest = 1 AND ra.offering_id IS NOT NULL AND ${sf.sql} GROUP BY level`, ...sf.params);
    return { version: m.version, datasetVersion: m.dataset_version, algorithm: m.algorithm, trainedAt: m.trained_at, metrics: m.metrics,
      features: risk.FEATURES.map((f, i) => ({ ...f, weight: +m.coef.w[i].toFixed(3) })), intercept: +m.coef.b.toFixed(3),
      recent: recent.map((r) => ({ ...r, features: JSON.parse(r.features) })), distribution: dist, totalPredictions: db.get(`SELECT COUNT(*) n FROM risk_analysis ra WHERE ${sf.sql}`, ...sf.params).n };
  }, ADMIN);

  api.post('/api/admin/risk/recompute', (ctx) => {
    need(ctx.user, 'view_analytics');
    const students = scopedStudents(ctx.user);
    for (const s of students) events.enqueue(() => events.reassess(s.id, 'manual-recompute'));
    audit(ctx, { action: 'run', entity: 'risk_analysis', summary: `Queued risk recomputation for ${students.length} students` });
    invalidateMaps();
    return { ok: true, queued: students.length };
  }, ADMIN);

  // ---- announcements ----
  api.get('/api/admin/announcements', (ctx) => {
    const f = scope.orgFilter(ctx.user, 'a');
    const sql = ctx.user.role === 'super_admin' ? '1=1' : ctx.user.role === 'university_admin' ? 'a.university_id = ?' : '(a.college_id = ? OR (a.college_id IS NULL AND a.university_id = ?))';
    const params = ctx.user.role === 'super_admin' ? [] : ctx.user.role === 'university_admin' ? [ctx.user.university_id] : [ctx.user.college_id, ctx.user.university_id];
    void f;
    return { rows: db.all(`SELECT a.*, u.name AS author, c.short_name AS college, co.name AS course FROM announcements a LEFT JOIN users u ON u.id = a.created_by LEFT JOIN colleges c ON c.id = a.college_id
      LEFT JOIN course_offerings o ON o.id = a.offering_id LEFT JOIN courses co ON co.id = o.course_id WHERE ${sql} ORDER BY a.created_at DESC LIMIT 100`, ...params) };
  }, ADMIN);
  api.post('/api/admin/announcements', (ctx) => {
    need(ctx.user, 'send_announcements');
    const title = toStr(ctx.body.title, 'Title', { max: 120 }); const body = toStr(ctx.body.body, 'Message', { max: 2000 });
    const audience = ['all', 'students', 'staff'].includes(ctx.body.audience) ? ctx.body.audience : 'all';
    let collegeId = ctx.body.collegeId ? Number(ctx.body.collegeId) : (ctx.user.college_id || null);
    if (collegeId && !scope.canAccessCollege(ctx.user, collegeId)) throw forbidden();
    const universityId = collegeId ? db.get('SELECT university_id FROM colleges WHERE id = ?', collegeId).university_id : ctx.user.university_id;
    if (!collegeId && !universityId) throw bad('Choose a college or university for this announcement.');
    db.run('INSERT INTO announcements (university_id, college_id, audience, title, body, created_by) VALUES (?,?,?,?,?,?)', universityId, collegeId, audience, title, body, ctx.user.id);
    const roles = audience === 'students' ? ['student'] : audience === 'staff' ? ['staff'] : ['student', 'staff'];
    let users = db.all(`SELECT id, college_id, department_id FROM users WHERE active = 1 AND role IN (${roles.map(() => '?').join(',')}) AND ${collegeId ? 'college_id = ?' : 'university_id = ?'}`, ...roles, collegeId || universityId);
    if (ctx.user.role === 'department_admin') users = users.filter((x) => x.department_id === ctx.user.department_id);
    events.enqueue(() => db.tx(() => { for (const x of users) events.notify(x.id, x.college_id, { type: 'admin', title, body, link: null }); }));
    audit(ctx, { action: 'create', entity: 'announcement', collegeId, universityId, summary: `Announcement "${title}" sent to ${users.length} users`, next: { audience } });
    return { ok: true, recipients: users.length };
  }, ADMIN);

  // ---- institution logo: upload an official logo that replaces the generated crest everywhere ----
  const LOGO_MIME = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/svg+xml': 'svg' };
  api.post('/api/admin/institution-logo', (ctx) => {
    const fs = require('fs'); const path = require('path');
    const level = ctx.body.level === 'university' ? 'university' : 'college';
    const id = toInt(ctx.body.id, 'Institution', { min: 1 });
    const inst = level === 'university' ? db.get('SELECT id, code FROM universities WHERE id = ?', id) : db.get('SELECT id, code FROM colleges WHERE id = ?', id);
    if (!inst) throw notFound('Institution not found.');
    if (level === 'university') { if (!(ctx.user.role === 'super_admin' || (ctx.user.role === 'university_admin' && ctx.user.university_id === id))) throw forbidden('You cannot change this university.'); }
    else if (!scope.canAccessCollege(ctx.user, id)) throw forbidden('You cannot change this college.');
    const m = /^data:(image\/(?:png|jpeg|webp|svg\+xml));base64,([A-Za-z0-9+/=]+)$/.exec(String(ctx.body.image || ''));
    if (!m) throw bad('Upload a PNG, JPEG, WebP or SVG image.');
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length < 40 || buf.length > 2_000_000) throw bad('Upload a valid image under 2 MB.');
    const ext = LOGO_MIME[m[1]];
    const base = String(inst.code).toLowerCase().replace(/[^a-z0-9_-]/g, '');
    const dir = path.join(__dirname, '..', '..', 'public', 'assets', 'logos');
    fs.mkdirSync(dir, { recursive: true });
    for (const e of ['png', 'jpg', 'jpeg', 'webp', 'svg']) { if (e !== ext) try { fs.unlinkSync(path.join(dir, `${base}.${e}`)); } catch { /* none */ } }
    fs.writeFileSync(path.join(dir, `${base}.${ext}`), buf);
    const url = `/assets/logos/${base}.${ext}`;
    db.run(`UPDATE ${level === 'university' ? 'universities' : 'colleges'} SET logo = ? WHERE id = ?`, url, id);
    audit(ctx, { action: 'update', entity: level, entityId: id, summary: `Uploaded an official logo for ${inst.code}`, [level === 'university' ? 'universityId' : 'collegeId']: id });
    return { ok: true, logo: url };
  }, { roles: scope.ADMIN_ROLES, limit: 4 * 1024 * 1024 });
  api.del('/api/admin/institution-logo', (ctx) => {
    const fs = require('fs'); const path = require('path');
    const level = ctx.query.level === 'university' ? 'university' : 'college';
    const id = toInt(ctx.query.id, 'Institution', { min: 1 });
    const inst = level === 'university' ? db.get('SELECT id, code FROM universities WHERE id = ?', id) : db.get('SELECT id, code FROM colleges WHERE id = ?', id);
    if (!inst) throw notFound('Institution not found.');
    if (level === 'university') { if (!(ctx.user.role === 'super_admin' || (ctx.user.role === 'university_admin' && ctx.user.university_id === id))) throw forbidden(); }
    else if (!scope.canAccessCollege(ctx.user, id)) throw forbidden();
    const base = String(inst.code).toLowerCase().replace(/[^a-z0-9_-]/g, '');
    const dir = path.join(__dirname, '..', '..', 'public', 'assets', 'logos');
    for (const e of ['png', 'jpg', 'jpeg', 'webp', 'svg']) try { fs.unlinkSync(path.join(dir, `${base}.${e}`)); } catch { /* none */ }
    db.run(`UPDATE ${level === 'university' ? 'universities' : 'colleges'} SET logo = NULL WHERE id = ?`, id);
    return { ok: true };
  }, ADMIN);

  // ---- people, organised by college then department (university portal) ----
  api.get('/api/admin/people', (ctx) => {
    const ids = scope.collegeIds(ctx.user);
    if (!ids.length) return { colleges: [] };
    const ph = ids.map(() => '?').join(',');
    const deptWhere = ctx.user.role === 'department_admin' ? 'AND d.id = ?' : '';
    const deptParam = ctx.user.role === 'department_admin' ? [ctx.user.department_id] : [];
    const depts = db.all(`SELECT d.id, d.name, d.code, d.college_id,
        (SELECT COUNT(*) FROM students s WHERE s.department_id = d.id AND s.active = 1) AS students,
        (SELECT COUNT(*) FROM staff st WHERE st.department_id = d.id AND st.active = 1) AS staff
      FROM departments d WHERE d.college_id IN (${ph}) ${deptWhere} ORDER BY d.name`, ...ids, ...deptParam);
    const byCollege = new Map();
    for (const d of depts) { if (!byCollege.has(d.college_id)) byCollege.set(d.college_id, []); byCollege.get(d.college_id).push(d); }
    const colleges = db.all(`SELECT c.id, c.name, c.short_name, c.accent, u.name AS university, u.short_name AS university_short
      FROM colleges c JOIN universities u ON u.id = c.university_id WHERE c.id IN (${ph}) ORDER BY u.id, c.name`, ...ids)
      .map((c) => { const ds = byCollege.get(c.id) || []; return { ...c, departments: ds, students: ds.reduce((s, x) => s + x.students, 0), staff: ds.reduce((s, x) => s + x.staff, 0) }; })
      .filter((c) => c.departments.length);
    return { colleges, scope: ctx.user.role };
  }, ADMIN);

  api.get('/api/admin/people/department/:id', (ctx) => {
    const id = toInt(ctx.params.id, 'Department', { min: 1 });
    const d = db.get('SELECT id, college_id, name FROM departments WHERE id = ?', id);
    if (!d || !scope.canAccessCollege(ctx.user, d.college_id) || (ctx.user.role === 'department_admin' && id !== ctx.user.department_id)) throw forbidden();
    const students = db.all(`SELECT s.id, s.roll_no, (s.first_name || ' ' || s.last_name) AS name, s.current_semester, sec.name AS section
      FROM students s LEFT JOIN sections sec ON sec.id = s.section_id WHERE s.department_id = ? AND s.active = 1 ORDER BY s.roll_no`, id);
    const staff = db.all(`SELECT st.id, st.employee_code, u.name, st.designation FROM staff st JOIN users u ON u.id = st.user_id
      WHERE st.department_id = ? AND st.active = 1 ORDER BY u.name`, id);
    return { department: d.name, students, staff };
  }, ADMIN);

  // ---- course registration approvals ----
  api.get('/api/admin/registrations', (ctx) => {
    need(ctx.user, 'manage_registrations');
    const f = scope.orgFilter(ctx.user, 's', { department: true });
    const cf = collegeFilter(ctx);
    const rows = db.all(`SELECT r.id, r.status, r.registered_at, s.roll_no, (s.first_name || ' ' || s.last_name) AS student,
        d.name AS department, sec.name AS section, c.code, c.name AS course, c.credits, col.short_name AS college
      FROM course_registrations r JOIN students s ON s.id = r.student_id
      JOIN course_offerings o ON o.id = r.offering_id JOIN courses c ON c.id = o.course_id
      LEFT JOIN sections sec ON sec.id = o.section_id JOIN departments d ON d.id = s.department_id JOIN colleges col ON col.id = r.college_id
      WHERE r.status = 'Pending' AND ${f.sql} ${cf.sql} ORDER BY r.registered_at ASC`, ...f.params, ...cf.params);
    return { rows };
  }, ADMIN);

  function decideRegistration(ctx, approve) {
    need(ctx.user, 'manage_registrations');
    const id = toInt(ctx.params.id, 'Registration', { min: 1 });
    const r = db.get(`SELECT r.*, s.first_name, s.last_name, s.roll_no, s.department_id, s.user_id AS student_user, c.code, c.name AS course
      FROM course_registrations r JOIN students s ON s.id = r.student_id JOIN course_offerings o ON o.id = r.offering_id JOIN courses c ON c.id = o.course_id WHERE r.id = ?`, id);
    if (!r) throw notFound('Registration request not found.');
    if (!scope.canAccessCollege(ctx.user, r.college_id) || (ctx.user.role === 'department_admin' && r.department_id !== ctx.user.department_id)) throw forbidden();
    if (r.status !== 'Pending') throw bad('That request has already been decided.');
    if (approve) db.run("UPDATE course_registrations SET status = 'Registered' WHERE id = ?", id);
    else db.run('DELETE FROM course_registrations WHERE id = ?', id);
    events.enqueue(() => events.notify(r.student_user, r.college_id, { type: 'registration', severity: approve ? 'success' : 'info',
      title: approve ? 'Course registration approved' : 'Course registration declined',
      body: `${r.code} ${r.course} ${approve ? 'has been added to your courses.' : 'was not approved. Contact your department office if this is unexpected.'}`, link: '#/student/courses' }));
    audit(ctx, { action: approve ? 'approve' : 'reject', entity: 'course_registration', entityId: id, collegeId: r.college_id, summary: `${approve ? 'Approved' : 'Declined'} ${r.first_name} ${r.last_name} (${r.roll_no}) for ${r.code} ${r.course}` });
    return { ok: true };
  }
  api.post('/api/admin/registrations/:id/approve', (ctx) => decideRegistration(ctx, true), ADMIN);
  api.post('/api/admin/registrations/:id/reject', (ctx) => decideRegistration(ctx, false), ADMIN);

  api.get('/api/admin/scope', (ctx) => {
    const u = ctx.user;
    const colleges = db.all(`SELECT c.id, c.name, c.short_name, c.university_id, un.short_name AS university FROM colleges c JOIN universities un ON un.id = c.university_id
      WHERE ${u.role === 'super_admin' ? '1=1' : u.role === 'university_admin' ? 'c.university_id = ?' : 'c.id = ?'} ORDER BY un.name, c.name`, ...(u.role === 'super_admin' ? [] : [u.role === 'university_admin' ? u.university_id : u.college_id]));
    return { colleges, universities: u.role === 'super_admin' ? db.all('SELECT id, name, short_name FROM universities ORDER BY name') : db.all('SELECT id, name, short_name FROM universities WHERE id = ?', u.university_id) };
  }, ADMIN);
};
module.exports.invalidateMaps = invalidateMaps;
