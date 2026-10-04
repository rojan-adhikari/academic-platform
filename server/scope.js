// Organization-scope enforcement. Every data query derives its tenant filter from
// the authenticated user, never from ids supplied by the client.
const db = require('./db');

const ADMIN_ROLES = ['super_admin', 'university_admin', 'college_admin', 'department_admin'];
const ROLE_LABEL = {
  super_admin: 'Platform Super Administrator',
  university_admin: 'University Administrator',
  college_admin: 'College Administrator',
  department_admin: 'Department Administrator',
  staff: 'Staff / Professor',
  student: 'Student',
};

const PERMISSIONS = {
  manage_universities: 'Create and edit universities',
  manage_colleges: 'Create and edit colleges',
  manage_structure: 'Configure departments, programmes, regulations, batches, years, semesters, sections',
  manage_students: 'Create, edit, deactivate and import students',
  manage_staff: 'Create, edit, deactivate and import staff',
  manage_courses: 'Create courses and assign faculty',
  manage_registrations: 'Manage course registration',
  manage_attendance: 'Record and correct attendance',
  manage_marks: 'Enter and correct marks',
  manage_assessments: 'Configure assessments and assignments',
  manage_settings: 'Change thresholds and risk settings',
  manage_permissions: 'Change role permissions',
  send_announcements: 'Send announcements and notifications',
  view_analytics: 'View analytics and risk monitoring',
  view_audit: 'View audit logs',
  import_export: 'Import and export data',
  manage_campus_guide: 'Publish the campus guide: map, events, venues and visitor check-in',
};

const DEFAULT_GRANTS = {
  super_admin: Object.keys(PERMISSIONS),
  // Admins manage structure, people and marks, but assessments/assignments are the teacher's
  // responsibility — they cannot add or remove assessments (and the classroom is staff-only).
  university_admin: Object.keys(PERMISSIONS).filter((p) => !['manage_universities', 'manage_permissions', 'manage_assessments'].includes(p)),
  college_admin: Object.keys(PERMISSIONS).filter((p) => !['manage_universities', 'manage_colleges', 'manage_permissions', 'manage_assessments'].includes(p)),
  department_admin: ['manage_students', 'manage_courses', 'manage_registrations', 'manage_attendance', 'manage_marks',
    'send_announcements', 'view_analytics', 'view_audit', 'import_export'],
  staff: ['manage_attendance', 'manage_marks', 'manage_assessments', 'send_announcements', 'view_analytics'],
  student: [],
};

let permCache = null;
function can(user, permission) {
  if (!user) return false;
  if (user.role === 'super_admin') return true;
  if (!permCache) {
    permCache = new Map();
    for (const r of db.all('SELECT role, permission, allowed FROM role_permissions')) permCache.set(`${r.role}:${r.permission}`, !!r.allowed);
  }
  const key = `${user.role}:${permission}`;
  if (permCache.has(key)) return permCache.get(key);
  return (DEFAULT_GRANTS[user.role] || []).includes(permission);
}
function invalidatePermissions() { permCache = null; }

const isAdmin = (u) => ADMIN_ROLES.includes(u.role);

function staffRow(user) { return db.get('SELECT * FROM staff WHERE user_id = ? AND active = 1', user.id); }
function studentRow(user) { return db.get('SELECT * FROM students WHERE user_id = ? AND active = 1', user.id); }

// Returns a SQL fragment restricting rows of a table alias that carries
// university_id / college_id (and optionally department_id) columns.
function orgFilter(user, alias, { department = false, viaCollege = false } = {}) {
  const a = alias ? alias + '.' : '';
  switch (user.role) {
    case 'super_admin': return { sql: '1=1', params: [] };
    case 'university_admin': return viaCollege
      ? { sql: `${a}college_id IN (SELECT id FROM colleges WHERE university_id = ?)`, params: [user.university_id] }
      : { sql: `${a}university_id = ?`, params: [user.university_id] };
    case 'college_admin': return { sql: `${a}college_id = ?`, params: [user.college_id] };
    case 'department_admin':
      return department
        ? { sql: `${a}college_id = ? AND ${a}department_id = ?`, params: [user.college_id, user.department_id] }
        : { sql: `${a}college_id = ?`, params: [user.college_id] };
    default: return { sql: `${a}college_id = ?`, params: [user.college_id] };
  }
}

function collegeIds(user) {
  if (user.role === 'super_admin') return db.all('SELECT id FROM colleges').map((r) => r.id);
  if (user.role === 'university_admin') return db.all('SELECT id FROM colleges WHERE university_id = ?', user.university_id).map((r) => r.id);
  return [user.college_id];
}

function canAccessCollege(user, collegeId) {
  if (user.role === 'super_admin') return true;
  const c = db.get('SELECT university_id FROM colleges WHERE id = ?', collegeId);
  if (!c) return false;
  if (user.role === 'university_admin') return c.university_id === user.university_id;
  return user.college_id === collegeId;
}

function canAccessOffering(user, offeringId) {
  const o = db.get(`SELECT o.*, c.department_id FROM course_offerings o JOIN courses c ON c.id = o.course_id WHERE o.id = ?`, offeringId);
  if (!o) return false;
  if (user.role === 'staff') { const s = staffRow(user); return !!s && o.staff_id === s.id; }
  if (user.role === 'student') {
    const st = studentRow(user);
    return !!st && !!db.get("SELECT 1 FROM course_registrations WHERE student_id = ? AND offering_id = ? AND status = 'Registered'", st.id, offeringId);
  }
  if (user.role === 'department_admin') return o.college_id === user.college_id && o.department_id === user.department_id;
  return canAccessCollege(user, o.college_id);
}

function canAccessStudent(user, studentId) {
  const s = db.get('SELECT * FROM students WHERE id = ?', studentId);
  if (!s) return false;
  switch (user.role) {
    case 'student': return s.user_id === user.id;
    case 'staff': {
      const st = staffRow(user);
      return !!st && !!db.get(`SELECT 1 FROM course_registrations r JOIN course_offerings o ON o.id = r.offering_id
        WHERE r.student_id = ? AND o.staff_id = ? AND r.status = 'Registered'`, studentId, st.id);
    }
    case 'department_admin': return s.college_id === user.college_id && s.department_id === user.department_id;
    default: return canAccessCollege(user, s.college_id);
  }
}

module.exports = {
  ADMIN_ROLES, ROLE_LABEL, PERMISSIONS, DEFAULT_GRANTS, can, invalidatePermissions, isAdmin,
  orgFilter, collegeIds, canAccessCollege, canAccessOffering, canAccessStudent, staffRow, studentRow,
};
