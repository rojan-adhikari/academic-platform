// Configuration-driven administrator CRUD for every organisational and
// academic entity. Scope is enforced on list, read, create, update and delete;
// references are validated to belong to the same institution.
const crypto = require('crypto');
const db = require('../db');
const scope = require('../scope');
const auth = require('../auth');
const events = require('../engine/events');
const { bad, forbidden, notFound, toInt, toNum, toStr, toDate, EMAIL, audit, diff, paged } = require('../lib');

const YEAR = { type: 'int', min: 2000, max: 2100 };
const E = {};

E.universities = { table: 'universities', label: 'University', level: 'platform', perm: 'manage_universities', soft: true,
  fields: [{ key: 'code', label: 'Code', type: 'string', required: true, max: 12, pattern: /^[A-Za-z0-9-]+$/ }, { key: 'name', label: 'Name', type: 'string', required: true, max: 150 },
    { key: 'short_name', label: 'Short name', type: 'string', required: true, max: 40 }, { key: 'location', label: 'Location', type: 'string', max: 120 },
    { key: 'affiliation', label: 'Affiliation', type: 'string', max: 120 }, { key: 'type', label: 'Type', type: 'string', max: 60 }, { key: 'established', label: 'Established (year)', type: 'int', min: 1700, max: 2100 }, { key: 'accent', label: 'Brand colour', type: 'color' },
    { key: 'active', label: 'Active', type: 'bool' }],
  select: `SELECT t.*, (SELECT COUNT(*) FROM colleges c WHERE c.university_id = t.id) AS colleges_count FROM universities t`,
  columns: [['code', 'Code'], ['name', 'Name'], ['location', 'Location'], ['affiliation', 'Affiliation'], ['colleges_count', 'Colleges'], ['active', 'Status']], search: ['t.code', 't.name', 't.location'] };

E.colleges = { table: 'colleges', label: 'College', level: 'university', perm: 'manage_colleges', soft: true,
  fields: [{ key: 'university_id', label: 'University', type: 'ref', ref: 'universities', required: true, fixed: true }, { key: 'code', label: 'Code', type: 'string', required: true, max: 12, pattern: /^[A-Za-z0-9-]+$/ },
    { key: 'name', label: 'Name', type: 'string', required: true, max: 150 }, { key: 'short_name', label: 'Short name', type: 'string', required: true, max: 40 },
    { key: 'location', label: 'Location', type: 'string', max: 120 }, { key: 'institution_code', label: 'Institution code', type: 'string', max: 20 },
    { key: 'category', label: 'Category', type: 'string', max: 80 }, { key: 'established', label: 'Established (year)', type: 'int', min: 1700, max: 2100 }, { key: 'website', label: 'Website', type: 'string', max: 200, pattern: /^https?:\/\/[^\s]+$/ },
    { key: 'accent', label: 'Brand colour', type: 'color' },
    { key: 'active', label: 'Active', type: 'bool' }],
  select: `SELECT t.*, u.short_name AS university, (SELECT COUNT(*) FROM students s WHERE s.college_id = t.id) AS students_count FROM colleges t JOIN universities u ON u.id = t.university_id`,
  columns: [['code', 'Code'], ['name', 'Name'], ['university', 'University'], ['location', 'Location'], ['institution_code', 'Inst. code'], ['students_count', 'Students'], ['active', 'Status']],
  search: ['t.code', 't.name', 't.location', 't.institution_code'], filters: ['university_id'] };

const COLLEGE = { key: 'college_id', label: 'College', type: 'ref', ref: 'colleges', required: true, fixed: true };
E.campuses = { table: 'campuses', label: 'Campus', level: 'college', perm: 'manage_structure', soft: true,
  fields: [COLLEGE, { key: 'name', label: 'Name', type: 'string', required: true, max: 120 }, { key: 'address', label: 'Address', type: 'string', max: 200 }, { key: 'active', label: 'Active', type: 'bool' }],
  select: 'SELECT t.*, c.short_name AS college FROM campuses t JOIN colleges c ON c.id = t.college_id', columns: [['name', 'Name'], ['college', 'College'], ['address', 'Address'], ['active', 'Status']], search: ['t.name'] };
E.faculties = { table: 'faculties', label: 'Faculty / School', level: 'college', perm: 'manage_structure', soft: true,
  fields: [COLLEGE, { key: 'campus_id', label: 'Campus', type: 'ref', ref: 'campuses' }, { key: 'name', label: 'Name', type: 'string', required: true, max: 120 }, { key: 'active', label: 'Active', type: 'bool' }],
  select: 'SELECT t.*, c.short_name AS college, cp.name AS campus FROM faculties t JOIN colleges c ON c.id = t.college_id LEFT JOIN campuses cp ON cp.id = t.campus_id',
  columns: [['name', 'Name'], ['college', 'College'], ['campus', 'Campus'], ['active', 'Status']], search: ['t.name'] };
E.departments = { table: 'departments', label: 'Department', level: 'college', perm: 'manage_structure', soft: true, deptSelf: true,
  fields: [COLLEGE, { key: 'faculty_id', label: 'Faculty / School', type: 'ref', ref: 'faculties' }, { key: 'code', label: 'Code', type: 'string', required: true, max: 12, pattern: /^[A-Za-z0-9-]+$/ },
    { key: 'name', label: 'Name', type: 'string', required: true, max: 120 }, { key: 'active', label: 'Active', type: 'bool' }],
  select: `SELECT t.*, c.short_name AS college, (SELECT COUNT(*) FROM students s WHERE s.department_id = t.id AND s.active = 1) AS students_count,
    (SELECT COUNT(*) FROM staff s WHERE s.department_id = t.id AND s.active = 1) AS staff_count FROM departments t JOIN colleges c ON c.id = t.college_id`,
  columns: [['code', 'Code'], ['name', 'Name'], ['college', 'College'], ['students_count', 'Students'], ['staff_count', 'Staff'], ['active', 'Status']], search: ['t.code', 't.name'], filters: ['college_id'] };
