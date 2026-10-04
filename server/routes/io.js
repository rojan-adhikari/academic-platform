// CSV import (validate first, then import all-or-nothing or valid rows only)
// and CSV export of scoped reports. Excel users save the sheet as CSV.
const db = require('../db');
const scope = require('../scope');
const settings = require('../settings');
const events = require('../engine/events');
const crud = require('./crud');
const { bad, forbidden, toInt, parseCsv, toCsv, audit, HttpError } = require('../lib');

const TEMPLATES = {
  students: { perm: 'manage_students', cols: ['roll_no', 'first_name', 'last_name', 'email', 'gender', 'department_code', 'programme_code', 'batch', 'section', 'regulation_code', 'current_semester'],
    example: ['25CSE199', 'Asha', 'Kumar', '25cse199@college.demo', 'Female', 'CSE', 'BE-CSE', '2025-2029', 'A', 'R2025', '3'] },
  staff: { perm: 'manage_staff', cols: ['employee_code', 'name', 'email', 'department_code', 'designation'], example: ['CS099', 'Dr. Example Name', 'cs099@college.demo', 'CSE', 'Assistant Professor'] },
  courses: { perm: 'manage_courses', cols: ['code', 'name', 'department_code', 'regulation_code', 'programme_code', 'semester_number', 'category', 'course_type', 'credits'],
    example: ['CS2499', 'Example Elective', 'CSE', 'R2025', 'BE-CSE', '4', 'Professional Elective', 'Theory', '3'] },
  registrations: { perm: 'manage_registrations', cols: ['roll_no', 'course_code', 'section'], example: ['25CSE101', 'CS2301', 'A'] },
  attendance: { perm: 'manage_attendance', cols: ['date', 'course_code', 'section', 'roll_no', 'status'], example: ['2026-10-01', 'CS2301', 'A', '25CSE101', 'P'] },
  marks: { perm: 'manage_marks', cols: ['course_code', 'section', 'assessment', 'roll_no', 'marks'], example: ['CS2301', 'A', 'Internal Assessment 1', '25CSE101', '21'] },
};

function lookupId(table, collegeId, col, value, label) {
  if (!value) return null;
  const r = db.get(`SELECT id FROM ${table} WHERE college_id = ? AND lower(${col}) = lower(?)`, collegeId, value);
  if (!r) throw new HttpError(400, `${label} "${value}" was not found in this college.`);
  return r.id;
}
function offeringFor(collegeId, courseCode, section, batchId) {
  const rows = db.all(`SELECT o.id, o.batch_id FROM course_offerings o JOIN courses c ON c.id = o.course_id LEFT JOIN sections s ON s.id = o.section_id
    WHERE o.college_id = ? AND lower(c.code) = lower(?) AND o.active = 1 ${section ? 'AND lower(s.name) = lower(?)' : ''} ${batchId ? 'AND o.batch_id = ?' : ''}`,
  collegeId, courseCode, ...(section ? [section] : []), ...(batchId ? [batchId] : []));
  if (!rows.length) throw new HttpError(400, `No active offering of ${courseCode}${section ? ` for section ${section}` : ''} exists.`);
  if (rows.length > 1) throw new HttpError(400, `${courseCode} has several offerings; add the section column.`);
  return rows[0].id;
}

