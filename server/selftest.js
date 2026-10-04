// End-to-end API self-test: demo flow, validation and tenant isolation.
// Runs against a throwaway copy of the database. Usage: npm test
const path = require('path');
const fs = require('fs');
const os = require('os');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'nerd-selftest-'));
process.env.DB_PATH = path.join(TMP, 'selftest.db');
for (const ext of ['', '-wal', '-shm']) { try { fs.unlinkSync(process.env.DB_PATH + ext); } catch { /* none */ } }
const { server } = require('./index');
const db = require('./db');

let base; let passed = 0; let failed = 0;
function check(name, cond, extra) { if (cond) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name}`, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : ''); } }

function client() {
  let cookie = ''; let csrf = '';
  const call = async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie, 'X-CSRF-Token': csrf }, body: body ? JSON.stringify(body) : undefined });
    const sc = res.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('json') ? await res.json() : await res.text();
    return { status: res.status, data };
  };
  return {
    call,
    async login(collegeCode, type, loginId) {
      const c = db.get('SELECT id FROM colleges WHERE code = ?', collegeCode);
      const r = await call('POST', '/api/auth/login', { collegeId: c.id, type, loginId, password: '123456' });
      if (r.status === 200) { const me = await call('GET', '/api/auth/me'); csrf = me.data.csrf; }
      return r;
    },
  };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
  console.log('Self-test against', base);

  const pub = client();
  const unis = await pub.call('GET', '/api/public/universities?q=anna');
  check('university search finds Anna University', unis.data.rows.length === 1 && unis.data.rows[0].code === 'AU');

  // Stage 2-3: professor + voice entry
  const prof = client();
  check('professor login', (await prof.login('KPRIET', 'staff', 'CS014')).status === 200);
  check('professor cannot log in through another college', (await client().login('PSGCT', 'staff', 'CS014')).status === 401);
  const dash = await prof.call('GET', '/api/staff/dashboard');
  const ds = dash.data.offerings.find((o) => o.code === 'CS2301' && o.section === 'A');
  check('professor sees Data Structures section A', !!ds, dash.data.offerings.map((o) => o.code));
  const parse = await prof.call('POST', `/api/offerings/${ds.id}/voice/parse`, { transcript: 'Rojan Adhikari scored 21 out of 25.' });
  const e = parse.data.entries[0];
  check('voice parse identifies Rojan and IA1, ready to confirm, not saved', e.student.status === 'matched' && e.marks.value === 21 && e.readyToConfirm && !e.autoSaved, e);
  const amb = await prof.call('POST', `/api/offerings/${ds.id}/voice/parse`, { transcript: 'Rahul scored 23 out of 25 in Internal One' });
  check('voice parse flags two Rahuls', amb.data.entries[0].student.status === 'ambiguous' && amb.data.entries[0].student.candidates.length === 2);
  const rollSpoken = await prof.call('POST', `/api/offerings/${ds.id}/voice/parse`, { transcript: 'twenty five C S three two four scored 20 out of 25' });
  check('voice parse reads a spelled-out roll number (25 C S 3 2 4)', rollSpoken.data.entries[0].student.status === 'matched' && rollSpoken.data.entries[0].student.candidates[0].roll_no === '25CS324' && rollSpoken.data.entries[0].marks.value === 20, rollSpoken.data.entries[0]);
  const over = await prof.call('POST', '/api/marks', { assessmentId: e.assessment.selectedId, entries: [{ studentId: e.student.selectedId, marks: 28 }], method: 'voice' });
  check('28 / 25 rejected', over.status === 400, over.data);
  const before = db.get('SELECT level FROM risk_analysis WHERE student_id = ? AND offering_id = ? AND is_latest = 1', e.student.selectedId, ds.id).level;
  const save = await prof.call('POST', '/api/marks', { assessmentId: e.assessment.selectedId, entries: [{ studentId: e.student.selectedId, marks: 21 }], method: 'voice' });
  check('confirmed voice mark saved', save.status === 200 && save.data.created === 1, save.data);
  await wait(300);

  // Stage 4-7: student
  const stu = client();
  check('student login', (await stu.login('KPRIET', 'student', '25CS324')).status === 200);
  const sd = await stu.call('GET', '/api/student/dashboard');
  check('student sees "New marks available"', sd.data.notifications.some((n) => n.title === 'New marks available' && /Internal Assessment 1/.test(n.body)), sd.data.notifications.map((n) => n.title));
  const risk = await stu.call('GET', '/api/student/risk');
  const dsr = risk.data.courses.find((c) => c.code === 'CS2301');
  check(`risk recalculated (${before} -> ${dsr.level}) with explanation`, dsr.level === 'High' && dsr.factors.some((f) => /assessment performance decreased/i.test(f.text)) && dsr.factors.some((f) => /declining/i.test(f.text)), dsr);
  check('student risk has no raw probability', dsr.probability === undefined);
  const satt = await stu.call('GET', '/api/student/attendance');
  const dsa = satt.data.courses.find((c) => c.code === 'CS2301');
  check(`attendance prediction present (${dsa.percentage}%: ${dsa.message})`, typeof dsa.missesToFallBelow === 'number' && dsa.status === 'Attention');
  check('student cannot open staff endpoints', (await stu.call('GET', `/api/offerings/${ds.id}`)).status === 403);
  check('student cannot open admin endpoints', (await stu.call('GET', '/api/admin/dashboard')).status === 403);
  const other = db.get("SELECT s.id FROM students s JOIN colleges c ON c.id = s.college_id WHERE c.code = 'PSGCT' LIMIT 1");
  check("student report ignores another student's id", (await stu.call('GET', `/api/reports/student/${other.id}`)).data.profile.roll_no === '25CS324');

  // Stage 8: admin
  const adm = client();
  check('college admin login', (await adm.login('KPRIET', 'admin', 'kpriet.admin')).status === 200);
  const prof360 = await adm.call('GET', `/api/admin/students/${e.student.selectedId}`);
  check('admin sees updated mark, risk and audit history', prof360.status === 200 && prof360.data.audit.some((a) => /via voice entry/.test(a.summary)) && prof360.data.risk.courses.some((c) => c.code === 'CS2301' && c.level === 'High'));

  // An admin action (publishing a campus event) must be visible in the student portal.
  const evKprId = db.get("SELECT id FROM colleges WHERE code='KPRIET'").id;
  const evGuide = await adm.call('GET', `/api/campus/${evKprId}`);
  const evData = evGuide.data.data;
  const evId = 'selftest-ev-' + Date.now();
  const evVenue = (evData.nodes.find((n) => n.kind !== 'junction') || evData.nodes[0]).id;
  evData.events.push({ id: evId, title: 'Self-test Open Day', venue: evVenue, time: '11:00 AM', instructions: 'Verification event.', registrationOpen: true, startsAt: new Date(Date.now() + 5 * 864e5).toISOString(), endsAt: new Date(Date.now() + 5 * 864e5 + 72e5).toISOString() });
  const evPub = await adm.call('PUT', `/api/campus/${evKprId}`, { data: evData, baseVersion: evData.version });
  check('admin publishes a new campus event', evPub.status === 200 && evPub.data.events.some((x) => x.id === evId), evPub.data && evPub.data.error);
  await wait(300);
  const sdEv = await stu.call('GET', '/api/student/dashboard');
  check('published event appears in the student portal', (sdEv.data.campusEvents || []).some((x) => x.title === 'Self-test Open Day'), sdEv.data.campusEvents);
  check('student is notified of the new campus event', sdEv.data.notifications.some((n) => n.type === 'event' && /Self-test Open Day/.test(n.title)), sdEv.data.notifications.map((n) => n.title));
  // Student registers for the event; it must show as registered and be visible to the admin.
  const reg = await stu.call('POST', '/api/student/events/register', { eventId: evId });
  check('student registers for the event', reg.status === 200 && reg.data.status === 'registered', reg.data);
  const sdReg = await stu.call('GET', '/api/student/dashboard');
  check('event shows as registered in the student portal', (sdReg.data.campusEvents || []).some((x) => x.id === evId && x.registered), sdReg.data.campusEvents);
  const parts = await adm.call('GET', `/api/campus/${evKprId}/participations`);
  check('admin sees the registered student', Array.isArray(parts.data) && parts.data.some((p) => p.eventId === evId && /Rojan/.test(p.name)), parts.data && parts.data.slice(0, 2));
  const dup = await stu.call('POST', '/api/student/events/register', { eventId: evId });
  check('duplicate registration is a no-op', dup.data.status === 'already_registered', dup.data);
  const otherStudent = await adm.call('GET', `/api/admin/students/${other.id}`);
  check('KPRIET admin blocked from PSG Tech student (URL tampering)', otherStudent.status === 403);
  const otherOffering = db.get("SELECT o.id FROM course_offerings o JOIN colleges c ON c.id = o.college_id WHERE c.code = 'PSGCT' LIMIT 1");
  check('KPRIET admin blocked from PSG Tech offering', (await adm.call('GET', `/api/offerings/${otherOffering.id}`)).status === 403);
  check('professor blocked from offering they do not teach', (await prof.call('GET', `/api/offerings/${otherOffering.id}`)).status === 403);
  const listStudents = await adm.call('GET', '/api/admin/entities/students?college_id=' + db.get("SELECT id FROM colleges WHERE code='PSGCT'").id);
  check('KPRIET admin list filtered to own college even with foreign college filter', listStudents.data.total === 0);
  const nietId = db.get("SELECT id FROM colleges WHERE code='KPRIET'").id; const nceId = db.get("SELECT id FROM colleges WHERE code='PSGCT'").id;
  const nceDept = db.get('SELECT id FROM departments WHERE college_id = ? LIMIT 1', nceId).id;
  const badCreate = await adm.call('POST', '/api/admin/entities/programmes', { college_id: nceId, department_id: nceDept, code: 'X1', name: 'Bad', degree_type: 'UG', duration_years: 4 });
  check('KPRIET admin cannot create records in PSG Tech', badCreate.status === 403, badCreate.data);
  const crossRef = await adm.call('POST', '/api/admin/entities/programmes', { department_id: nceDept, code: 'X2', name: 'Bad ref', degree_type: 'UG', duration_years: 4 });
  check('cross-college reference rejected', crossRef.status === 400, crossRef.data);
  const okCreate = await adm.call('POST', '/api/admin/entities/departments', { code: 'CHEM', name: 'Chemical Engineering' });
  check('admin creates a department', okCreate.status === 200, okCreate.data);
  const dash2 = await adm.call('GET', '/api/admin/dashboard');
  check('admin dashboard totals', dash2.status === 200 && dash2.data.totals.students > 0, dash2.data.totals);
  const drill = await adm.call('GET', '/api/admin/drill');
  check('drill-down starts at college', drill.data.level === 'college' && drill.data.children.length >= 6);
  const audit = await adm.call('GET', '/api/admin/audit?entity=marks');
  check('audit log has the voice mark', audit.data.rows.some((r) => /via voice entry/.test(r.summary)));
  const exp = await adm.call('GET', '/api/admin/export/risk');
  check('risk export is CSV', typeof exp.data === 'string' && exp.data.includes('roll_no'));
  const csv = 'roll_no,first_name,last_name,email,gender,department_code,programme_code,batch,section,regulation_code,current_semester\n25CSE150,Test,Student,t150@kpriet.nerd.local,Female,CSE,BE-CSE,2025-2029,A,R2025,3\n25CSE151,Bad,Row,not-an-email,Male,CSE,BE-CSE,2025-2029,A,R2025,3';
  const val = await adm.call('POST', '/api/admin/import/students', { csv, mode: 'validate' });
  check('import validation catches bad row and commits nothing', val.data.valid === 1 && val.data.errors.length === 1 && !db.get("SELECT 1 FROM students WHERE roll_no = '25CSE150'"), val.data);
  const imp = await adm.call('POST', '/api/admin/import/students', { csv, mode: 'import_valid' });
  check('import valid rows', imp.data.imported === 1, imp.data);
  const setRes = await adm.call('PUT', '/api/admin/settings', { values: { attendance_threshold: 120 } });
  check('invalid threshold rejected', setRes.status === 400);
  const noCsrf = await fetch(base + '/api/admin/entities/departments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  check('unauthenticated write rejected', noCsrf.status === 401);

  // Department admin and university admin scope
  const dep = client(); await dep.login('KPRIET', 'admin', 'kpriet.cse.admin');
  const depStudents = await dep.call('GET', '/api/admin/entities/students?pageSize=100');
  check('department admin sees only CSE students', depStudents.data.rows.every((r) => r.department === 'CSE'));
  const uni = client(); await uni.login('PSGCT', 'admin', 'au.admin');
  const uniDash = await uni.call('GET', '/api/admin/dashboard');
  check('university admin compares colleges', uniDash.data.comparison.by === 'College' && uniDash.data.comparison.rows.length === 7, uniDash.data.comparison);
  const mru = db.get("SELECT s.id FROM students s JOIN colleges c ON c.id = s.college_id WHERE c.code = 'IITM' LIMIT 1");
  check('university admin blocked from another university', (await uni.call('GET', `/api/admin/students/${mru.id}`)).status === 403);
  const sup = client(); await sup.login('IITM', 'admin', 'superadmin');
  check('super admin drill starts at platform', (await sup.call('GET', '/api/admin/drill')).data.level === 'platform');
  const search = await adm.call('GET', '/api/search?q=rojan');
  check('global search finds student', search.data.groups.some((g) => g.label === 'Students'));

  // Attendance -> alert
  const today = new Date().toISOString().slice(0, 10);
  const attRes = await prof.call('POST', `/api/offerings/${ds.id}/attendance`, { date: today, absent: [e.student.selectedId] });
  check('attendance recorded', attRes.status === 200, attRes.data);
  await wait(300);
  const n2 = await stu.call('GET', '/api/notifications?type=attendance');
  check('attendance alert sent', n2.data.rows.length > 0, n2.data.rows.map((r) => r.title));

  // Notification lifecycle: read -> leaves dashboard, filed under Read by category -> delete
  const nid = n2.data.rows[0].id;
  await stu.call('POST', `/api/notifications/${nid}/read`, {});
  const dashAfter = await stu.call('GET', '/api/student/dashboard');
  check('read notification leaves dashboard', !dashAfter.data.notifications.some((n) => n.id === nid) && dashAfter.data.notifications.every((n) => !n.is_read));
  const readList = await stu.call('GET', '/api/notifications?status=read&type=attendance');
  check('read notification filed by category', readList.data.rows.some((n) => n.id === nid) && readList.data.counts.some((c) => c.type === 'attendance' && c.read > 0));
  const newList = await stu.call('GET', '/api/notifications?status=new');
  check('new tab holds only unread', newList.data.rows.every((n) => !n.is_read));
  const del1 = await stu.call('DELETE', `/api/notifications/${nid}`);
  check('notification deleted', del1.status === 200 && del1.data.deleted === 1);
  const delOther = await prof.call('DELETE', `/api/notifications/${newList.data.rows[0]?.id || 1}`);
  check('cannot delete another user notification', delOther.data.deleted === 0);
  const delAll = await stu.call('POST', '/api/notifications/delete', { allRead: true, type: 'marks' });
  const marksLeft = await stu.call('GET', '/api/notifications?status=read&type=marks');
  check('delete all read in a category', delAll.status === 200 && marksLeft.data.total === 0);
  const fut = await prof.call('POST', `/api/offerings/${ds.id}/attendance`, { date: '2099-01-01', absent: [] });
  check('future attendance rejected', fut.status === 400);

  // Campus guide (KPR Compass at KPRIET)
  const list = (d) => (Array.isArray(d) ? d : d?.rows || []);
  const kpr = db.get("SELECT id FROM colleges WHERE code = 'KPRIET'").id;
  const guide = await pub.call('GET', `/api/campus/${kpr}`);
  check('KPRIET campus guide is public', guide.status === 200 && guide.data.data.nodes.length > 10, guide.status);
  check('college without a guide returns 404', (await pub.call('GET', `/api/campus/${db.get("SELECT id FROM colleges WHERE code = 'IITM'").id}`)).status === 404);
  check('students cannot edit the campus guide', (await stu.call('PUT', `/api/campus/${kpr}`, { data: guide.data.data })).status === 403);
  const psg = client(); await psg.login('PSGCT', 'admin', 'psgct.admin');
  check('PSG Tech admin cannot manage the KPRIET guide', (await psg.call('GET', `/api/campus/${kpr}/admin`)).status === 403);
  const draft = JSON.parse(JSON.stringify(guide.data.data));
  const jpeg = 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(800)]).toString('base64');
  const up = await adm.call('POST', `/api/campus/${kpr}/upload`, { kind: 'poster', image: jpeg });
  check('poster upload', up.status === 200 && /^\/api\/campus\/files\//.test(up.data.url), up.data);
  check('fake image rejected', (await adm.call('POST', `/api/campus/${kpr}/upload`, { kind: 'poster', image: 'data:image/png;base64,' + Buffer.alloc(800).toString('base64') })).status === 400);
  draft.events.push({ id: 'test-symposium', title: 'Test Symposium', time: '10:00 AM', instructions: 'Report at the desk.', venue: 'ragam-hall', registrationOpen: true, posterUrl: up.data.url, startsAt: new Date(Date.now() + 864e5).toISOString(), endsAt: new Date(Date.now() + 2 * 864e5).toISOString() });
  const pubRes = await adm.call('PUT', `/api/campus/${kpr}`, { data: draft, baseVersion: guide.data.data.version });
  check('admin publishes a guide update', pubRes.status === 200 && pubRes.data.version === guide.data.data.version + 1, pubRes.data);
  check('published poster is public', (await pub.call('GET', up.data.url)).status === 200);
  check('stale publish rejected', (await adm.call('PUT', `/api/campus/${kpr}`, { data: draft, baseVersion: guide.data.data.version })).status === 409);
  check('invalid guide rejected', (await adm.call('PUT', `/api/campus/${kpr}`, { data: { ...draft, nodes: [] } })).status === 400);
  const visitor = { eventId: 'test-symposium', name: 'Test Visitor', institution: 'Sample College', email: 'visitor@example.org', consent: true };
  const part = await pub.call('POST', `/api/campus/${kpr}/participations`, visitor);
  const again = await pub.call('POST', `/api/campus/${kpr}/participations`, { ...visitor, email: 'VISITOR@example.org' });
  check('visitor registers once for an event', part.data.status === 'registered' && again.data.status === 'already_registered', [part.data, again.data]);
  const badge = await adm.call('POST', `/api/campus/${kpr}/visitors`, { name: 'Test Visitor', badgeCode: part.data.id.slice(0, 8) });
  const roster = list((await adm.call('GET', `/api/campus/${kpr}/participations`)).data);
  check('badge desk checks the participant in', badge.status === 200 && roster.some((r) => r.id === part.data.id && r.status === 'checked_in'), [badge.data, roster[0]]);
  const idc = await pub.call('POST', `/api/campus/${kpr}/id-checkins`, { name: 'Test Visitor', institution: 'Sample College', eventName: 'Test Symposium', front: jpeg, back: jpeg, consent: true });
  check('visitor ID check-in received', idc.status === 200 && idc.data.status === 'received', idc.data);
  const idFront = list((await adm.call('GET', `/api/campus/${kpr}/id-checkins`)).data)[0]?.front;
  check('ID photos are private to campus admins', !!idFront && (await pub.call('GET', idFront)).status === 401 && (await adm.call('GET', idFront)).status === 200, idFront);

  // Voice sheets
  const blank = await prof.call('POST', '/api/sheets', { title: 'Class test' });
  check('blank voice sheet has the Excel headers', blank.status === 200 && blank.data.columns.map((c) => c.header).join() === 'Name,Roll,Physics,Chemistry,Math,English,History,Total,Avg' && blank.data.columns[7].type === 'formula', blank.data);
  const fromCourse = await prof.call('POST', '/api/sheets', { offeringId: ds.id });
  check('course voice sheet lists the roster and assessments', fromCourse.status === 200 && fromCourse.data.rows.length > 20 && fromCourse.data.columns.some((c) => c.assessmentId), fromCourse.data.columns);
  const rows = blank.data.rows; rows[0][2] = 75; rows[0][7] = '=SUM(C2:G2)';
  check('voice sheet saves', (await prof.call('PUT', `/api/sheets/${blank.data.id}`, { title: 'Class test', columns: blank.data.columns, rows })).status === 200);
  check('voice sheet keeps values and formulas', JSON.stringify((await prof.call('GET', `/api/sheets/${blank.data.id}`)).data.rows[0]).includes('=SUM(C2:G2)'));
  check('voice sheet is private to its owner', (await stu.call('GET', `/api/sheets/${blank.data.id}`)).status === 403 && (await adm.call('GET', `/api/sheets/${blank.data.id}`)).status === 403);

  // Course registration: student requests, college admin approves
  const sid0 = db.get("SELECT id FROM students WHERE roll_no = '25CS324' AND college_id = (SELECT id FROM colleges WHERE code = 'KPRIET')").id;
  const freed = db.get("SELECT offering_id FROM course_registrations WHERE student_id = ? AND status = 'Registered' LIMIT 1", sid0);
  db.run('DELETE FROM course_registrations WHERE student_id = ? AND offering_id = ?', sid0, freed.offering_id);
  const avail = await stu.call('GET', '/api/student/registration');
  check('dropped course becomes available to add', avail.data.available.some((a) => a.offering_id === freed.offering_id), avail.data.available.length);
  const req = await stu.call('POST', '/api/student/registration', { offeringId: freed.offering_id });
  check('student registration request is pending', req.status === 200 && req.data.status === 'Pending', req.data);
  check('duplicate request rejected', (await stu.call('POST', '/api/student/registration', { offeringId: freed.offering_id })).status === 400);
  const foreignOff = db.get("SELECT id FROM course_offerings WHERE college_id <> ? LIMIT 1", db.get("SELECT college_id FROM students WHERE id = ?", sid0).college_id).id;
  check('cannot request a course from another college', [403, 404].includes((await stu.call('POST', '/api/student/registration', { offeringId: foreignOff })).status));
  const pend = await adm.call('GET', '/api/admin/registrations');
  const rrow = pend.data.rows.find((r) => r.roll_no === '25CS324' && r.status === 'Pending');
  check('college admin sees the pending request', !!rrow, pend.data.rows.map((r) => r.roll_no));
  check('a different college admin cannot approve it', (await (async () => { const o = client(); await o.login('PSGCT', 'admin', 'psgct.admin'); return o.call('POST', `/api/admin/registrations/${rrow.id}/approve`, {}); })()).status === 403);
  check('college admin approves the request', (await adm.call('POST', `/api/admin/registrations/${rrow.id}/approve`, {})).status === 200);
  check('approved course is now registered', (await stu.call('GET', '/api/student/registration')).data.registered.some((c) => c.offering_id === freed.offering_id));
  check('approving twice is rejected', (await adm.call('POST', `/api/admin/registrations/${rrow.id}/approve`, {})).status === 400);

  // Timetable
  const stt = await stu.call('GET', '/api/timetable');
  check('student sees a section timetable with class slots', stt.data.view === 'section' && stt.data.slots.length > 0 && stt.data.periods.length === 7, stt.data.slots.length);
  const ptt = await prof.call('GET', '/api/timetable');
  check('staff sees a teaching timetable', ptt.data.view === 'teaching' && ptt.data.slots.every((s) => s.course_code));

  // Clubs
  const clubs = await stu.call('GET', '/api/clubs');
  check('student lists college clubs with a joined flag', clubs.data.clubs.length > 0 && clubs.data.clubs.every((c) => 'joined' in c));
  const notJoined = clubs.data.clubs.find((c) => !c.joined);
  check('joining a club requires member details', (await stu.call('POST', `/api/clubs/${notJoined.id}/join`, {})).status === 400);
  check('student joins a club with details', (await stu.call('POST', `/api/clubs/${notJoined.id}/join`, { phone: '9876543210', interest: 'Keen to participate' })).status === 200);
  check('joined club now shows joined', (await stu.call('GET', '/api/clubs')).data.clubs.find((c) => c.id === notJoined.id).joined === true);
  check('club roster shows the member phone', (await prof.call('GET', `/api/clubs/${notJoined.id}/members`)).data.members.some((m) => m.phone === '9876543210'));
  check('student cannot view a club roster', (await stu.call('GET', `/api/clubs/${notJoined.id}/members`)).status === 403);
  const clubRoster = await prof.call('GET', `/api/clubs/${notJoined.id}/members`);
  check('staff sees the club roster', clubRoster.status === 200 && Array.isArray(clubRoster.data.members));
  check('student leaves a club', (await stu.call('DELETE', `/api/clubs/${notJoined.id}/leave`)).status === 200);
  const foreignClub = db.get('SELECT id FROM clubs WHERE college_id <> (SELECT college_id FROM students WHERE id = ?) LIMIT 1', sid0).id;
  check('cannot join a club from another college', [403, 404].includes((await stu.call('POST', `/api/clubs/${foreignClub}/join`)).status));

  // Classroom: teacher posts an assignment, student sees it and submits; deadlines are read-only
  const dsOff = db.get("SELECT o.id FROM course_offerings o JOIN courses c ON c.id = o.course_id WHERE c.code = 'CS2301' AND o.section_id = (SELECT section_id FROM students WHERE id = ?)", sid0).id;
  const post = await prof.call('POST', `/api/classroom/${dsOff}/posts`, { kind: 'assignment', title: 'Self-test assignment', body: 'Do the thing.', dueOn: '2026-11-01', points: 15 });
  check('teacher posts an assignment', post.status === 200, post.data);
  check('student cannot post to the classroom', (await stu.call('POST', `/api/classroom/${dsOff}/posts`, { kind: 'note', title: 'x' })).status === 403);
  const stream = await stu.call('GET', `/api/classroom/${dsOff}`);
  check('student sees the new assignment in the stream', stream.data.posts.some((p) => p.id === post.data.id), stream.data.posts.length);
  check('student submits the assignment', (await stu.call('POST', `/api/classroom/posts/${post.data.id}/submit`, { link: 'https://example.com/work' })).status === 200);
  const subs = await prof.call('GET', `/api/classroom/posts/${post.data.id}/submissions`);
  check('teacher sees the submission', subs.data.submissions.length === 1 && subs.data.submissions[0].roll_no === '25CS324');
  // PDF upload: teacher attaches a PDF to a material; student can read it
  const pdfData = 'data:application/pdf;base64,' + Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF').toString('base64');
  const upf = await prof.call("POST", `/api/classroom/${dsOff}/files`, { name: 'notes.pdf', data: pdfData });
  check('teacher uploads a PDF', upf.status === 200 && /^[0-9a-f-]{36}$/.test(upf.data.id || ''), upf.data);
  const mat = await prof.call('POST', `/api/classroom/${dsOff}/posts`, { kind: 'material', title: 'Notes PDF', fileId: upf.data.id });
  check('material carries the PDF', (await stu.call('GET', `/api/classroom/${dsOff}`)).data.posts.find((p) => p.id === mat.data.id).file_id === upf.data.id);
  check('student can read the uploaded PDF', (await stu.call('GET', `/api/classroom/files/${upf.data.id}`)).status === 200);
  const otherOff = db.get('SELECT id FROM course_offerings WHERE college_id <> (SELECT college_id FROM students WHERE id = ?) LIMIT 1', sid0).id;
  check('cannot upload to a course you cannot access', (await stu.call('POST', `/api/classroom/${otherOff}/files`, { name: 'x.pdf', data: pdfData })).status === 403);
  await prof.call('DELETE', `/api/classroom/posts/${mat.data.id}`);

  // Admins can no longer add or remove assessments/assignments
  check('admin cannot create an assessment', (await adm.call('POST', '/api/admin/entities/assessments', { offering_id: dsOff, name: 'x', kind: 'quiz', max_marks: 10 })).status === 403);
  check('admin cannot post to the classroom', (await adm.call('POST', `/api/classroom/${dsOff}/posts`, { kind: 'note', title: 'x' })).status === 403);
  const dl = await stu.call('GET', '/api/student/deadlines');
  check('student deadlines include the assignment', dl.data.upcoming.some((a) => a.id === post.data.id));
  check('deletes the self-test assignment', (await prof.call('DELETE', `/api/classroom/posts/${post.data.id}`)).status === 200);

  // Forgot-password OTP in dev mode returns the code on screen (no SMTP configured)
  const otp = await pub.call('POST', '/api/auth/otp/request', { collegeId: db.get("SELECT id FROM colleges WHERE code = 'KPRIET'").id, type: 'student', loginId: '25CS324', purpose: 'reset' });
  check('forgot-password OTP works in dev mode (code shown, not claimed as emailed)', otp.data.dev === true && otp.data.delivered === false && /^\d{6}$/.test(otp.data.devCode || ''), otp.data);

  // Institution logos: the real crests provided are present on disk and set in the database
  const { logoFor } = require('./lib');
  check('KPRIET has a real logo file', !!logoFor('KPRIET'));
  check('IIT Madras (college + university) shares a logo file', !!logoFor('IITM'));
  check('every college carries a real logo (28/28)', db.get("SELECT COUNT(*) AS n FROM colleges WHERE logo IS NULL").n === 0, db.get("SELECT COUNT(*) AS n FROM colleges WHERE logo IS NOT NULL").n);
  check('every university carries a real logo (14/14)', db.get("SELECT COUNT(*) AS n FROM universities WHERE logo IS NOT NULL").n === 14, db.get("SELECT COUNT(*) AS n FROM universities WHERE logo IS NOT NULL").n);

  // Admin portal: people and portals only; portal switches reach the student and teacher portals
  {
    const adm = client(); await adm.login('KPRIET', 'admin', 'kpriet.admin');
    const ov = await adm.call('GET', '/api/admin/overview');
    check('admin overview is people and portals only (no attendance, marks or risk)', ov.status === 200 && ov.data.totals.students > 0 && !Object.keys(ov.data).some((k) => /attend|mark|risk|assess/i.test(k)), Object.keys(ov.data || {}));
    const pt = await adm.call('GET', '/api/admin/portals');
    check('admin sees 13 portal switches across student and teacher portals', pt.status === 200 && pt.data.portals.reduce((n, x) => n + x.items.length, 0) === 13, pt.data);
    const stu = client(); await stu.login('KPRIET', 'student', '25CS324');
    await adm.call('PUT', '/api/admin/portals', { key: 'portal_student_clubs', on: false });
    const off = await stu.call('GET', '/api/auth/me');
    await adm.call('PUT', '/api/admin/portals', { key: 'portal_student_clubs', on: true });
    const on = await stu.call('GET', '/api/auth/me');
    check('turning off student Clubs hides it for students, and back on restores it', off.data.features && off.data.features.clubs === false && on.data.features.clubs === true, [off.data.features, on.data.features]);
    await adm.call('PUT', '/api/admin/portals', { key: 'portal_student_open', on: false });
    const closed = await client().login('KPRIET', 'student', '25CS324');
    await adm.call('PUT', '/api/admin/portals', { key: 'portal_student_open', on: true });
    const reopened = await client().login('KPRIET', 'student', '25CS324');
    check('closing the student portal blocks student sign-in, reopening allows it', closed.status === 403 && reopened.status === 200, [closed.status, reopened.status]);
    const stuStaff = client(); await stuStaff.login('KPRIET', 'student', '25CS324');
    const noPortals = await stuStaff.call('GET', '/api/admin/portals');
    check('students cannot read portal switches', noPortals.status === 401 || noPortals.status === 403, noPortals.status);

    // nerd AI: the person's own facts, and Claude mode only when configured
    const sf = await stu.call('GET', '/api/assistant/facts');
    const dsF = sf.data.facts && sf.data.facts.courses.find((c) => c.code === 'CS2301');
    check('nerd AI facts give a student their own attendance, safe misses, marks and timetable', sf.status === 200 && sf.data.facts.role === 'student' && sf.data.facts.rollNo === '25CS324' && dsF && typeof dsF.attendance === 'number' && typeof dsF.safeMisses === 'number' && Array.isArray(sf.data.facts.timetable) && sf.data.facts.timetable.length > 0, dsF);
    const tf = await prof.call('GET', '/api/assistant/facts');
    check('nerd AI facts give a teacher their classes and marks still to enter', tf.status === 200 && tf.data.facts.role === 'staff' && tf.data.facts.courses.length >= 1 && Array.isArray(tf.data.facts.pendingMarks), tf.data.facts && tf.data.facts.courses);
    const af = await adm.call('GET', '/api/assistant/facts');
    check('nerd AI facts for an admin carry counts only, no academic records', af.status === 200 && af.data.facts.role === 'admin' && !('courses' in af.data.facts), af.data.facts);
    const anon = await client().call('GET', '/api/assistant/facts');
    check('nerd AI facts need sign-in', anon.status === 401, anon.status);
    const ms = await stu.call('GET', '/api/assistant/status');
    if (ms.data.mode === 'offline') {
      const ch = await stu.call('POST', '/api/assistant/chat', { messages: [{ role: 'user', content: 'hi' }] });
      check('nerd AI online chat says unavailable (503) when no API key is set, so the browser answers offline', ch.status === 503, ch.status);
    } else check('nerd AI online mode is configured', ms.data.mode === 'online' && !!ms.data.provider, ms.data);
    const { parseText, factsText } = require('./assistant');
    const lm = parseText('<think>x</think>Hello **there**.\n- one\nSuggestions: First one | Second one');
    check('nerd AI reads a local model reply and its suggestions line', lm.reply === 'Hello **there**.\n- one' && lm.suggestions.join('|') === 'First one|Second one', lm);
    const ft = factsText(sf.data.facts);
    check('nerd AI gives local models a short text version of the facts', ft.includes('25CS324') && ft.includes('CS2301 Data Structures') && ft.length < 7000, ft.length);
  }

  // nerd AI knowledge base: loads, is large, and is internally consistent
  try {
    const g = {}; const vm = require('vm');
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'nerdai-data.js'), 'utf8'), { window: g });
    const KB = g.NerdAIKB;
    check('nerd AI knowledge base loads', !!(KB && Array.isArray(KB.intents)));
    const qCount = KB.intents.reduce((s, i) => s + i.q.length, 0);
    check('nerd AI is trained on 1000+ questions', qCount >= 1000, qCount);
    const ids = new Set(); let dup = 0; for (const it of KB.intents) { if (ids.has(it.id)) dup++; ids.add(it.id); }
    check('nerd AI intent ids are unique', dup === 0, dup);
    let broken = 0;
    for (const it of KB.intents) for (const c of (it.chips || [])) if (!ids.has(c)) broken++;
    for (const cat of KB.categories) for (const item of cat.items) if (!ids.has(item)) broken++;
    check('nerd AI topic and follow-up links all resolve', broken === 0, broken);
  } catch (e) { check('nerd AI knowledge base loads', false, String(e).slice(0, 200)); }

  // Voice sheet: names and roll numbers by voice
  try {
    const vm = require('vm'); const w = {};
    const App = new Proxy({ state: { me: { role: 'staff' } } }, { get: (t, k) => (k in t ? t[k] : () => {}) });
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'sheet.js'), 'utf8'), { window: w, App, console });
    const VS = w.VoiceSheets;
    const cols = [{ header: 'Name', type: 'text' }, { header: 'Roll', type: 'text' }, { header: 'Physics', type: 'number', max: 100 }, { header: 'Total', type: 'formula' }];
    const blankS = (c) => ({ columns: cols, rows: [[null, null, null, null], [null, null, null, null]], active: { r: 0, c } });
    const n1 = VS.parseUtterance(blankS(0), 'Rojan Adhikari'), n2 = VS.parseUtterance(blankS(2), 'name Kavya Sri');
    check('voice sheet writes a spoken name into the Name column', n1.kind === 'write' && n1.c === 0 && n1.value === 'Rojan Adhikari' && n2.kind === 'write' && n2.c === 0 && n2.value === 'Kavya Sri', [n1, n2]);
    const r1 = VS.parseUtterance(blankS(1), '25 C S 324'), r2 = VS.parseUtterance(blankS(1), 'two five cs three two four');
    check('voice sheet writes a spoken roll number into the Roll column', r1.value === '25CS324' && r2.value === '25CS324', [r1, r2]);
    const full = { columns: cols, rows: [['Rojan Adhikari', '25CS324', null, null], ['Mohammed Irfan', '25CS102', null, null]], active: { r: 0, c: 2 } };
    const a = VS.parseUtterance(full, '25 see as 324 physics 80'), b = VS.parseUtterance(full, 'Mohamed Irfan physics 77'), c = VS.parseUtterance(full, 'physics 64');
    check('voice sheet finds students by misheard roll and name, marks still work', a.r === 0 && a.value === 80 && b.r === 1 && b.value === 77 && c.kind === 'write' && c.value === 64, [a, b, c]);
    // Mean, variance and standard deviation by voice
    const r2d = (x) => Math.round(x * 100) / 100;
    const sc = [{ header: 'Name', type: 'text' }, { header: 'Roll', type: 'text' }, { header: 'Physics', type: 'number', max: 100 }, { header: 'Chemistry', type: 'number', max: 100 }, { header: 'SD', type: 'formula' }];
    const sr = [['Rojan Adhikari', '25CS324', 80, 70, null], ['Mohammed Irfan', '25CS102', 60, 'AB', null], ['Kavya Sri', '25CS101', 90, 85, null], ['Asha Nair', '25CS110', 70, 65, null]];
    const st = (col) => ({ columns: sc, rows: sr, active: { r: 0, c: col } });
    const sd = VS.parseUtterance(st(2), 'what is the standard deviation of physics'), sv = VS.parseUtterance(st(2), 'sample variance of C2 to C5'), all = VS.parseUtterance(st(2), 'mean, variance and standard deviation of physics');
    check('voice sheet answers mean, variance and standard deviation of a column', sd.kind === 'answer' && r2d(sd.parts[0].value) === 11.18 && sv.kind === 'answer' && sv.parts[0].fn === 'VAR.S' && r2d(sv.parts[0].value) === 166.67 && all.kind === 'answer' && all.parts.map((p) => p.fn).join() === 'AVERAGE,VAR.P,STDEV.P' && all.parts[0].value === 75, [sd.msg, sv.msg, all.msg]);
    const byName = VS.parseUtterance(st(2), 'variance for Rojan'), onSD = VS.parseUtterance(st(4), 'C2 to D2'), mark = VS.parseUtterance(st(2), 'physics 75 percent');
    check('voice sheet works out one student\'s figures, writes =STDEV.P on an SD cell, still takes marks', byName.kind === 'answer' && byName.parts[0].value === 25 && onSD.kind === 'formula' && onSD.formula === '=STDEV.P(C2:D2)' && mark.kind === 'write' && mark.value === 75, [byName.msg, onSD, mark]);
    const SE = VS.makeEngine({ columns: sc, rows: [[null, null, 10, 20, '=VAR.S(C2:D3)'], [null, null, 30, 40, '=STDEV.P(C2:D3)']], active: { r: 0, c: 0 } });
    check('voice sheet formulas VAR.S and STDEV.P compute', SE.display(0, 4) === '166.67' && SE.display(1, 4) === '11.18', [SE.display(0, 4), SE.display(1, 4)]);
  } catch (e) { check('voice sheet parser loads', false, String(e).slice(0, 200)); }

  console.log(`\n${passed} passed, ${failed} failed`);
  server.close(); db.close();
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
}
main().catch((err) => { console.error(err); process.exit(1); });