E.programmes = { table: 'programmes', label: 'Programme', level: 'college', perm: 'manage_structure', soft: true, dept: true,
  fields: [COLLEGE, { key: 'department_id', label: 'Department', type: 'ref', ref: 'departments', required: true }, { key: 'code', label: 'Code', type: 'string', required: true, max: 20 },
    { key: 'name', label: 'Name', type: 'string', required: true, max: 150 }, { key: 'degree_type', label: 'Degree type', type: 'enum', options: ['UG', 'PG', 'Diploma', 'PhD', 'Integrated'], required: true },
    { key: 'duration_years', label: 'Duration (years)', type: 'int', min: 1, max: 7, required: true }, { key: 'active', label: 'Active', type: 'bool' }],
  select: 'SELECT t.*, c.short_name AS college, d.code AS department FROM programmes t JOIN colleges c ON c.id = t.college_id JOIN departments d ON d.id = t.department_id',
  columns: [['code', 'Code'], ['name', 'Name'], ['department', 'Dept'], ['degree_type', 'Degree'], ['duration_years', 'Years'], ['college', 'College'], ['active', 'Status']], search: ['t.code', 't.name'], filters: ['college_id', 'department_id'] };
E.regulations = { table: 'regulations', label: 'Regulation', level: 'college', perm: 'manage_structure', soft: true,
  fields: [COLLEGE, { key: 'code', label: 'Code', type: 'string', required: true, max: 12 }, { key: 'name', label: 'Name', type: 'string', required: true, max: 120 },
    { key: 'effective_year', label: 'Effective year', ...YEAR }, { key: 'total_semesters', label: 'Semesters', type: 'int', min: 1, max: 12, required: true },
    { key: 'min_credits', label: 'Minimum credits', type: 'int', min: 0, max: 400 }, { key: 'active', label: 'Active', type: 'bool' }],
  select: 'SELECT t.*, c.short_name AS college FROM regulations t JOIN colleges c ON c.id = t.college_id',
  columns: [['code', 'Code'], ['name', 'Name'], ['effective_year', 'Year'], ['total_semesters', 'Semesters'], ['min_credits', 'Min credits'], ['college', 'College'], ['active', 'Status']], search: ['t.code', 't.name'], filters: ['college_id'] };
E.batches = { table: 'batches', label: 'Batch', level: 'college', perm: 'manage_structure', soft: true,
  fields: [COLLEGE, { key: 'programme_id', label: 'Programme', type: 'ref', ref: 'programmes', required: true }, { key: 'regulation_id', label: 'Regulation', type: 'ref', ref: 'regulations', required: true },
    { key: 'name', label: 'Name', type: 'string', required: true, max: 20, pattern: /^\d{4}\s*[-–]\s*\d{4}$/, patternMsg: 'Batch name must look like 2025-2029' },
    { key: 'start_year', label: 'Start year', ...YEAR, required: true }, { key: 'end_year', label: 'End year', ...YEAR, required: true },
    { key: 'current_semester', label: 'Current semester', type: 'int', min: 1, max: 12, required: true }, { key: 'active', label: 'Active', type: 'bool' }],
  validate: (r) => { if (r.end_year <= r.start_year) throw bad('End year must be after start year.'); },
  select: 'SELECT t.*, c.short_name AS college, p.code AS programme, r.code AS regulation FROM batches t JOIN colleges c ON c.id = t.college_id JOIN programmes p ON p.id = t.programme_id JOIN regulations r ON r.id = t.regulation_id',
  columns: [['name', 'Batch'], ['programme', 'Programme'], ['regulation', 'Regulation'], ['current_semester', 'Semester'], ['college', 'College'], ['active', 'Status']], search: ['t.name', 'p.code'], filters: ['college_id', 'programme_id'] };
E.academic_years = { table: 'academic_years', label: 'Academic year', level: 'college', perm: 'manage_structure',
  fields: [COLLEGE, { key: 'name', label: 'Name', type: 'string', required: true, max: 20, pattern: /^\d{4}-\d{2}$/, patternMsg: 'Academic year must look like 2026-27' },
    { key: 'start_date', label: 'Start date', type: 'date', required: true }, { key: 'end_date', label: 'End date', type: 'date', required: true }, { key: 'is_current', label: 'Current', type: 'bool' }],
  validate: (r) => { if (r.end_date <= r.start_date) throw bad('End date must be after start date.'); },
  afterSave: (ctx, row, id) => { if (row.is_current) db.run('UPDATE academic_years SET is_current = 0 WHERE college_id = ? AND id != ?', row.college_id, id); },
  select: 'SELECT t.*, c.short_name AS college FROM academic_years t JOIN colleges c ON c.id = t.college_id',
  columns: [['name', 'Year'], ['start_date', 'Starts'], ['end_date', 'Ends'], ['is_current', 'Current'], ['college', 'College']], search: ['t.name'], filters: ['college_id'] };
E.semesters = { table: 'semesters', label: 'Semester / term', level: 'college', perm: 'manage_structure',
  fields: [COLLEGE, { key: 'academic_year_id', label: 'Academic year', type: 'ref', ref: 'academic_years', required: true }, { key: 'term', label: 'Term', type: 'enum', options: ['Odd', 'Even'], required: true },
    { key: 'name', label: 'Name', type: 'string', required: true, max: 60 }, { key: 'start_date', label: 'Start date', type: 'date' }, { key: 'end_date', label: 'End date', type: 'date' }, { key: 'is_current', label: 'Current', type: 'bool' }],
  afterSave: (ctx, row, id) => { if (row.is_current) db.run('UPDATE semesters SET is_current = 0 WHERE college_id = ? AND id != ?', row.college_id, id); },
  select: 'SELECT t.*, c.short_name AS college, ay.name AS academic_year FROM semesters t JOIN colleges c ON c.id = t.college_id JOIN academic_years ay ON ay.id = t.academic_year_id',
  columns: [['name', 'Name'], ['academic_year', 'Academic year'], ['term', 'Term'], ['is_current', 'Current'], ['college', 'College']], search: ['t.name'], filters: ['college_id'] };
