// Voice sheets: Excel-style grids that staff fill by voice. A sheet can be blank or built from a course
// (roster rows, one column per assessment, plus Total / Average formula columns).
const db = require('../db');
const scope = require('../scope');
const { bad, notFound, forbidden, audit } = require('../lib');

const ROLES = ['staff', 'department_admin', 'college_admin', 'university_admin', 'super_admin'];
const MAX_ROWS = 500, MAX_COLS = 40;

function own(ctx, id) {
  const s = db.get('SELECT * FROM voice_sheets WHERE id = ?', Number(id));
  if (!s) throw notFound('Sheet not found.');
  if (s.owner_id !== ctx.user.id) throw forbidden('This sheet belongs to someone else.');
  return s;
}
const out = (s) => ({ id: s.id, title: s.title, offeringId: s.offering_id, columns: JSON.parse(s.columns), rows: JSON.parse(s.rows), updatedAt: s.updated_at, createdAt: s.created_at });

function validSheet(b) {
  const title = String(b.title || '').trim();
  if (!title || title.length > 120) throw bad('Give the sheet a title (up to 120 characters).');
  const cols = b.columns;
  if (!Array.isArray(cols) || !cols.length || cols.length > MAX_COLS) throw bad(`A sheet needs 1 to ${MAX_COLS} columns.`);
  for (const c of cols) {
    if (!c || typeof c.header !== 'string' || !c.header.trim() || c.header.length > 60) throw bad('Every column needs a header (up to 60 characters).');
    if (!['text', 'number', 'formula'].includes(c.type)) throw bad('Column type must be text, number or formula.');
    if (c.max !== undefined && c.max !== null && !(Number.isFinite(c.max) && c.max > 0 && c.max <= 10000)) throw bad(`Check the maximum for "${c.header}".`);
  }
  const rows = b.rows;
  if (!Array.isArray(rows) || rows.length > MAX_ROWS) throw bad(`A sheet can have up to ${MAX_ROWS} rows.`);
  for (const r of rows) if (!Array.isArray(r) || r.length > cols.length || r.some((v) => v !== null && typeof v !== 'string' && typeof v !== 'number')) throw bad('The sheet contains invalid cells.');
  return { title, columns: JSON.stringify(cols), rows: JSON.stringify(rows) };
}

