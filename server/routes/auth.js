// Login (password or OTP), logout, forgot/reset password, current user.
const db = require('../db');
const settings = require('../settings');
const auth = require('../auth');
const scope = require('../scope');
const mailer = require('../mailer');
const { HttpError, bad, toStr, toInt, audit, clientMeta } = require('../lib');

// Hide most of the local part so the user can recognise their address without exposing it.
function maskEmail(email) {
  const [name, domain] = String(email || '').split('@');
  if (!domain) return 'your registered email';
  const shown = name.length <= 2 ? name[0] || '' : name.slice(0, 2);
  return `${shown}${'•'.repeat(Math.max(3, name.length - 2))}@${domain}`;
}

const LOGIN_ROLES = {
  student: ['student'],
  staff: ['staff'],
  admin: ['college_admin', 'department_admin', 'university_admin', 'super_admin'],
};

// Resolve an account only within the chosen institution.
function findAccount(collegeId, type, loginId) {
  const college = db.get('SELECT c.*, u.active AS u_active FROM colleges c JOIN universities u ON u.id = c.university_id WHERE c.id = ?', collegeId);
  if (!college) throw bad('Select a valid college first.');
  if (!college.active || !college.u_active) throw new HttpError(403, 'This institution is not active on the platform.');
  const roles = LOGIN_ROLES[type];
  if (!roles) throw bad('Choose Student, Staff or Administrator.');
  const id = String(loginId).trim().toLowerCase();
  const candidates = db.all(`SELECT * FROM users WHERE (lower(login_id) = ? OR lower(email) = ?) AND active = 1 AND role IN (${roles.map(() => '?').join(',')})`, id, id, ...roles);
  return candidates.find((u) =>
    u.role === 'super_admin' ||
    (u.role === 'university_admin' && u.university_id === college.university_id) ||
    u.college_id === college.id) || null;
}

function startSession(ctx, user, remember, method) {
  // Admins can close the student or teacher portal for their college.
  if ((user.role === 'student' || user.role === 'staff') && user.college_id && !settings.forCollege(user.college_id)[`portal_${user.role}_open`]) {
    throw new HttpError(403, `The ${user.role === 'staff' ? 'teacher' : 'student'} portal is closed right now. Please contact your college office.`);
  }
  const s = auth.createSession(user.id, !!remember);
  const secure = String(ctx.req.headers['x-forwarded-proto'] || '').includes('https');
  ctx.headers = { 'Set-Cookie': auth.cookieHeader(s.token, s.maxAge, secure) };
  audit({ req: ctx.req, user }, { action: 'login', entity: 'session', summary: `Signed in (${method})` });
  return { ok: true, role: user.role, home: homeFor(user.role) };
}
const homeFor = (role) => (role === 'student' ? '#/student' : role === 'staff' ? '#/staff' : '#/admin');

function me(ctx) {
  const u = ctx.user;
  const out = { id: u.id, name: u.name, email: u.email, loginId: u.login_id, role: u.role, roleLabel: scope.ROLE_LABEL[u.role], csrf: ctx.session.csrf, home: homeFor(u.role) };
  out.university = u.university_id ? db.get('SELECT id, name, short_name, code, accent, logo FROM universities WHERE id = ?', u.university_id) : null;
  out.college = u.college_id ? db.get('SELECT id, name, short_name, code, accent, logo, institution_code FROM colleges WHERE id = ?', u.college_id) : null;
  out.department = u.department_id ? db.get('SELECT id, name, code FROM departments WHERE id = ?', u.department_id) : null;
  out.permissions = Object.keys(scope.PERMISSIONS).filter((p) => scope.can(u, p));
  if (u.role === 'student') { const s = scope.studentRow(u); out.studentId = s?.id; out.rollNo = s?.roll_no; }
  if (u.role === 'staff') { const s = scope.staffRow(u); out.staffId = s?.id; out.employeeCode = s?.employee_code; out.designation = s?.designation; }
  out.unread = db.get('SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND is_read = 0', u.id).n;
  out.campusGuide = u.college_id ? !!db.get('SELECT 1 FROM campus_guides WHERE college_id = ?', u.college_id) : false;
  // Features the admin has switched on for this portal (admins see everything).
  if (u.role === 'student' || u.role === 'staff') {
    const cfg = settings.forCollege(u.college_id);
    out.features = Object.fromEntries(settings.PORTAL_KEYS.filter((k) => k.startsWith(`portal_${u.role}_`)).map((k) => [k.split('_')[2], !!cfg[k]]));
  }
  return out;
}