E.sections = { table: 'sections', label: 'Section', level: 'college', perm: 'manage_structure', hard: true,
  fields: [COLLEGE, { key: 'batch_id', label: 'Batch', type: 'ref', ref: 'batches', required: true }, { key: 'name', label: 'Name', type: 'string', required: true, max: 10 }],
  beforeDelete: (row) => { if (db.get('SELECT COUNT(*) n FROM students WHERE section_id = ?', row.id).n) throw bad('Move students out of this section before deleting it.'); },
  select: `SELECT t.*, c.short_name AS college, b.name AS batch, p.code AS programme, (SELECT COUNT(*) FROM students s WHERE s.section_id = t.id) AS students_count
    FROM sections t JOIN colleges c ON c.id = t.college_id JOIN batches b ON b.id = t.batch_id JOIN programmes p ON p.id = b.programme_id`,
  columns: [['name', 'Section'], ['programme', 'Programme'], ['batch', 'Batch'], ['students_count', 'Students'], ['college', 'College']], search: ['t.name', 'b.name'], filters: ['college_id', 'batch_id'] };
E.courses = { table: 'courses', label: 'Course / subject', level: 'college', perm: 'manage_courses', soft: true, dept: true,
  fields: [COLLEGE, { key: 'department_id', label: 'Department', type: 'ref', ref: 'departments', required: true }, { key: 'regulation_id', label: 'Regulation', type: 'ref', ref: 'regulations', required: true },
    { key: 'programme_id', label: 'Programme', type: 'ref', ref: 'programmes' }, { key: 'semester_number', label: 'Semester', type: 'int', min: 1, max: 12, required: true },
    { key: 'code', label: 'Course code', type: 'string', required: true, max: 20, pattern: /^[A-Za-z0-9-]+$/ }, { key: 'name', label: 'Course name', type: 'string', required: true, max: 150 },
    { key: 'category', label: 'Category', type: 'enum', options: ['Core', 'Foundation', 'Professional Elective', 'Open Elective', 'Humanities', 'Mandatory', 'Project'], required: true },
    { key: 'course_type', label: 'Course type', type: 'enum', options: ['Theory', 'TwL', 'Lab', 'Project', 'Seminar'], required: true },
    { key: 'credits', label: 'Credits', type: 'number', min: 0, max: 12, required: true }, { key: 'active', label: 'Active', type: 'bool' }],
  select: `SELECT t.*, c.short_name AS college, d.code AS department, r.code AS regulation FROM courses t JOIN colleges c ON c.id = t.college_id JOIN departments d ON d.id = t.department_id JOIN regulations r ON r.id = t.regulation_id`,
  columns: [['code', 'Code'], ['name', 'Name'], ['category', 'Category'], ['course_type', 'Type'], ['credits', 'Credits'], ['semester_number', 'Sem'], ['regulation', 'Reg.'], ['department', 'Dept'], ['active', 'Status']],
  search: ['t.code', 't.name'], filters: ['college_id', 'department_id', 'regulation_id', 'semester_number'] };
E.offerings = { table: 'course_offerings', label: 'Course offering (faculty assignment)', level: 'college', perm: 'manage_courses', soft: true, deptVia: 'c.department_id',
  fields: [COLLEGE, { key: 'course_id', label: 'Course', type: 'ref', ref: 'courses', required: true }, { key: 'semester_id', label: 'Semester / term', type: 'ref', ref: 'semesters', required: true },
    { key: 'batch_id', label: 'Batch', type: 'ref', ref: 'batches', required: true }, { key: 'section_id', label: 'Section', type: 'ref', ref: 'sections' },
    { key: 'staff_id', label: 'Faculty', type: 'ref', ref: 'staff' }, { key: 'registration_open', label: 'Registration open', type: 'bool' }, { key: 'active', label: 'Active', type: 'bool' }],
  validate: (r) => { if (r.section_id) { const s = db.get('SELECT batch_id FROM sections WHERE id = ?', r.section_id); if (s && s.batch_id !== r.batch_id) throw bad('The section does not belong to the selected batch.'); } },
  afterSave: (ctx, row, id, prev) => {
    if (prev && prev.staff_id === row.staff_id) return;
    const info = db.get(`SELECT c.name, c.code, st.employee_code, u.name AS faculty, st.user_id FROM course_offerings o JOIN courses c ON c.id = o.course_id
      LEFT JOIN staff st ON st.id = o.staff_id LEFT JOIN users u ON u.id = st.user_id WHERE o.id = ?`, id);
    if (info.user_id) events.notify(info.user_id, row.college_id, { type: 'course', title: 'New course assigned', body: `You have been assigned ${info.code} ${info.name}.`, link: '#/staff/courses' });
    if (prev) for (const s of db.all("SELECT s.user_id FROM course_registrations r JOIN students s ON s.id = r.student_id WHERE r.offering_id = ? AND r.status = 'Registered'", id))
      events.notify(s.user_id, row.college_id, { type: 'course', title: `Faculty updated for ${info.name}`, body: `${info.code} ${info.name} is now taught by ${info.employee_code ? `${info.employee_code} - ${info.faculty}` : 'faculty to be announced'}.`, link: '#/student/courses' });
  },
  select: `SELECT t.*, col.short_name AS college, c.code AS course_code, c.name AS course, b.name AS batch, sec.name AS section, sem.name AS semester, st.employee_code || ' - ' || fu.name AS faculty,
    (SELECT COUNT(*) FROM course_registrations r WHERE r.offering_id = t.id AND r.status = 'Registered') AS registered
    FROM course_offerings t JOIN colleges col ON col.id = t.college_id JOIN courses c ON c.id = t.course_id JOIN batches b ON b.id = t.batch_id
    LEFT JOIN sections sec ON sec.id = t.section_id JOIN semesters sem ON sem.id = t.semester_id LEFT JOIN staff st ON st.id = t.staff_id LEFT JOIN users fu ON fu.id = st.user_id`,
  columns: [['course_code', 'Code'], ['course', 'Course'], ['batch', 'Batch'], ['section', 'Sec'], ['faculty', 'Faculty'], ['registered', 'Students'], ['semester', 'Term'], ['active', 'Status']],
  search: ['c.code', 'c.name', 'fu.name', 'st.employee_code'], filters: ['college_id', 'batch_id', 'staff_id', 'course_id'] };