function importRow(ctx, type, cid, r) {
  const sub = { ...ctx, body: {} };
  if (type === 'students') {
    const dep = lookupId('departments', cid, 'code', r.department_code, 'Department');
    const prog = lookupId('programmes', cid, 'code', r.programme_code, 'Programme');
    const batch = db.get('SELECT id, current_semester, regulation_id FROM batches WHERE college_id = ? AND programme_id = ? AND name = ?', cid, prog, r.batch);
    if (!batch) throw new HttpError(400, `Batch "${r.batch}" was not found for ${r.programme_code}.`);
    const sec = r.section ? db.get('SELECT id FROM sections WHERE batch_id = ? AND lower(name) = lower(?)', batch.id, r.section) : null;
    if (r.section && !sec) throw new HttpError(400, `Section "${r.section}" was not found in batch ${r.batch}.`);
    sub.body = { college_id: cid, roll_no: r.roll_no, first_name: r.first_name, last_name: r.last_name, email: r.email, gender: r.gender || null, department_id: dep, programme_id: prog,
      batch_id: batch.id, section_id: sec ? sec.id : null, regulation_id: r.regulation_code ? lookupId('regulations', cid, 'code', r.regulation_code, 'Regulation') : batch.regulation_id,
      current_semester: r.current_semester || batch.current_semester, active: 1 };
    return crud.create(sub, 'students');
  }
  if (type === 'staff') {
    sub.body = { college_id: cid, employee_code: r.employee_code, name: r.name, email: r.email, department_id: lookupId('departments', cid, 'code', r.department_code, 'Department'), designation: r.designation, active: 1 };
    return crud.create(sub, 'staff');
  }
  if (type === 'courses') {
    sub.body = { college_id: cid, code: r.code, name: r.name, department_id: lookupId('departments', cid, 'code', r.department_code, 'Department'),
      regulation_id: lookupId('regulations', cid, 'code', r.regulation_code, 'Regulation'), programme_id: lookupId('programmes', cid, 'code', r.programme_code, 'Programme'),
      semester_number: r.semester_number, category: r.category, course_type: r.course_type, credits: r.credits, active: 1 };
    return crud.create(sub, 'courses');
  }
  const st = db.get('SELECT id, batch_id FROM students WHERE college_id = ? AND lower(roll_no) = lower(?)', cid, r.roll_no);
  if (!st) throw new HttpError(400, `Student "${r.roll_no}" was not found in this college.`);
  if (type === 'registrations') {
    sub.body = { college_id: cid, student_id: st.id, offering_id: offeringFor(cid, r.course_code, r.section, st.batch_id), status: 'Registered' };
    return crud.create(sub, 'registrations');
  }
  const oid = offeringFor(cid, r.course_code, r.section, st.batch_id);
  if (!scope.canAccessOffering(ctx.user, oid)) throw forbidden();
  if (!db.get("SELECT 1 FROM course_registrations WHERE student_id = ? AND offering_id = ? AND status = 'Registered'", st.id, oid)) throw new HttpError(400, `${r.roll_no} is not registered for ${r.course_code}.`);
  if (type === 'attendance') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date || '')) throw new HttpError(400, 'Date must be YYYY-MM-DD.');
    if (r.date > new Date().toISOString().slice(0, 10)) throw new HttpError(400, 'Attendance cannot be recorded for a future date.');
    const status = String(r.status || '').trim().toUpperCase();
    if (!['P', 'A', 'PRESENT', 'ABSENT'].includes(status)) throw new HttpError(400, 'Status must be P or A.');
    let sess = db.get('SELECT id FROM attendance_sessions WHERE offering_id = ? AND held_on = ? AND period = 1', oid, r.date);
    if (!sess) sess = { id: Number(db.run('INSERT INTO attendance_sessions (college_id, offering_id, held_on, period, created_by) VALUES (?,?,?,1,?)', cid, oid, r.date, ctx.user.id).lastInsertRowid) };
    db.run('INSERT INTO attendance (college_id, session_id, offering_id, student_id, present) VALUES (?,?,?,?,?) ON CONFLICT(session_id, student_id) DO UPDATE SET present = excluded.present',
      cid, sess.id, oid, st.id, status.startsWith('P') ? 1 : 0);
    return { studentId: st.id, offeringId: oid };
  }
  if (type === 'marks') {
    const a = db.get('SELECT * FROM assessments WHERE offering_id = ? AND (lower(name) = lower(?) OR lower(short_name) = lower(?))', oid, r.assessment, r.assessment);
    if (!a) throw new HttpError(400, `Assessment "${r.assessment}" was not found in ${r.course_code}.`);
    const v = Number(r.marks);
    if (r.marks === '' || !Number.isFinite(v) || v < 0) throw new HttpError(400, 'Marks must be a positive number.');
    if (v > a.max_marks) throw new HttpError(400, `${v} / ${a.max_marks} is not valid. Marks cannot exceed the maximum.`);
    const prev = db.get('SELECT marks FROM marks WHERE assessment_id = ? AND student_id = ?', a.id, st.id);
    db.run(`INSERT INTO marks (college_id, assessment_id, student_id, marks, entry_method, updated_by, updated_at) VALUES (?,?,?,?, 'import', ?, datetime('now'))
      ON CONFLICT(assessment_id, student_id) DO UPDATE SET marks = excluded.marks, entry_method = 'import', updated_by = excluded.updated_by, updated_at = excluded.updated_at`, cid, a.id, st.id, v, ctx.user.id);
    audit(ctx, { action: prev ? 'update' : 'create', entity: 'marks', entityId: st.id, collegeId: cid, summary: `Imported mark for ${r.roll_no} in ${r.course_code} — ${a.name}`, previous: prev ? { marks: prev.marks } : null, next: { marks: v, max: a.max_marks } });
    return { studentId: st.id, assessment: a, isUpdate: !!prev, changed: !prev || prev.marks !== v };
  }
  throw bad('Unknown import type.');
}