module.exports = (api) => {
  api.post('/api/auth/login', (ctx) => {
    const { collegeId, type, loginId, password, remember } = ctx.body;
    const cid = toInt(collegeId, 'College', { min: 1 });
    const login = toStr(loginId, 'Login ID', { max: 120 });
    const pw = toStr(password, 'Password', { max: 200 });
    const key = `${clientMeta(ctx.req).ip}:${cid}:${login.toLowerCase()}`;
    if (auth.throttled(key)) throw new HttpError(429, 'Too many failed attempts. Please wait 10 minutes and try again.');
    const user = findAccount(cid, type, login);
    if (!user || !auth.verifyPassword(pw, user.password_hash)) {
      auth.recordFailure(key);
      throw new HttpError(401, 'The login ID or password is incorrect for this institution and login type.');
    }
    auth.clearFailures(key);
    return startSession(ctx, user, remember, 'password');
  }, { public: true });

  // OTP request for sign-in or password reset. Real email is sent when SMTP is
  // configured (see server/mailer.js); otherwise the code is returned for on-screen
  // display in dev mode — clearly labelled, never presented as a delivered email.
  api.post('/api/auth/otp/request', async (ctx) => {
    const cid = toInt(ctx.body.collegeId, 'College', { min: 1 });
    const user = findAccount(cid, ctx.body.type, toStr(ctx.body.loginId, 'Login ID', { max: 120 }));
    const purpose = ctx.body.purpose === 'reset' ? 'reset' : 'login';
    // Always answer the same way whether or not the account exists (no account enumeration).
    if (!user) return { ok: true, message: 'If the account exists, a one-time code has been sent to its registered email.' };
    const code = auth.createOtp(user.id, purpose);
    const r = await mailer.sendOtp(user, code, purpose);
    if (r.delivered) return { ok: true, delivered: true, message: `A one-time code has been sent to ${maskEmail(user.email)}. It expires in 10 minutes.` };
    // Dev mode (no SMTP configured) or a send failure: surface the code on screen, labelled.
    return {
      ok: true, delivered: false, dev: true, devCode: code,
      message: r.dev
        ? 'Email delivery is not configured on this server (dev mode), so the code is shown here instead.'
        : 'The email could not be sent right now, so the code is shown here instead (dev mode).',
    };
  }, { public: true });

  api.post('/api/auth/otp/verify', (ctx) => {
    const cid = toInt(ctx.body.collegeId, 'College', { min: 1 });
    const login = toStr(ctx.body.loginId, 'Login ID', { max: 120 });
    const key = `otp:${cid}:${login.toLowerCase()}`;
    if (auth.throttled(key)) throw new HttpError(429, 'Too many failed attempts. Please wait 10 minutes and try again.');
    const user = findAccount(cid, ctx.body.type, login);
    if (!user || !auth.consumeOtp(user.id, 'login', ctx.body.code)) { auth.recordFailure(key); throw new HttpError(401, 'The code is incorrect or has expired.'); }
    return startSession(ctx, user, ctx.body.remember, 'otp');
  }, { public: true });

  api.post('/api/auth/reset', (ctx) => {
    const cid = toInt(ctx.body.collegeId, 'College', { min: 1 });
    const login = toStr(ctx.body.loginId, 'Login ID', { max: 120 });
    const pw = toStr(ctx.body.newPassword, 'New password', { min: 8, max: 200 });
    if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) throw bad('Use at least 8 characters with letters and numbers.');
    const user = findAccount(cid, ctx.body.type, login);
    if (!user || !auth.consumeOtp(user.id, 'reset', ctx.body.code)) throw new HttpError(401, 'The code is incorrect or has expired.');
    db.run('UPDATE users SET password_hash = ? WHERE id = ?', auth.hashPassword(pw), user.id);
    db.run('DELETE FROM sessions WHERE user_id = ?', user.id);
    audit({ req: ctx.req, user }, { action: 'update', entity: 'password', entityId: user.id, summary: 'Password reset with one-time code' });
    return { ok: true };
  }, { public: true });

  api.post('/api/auth/logout', (ctx) => {
    auth.destroySession(ctx.req);
    ctx.headers = { 'Set-Cookie': auth.clearCookieHeader() };
    return { ok: true };
  }, { public: true, skipCsrf: true });

  api.get('/api/auth/me', (ctx) => me(ctx));

  api.post('/api/auth/change-password', (ctx) => {
    const { currentPassword, newPassword } = ctx.body;
    if (!auth.verifyPassword(currentPassword || '', ctx.user.password_hash)) throw bad('The current password is incorrect.');
    const pw = toStr(newPassword, 'New password', { min: 8, max: 200 });
    if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) throw bad('Use at least 8 characters with letters and numbers.');
    db.run('UPDATE users SET password_hash = ? WHERE id = ?', auth.hashPassword(pw), ctx.user.id);
    audit(ctx, { action: 'update', entity: 'password', entityId: ctx.user.id, summary: 'Changed own password' });
    return { ok: true };
  });
};