E.registrations = { table: 'course_registrations', label: 'Course registration', level: 'college', perm: 'manage_registrations', deptVia: 's.department_id', dropStatus: true,
  fields: [COLLEGE, { key: 'student_id', label: 'Student', type: 'ref', ref: 'students', required: true }, { key: 'offering_id', label: 'Course offering', type: 'ref', ref: 'offerings', required: true },
    { key: 'status', label: 'Status', type: 'enum', options: ['Registered', 'Pending', 'Dropped'], required: true }],
  validate: (r) => {
    const s = db.get('SELECT batch_id FROM students WHERE id = ?', r.student_id); const o = db.get('SELECT batch_id, registration_open FROM course_offerings WHERE id = ?', r.offering_id);
    if (s && o && s.batch_id !== o.batch_id) throw bad("This course offering is for a different batch than the student's.");
  },
  afterSave: (ctx, row, id, prev) => {
    if (prev && prev.status === row.status) return;
    const info = db.get('SELECT s.user_id, c.name, c.code FROM course_registrations r JOIN students s ON s.id = r.student_id JOIN course_offerings o ON o.id = r.offering_id JOIN courses c ON c.id = o.course_id WHERE r.id = ?', id);
    events.notify(info.user_id, row.college_id, { type: 'course', title: row.status === 'Registered' ? 'Course registration confirmed' : `Course registration ${row.status.toLowerCase()}`,
      body: `${info.code} ${info.name}: registration is now ${row.status}.`, link: '#/student/courses' });
    events.enqueue(() => events.reassess(row.student_id, 'registration'));
  },
  select: `SELECT t.*, col.short_name AS college, s.roll_no, s.first_name || ' ' || s.last_name AS student, c.code AS course_code, c.name AS course, sec.name AS section
    FROM course_registrations t JOIN colleges col ON col.id = t.college_id JOIN students s ON s.id = t.student_id JOIN course_offerings o ON o.id = t.offering_id
    JOIN courses c ON c.id = o.course_id LEFT JOIN sections sec ON sec.id = o.section_id`,
  columns: [['roll_no', 'Roll no.'], ['student', 'Student'], ['course_code', 'Code'], ['course', 'Course'], ['section', 'Sec'], ['status', 'Status'], ['registered_at', 'Registered']],
  search: ['s.roll_no', 's.first_name', 's.last_name', 'c.code', 'c.name'], filters: ['college_id', 'student_id', 'offering_id', 'status'] };
E.students = { table: 'students', label: 'Student', level: 'college', perm: 'manage_students', soft: true, dept: true, special: 'student',
  fields: [COLLEGE, { key: 'roll_no', label: 'Roll number', type: 'string', required: true, max: 20, pattern: /^[A-Za-z0-9/-]+$/, patternMsg: 'Roll number may contain letters, digits, - and /' },
    { key: 'first_name', label: 'First name', type: 'string', required: true, max: 60 }, { key: 'last_name', label: 'Last name', type: 'string', max: 60 },
    { key: 'email', label: 'Institution email', type: 'email', required: true, virtual: true }, { key: 'gender', label: 'Gender', type: 'enum', options: ['Female', 'Male', 'Other', 'Prefer not to say'] },
    { key: 'department_id', label: 'Department', type: 'ref', ref: 'departments', required: true }, { key: 'programme_id', label: 'Programme', type: 'ref', ref: 'programmes', required: true },
    { key: 'batch_id', label: 'Batch', type: 'ref', ref: 'batches', required: true }, { key: 'section_id', label: 'Section', type: 'ref', ref: 'sections' },
    { key: 'regulation_id', label: 'Regulation', type: 'ref', ref: 'regulations', required: true }, { key: 'current_semester', label: 'Current semester', type: 'int', min: 1, max: 12, required: true },
    { key: 'active', label: 'Active', type: 'bool' }],
  validate: (r) => {
    const p = db.get('SELECT department_id FROM programmes WHERE id = ?', r.programme_id); if (p && p.department_id !== r.department_id) throw bad('The programme does not belong to the selected department.');
    const b = db.get('SELECT programme_id FROM batches WHERE id = ?', r.batch_id); if (b && b.programme_id !== r.programme_id) throw bad('The batch does not belong to the selected programme.');
    if (r.section_id) { const s = db.get('SELECT batch_id FROM sections WHERE id = ?', r.section_id); if (s && s.batch_id !== r.batch_id) throw bad('The section does not belong to the selected batch.'); }
  },
  select: `SELECT t.*, u.email, col.short_name AS college, d.code AS department, p.code AS programme, b.name AS batch, sec.name AS section,
    (SELECT level FROM risk_analysis ra WHERE ra.student_id = t.id AND ra.offering_id IS NULL AND ra.is_latest = 1) AS risk
    FROM students t JOIN users u ON u.id = t.user_id JOIN colleges col ON col.id = t.college_id JOIN departments d ON d.id = t.department_id
    JOIN programmes p ON p.id = t.programme_id JOIN batches b ON b.id = t.batch_id LEFT JOIN sections sec ON sec.id = t.section_id`,
  columns: [['roll_no', 'Roll no.'], ['first_name', 'First name'], ['last_name', 'Last name'], ['department', 'Dept'], ['batch', 'Batch'], ['section', 'Sec'], ['current_semester', 'Sem'], ['risk', 'Risk'], ['active', 'Status']],
  search: ['t.roll_no', 't.first_name', 't.last_name', 'u.email'], filters: ['college_id', 'department_id', 'programme_id', 'batch_id', 'section_id', 'current_semester'] };
E.staff = { table: 'staff', label: 'Staff member', level: 'college', perm: 'manage_staff', soft: true, dept: true, special: 'staff',
  fields: [COLLEGE, { key: 'employee_code', label: 'Employee ID', type: 'string', required: true, max: 20, pattern: /^[A-Za-z0-9/-]+$/ },
    { key: 'name', label: 'Full name', type: 'string', required: true, max: 100, virtual: true }, { key: 'email', label: 'Institution email', type: 'email', required: true, virtual: true },
    { key: 'department_id', label: 'Department', type: 'ref', ref: 'departments', required: true }, { key: 'designation', label: 'Designation', type: 'string', max: 60 }, { key: 'active', label: 'Active', type: 'bool' }],
  select: `SELECT t.*, u.name, u.email, col.short_name AS college, d.code AS department,
    (SELECT COUNT(*) FROM course_offerings o WHERE o.staff_id = t.id AND o.active = 1) AS courses_count
    FROM staff t JOIN users u ON u.id = t.user_id JOIN colleges col ON col.id = t.college_id JOIN departments d ON d.id = t.department_id`,
  columns: [['employee_code', 'Employee ID'], ['name', 'Name'], ['designation', 'Designation'], ['department', 'Dept'], ['courses_count', 'Courses'], ['email', 'Email'], ['active', 'Status']],
  search: ['t.employee_code', 'u.name', 'u.email'], filters: ['college_id', 'department_id'] };