module.exports = (api) => {
  api.get('/api/sheets', (ctx) => db.all(`SELECT s.id, s.title, s.offering_id AS offeringId, s.updated_at AS updatedAt, json_array_length(s.rows) AS rowCount,
      c.name AS course, c.code AS courseCode FROM voice_sheets s LEFT JOIN course_offerings o ON o.id = s.offering_id LEFT JOIN courses c ON c.id = o.course_id
      WHERE s.owner_id = ? ORDER BY s.updated_at DESC`, ctx.user.id), { roles: ROLES });

  api.post('/api/sheets', (ctx) => {
    const b = ctx.body;
    let sheet;
    if (b.offeringId) {
      const o = db.get(`SELECT o.*, c.name AS course, c.code, sec.name AS section FROM course_offerings o JOIN courses c ON c.id = o.course_id LEFT JOIN sections sec ON sec.id = o.section_id WHERE o.id = ?`, Number(b.offeringId));
      if (!o || !scope.canAccessOffering(ctx.user, o.id)) throw forbidden('You cannot build a sheet from this course.');
      const assessments = db.all('SELECT id, name, short_name, max_marks FROM assessments WHERE offering_id = ? ORDER BY sequence, id', o.id);
      const students = db.all(`SELECT s.id, s.roll_no, s.first_name || ' ' || s.last_name AS name FROM course_registrations r JOIN students s ON s.id = r.student_id
        WHERE r.offering_id = ? AND r.status = 'Registered' ORDER BY s.roll_no`, o.id);
      const marks = new Map(db.all('SELECT assessment_id, student_id, marks FROM marks m JOIN assessments a ON a.id = m.assessment_id WHERE a.offering_id = ?', o.id).map((m) => [`${m.assessment_id}:${m.student_id}`, m.marks]));
      const columns = [{ header: 'Name', type: 'text' }, { header: 'Roll', type: 'text' },
        ...assessments.map((a) => ({ header: a.short_name || a.name, type: 'number', max: a.max_marks, assessmentId: a.id, title: a.name })),
        { header: 'Total', type: 'formula' }, { header: 'Avg', type: 'formula' }];
      const rows = students.map((s) => [s.name, s.roll_no, ...assessments.map((a) => marks.get(`${a.id}:${s.id}`) ?? null), null, null]);
      // Row order is fixed at creation; meta.studentIds maps each row back to its student for posting marks.
      sheet = { title: String(b.title || `${o.code} ${o.course}${o.section ? ` · Section ${o.section}` : ""}`).slice(0, 120), offering_id: o.id, columns: JSON.stringify(columns), rows: JSON.stringify(rows), meta: JSON.stringify({ studentIds: students.map((s) => s.id) }) };
    } else {
      const headers = Array.isArray(b.headers) && b.headers.length ? b.headers : ['Name', 'Roll', 'Physics', 'Chemistry', 'Math', 'English', 'History', 'Total', 'Avg'];
      const columns = headers.slice(0, MAX_COLS).map((h) => {
        const header = String(h).trim().slice(0, 60);
        const k = header.toLowerCase();
        return /^(total|sum|avg|average|mean|max|min|count|percentage|percent|((sample|population) )?(variance|var|sd|s\.d\.?|std|stdev|std\.? dev\.?|std deviation|standard deviation))$/.test(k) ? { header, type: 'formula' } : /^(name|roll|roll no|roll number|register number|reg no|remarks?)$/.test(k) ? { header, type: 'text' } : { header, type: 'number', max: 100 };
      });
      const n = Math.max(1, Math.min(MAX_ROWS, Number(b.rowCount) || 20));
      sheet = { title: String(b.title || 'Untitled sheet').slice(0, 120), offering_id: null, columns: JSON.stringify(columns), rows: JSON.stringify(Array.from({ length: n }, () => columns.map(() => null))), meta: '{}' };
    }
    validSheet({ title: sheet.title, columns: JSON.parse(sheet.columns), rows: JSON.parse(sheet.rows) });
    const r = db.run('INSERT INTO voice_sheets (college_id, owner_id, offering_id, title, columns, rows, meta) VALUES (?,?,?,?,?,?,?)', ctx.user.college_id, ctx.user.id, sheet.offering_id, sheet.title, sheet.columns, sheet.rows, sheet.meta);
    return out(db.get('SELECT * FROM voice_sheets WHERE id = ?', Number(r.lastInsertRowid)));
  }, { roles: ROLES });

  api.get('/api/sheets/:id', (ctx) => {
    const s = own(ctx, ctx.params.id);
    const o = out(s);
    o.studentIds = JSON.parse(s.meta || '{}').studentIds || [];
    return o;
  }, { roles: ROLES });

  api.put('/api/sheets/:id', (ctx) => {
    const s = own(ctx, ctx.params.id);
    const v = validSheet(ctx.body);
    db.run("UPDATE voice_sheets SET title = ?, columns = ?, rows = ?, updated_at = datetime('now') WHERE id = ?", v.title, v.columns, v.rows, s.id);
    return out(db.get('SELECT * FROM voice_sheets WHERE id = ?', s.id));
  }, { roles: ROLES, limit: 3 * 1024 * 1024 });

  api.del('/api/sheets/:id', (ctx) => {
    const s = own(ctx, ctx.params.id);
    db.run('DELETE FROM voice_sheets WHERE id = ?', s.id);
    audit(ctx, { action: 'delete', entity: 'voice_sheet', entityId: s.id, summary: `Deleted voice sheet "${s.title}"` });
    return { ok: true };
  }, { roles: ROLES });
};