function csvResponse(ctx, filename, headers, rows) {
  const body = '﻿' + toCsv(headers, rows);
  ctx.res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'no-store' });
  ctx.res.end(body);
  return { __raw: true };
}

module.exports = (api) => {
  const ADMIN = { roles: scope.ADMIN_ROLES };
  api.get('/api/admin/templates/:type', (ctx) => {
    const t = TEMPLATES[ctx.params.type];
    if (!t) throw bad('Unknown template.');
    return csvResponse(ctx, `${ctx.params.type}-template.csv`, t.cols, [Object.fromEntries(t.cols.map((c, i) => [c, t.example[i]]))]);
  }, ADMIN);

  api.post('/api/admin/import/:type', (ctx) => {
    const type = ctx.params.type; const t = TEMPLATES[type];
    if (!t) throw bad('Unknown import type.');
    if (!scope.can(ctx.user, t.perm) || !scope.can(ctx.user, 'import_export')) throw forbidden('Your role is not permitted to import this data.');
    const cid = toInt(ctx.body.collegeId || ctx.user.college_id, 'College', { min: 1 });
    if (!scope.canAccessCollege(ctx.user, cid)) throw forbidden();
    const { headers, records } = parseCsv(ctx.body.csv);
    if (!records.length) throw bad('The file has no data rows.');
    if (records.length > 5000) throw bad('Import at most 5,000 rows at a time.');
    const missing = t.cols.filter((c) => !headers.includes(c) && !['last_name', 'gender', 'section', 'designation', 'programme_code', 'regulation_code', 'current_semester'].includes(c));
    if (missing.length) throw bad(`Missing columns: ${missing.join(', ')}. Download the template for the expected format.`);
    const mode = ['validate', 'import', 'import_valid'].includes(ctx.body.mode) ? ctx.body.mode : 'validate';
    const results = []; const effects = [];
    const runAll = () => {
      for (const [i, r] of records.entries()) {
        try { db.tx(() => { effects.push(importRow(ctx, type, cid, r)); }); results.push({ row: i + 2, ok: true }); }
        catch (e) { results.push({ row: i + 2, ok: false, error: e instanceof HttpError ? e.message : /UNIQUE/.test(e.message) ? 'Duplicate: this record already exists.' : 'Invalid values in this row.' }); }
      }
    };
    const errors = () => results.filter((r) => !r.ok);
    if (mode === 'validate' || mode === 'import') {
      // Dry run inside a transaction that is always rolled back.
      try { events.mute(() => db.tx(() => { runAll(); throw new Error('__rollback__'); })); } catch (e) { if (e.message !== '__rollback__') throw e; }
      if (mode === 'validate' || errors().length) return { mode, imported: 0, total: records.length, valid: records.length - errors().length, errors: errors().slice(0, 200), committed: false };
      results.length = 0; effects.length = 0;
    }
    db.tx(() => runAll());
    // Downstream recalculation and notifications for academic data
    if (type === 'marks') {
      const byA = new Map();
      for (const e of effects.filter((x) => x && x.changed)) { const k = e.assessment.id; if (!byA.has(k)) byA.set(k, { a: e.assessment, created: [], updated: [] }); byA.get(k)[e.isUpdate ? 'updated' : 'created'].push(e.studentId); }
      for (const { a, created, updated } of byA.values()) {
        if (created.length) events.onMarksChanged({ assessment: a, studentIds: created, actor: ctx.user, isUpdate: false });
        if (updated.length) events.onMarksChanged({ assessment: a, studentIds: updated, actor: ctx.user, isUpdate: true });
      }
    }
    if (type === 'attendance') for (const e of effects) events.enqueue(() => events.reassess(e.studentId, 'attendance-import'));
    const imported = results.filter((r) => r.ok).length;
    audit(ctx, { action: 'import', entity: type, collegeId: cid, summary: `Imported ${imported} of ${records.length} ${type} rows from CSV`, next: { imported, failed: errors().length } });
    return { mode, imported, total: records.length, errors: errors().slice(0, 200), committed: true };
  }, ADMIN);

  api.get('/api/admin/export/:type', (ctx) => {
    if (!scope.can(ctx.user, 'import_export')) throw forbidden();
    const type = ctx.params.type;
    const f = scope.orgFilter(ctx.user, 's', { department: true });
    const where = ['s.active = 1', f.sql]; const params = [...f.params];
    if (ctx.query.collegeId) { const c = Number(ctx.query.collegeId); if (!scope.canAccessCollege(ctx.user, c)) throw forbidden(); where.push('s.college_id = ?'); params.push(c); }
    if (ctx.query.departmentId) { where.push('s.department_id = ?'); params.push(Number(ctx.query.departmentId)); }
    const W = where.join(' AND ');
    const stamp = new Date().toISOString().slice(0, 10);
    if (type === 'students') {
      const rows = db.all(`SELECT s.roll_no, s.first_name, s.last_name, u.email, s.gender, col.short_name AS college, d.code AS department, p.code AS programme, b.name AS batch, sec.name AS section,
        r.code AS regulation, s.current_semester, (SELECT level FROM risk_analysis ra WHERE ra.student_id = s.id AND ra.offering_id IS NULL AND ra.is_latest = 1) AS risk
        FROM students s JOIN users u ON u.id = s.user_id JOIN colleges col ON col.id = s.college_id JOIN departments d ON d.id = s.department_id JOIN programmes p ON p.id = s.programme_id
        JOIN batches b ON b.id = s.batch_id LEFT JOIN sections sec ON sec.id = s.section_id JOIN regulations r ON r.id = s.regulation_id WHERE ${W} ORDER BY col.short_name, s.roll_no`, ...params);
      return csvResponse(ctx, `students-${stamp}.csv`, ['roll_no', 'first_name', 'last_name', 'email', 'gender', 'college', 'department', 'programme', 'batch', 'section', 'regulation', 'current_semester', 'risk'], rows);
    }
    if (type === 'attendance') {
      const rows = db.all(`SELECT s.roll_no, s.first_name || ' ' || s.last_name AS name, col.short_name AS college, c.code AS course_code, c.name AS course, SUM(a.present) AS attended, COUNT(a.id) AS conducted,
          ROUND(SUM(a.present) * 100.0 / COUNT(a.id), 1) AS percentage, s.college_id
        FROM attendance a JOIN students s ON s.id = a.student_id JOIN colleges col ON col.id = s.college_id JOIN course_offerings o ON o.id = a.offering_id JOIN courses c ON c.id = o.course_id
        WHERE ${W} GROUP BY a.student_id, a.offering_id ORDER BY col.short_name, s.roll_no, c.code`, ...params)
        .map((r) => ({ ...r, threshold: settings.forCollege(r.college_id).attendance_threshold, status: r.percentage < settings.forCollege(r.college_id).attendance_threshold ? 'Below threshold' : 'OK' }));
      return csvResponse(ctx, `attendance-${stamp}.csv`, ['roll_no', 'name', 'college', 'course_code', 'course', 'attended', 'conducted', 'percentage', 'threshold', 'status'], rows);
    }
    if (type === 'marks') {
      const rows = db.all(`SELECT s.roll_no, s.first_name || ' ' || s.last_name AS name, col.short_name AS college, c.code AS course_code, c.name AS course, a.name AS assessment, a.kind, m.marks, a.max_marks, m.entry_method, m.updated_at
        FROM marks m JOIN assessments a ON a.id = m.assessment_id JOIN students s ON s.id = m.student_id JOIN colleges col ON col.id = s.college_id JOIN course_offerings o ON o.id = a.offering_id JOIN courses c ON c.id = o.course_id
        WHERE ${W} ORDER BY col.short_name, s.roll_no, c.code, a.sequence`, ...params);
      return csvResponse(ctx, `marks-${stamp}.csv`, ['roll_no', 'name', 'college', 'course_code', 'course', 'assessment', 'kind', 'marks', 'max_marks', 'entry_method', 'updated_at'], rows);
    }
    if (type === 'risk') {
      const rows = db.all(`SELECT s.roll_no, s.first_name || ' ' || s.last_name AS name, col.short_name AS college, d.code AS department, COALESCE(c.code, 'OVERALL') AS course_code, c.name AS course,
          ra.level, ra.factors, ra.model_version, ra.created_at
        FROM risk_analysis ra JOIN students s ON s.id = ra.student_id JOIN colleges col ON col.id = s.college_id JOIN departments d ON d.id = s.department_id
        LEFT JOIN course_offerings o ON o.id = ra.offering_id LEFT JOIN courses c ON c.id = o.course_id WHERE ra.is_latest = 1 AND ${W} ORDER BY col.short_name, s.roll_no, ra.offering_id IS NOT NULL, c.code`, ...params)
        .map((r) => ({ ...r, factors: JSON.parse(r.factors).factors.map((x) => x.text).join(' | ') }));
      return csvResponse(ctx, `risk-${stamp}.csv`, ['roll_no', 'name', 'college', 'department', 'course_code', 'course', 'level', 'factors', 'model_version', 'created_at'], rows);
    }
    if (type === 'departments' || type === 'colleges') {
      const key = type === 'departments' ? 'd.id' : 'col.id';
      const rows = db.all(`SELECT ${type === 'departments' ? "col.short_name AS college, d.code AS department, d.name AS name" : 'col.short_name AS college, col.name AS name'},
          COUNT(DISTINCT s.id) AS students,
          ROUND((SELECT AVG(a.present) * 100 FROM attendance a JOIN students s2 ON s2.id = a.student_id WHERE ${type === 'departments' ? 's2.department_id = d.id' : 's2.college_id = col.id'}), 1) AS avg_attendance,
          SUM(CASE WHEN (SELECT level FROM risk_analysis ra WHERE ra.student_id = s.id AND ra.offering_id IS NULL AND ra.is_latest = 1) = 'High' THEN 1 ELSE 0 END) AS high_risk,
          SUM(CASE WHEN (SELECT level FROM risk_analysis ra WHERE ra.student_id = s.id AND ra.offering_id IS NULL AND ra.is_latest = 1) = 'Attention' THEN 1 ELSE 0 END) AS attention
        FROM students s JOIN colleges col ON col.id = s.college_id JOIN departments d ON d.id = s.department_id WHERE ${W} GROUP BY ${key} ORDER BY college`, ...params);
      return csvResponse(ctx, `${type}-report-${stamp}.csv`, type === 'departments' ? ['college', 'department', 'name', 'students', 'avg_attendance', 'high_risk', 'attention'] : ['college', 'name', 'students', 'avg_attendance', 'high_risk', 'attention'], rows);
    }
    throw bad('Unknown export type.');
  }, ADMIN);
};
module.exports.TEMPLATES = TEMPLATES;