E.assessments = { table: 'assessments', label: 'Assessment / assignment', level: 'college', perm: 'manage_assessments', hard: true, deptVia: 'c.department_id',
  fields: [COLLEGE, { key: 'offering_id', label: 'Course offering', type: 'ref', ref: 'offerings', required: true }, { key: 'name', label: 'Name', type: 'string', required: true, max: 80 },
    { key: 'short_name', label: 'Short name', type: 'string', max: 12 }, { key: 'kind', label: 'Type', type: 'enum', options: ['internal', 'quiz', 'assignment', 'lab', 'exam'], required: true },
    { key: 'max_marks', label: 'Maximum marks', type: 'number', min: 1, max: 1000, required: true }, { key: 'weight', label: 'Weight', type: 'number', min: 0, max: 100, required: true },
    { key: 'sequence', label: 'Order', type: 'int', min: 1, max: 100, required: true }, { key: 'held_on', label: 'Held on', type: 'date' }, { key: 'due_on', label: 'Due on', type: 'date' },
    { key: 'published', label: 'Published', type: 'bool' }],
  validate: (r, prev) => { if (prev) { const m = db.get('SELECT MAX(marks) m FROM marks WHERE assessment_id = ?', prev.id).m; if (m !== null && r.max_marks < m) throw bad(`Maximum marks cannot be lower than an existing mark (${m}).`); } },
  beforeDelete: (row) => { if (db.get('SELECT COUNT(*) n FROM marks WHERE assessment_id = ?', row.id).n) throw bad('This assessment already has marks. Unpublish it instead.'); },
  select: `SELECT t.*, col.short_name AS college, c.code AS course_code, c.name AS course, sec.name AS section, (SELECT COUNT(*) FROM marks m WHERE m.assessment_id = t.id) AS marks_entered
    FROM assessments t JOIN colleges col ON col.id = t.college_id JOIN course_offerings o ON o.id = t.offering_id JOIN courses c ON c.id = o.course_id LEFT JOIN sections sec ON sec.id = o.section_id`,
  columns: [['course_code', 'Code'], ['course', 'Course'], ['section', 'Sec'], ['name', 'Assessment'], ['kind', 'Type'], ['max_marks', 'Max'], ['weight', 'Weight'], ['marks_entered', 'Entered'], ['published', 'Published']],
  search: ['t.name', 'c.code', 'c.name'], filters: ['college_id', 'offering_id', 'kind'] };
E.admins = { table: 'users', label: 'Administrator', level: 'admins', perm: 'manage_staff', soft: true, special: 'admin',
  fields: [{ key: 'role', label: 'Role', type: 'enum', options: ['university_admin', 'college_admin', 'department_admin'], required: true },
    { key: 'login_id', label: 'Login ID', type: 'string', required: true, max: 40, pattern: /^[A-Za-z0-9._-]+$/ }, { key: 'name', label: 'Name', type: 'string', required: true, max: 100 },
    { key: 'email', label: 'Email', type: 'email', required: true }, { key: 'university_id', label: 'University', type: 'ref', ref: 'universities' }, { key: 'college_id', label: 'College', type: 'ref', ref: 'colleges' },
    { key: 'department_id', label: 'Department', type: 'ref', ref: 'departments' }, { key: 'active', label: 'Active', type: 'bool' }],
  select: `SELECT t.id, t.role, t.login_id, t.name, t.email, t.university_id, t.college_id, t.department_id, t.active, t.last_login_at, un.short_name AS university, c.short_name AS college, d.code AS department
    FROM users t LEFT JOIN universities un ON un.id = t.university_id LEFT JOIN colleges c ON c.id = t.college_id LEFT JOIN departments d ON d.id = t.department_id`,
  columns: [['name', 'Name'], ['login_id', 'Login ID'], ['role', 'Role'], ['university', 'University'], ['college', 'College'], ['department', 'Dept'], ['last_login_at', 'Last login'], ['active', 'Status']],
  search: ['t.name', 't.login_id', 't.email'], filters: ['role', 'college_id'] };

// ---------- scope helpers ----------
const ADMIN_RANK = { super_admin: 4, university_admin: 3, college_admin: 2, department_admin: 1 };
function scopeSql(user, def) {
  if (def.level === 'platform') return user.role === 'super_admin' ? { sql: '1=1', params: [] } : { sql: 't.id = ?', params: [user.university_id] };
  if (def.level === 'university') {
    if (user.role === 'super_admin') return { sql: '1=1', params: [] };
    if (user.role === 'university_admin') return { sql: 't.university_id = ?', params: [user.university_id] };
    return { sql: 't.id = ?', params: [user.college_id] };
  }
  if (def.level === 'admins') {
    const roles = Object.keys(ADMIN_RANK).filter((r) => ADMIN_RANK[r] < ADMIN_RANK[user.role]);
    const base = `t.role IN (${roles.map(() => '?').join(',') || "''"})`;
    if (user.role === 'super_admin') return { sql: base, params: roles };
    if (user.role === 'university_admin') return { sql: `${base} AND t.university_id = ?`, params: [...roles, user.university_id] };
    return { sql: `${base} AND t.college_id = ?`, params: [...roles, user.college_id] };
  }
  const f = scope.orgFilter(user, 't');
  if (user.role === 'department_admin') {
    if (def.dept) return { sql: `${f.sql} AND t.department_id = ?`, params: [...f.params, user.department_id] };
    if (def.deptSelf) return { sql: `${f.sql} AND t.id = ?`, params: [...f.params, user.department_id] };
    if (def.deptVia) return { sql: `${f.sql} AND ${def.deptVia} = ?`, params: [...f.params, user.department_id] };
  }
  return f;
}

