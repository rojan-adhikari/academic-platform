// Database layer: Node's built-in SQLite (node:sqlite), relational schema with
// organization identifiers on every tenant-owned table, plus indexes for scale.
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'platform.db');

const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS platform (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT NOT NULL,
  demo_mode INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS universities (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  short_name TEXT NOT NULL,
  location TEXT,
  affiliation TEXT,
  type TEXT,
  accent TEXT DEFAULT '#1f4e79',
  logo TEXT,
  established INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS colleges (
  id INTEGER PRIMARY KEY,
  university_id INTEGER NOT NULL REFERENCES universities(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  short_name TEXT NOT NULL,
  location TEXT,
  institution_code TEXT,
  category TEXT,
  established INTEGER,
  website TEXT,
  accent TEXT DEFAULT '#1f4e79',
  logo TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  UNIQUE (university_id, code)
);
CREATE INDEX IF NOT EXISTS ix_colleges_univ ON colleges(university_id);

CREATE TABLE IF NOT EXISTS voice_sheets (
  id INTEGER PRIMARY KEY,
  college_id INTEGER REFERENCES colleges(id),
  owner_id INTEGER NOT NULL REFERENCES users(id),
  offering_id INTEGER REFERENCES course_offerings(id),
  title TEXT NOT NULL,
  columns TEXT NOT NULL,
  rows TEXT NOT NULL,
  meta TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_voice_sheets_owner ON voice_sheets(owner_id);

-- Campus guide (KPR Compass): one published dataset per college plus visitor-facing records.
CREATE TABLE IF NOT EXISTS campus_guides (
  college_id INTEGER PRIMARY KEY REFERENCES colleges(id),
  name TEXT NOT NULL DEFAULT 'Campus Guide',
  payload TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_by INTEGER,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS campus_participations (
  id TEXT PRIMARY KEY,
  college_id INTEGER NOT NULL REFERENCES colleges(id),
  event_id TEXT NOT NULL,
  event_title TEXT NOT NULL,
  name TEXT NOT NULL,
  institution TEXT NOT NULL,
  email TEXT NOT NULL,
  student_id INTEGER REFERENCES students(id),
  status TEXT NOT NULL DEFAULT 'registered' CHECK (status IN ('registered','checked_in','cancelled')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (college_id, event_id, email)
);
CREATE TABLE IF NOT EXISTS campus_visitors (
  id TEXT PRIMARY KEY,
  college_id INTEGER NOT NULL REFERENCES colleges(id),
  name TEXT NOT NULL,
  institution TEXT NOT NULL DEFAULT '',
  badge_code TEXT NOT NULL,
  event_name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS campus_id_checkins (
  id TEXT PRIMARY KEY,
  college_id INTEGER NOT NULL REFERENCES colleges(id),
  name TEXT NOT NULL,
  institution TEXT NOT NULL DEFAULT '',
  event_name TEXT NOT NULL DEFAULT '',
  front_file TEXT NOT NULL,
  back_file TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','reviewed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS campus_files (
  id TEXT PRIMARY KEY,
  college_id INTEGER NOT NULL REFERENCES colleges(id),
  kind TEXT NOT NULL CHECK (kind IN ('poster','map','id')),
  mime TEXT NOT NULL,
  path TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS campuses (
  id INTEGER PRIMARY KEY,
  university_id INTEGER NOT NULL REFERENCES universities(id),
  college_id INTEGER NOT NULL REFERENCES colleges(id),
  name TEXT NOT NULL,
  address TEXT,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS faculties (
  id INTEGER PRIMARY KEY,
  university_id INTEGER NOT NULL REFERENCES universities(id),
  college_id INTEGER NOT NULL REFERENCES colleges(id),
  campus_id INTEGER REFERENCES campuses(id),
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS departments (
  id INTEGER PRIMARY KEY,
  university_id INTEGER NOT NULL REFERENCES universities(id),
  college_id INTEGER NOT NULL REFERENCES colleges(id),
  faculty_id INTEGER REFERENCES faculties(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  UNIQUE (college_id, code)
);

CREATE TABLE IF NOT EXISTS programmes (
  id INTEGER PRIMARY KEY,
  university_id INTEGER NOT NULL REFERENCES universities(id),
  college_id INTEGER NOT NULL REFERENCES colleges(id),
  department_id INTEGER NOT NULL REFERENCES departments(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  degree_type TEXT NOT NULL DEFAULT 'UG',
  duration_years INTEGER NOT NULL DEFAULT 4,
  active INTEGER NOT NULL DEFAULT 1,
  UNIQUE (college_id, code)
);

CREATE TABLE IF NOT EXISTS regulations (
  id INTEGER PRIMARY KEY,
  university_id INTEGER NOT NULL REFERENCES universities(id),
  college_id INTEGER NOT NULL REFERENCES colleges(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  effective_year INTEGER,
  total_semesters INTEGER NOT NULL DEFAULT 8,
  min_credits INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  UNIQUE (college_id, code)
);

CREATE TABLE IF NOT EXISTS batches (
  id INTEGER PRIMARY KEY,
  university_id INTEGER NOT NULL REFERENCES universities(id),
  college_id INTEGER NOT NULL REFERENCES colleges(id),
  programme_id INTEGER NOT NULL REFERENCES programmes(id),
  regulation_id INTEGER NOT NULL REFERENCES regulations(id),
  name TEXT NOT NULL,
  start_year INTEGER NOT NULL,
  end_year INTEGER NOT NULL,
  current_semester INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  CHECK (end_year > start_year),
  CHECK (current_semester BETWEEN 1 AND 12)
);

CREATE TABLE IF NOT EXISTS academic_years (
  id INTEGER PRIMARY KEY,
  university_id INTEGER NOT NULL REFERENCES universities(id),
  college_id INTEGER NOT NULL REFERENCES colleges(id),
  name TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  is_current INTEGER NOT NULL DEFAULT 0,
  UNIQUE (college_id, name)
);

CREATE TABLE IF NOT EXISTS semesters (
  id INTEGER PRIMARY KEY,
  university_id INTEGER NOT NULL REFERENCES universities(id),
  college_id INTEGER NOT NULL REFERENCES colleges(id),
  academic_year_id INTEGER NOT NULL REFERENCES academic_years(id),
  term TEXT NOT NULL CHECK (term IN ('Odd','Even')),
  name TEXT NOT NULL,
  start_date TEXT,
  end_date TEXT,
  is_current INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sections (
  id INTEGER PRIMARY KEY,
  university_id INTEGER NOT NULL REFERENCES universities(id),
  college_id INTEGER NOT NULL REFERENCES colleges(id),
  batch_id INTEGER NOT NULL REFERENCES batches(id),
  name TEXT NOT NULL,
  UNIQUE (batch_id, name)
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  university_id INTEGER REFERENCES universities(id),
  college_id INTEGER REFERENCES colleges(id),
  department_id INTEGER REFERENCES departments(id),
  role TEXT NOT NULL CHECK (role IN ('super_admin','university_admin','college_admin','department_admin','staff','student')),
  login_id TEXT NOT NULL,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  last_login_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_users_login ON users(IFNULL(college_id, 0), IFNULL(university_id, 0), lower(login_id));
CREATE INDEX IF NOT EXISTS ix_users_email ON users(lower(email));

CREATE TABLE IF NOT EXISTS students (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
  university_id INTEGER NOT NULL REFERENCES universities(id),
  college_id INTEGER NOT NULL REFERENCES colleges(id),
  department_id INTEGER NOT NULL REFERENCES departments(id),
  programme_id INTEGER NOT NULL REFERENCES programmes(id),
  batch_id INTEGER NOT NULL REFERENCES batches(id),
  section_id INTEGER REFERENCES sections(id),
  regulation_id INTEGER NOT NULL REFERENCES regulations(id),
  roll_no TEXT NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL DEFAULT '',
  gender TEXT,
  current_semester INTEGER NOT NULL DEFAULT 1 CHECK (current_semester BETWEEN 1 AND 12),
  active INTEGER NOT NULL DEFAULT 1,
  UNIQUE (college_id, roll_no)
);
CREATE INDEX IF NOT EXISTS ix_students_scope ON students(college_id, department_id, batch_id);

CREATE TABLE IF NOT EXISTS staff (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
  university_id INTEGER NOT NULL REFERENCES universities(id),
  college_id INTEGER NOT NULL REFERENCES colleges(id),
  department_id INTEGER NOT NULL REFERENCES departments(id),
  employee_code TEXT NOT NULL,
  designation TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  UNIQUE (college_id, employee_code)
);

CREATE TABLE IF NOT EXISTS courses (
  id INTEGER PRIMARY KEY,
  university_id INTEGER NOT NULL REFERENCES universities(id),
  college_id INTEGER NOT NULL REFERENCES colleges(id),
  department_id INTEGER NOT NULL REFERENCES departments(id),
  regulation_id INTEGER NOT NULL REFERENCES regulations(id),
  programme_id INTEGER REFERENCES programmes(id),
  semester_number INTEGER NOT NULL CHECK (semester_number BETWEEN 1 AND 12),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  course_type TEXT NOT NULL,
  credits REAL NOT NULL CHECK (credits >= 0 AND credits <= 12),
  active INTEGER NOT NULL DEFAULT 1,
  UNIQUE (college_id, regulation_id, code)
);

-- A course offering is a course taught to one section in one semester by one
-- faculty member. This is the FacultyAssignments entity.
CREATE TABLE IF NOT EXISTS course_offerings (
  id INTEGER PRIMARY KEY,
  university_id INTEGER NOT NULL REFERENCES universities(id),
  college_id INTEGER NOT NULL REFERENCES colleges(id),
  course_id INTEGER NOT NULL REFERENCES courses(id),
  semester_id INTEGER NOT NULL REFERENCES semesters(id),
  batch_id INTEGER NOT NULL REFERENCES batches(id),
  section_id INTEGER REFERENCES sections(id),
  staff_id INTEGER REFERENCES staff(id),
  registration_open INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS ix_offerings_staff ON course_offerings(staff_id);
CREATE INDEX IF NOT EXISTS ix_offerings_scope ON course_offerings(college_id, batch_id);

CREATE TABLE IF NOT EXISTS course_registrations (
  id INTEGER PRIMARY KEY,
  university_id INTEGER NOT NULL,
  college_id INTEGER NOT NULL REFERENCES colleges(id),
  student_id INTEGER NOT NULL REFERENCES students(id),
  offering_id INTEGER NOT NULL REFERENCES course_offerings(id),
  status TEXT NOT NULL DEFAULT 'Registered' CHECK (status IN ('Registered','Pending','Dropped')),
  registered_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (student_id, offering_id)
);
CREATE INDEX IF NOT EXISTS ix_reg_offering ON course_registrations(offering_id);

CREATE TABLE IF NOT EXISTS attendance_sessions (
  id INTEGER PRIMARY KEY,
  college_id INTEGER NOT NULL REFERENCES colleges(id),
  offering_id INTEGER NOT NULL REFERENCES course_offerings(id),
  held_on TEXT NOT NULL,
  period INTEGER NOT NULL DEFAULT 1,
  topic TEXT,
  created_by INTEGER REFERENCES users(id),
  UNIQUE (offering_id, held_on, period)
);

CREATE TABLE IF NOT EXISTS attendance (
  id INTEGER PRIMARY KEY,
  college_id INTEGER NOT NULL REFERENCES colleges(id),
  session_id INTEGER NOT NULL REFERENCES attendance_sessions(id) ON DELETE CASCADE,
  offering_id INTEGER NOT NULL REFERENCES course_offerings(id),
  student_id INTEGER NOT NULL REFERENCES students(id),
  present INTEGER NOT NULL CHECK (present IN (0,1)),
  UNIQUE (session_id, student_id)
);
CREATE INDEX IF NOT EXISTS ix_att_student ON attendance(student_id, offering_id);

-- Assessments cover internal tests, quizzes, labs and assignments; the structure
-- (names, max marks, weights) is configured per offering, never hard-coded.
CREATE TABLE IF NOT EXISTS assessments (
  id INTEGER PRIMARY KEY,
  college_id INTEGER NOT NULL REFERENCES colleges(id),
  offering_id INTEGER NOT NULL REFERENCES course_offerings(id),
  name TEXT NOT NULL,
  short_name TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('internal','quiz','assignment','lab','exam')),
  max_marks REAL NOT NULL CHECK (max_marks > 0 AND max_marks <= 1000),
  weight REAL NOT NULL DEFAULT 1,
  sequence INTEGER NOT NULL DEFAULT 1,
  held_on TEXT,
  due_on TEXT,
  description TEXT,
  published INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS ix_assess_offering ON assessments(offering_id);

CREATE TABLE IF NOT EXISTS marks (
  id INTEGER PRIMARY KEY,
  college_id INTEGER NOT NULL REFERENCES colleges(id),
  assessment_id INTEGER NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id),
  marks REAL NOT NULL CHECK (marks >= 0),
  entry_method TEXT NOT NULL DEFAULT 'manual',
  updated_by INTEGER REFERENCES users(id),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (assessment_id, student_id)
);
CREATE INDEX IF NOT EXISTS ix_marks_student ON marks(student_id);

CREATE TABLE IF NOT EXISTS academic_history (
  id INTEGER PRIMARY KEY,
  college_id INTEGER NOT NULL REFERENCES colleges(id),
  student_id INTEGER NOT NULL REFERENCES students(id),
  semester_number INTEGER NOT NULL,
  sgpa REAL NOT NULL CHECK (sgpa BETWEEN 0 AND 10),
  attendance_pct REAL,
  credits_earned REAL,
  UNIQUE (student_id, semester_number)
);

CREATE TABLE IF NOT EXISTS model_registry (
  version TEXT PRIMARY KEY,
  dataset_version TEXT NOT NULL,
  algorithm TEXT NOT NULL,
  features TEXT NOT NULL,
  coefficients TEXT NOT NULL,
  metrics TEXT NOT NULL,
  trained_at TEXT NOT NULL DEFAULT (datetime('now')),
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS risk_analysis (
  id INTEGER PRIMARY KEY,
  college_id INTEGER NOT NULL REFERENCES colleges(id),
  student_id INTEGER NOT NULL REFERENCES students(id),
  offering_id INTEGER REFERENCES course_offerings(id),
  level TEXT NOT NULL CHECK (level IN ('Normal','Attention','High')),
  probability REAL NOT NULL,
  factors TEXT NOT NULL,
  features TEXT NOT NULL,
  model_version TEXT NOT NULL,
  dataset_version TEXT NOT NULL,
  trigger TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  is_latest INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS ix_risk_latest ON risk_analysis(college_id, is_latest, level);
CREATE INDEX IF NOT EXISTS ix_risk_student ON risk_analysis(student_id, offering_id, is_latest);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY,
  college_id INTEGER REFERENCES colleges(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  type TEXT NOT NULL CHECK (type IN ('marks','attendance','risk','course','registration','admin','system','club','classroom','event')),
  severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warning','critical','success')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  link TEXT,
  dedupe_key TEXT,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_notif_user ON notifications(user_id, is_read, created_at);
CREATE INDEX IF NOT EXISTS ix_notif_dedupe ON notifications(user_id, dedupe_key);

CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY,
  university_id INTEGER REFERENCES universities(id),
  college_id INTEGER REFERENCES colleges(id),
  offering_id INTEGER REFERENCES course_offerings(id),
  audience TEXT NOT NULL DEFAULT 'all' CHECK (audience IN ('all','students','staff')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY,
  university_id INTEGER,
  college_id INTEGER,
  user_id INTEGER,
  user_name TEXT,
  role TEXT,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id INTEGER,
  summary TEXT,
  previous_value TEXT,
  new_value TEXT,
  ip TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_audit_scope ON audit_logs(college_id, created_at);

-- Settings cascade: platform (scope_id 0) -> university -> college.
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('platform','university','college')),
  scope_id INTEGER NOT NULL DEFAULT 0,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  UNIQUE (scope_type, scope_id, key)
);

-- Configurable permissions per role (role -> permission key).
CREATE TABLE IF NOT EXISTS role_permissions (
  id INTEGER PRIMARY KEY,
  role TEXT NOT NULL,
  permission TEXT NOT NULL,
  allowed INTEGER NOT NULL DEFAULT 1,
  UNIQUE (role, permission)
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  csrf TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  remember INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS otp_codes (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  code_hash TEXT NOT NULL,
  purpose TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);

-- ---- Student clubs / societies ----
CREATE TABLE IF NOT EXISTS clubs (
  id INTEGER PRIMARY KEY,
  university_id INTEGER NOT NULL REFERENCES universities(id),
  college_id INTEGER NOT NULL REFERENCES colleges(id),
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT,
  lead_staff_id INTEGER REFERENCES staff(id),
  active INTEGER NOT NULL DEFAULT 1,
  UNIQUE (college_id, name)
);
CREATE TABLE IF NOT EXISTS club_memberships (
  id INTEGER PRIMARY KEY,
  club_id INTEGER NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  college_id INTEGER NOT NULL REFERENCES colleges(id),
  student_id INTEGER NOT NULL REFERENCES students(id),
  role TEXT NOT NULL DEFAULT 'Member',
  status TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Left')),
  phone TEXT,
  interest TEXT,
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (club_id, student_id)
);
CREATE INDEX IF NOT EXISTS ix_club_mem ON club_memberships(club_id, status);

-- ---- Weekly class timetable: one recurring slot per (section, day, period) ----
-- day 1=Mon .. 6=Sat. A slot is either a course (offering_id) or a labelled block.
CREATE TABLE IF NOT EXISTS timetable_slots (
  id INTEGER PRIMARY KEY,
  college_id INTEGER NOT NULL REFERENCES colleges(id),
  section_id INTEGER NOT NULL REFERENCES sections(id),
  day INTEGER NOT NULL CHECK (day BETWEEN 1 AND 6),
  period INTEGER NOT NULL CHECK (period BETWEEN 1 AND 7),
  offering_id INTEGER REFERENCES course_offerings(id) ON DELETE CASCADE,
  label TEXT,
  kind TEXT NOT NULL DEFAULT 'class',
  UNIQUE (section_id, day, period)
);
CREATE INDEX IF NOT EXISTS ix_tt_section ON timetable_slots(section_id);
CREATE INDEX IF NOT EXISTS ix_tt_offering ON timetable_slots(offering_id);

-- ---- Classroom (Google-Classroom-style stream per course offering) ----
CREATE TABLE IF NOT EXISTS classroom_posts (
  id INTEGER PRIMARY KEY,
  college_id INTEGER NOT NULL REFERENCES colleges(id),
  offering_id INTEGER NOT NULL REFERENCES course_offerings(id) ON DELETE CASCADE,
  author_id INTEGER REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('assignment','note','material')),
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,
  file_id TEXT,
  file_name TEXT,
  due_on TEXT,
  points REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_cls_offering ON classroom_posts(offering_id, created_at);
CREATE TABLE IF NOT EXISTS classroom_submissions (
  id INTEGER PRIMARY KEY,
  post_id INTEGER NOT NULL REFERENCES classroom_posts(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id),
  note TEXT,
  link TEXT,
  file_id TEXT,
  file_name TEXT,
  status TEXT NOT NULL DEFAULT 'Submitted' CHECK (status IN ('Submitted','Returned')),
  submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (post_id, student_id)
);
-- Uploaded PDFs for classroom posts (teacher notes/materials) and submissions (student work).
CREATE TABLE IF NOT EXISTS classroom_files (
  id TEXT PRIMARY KEY,
  college_id INTEGER NOT NULL REFERENCES colleges(id),
  offering_id INTEGER NOT NULL REFERENCES course_offerings(id) ON DELETE CASCADE,
  uploaded_by INTEGER REFERENCES users(id),
  mime TEXT NOT NULL,
  name TEXT NOT NULL,
  size INTEGER NOT NULL,
  path TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

let db;
function open() {
  if (db) return db;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
  db.exec(SCHEMA);
  return db;
}

function all(sql, ...params) { return open().prepare(sql).all(...params); }
function get(sql, ...params) { return open().prepare(sql).get(...params); }
function run(sql, ...params) { return open().prepare(sql).run(...params); }
// Transactions nest through savepoints so composed operations stay atomic.
let depth = 0;
function tx(fn) {
  const d = open();
  const sp = `sp${depth}`;
  d.exec(depth === 0 ? 'BEGIN' : `SAVEPOINT ${sp}`);
  depth++;
  try {
    const r = fn();
    depth--;
    d.exec(depth === 0 ? 'COMMIT' : `RELEASE ${sp}`);
    return r;
  } catch (e) {
    depth--;
    d.exec(depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${sp}; RELEASE ${sp}`);
    throw e;
  }
}
function close() { if (db) { db.close(); db = null; } }

module.exports = { open, all, get, run, tx, close, DB_PATH };
