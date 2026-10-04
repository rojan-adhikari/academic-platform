// Cascading settings: college overrides university overrides platform defaults.
const db = require('./db');

const DEFAULTS = {
  attendance_threshold: 75,          // % required by the problem statement
  attendance_attention_buffer: 5,    // % above threshold still flagged "Attention"
  attendance_recovery_target: 80,    // % target used in "attend N classes to reach X%"
  risk_attention_probability: 0.35,  // model probability at which risk becomes Attention
  risk_high_probability: 0.6,        // model probability at which risk becomes High
  risk_recent_window: 8,             // classes used for the recent-attendance trend
  risk_policy_rules: 1,              // apply early-warning policy rules on top of the model
  notify_attendance_alerts: 1,
  notify_risk_alerts: 1,
  notify_mark_updates: 1,
  // Portal controls (1 = on, 0 = off): admins decide what the student and teacher portals offer.
  portal_student_open: 1, portal_student_timetable: 1, portal_student_classroom: 1, portal_student_clubs: 1, portal_student_campus: 1, portal_student_assistant: 1,
  portal_staff_open: 1, portal_staff_timetable: 1, portal_staff_classroom: 1, portal_staff_clubs: 1, portal_staff_voice: 1, portal_staff_campus: 1, portal_staff_assistant: 1,
};

// Portal keys are shown on the Portals page, not with the policy settings.
const PORTAL_KEYS = Object.keys(DEFAULTS).filter((k) => k.startsWith('portal_'));

const DESCRIPTIONS = {
  attendance_threshold: 'Minimum attendance percentage required',
  attendance_attention_buffer: 'Percentage points above the threshold that still show "Attention"',
  attendance_recovery_target: 'Target percentage used for recovery guidance',
  risk_attention_probability: 'Model probability (0-1) for Attention risk',
  risk_high_probability: 'Model probability (0-1) for High risk',
  risk_recent_window: 'Number of recent classes used to detect attendance decline',
  risk_policy_rules: 'Apply early-warning rules (declining attendance near threshold, compound decline) on top of the model (1 = on, 0 = off)',
  notify_attendance_alerts: 'Send attendance alerts to students (1 = on, 0 = off)',
  notify_risk_alerts: 'Send academic-risk alerts to students (1 = on, 0 = off)',
  notify_mark_updates: 'Notify students when marks are entered or updated (1 = on, 0 = off)',
};
for (const k of PORTAL_KEYS) DESCRIPTIONS[k] = 'Portal feature (1 = on, 0 = off)';

const LIMITS = {
  attendance_threshold: [1, 100],
  attendance_attention_buffer: [0, 30],
  attendance_recovery_target: [1, 100],
  risk_attention_probability: [0.05, 0.95],
  risk_high_probability: [0.05, 0.99],
  risk_recent_window: [3, 30],
  risk_policy_rules: [0, 1],
  notify_attendance_alerts: [0, 1],
  notify_risk_alerts: [0, 1],
  notify_mark_updates: [0, 1],
};
for (const k of PORTAL_KEYS) LIMITS[k] = [0, 1];

const cache = new Map();

function forCollege(collegeId) {
  if (cache.has(collegeId)) return cache.get(collegeId);
  const out = { ...DEFAULTS };
  const college = collegeId ? db.get('SELECT university_id FROM colleges WHERE id = ?', collegeId) : null;
  const rows = db.all(
    `SELECT scope_type, key, value FROM settings
     WHERE (scope_type = 'platform') OR (scope_type = 'university' AND scope_id = ?) OR (scope_type = 'college' AND scope_id = ?)`,
    college ? college.university_id : -1, collegeId || -1);
  const rank = { platform: 0, university: 1, college: 2 };
  rows.sort((a, b) => rank[a.scope_type] - rank[b.scope_type]);
  for (const r of rows) if (r.key in DEFAULTS) out[r.key] = Number(r.value);
  cache.set(collegeId, out);
  return out;
}

function invalidate() { cache.clear(); }

function validate(key, value) {
  if (!(key in DEFAULTS)) return 'Unknown setting';
  const n = Number(value);
  if (!Number.isFinite(n)) return 'Value must be a number';
  const [lo, hi] = LIMITS[key];
  if (n < lo || n > hi) return `Value must be between ${lo} and ${hi}`;
  return null;
}

module.exports = { forCollege, invalidate, validate, DEFAULTS, DESCRIPTIONS, LIMITS, PORTAL_KEYS };