function loadScoped(user, def, id) {
  const sc = scopeSql(user, def);
  const row = db.get(`${def.select} WHERE t.id = ? AND ${sc.sql}`, id, ...sc.params);
  if (!row) {
    if (db.get(`SELECT 1 FROM ${def.table} WHERE id = ?`, id)) throw forbidden();
    throw notFound();
  }
  return row;
}

function coerce(field, v) {
  const name = field.label;
  switch (field.type) {
    case 'string': return toStr(v, name, { max: field.max || 200, optional: !field.required, pattern: field.pattern, patternMsg: field.patternMsg });
    case 'email': { const s = toStr(v, name, { max: 120, optional: !field.required }); if (s && !EMAIL.test(s)) throw bad(`${name} is not a valid email address.`); return s ? s.toLowerCase() : s; }
    case 'int': return toInt(v, name, { min: field.min ?? -1e9, max: field.max ?? 1e9, optional: !field.required });
    case 'number': return toNum(v, name, { min: field.min ?? -1e9, max: field.max ?? 1e9, optional: !field.required });
    case 'bool': return v === undefined || v === null || v === '' ? 1 : (v === true || v === 1 || v === '1' || v === 'true' || v === 'yes' || v === 'Active') ? 1 : 0;
    case 'date': return toDate(v, name, { optional: !field.required });
    case 'enum': if ((v === undefined || v === null || v === '') && !field.required) return null; if (!field.options.includes(v)) throw bad(`${name} must be one of: ${field.options.join(', ')}.`); return v;
    case 'color': if (!v) return null; if (!/^#[0-9a-fA-F]{6}$/.test(v)) throw bad(`${name} must be a colour like #1f4e79.`); return v;
    case 'ref': return toInt(v, name, { min: 1, optional: !field.required });
    default: return v;
  }
}

const REF_TABLE = { universities: 'universities', colleges: 'colleges', campuses: 'campuses', faculties: 'faculties', departments: 'departments', programmes: 'programmes', regulations: 'regulations',
  batches: 'batches', academic_years: 'academic_years', semesters: 'semesters', sections: 'sections', courses: 'courses', offerings: 'course_offerings', students: 'students', staff: 'staff' };

function checkRefs(def, row) {
  for (const f of def.fields) {
    if (f.type !== 'ref' || row[f.key] === null || row[f.key] === undefined || f.key === 'college_id' || f.key === 'university_id') continue;
    const ref = db.get(`SELECT * FROM ${REF_TABLE[f.ref]} WHERE id = ?`, row[f.key]);
    if (!ref) throw bad(`The selected ${f.label.toLowerCase()} does not exist.`);
    if (row.college_id && ref.college_id !== undefined && ref.college_id !== row.college_id) throw bad(`The selected ${f.label.toLowerCase()} belongs to a different college.`);
  }
}

function resolveOrg(ctx, def, body, prev) {
  const u = ctx.user;
  const out = {};
  if (def.level === 'university') {
    const uid = prev ? prev.university_id : Number(body.university_id || u.university_id);
    if (!uid || !(u.role === 'super_admin' || u.university_id === uid)) throw forbidden('You can only add colleges to your own university.');
    out.university_id = uid;
  } else if (def.level === 'college') {
    const cid = prev ? prev.college_id : Number(body.college_id || u.college_id);
    if (!cid || !scope.canAccessCollege(u, cid)) throw forbidden('You can only manage records in your own institution.');
    out.college_id = cid;
    out.university_id = db.get('SELECT university_id FROM colleges WHERE id = ?', cid).university_id;
  }
  return out;
}

function readRow(ctx, def, body, prev) {
  const row = {};
  for (const f of def.fields) {
    if (f.key === 'college_id' || (def.level === 'university' && f.key === 'university_id')) continue;
    const v = body[f.key] !== undefined ? body[f.key] : prev ? prev[f.key] : undefined;
    row[f.key] = coerce(f, v);
  }
  Object.assign(row, resolveOrg(ctx, def, body, prev));
  if (ctx.user.role === 'department_admin' && def.dept) row.department_id = ctx.user.department_id;
  return row;
}

const tableCols = (table) => new Set(db.all(`PRAGMA table_info(${table})`).map((c) => c.name));

function genPassword() { return 'Tmp-' + crypto.randomBytes(5).toString('hex'); }

function adminRowChecks(ctx, row) {
  const u = ctx.user;
  if (ADMIN_RANK[row.role] >= ADMIN_RANK[u.role]) throw forbidden('You can only create administrators below your own level.');
  if (row.role === 'university_admin') { if (!row.university_id) throw bad('Choose a university.'); row.college_id = null; row.department_id = null; }
  else {
    if (!row.college_id) throw bad('Choose a college.');
    row.university_id = db.get('SELECT university_id FROM colleges WHERE id = ?', row.college_id)?.university_id;
    if (row.role === 'college_admin') row.department_id = null;
    else if (!row.department_id || db.get('SELECT college_id FROM departments WHERE id = ?', row.department_id)?.college_id !== row.college_id) throw bad('Choose a department in that college.');
  }
  if (u.role === 'university_admin' && row.university_id !== u.university_id) throw forbidden();
  if (u.role === 'college_admin' && row.college_id !== u.college_id) throw forbidden();
}

function create(ctx, key) {
  const def = E[key];
  if (!scope.can(ctx.user, def.perm)) throw forbidden('Your role is not permitted to create this record.');
  const row = readRow(ctx, def, ctx.body, null);
  checkRefs(def, row);
  if (def.validate) def.validate(row, null);
  let id; let extra = {};
  db.tx(() => {
    if (def.special === 'student' || def.special === 'staff') {
      const password = ctx.body.password ? toStr(ctx.body.password, 'Password', { min: 8, max: 100 }) : genPassword();
      const loginId = def.special === 'student' ? row.roll_no : row.employee_code;
      const name = def.special === 'student' ? `${row.first_name} ${row.last_name || ''}`.trim() : row.name;
      const uid = Number(db.run('INSERT INTO users (university_id, college_id, department_id, role, login_id, email, name, password_hash, active) VALUES (?,?,?,?,?,?,?,?,?)',
        row.university_id, row.college_id, row.department_id, def.special, loginId, row.email, name, auth.hashPassword(password), row.active).lastInsertRowid);
      const cols = tableCols(def.table);
      const data = Object.fromEntries(Object.entries({ ...row, user_id: uid }).filter(([k]) => cols.has(k)));
      id = Number(db.run(`INSERT INTO ${def.table} (${Object.keys(data).join(',')}) VALUES (${Object.keys(data).map(() => '?').join(',')})`, ...Object.values(data)).lastInsertRowid);
      if (!ctx.body.password) extra.temporaryPassword = password;
    } else if (def.special === 'admin') {
      adminRowChecks(ctx, row);
      const password = ctx.body.password ? toStr(ctx.body.password, 'Password', { min: 8, max: 100 }) : genPassword();
      id = Number(db.run('INSERT INTO users (university_id, college_id, department_id, role, login_id, email, name, password_hash, active) VALUES (?,?,?,?,?,?,?,?,?)',
        row.university_id, row.college_id, row.department_id, row.role, row.login_id, row.email, row.name, auth.hashPassword(password), row.active).lastInsertRowid);
      if (!ctx.body.password) extra.temporaryPassword = password;
    } else {
      const cols = tableCols(def.table);
      const data = Object.fromEntries(Object.entries(row).filter(([k]) => cols.has(k)));
      id = Number(db.run(`INSERT INTO ${def.table} (${Object.keys(data).join(',')}) VALUES (${Object.keys(data).map(() => '?').join(',')})`, ...Object.values(data)).lastInsertRowid);
    }
    if (def.afterSave) def.afterSave(ctx, row, id, null);
    audit(ctx, { action: 'create', entity: key, entityId: id, collegeId: row.college_id || null, universityId: row.university_id || null,
      summary: `Created ${def.label.toLowerCase()} ${row.name || row.code || row.roll_no || row.employee_code || row.login_id || `#${id}`}`, next: { ...row } });
  });
  return { id, ...extra };
}

function update(ctx, key, id) {
  const def = E[key];
  if (!scope.can(ctx.user, def.perm)) throw forbidden('Your role is not permitted to change this record.');
  const prev = loadScoped(ctx.user, def, id);
  const row = readRow(ctx, def, ctx.body, prev);
  checkRefs(def, row);
  if (def.validate) def.validate(row, prev);
  const d = diff(prev, row);
  if (!d.changed) return { ok: true, unchanged: true };
  db.tx(() => {
    if (def.special === 'admin') {
      adminRowChecks(ctx, row);
      db.run('UPDATE users SET role=?, login_id=?, name=?, email=?, university_id=?, college_id=?, department_id=?, active=? WHERE id = ?', row.role, row.login_id, row.name, row.email, row.university_id, row.college_id, row.department_id, row.active, id);
    } else {
      const cols = tableCols(def.table);
      const data = Object.fromEntries(Object.entries(row).filter(([k]) => cols.has(k) && k !== 'college_id' && k !== 'university_id'));
      db.run(`UPDATE ${def.table} SET ${Object.keys(data).map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...Object.values(data), id);
      if (def.special === 'student') db.run('UPDATE users SET email = ?, name = ?, login_id = ?, department_id = ?, active = ? WHERE id = ?', row.email, `${row.first_name} ${row.last_name || ''}`.trim(), row.roll_no, row.department_id, row.active, prev.user_id);
      if (def.special === 'staff') db.run('UPDATE users SET email = ?, name = ?, login_id = ?, department_id = ?, active = ? WHERE id = ?', row.email, row.name, row.employee_code, row.department_id, row.active, prev.user_id);
    }
    if ((def.special === 'student' || def.special === 'staff' || def.special === 'admin') && !row.active) db.run('DELETE FROM sessions WHERE user_id = ?', def.special === 'admin' ? id : prev.user_id);
    if (def.afterSave) def.afterSave(ctx, row, id, prev);
    audit(ctx, { action: 'update', entity: key, entityId: id, collegeId: prev.college_id || null, universityId: prev.university_id || null,
      summary: `Updated ${def.label.toLowerCase()} ${prev.name || prev.code || prev.roll_no || prev.employee_code || prev.login_id || prev.student || `#${id}`}: ${Object.keys(d.next).join(', ')}`, previous: d.prev, next: d.next });
  });
  if (key === 'students' && (d.next.batch_id || d.next.active !== undefined)) events.enqueue(() => events.reassess(id, 'profile-change'));
  return { ok: true };
}

function remove(ctx, key, id) {
  const def = E[key];
  if (!scope.can(ctx.user, def.perm)) throw forbidden('Your role is not permitted to remove this record.');
  const prev = loadScoped(ctx.user, def, id);
  if (def.soft) { ctx.body = { ...prev, active: 0 }; const r = update(ctx, key, id); return { ...r, deactivated: true }; }
  if (def.dropStatus) { ctx.body = { ...prev, status: 'Dropped' }; const r = update(ctx, key, id); return { ...r, dropped: true }; }
  if (def.beforeDelete) def.beforeDelete(prev);
  db.run(`DELETE FROM ${def.table} WHERE id = ?`, id);
  audit(ctx, { action: 'delete', entity: key, entityId: id, collegeId: prev.college_id || null, summary: `Deleted ${def.label.toLowerCase()} ${prev.name || `#${id}`}`, previous: prev });
  return { ok: true, deleted: true };
}

function list(ctx, key) {
  const def = E[key];
  const sc = scopeSql(ctx.user, def);
  const where = [sc.sql]; const params = [...sc.params];
  for (const f of def.filters || []) {
    if (ctx.query[f] === undefined || ctx.query[f] === '') continue;
    where.push(`t.${f} = ?`); params.push(/^-?\d+$/.test(ctx.query[f]) ? Number(ctx.query[f]) : ctx.query[f]);
  }
  if (ctx.query.status === 'active') where.push(def.dropStatus ? "t.status = 'Registered'" : 't.active = 1');
  if (ctx.query.status === 'inactive') where.push(def.dropStatus ? "t.status = 'Dropped'" : 't.active = 0');
  if (ctx.query.q && def.search) { where.push(`(${def.search.map((s) => `lower(${s}) LIKE ?`).join(' OR ')})`); params.push(...def.search.map(() => `%${ctx.query.q.toLowerCase()}%`)); }
  const base = `SELECT * FROM (${def.select} WHERE ${where.join(' AND ')})`;
  const sortCol = def.columns.find((c) => c[0] === ctx.query.sort) ? ctx.query.sort : null;
  const res = paged(`SELECT COUNT(*) n FROM (${base})`, `${base} ORDER BY ${sortCol ? `"${sortCol}" ${ctx.query.dir === 'desc' ? 'DESC' : 'ASC'}` : 'id DESC'}`, params, ctx.query);
  if (key === 'admins') res.rows = res.rows.map(({ password_hash, ...r }) => r);
  return res;
}

module.exports = (api) => {
  const ADMIN = { roles: scope.ADMIN_ROLES };
  api.get('/api/admin/entities', (ctx) => Object.fromEntries(Object.entries(E).map(([k, d]) => [k, {
    label: d.label, level: d.level, canEdit: scope.can(ctx.user, d.perm) && !(d.level === 'platform' && ctx.user.role !== 'super_admin'),
    fields: d.fields.map(({ pattern, ...f }) => f), columns: d.columns.map(([key, label]) => ({ key, label })), filters: d.filters || [], soft: !!d.soft, hard: !!d.hard, dropStatus: !!d.dropStatus,
  }])), ADMIN);
  const entity = (ctx) => { const k = ctx.params.entity; if (!E[k]) throw notFound('Unknown record type.'); return k; };
  api.get('/api/admin/entities/:entity', (ctx) => list(ctx, entity(ctx)), ADMIN);
  api.get('/api/admin/entities/:entity/:id', (ctx) => { const k = entity(ctx); const r = loadScoped(ctx.user, E[k], toInt(ctx.params.id, 'Id', { min: 1 })); delete r.password_hash; return r; }, ADMIN);
  api.post('/api/admin/entities/:entity', (ctx) => create(ctx, entity(ctx)), ADMIN);
  api.put('/api/admin/entities/:entity/:id', (ctx) => update(ctx, entity(ctx), toInt(ctx.params.id, 'Id', { min: 1 })), ADMIN);
  api.del('/api/admin/entities/:entity/:id', (ctx) => remove(ctx, entity(ctx), toInt(ctx.params.id, 'Id', { min: 1 })), ADMIN);

  // Dropdown lookups (scoped, capped)
  api.get('/api/admin/lookup/:entity', (ctx) => {
    const k = entity(ctx); const def = E[k];
    const sc = scopeSql(ctx.user, def);
    const where = [sc.sql]; const params = [...sc.params];
    for (const f of def.filters || []) if (ctx.query[f]) { where.push(`t.${f} = ?`); params.push(Number(ctx.query[f]) || ctx.query[f]); }
    if (ctx.query.collegeId && def.level === 'college') { where.push('t.college_id = ?'); params.push(Number(ctx.query.collegeId)); }
    if (ctx.query.q && def.search) { where.push(`(${def.search.map((s) => `lower(${s}) LIKE ?`).join(' OR ')})`); params.push(...def.search.map(() => `%${ctx.query.q.toLowerCase()}%`)); }
    const label = { universities: "t.name", colleges: "t.name", students: "t.roll_no || ' - ' || t.first_name || ' ' || t.last_name", staff: "t.employee_code || ' - ' || u.name",
      offerings: "c.code || ' ' || c.name || ' (' || b.name || COALESCE(' · Sec ' || sec.name, '') || ')'", courses: "t.code || ' ' || t.name", departments: "t.code || ' - ' || t.name",
      programmes: "t.code || ' - ' || t.name", batches: "p.code || ' ' || t.name", sections: "p.code || ' ' || b.name || ' · ' || t.name", semesters: 't.name', academic_years: 't.name', regulations: "t.code || ' - ' || t.name",
      campuses: 't.name', faculties: 't.name', registrations: "s.roll_no || ' · ' || c.code", assessments: "c.code || ' · ' || t.name", admins: 't.name' }[k] || 't.id';
    return lookup(ctx, k, label, where, params);
  }, ADMIN);
  function lookup(ctx, k, label, where, params) {
    const def = E[k];
    return { rows: db.all(`SELECT t.id, ${label} AS label ${def.select.slice(def.select.indexOf(' FROM ' + def.table + ' t'))} WHERE ${where.join(' AND ')} ${def.soft ? 'AND t.active = 1' : ''} ORDER BY label LIMIT 300`, ...params) };
  }

  // Bulk helpers for course registration
  api.post('/api/admin/registrations/bulk', (ctx) => {
    if (!scope.can(ctx.user, 'manage_registrations')) throw forbidden();
    const oid = toInt(ctx.body.offeringId, 'Course offering', { min: 1 });
    if (!scope.canAccessOffering(ctx.user, oid)) throw forbidden();
    const o = db.get('SELECT * FROM course_offerings WHERE id = ?', oid);
    const students = db.all(`SELECT id, user_id FROM students WHERE batch_id = ? AND active = 1 ${o.section_id ? 'AND section_id = ?' : ''}`, o.batch_id, ...(o.section_id ? [o.section_id] : []));
    let added = 0;
    db.tx(() => {
      for (const s of students) {
        const r = db.run("INSERT INTO course_registrations (university_id, college_id, student_id, offering_id, status) VALUES (?,?,?,?, 'Registered') ON CONFLICT(student_id, offering_id) DO UPDATE SET status = 'Registered' WHERE status != 'Registered'", o.university_id, o.college_id, s.id, oid);
        if (r.changes) { added++; events.enqueue(() => events.reassess(s.id, 'registration')); }
      }
      audit(ctx, { action: 'create', entity: 'registrations', entityId: oid, collegeId: o.college_id, summary: `Bulk-registered ${added} students to offering #${oid}`, next: { added } });
    });
    return { ok: true, added };
  }, ADMIN);
};
module.exports.ENTITIES = E;
module.exports.create = create;
module.exports.update = update;
module.exports.scopeSql = scopeSql;
