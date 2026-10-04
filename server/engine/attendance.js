// Attendance calculation and forward-looking prediction.
// All projections are exact arithmetic on attended/conducted counts.
const db = require('../db');

function round1(x) { return Math.round(x * 10) / 10; }

// attended a of conducted c, threshold t (0-1)
function predict(a, c, thresholdPct, targetPct, bufferPct) {
  const t = thresholdPct / 100;
  const pct = c ? (a / c) * 100 : 100;
  const out = { attended: a, conducted: c, missed: c - a, percentage: round1(pct), threshold: thresholdPct };
  if (c === 0) {
    return { ...out, status: 'Safe', safeMisses: null, missesToFallBelow: null, classesToRecover: 0, classesToTarget: 0, target: targetPct,
      message: 'No classes have been held yet.', guidance: [] };
  }
  // Largest k with a/(c+k) >= t
  const safeMisses = Math.max(0, Math.floor(a / t - c + 1e-9));
  // Smallest m with a/(c+m) < t (if already below, 0)
  const missesToFallBelow = pct < thresholdPct ? 0 : safeMisses + 1;
  // Smallest n with (a+n)/(c+n) >= t
  const need = (x) => (a / c >= x ? 0 : Math.ceil((x * c - a) / (1 - x) - 1e-9));
  const classesToRecover = t >= 1 ? (a === c ? 0 : Infinity) : need(t);
  const tt = targetPct / 100;
  const classesToTarget = tt >= 1 ? (a === c ? 0 : null) : need(tt);

  // Status policy (shown to users):
  //   Safe      — at least (threshold+buffer)% and more than two classes of margin.
  //   Attention — close to the threshold, or two more absences would cross it.
  //   Critical  — below the threshold.
  let status = 'Safe';
  if (pct < thresholdPct) status = 'Critical';
  else if (pct < thresholdPct + bufferPct || safeMisses <= 2) status = 'Attention';

  const guidance = [];
  let message;
  if (status === 'Critical') {
    message = `Attendance is ${round1(pct)}%, below the required ${thresholdPct}%.`;
    guidance.push(`Attend the next ${classesToRecover} class${classesToRecover === 1 ? '' : 'es'} without absence to return to ${thresholdPct}%.`);
  } else {
    message = safeMisses === 0
      ? `Missing the next class would take attendance below ${thresholdPct}%.`
      : `If you miss the next ${missesToFallBelow} class${missesToFallBelow === 1 ? '' : 'es'}, attendance will fall below ${thresholdPct}%.`;
    guidance.push(safeMisses === 0 ? 'No classes can be missed safely right now.'
      : `You can miss at most ${safeMisses} class${safeMisses === 1 ? '' : 'es'} and stay at or above ${thresholdPct}%.`);
  }
  if (classesToTarget) guidance.push(`Attend the next ${classesToTarget} class${classesToTarget === 1 ? '' : 'es'} to reach ${targetPct}%.`);
  // Projected value after the next two classes are missed, a concrete scenario.
  const ifMiss2 = round1((a / (c + 2)) * 100);
  const ifAttend5 = round1(((a + 5) / (c + 5)) * 100);
  return { ...out, status, safeMisses, missesToFallBelow, classesToRecover, classesToTarget, target: targetPct,
    scenarios: { ifMissNext2: ifMiss2, ifAttendNext5: ifAttend5 }, message, guidance };
}

// Per-offering attendance with trend information for one student.
function forStudentOffering(studentId, offeringId, recentWindow = 8) {
  const rows = db.all(`SELECT s.held_on, a.present FROM attendance a JOIN attendance_sessions s ON s.id = a.session_id
    WHERE a.student_id = ? AND a.offering_id = ? ORDER BY s.held_on, s.period`, studentId, offeringId);
  const conducted = rows.length;
  const attended = rows.reduce((n, r) => n + r.present, 0);
  const recent = rows.slice(-recentWindow);
  const recentPct = recent.length ? (recent.reduce((n, r) => n + r.present, 0) / recent.length) * 100 : null;
  // Cumulative series for the trend chart (one point per class).
  let run = 0;
  const series = rows.map((r, i) => { run += r.present; return { date: r.held_on, pct: round1((run / (i + 1)) * 100), present: r.present }; });
  return { conducted, attended, recentPct: recentPct === null ? null : round1(recentPct), series };
}

module.exports = { predict, forStudentOffering, round1 };
