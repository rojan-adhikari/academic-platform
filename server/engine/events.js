// Event pipeline: data change -> background job -> recalculation -> notification -> live push (SSE).
const db = require('../db');
const settings = require('../settings');
const risk = require('./risk');

// ---------- live push via Server-Sent Events ----------
const streams = new Map(); // userId -> Set(res)
function subscribe(userId, res) {
  if (!streams.has(userId)) streams.set(userId, new Set());
  streams.get(userId).add(res);
  return () => { const s = streams.get(userId); if (s) { s.delete(res); if (!s.size) streams.delete(userId); } };
}
// While muted (import validation dry-runs), no notifications, pushes or jobs escape.
let muted = 0;
function mute(fn) { muted++; try { return fn(); } finally { muted--; } }
function push(userId, event, data) {
  if (muted) return;
  const s = streams.get(userId);
  if (!s) return;
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of s) { try { res.write(msg); } catch { /* closed */ } }
}

// ---------- notifications ----------
function notify(userId, collegeId, { type, severity = 'info', title, body, link = null, dedupeKey = null }) {
  if (muted) return null;
  if (dedupeKey) {
    const dup = db.get("SELECT id FROM notifications WHERE user_id = ? AND dedupe_key = ? AND created_at > datetime('now','-1 day')", userId, dedupeKey);
    if (dup) return null;
  }
  const r = db.run('INSERT INTO notifications (college_id, user_id, type, severity, title, body, link, dedupe_key) VALUES (?,?,?,?,?,?,?,?)',
    collegeId, userId, type, severity, title, body, link, dedupeKey);
  const n = db.get('SELECT * FROM notifications WHERE id = ?', Number(r.lastInsertRowid));
  push(userId, 'notification', n);
  return n;
}

// ---------- background job queue (keeps request latency low) ----------
const queue = [];
let running = false;
function enqueue(job) { if (muted) return; queue.push(job); if (!running) setImmediate(drain); }
function drain() {
  running = true;
  const started = Date.now();
  while (queue.length && Date.now() - started < 50) {
    const job = queue.shift();
    try { job(); } catch (e) { console.error('[job] failed:', e.message); }
  }
  if (queue.length) setImmediate(drain); else running = false;
}
function pending() { return queue.length; }

// Recompute risk for a student and raise alerts on meaningful changes.
function reassess(studentId, trigger) {
  const st = db.get('SELECT s.*, u.id AS uid FROM students s JOIN users u ON u.id = s.user_id WHERE s.id = ?', studentId);
  if (!st) return null;
  const cfg = settings.forCollege(st.college_id);
  const result = risk.recomputeStudent(studentId, trigger);
  for (const c of result.courses) {
    const a = c.attendance;
    // Attendance alerts follow attendance changes; a mark update should only raise mark and risk notices.
    if (cfg.notify_attendance_alerts && !String(trigger).startsWith('marks') && a.conducted && (a.status === 'Critical' || a.status === 'Attention')) {
      notify(st.uid, st.college_id, {
        type: 'attendance', severity: a.status === 'Critical' ? 'critical' : 'warning',
        title: a.status === 'Critical' ? `Attendance below ${a.threshold}% in ${c.course_name}` : `Attendance attention: ${c.course_name}`,
        body: `${a.message} ${a.guidance[0] || ''}`.trim(), link: `#/student/attendance`,
        dedupeKey: `att:${c.offering_id}:${a.status}`,
      });
    }
    const escalated = c.previousLevel && risk.RANK[c.level] > risk.RANK[c.previousLevel];
    if (cfg.notify_risk_alerts && c.level !== 'Normal' && (escalated || !c.previousLevel)) {
      notify(st.uid, st.college_id, {
        type: 'risk', severity: c.level === 'High' ? 'critical' : 'warning',
        title: escalated ? `Academic risk increased to ${c.level} in ${c.course_name}` : `Academic risk: ${c.level} in ${c.course_name}`,
        body: c.factors.length ? `Main reasons: ${c.factors.slice(0, 2).map((f) => f.text).join('; ')}.` : 'Review your course progress.',
        link: `#/student/risk`, dedupeKey: `risk:${c.offering_id}:${c.level}:${trigger}`,
      });
    }
  }
  push(st.uid, 'refresh', { scope: 'risk' });
  return result;
}

function onMarksChanged({ assessment, studentIds, actor, isUpdate }) {
  const info = db.get(`SELECT c.name AS course_name, c.code, o.college_id FROM course_offerings o JOIN courses c ON c.id = o.course_id WHERE o.id = ?`, assessment.offering_id);
  const cfg = settings.forCollege(info.college_id);
  for (const sid of studentIds) {
    const st = db.get('SELECT user_id FROM students WHERE id = ?', sid);
    if (!st) continue;
    if (cfg.notify_mark_updates) {
      notify(st.user_id, info.college_id, {
        type: 'marks', severity: 'info',
        title: isUpdate ? 'Marks updated' : 'New marks available',
        body: `${info.course_name} — ${assessment.name} has been ${isUpdate ? 'updated' : 'published'}.`,
        link: `#/student/performance`,
      });
    }
    enqueue(() => reassess(sid, `marks:${assessment.id}`));
  }
}

function onAttendanceChanged({ offeringId, studentIds }) {
  for (const sid of studentIds) enqueue(() => reassess(sid, `attendance:${offeringId}`));
}

// A campus-guide publish that adds new events notifies the college's students and staff, so an
// admin action shows up straight away in the student and staff portals (not only in the guide).
function onCampusEventsPublished({ collegeId, newEvents }) {
  if (!collegeId || !newEvents || !newEvents.length) return;
  const users = db.all("SELECT id, college_id FROM users WHERE active = 1 AND role IN ('student','staff') AND college_id = ?", collegeId);
  if (!users.length) return;
  enqueue(() => db.tx(() => {
    for (const ev of newEvents) {
      const when = ev.startsAt ? new Date(ev.startsAt).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }) : null;
      for (const u of users) {
        notify(u.id, u.college_id, {
          type: 'event', severity: 'info',
          title: `Campus event: ${ev.title}`,
          body: [when ? `On ${when}.` : '', ev.registrationOpen ? 'Registration is open.' : '', 'Open the campus guide for details.'].filter(Boolean).join(' '),
          link: `#/campus/${collegeId}`,
          dedupeKey: `event:${collegeId}:${ev.id}`,
        });
      }
    }
  }));
}

module.exports = { mute, subscribe, push, notify, enqueue, pending, reassess, onMarksChanged, onAttendanceChanged, onCampusEventsPublished };
