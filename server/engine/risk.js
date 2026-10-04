// Academic-risk engine.
//
// Pipeline: academic data -> validation -> feature engineering -> logistic
// regression -> policy rules -> explanation -> recommendation -> notification.
//
// The model is trained on a SYNTHETIC dataset generated in this file, because no
// real historical outcome data is available for the hackathon. Its hold-out
// metrics describe fit to that synthetic data only and say nothing about
// real-world accuracy.
const db = require('../db');
const settings = require('../settings');
const att = require('./attendance');

const MODEL_VERSION = 'risk-logreg-1.0.0';
const DATASET_VERSION = 'synthetic-cohort-v1 (4,000 generated student-course records)';

const FEATURES = [
  { key: 'att_gap', label: 'Attendance below threshold' },
  { key: 'att_decline', label: 'Attendance declining' },
  { key: 'assess_low', label: 'Low assessment marks' },
  { key: 'assess_drop', label: 'Recent assessment decline' },
  { key: 'assign_low', label: 'Low assignment marks' },
  { key: 'assign_drop', label: 'Assignment decline' },
  { key: 'prev_low', label: 'Weak previous performance' },
  { key: 'prev_drop', label: 'Negative previous trend' },
];

// ---------- deterministic PRNG ----------
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gauss(rand) { let u = 0, v = 0; while (u === 0) u = rand(); while (v === 0) v = rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

// ---------- feature engineering ----------
// raw: { attPct, attRecentPct, assessPct, assessTrend, assignPct, assignTrend, prevSgpa, prevTrend }
function vectorize(raw, threshold) {
  return [
    (threshold - raw.attPct) / 10,
    (raw.attPct - (raw.attRecentPct ?? raw.attPct)) / 10,
    (60 - raw.assessPct) / 15,
    -(raw.assessTrend || 0) / 15,
    (60 - raw.assignPct) / 15,
    -(raw.assignTrend || 0) / 15,
    (7 - raw.prevSgpa) / 1.5,
    -(raw.prevTrend || 0),
  ];
}

// ---------- synthetic cohort ----------
function syntheticCohort(n, seed) {
  const rand = mulberry32(seed);
  const rows = [];
  for (let i = 0; i < n; i++) {
    const ability = gauss(rand); // latent
    const engagement = gauss(rand);
    const prevSgpa = clamp(7 + 1.1 * ability + 0.3 * gauss(rand), 3, 10);
    const prevTrend = clamp(0.25 * gauss(rand) + 0.15 * engagement, -2, 2);
    const attPct = clamp(82 + 9 * engagement + 4 * gauss(rand), 35, 100);
    const attRecentPct = clamp(attPct + 8 * gauss(rand) + 3 * engagement, 0, 100);
    const assessPct = clamp(65 + 13 * ability + 4 * engagement + 8 * gauss(rand), 5, 100);
    const assessTrend = clamp(6 * gauss(rand) + 3 * engagement, -40, 40);
    const assignPct = clamp(72 + 8 * ability + 8 * engagement + 9 * gauss(rand), 5, 100);
    const assignTrend = clamp(7 * gauss(rand) + 3 * engagement, -50, 50);
    const raw = { attPct, attRecentPct, assessPct, assessTrend, assignPct, assignTrend, prevSgpa, prevTrend };
    // Ground-truth outcome: end-of-term shortfall (fail or attendance shortage).
    const z = -1.6 + 1.3 * Math.max(0, (75 - attPct) / 10) + 0.5 * (75 - attPct) / 10 + 0.7 * (attPct - attRecentPct) / 10
      + 0.9 * (60 - assessPct) / 15 + 0.5 * -assessTrend / 15 + 0.45 * (60 - assignPct) / 15 + 0.25 * -assignTrend / 15
      + 0.55 * (7 - prevSgpa) / 1.5 + 0.3 * -prevTrend + 0.6 * gauss(rand);
    rows.push({ x: vectorize(raw, 75), y: rand() < 1 / (1 + Math.exp(-z)) ? 1 : 0 });
  }
  return rows;
}

function sigmoid(z) { return 1 / (1 + Math.exp(-z)); }

function trainLogReg(rows, { epochs = 400, lr = 0.15, l2 = 0.001 } = {}) {
  const d = rows[0].x.length;
  let w = new Array(d).fill(0), b = 0;
  for (let e = 0; e < epochs; e++) {
    const gw = new Array(d).fill(0); let gb = 0;
    for (const r of rows) {
      const p = sigmoid(b + r.x.reduce((s, xi, i) => s + xi * w[i], 0));
      const err = p - r.y;
      for (let i = 0; i < d; i++) gw[i] += err * r.x[i];
      gb += err;
    }
    for (let i = 0; i < d; i++) w[i] -= lr * (gw[i] / rows.length + l2 * w[i]);
    b -= lr * gb / rows.length;
  }
  return { w, b };
}

function auc(scores, labels) {
  const pairs = scores.map((s, i) => [s, labels[i]]).sort((a, b) => a[0] - b[0]);
  let rank = 0, sumPos = 0, nPos = 0;
  for (const [, y] of pairs) { rank++; if (y) { sumPos += rank; nPos++; } }
  const nNeg = pairs.length - nPos;
  return (sumPos - (nPos * (nPos + 1)) / 2) / (nPos * nNeg);
}

function trainAndRegister() {
  const rows = syntheticCohort(4000, 20261002);
  const split = Math.floor(rows.length * 0.8);
  const train = rows.slice(0, split), test = rows.slice(split);
  const model = trainLogReg(train);
  const means = FEATURES.map((_, i) => train.reduce((s, r) => s + r.x[i], 0) / train.length);
  const scores = test.map((r) => sigmoid(model.b + r.x.reduce((s, xi, i) => s + xi * model.w[i], 0)));
  const labels = test.map((r) => r.y);
  let tp = 0, fp = 0, fn = 0, tn = 0;
  scores.forEach((s, i) => { const p = s >= 0.5; if (p && labels[i]) tp++; else if (p) fp++; else if (labels[i]) fn++; else tn++; });
  const metrics = {
    note: 'Measured on a 20% hold-out of SYNTHETIC data. Not a measure of real-world accuracy.',
    holdout_size: test.length, positive_rate: +(labels.filter(Boolean).length / labels.length).toFixed(3),
    accuracy: +((tp + tn) / test.length).toFixed(3), precision: +(tp / Math.max(1, tp + fp)).toFixed(3),
    recall: +(tp / Math.max(1, tp + fn)).toFixed(3), auc: +auc(scores, labels).toFixed(3),
  };
  db.run('UPDATE model_registry SET active = 0');
  db.run(`INSERT OR REPLACE INTO model_registry (version, dataset_version, algorithm, features, coefficients, metrics, active)
    VALUES (?,?,?,?,?,?,1)`, MODEL_VERSION, DATASET_VERSION, 'Logistic regression (batch gradient descent, L2)',
    JSON.stringify(FEATURES.map((f) => f.key)), JSON.stringify({ w: model.w, b: model.b, means }), JSON.stringify(metrics));
  activeModel = null;
  return metrics;
}

let activeModel = null;
function getModel() {
  if (activeModel) return activeModel;
  let row = db.get('SELECT * FROM model_registry WHERE active = 1');
  if (!row) { trainAndRegister(); row = db.get('SELECT * FROM model_registry WHERE active = 1'); }
  activeModel = { ...row, coef: JSON.parse(row.coefficients), metrics: JSON.parse(row.metrics) };
  return activeModel;
}

// ---------- data gathering ----------
function pct(m, max) { return (m / max) * 100; }

function courseFeatures(studentId, offeringId, cfg) {
  const a = att.forStudentOffering(studentId, offeringId, cfg.risk_recent_window);
  const marks = db.all(`SELECT a.id, a.name, a.kind, a.max_marks, a.weight, a.sequence, m.marks
    FROM assessments a LEFT JOIN marks m ON m.assessment_id = a.id AND m.student_id = ?
    WHERE a.offering_id = ? AND a.published = 1 ORDER BY a.sequence, a.id`, studentId, offeringId);
  const scored = marks.filter((m) => m.marks !== null);
  const tests = scored.filter((m) => m.kind !== 'assignment');
  const assigns = scored.filter((m) => m.kind === 'assignment');
  const wavg = (list) => { const w = list.reduce((s, m) => s + m.weight, 0); return w ? list.reduce((s, m) => s + pct(m.marks, m.max_marks) * m.weight, 0) / w : null; };
  const trend = (list) => {
    if (list.length < 2) return { value: 0, latest: null, earlier: null };
    const latest = list[list.length - 1];
    const earlier = list.slice(0, -1).reduce((s, m) => s + pct(m.marks, m.max_marks), 0) / (list.length - 1);
    return { value: pct(latest.marks, latest.max_marks) - earlier, latest, earlier };
  };
  const hist = db.all('SELECT semester_number, sgpa FROM academic_history WHERE student_id = ? ORDER BY semester_number', studentId);
  const prevSgpa = hist.length ? hist.reduce((s, h) => s + h.sgpa, 0) / hist.length : 7;
  const prevTrend = hist.length >= 2 ? hist[hist.length - 1].sgpa - hist[hist.length - 2].sgpa : 0;
  const assessPct = wavg(tests), assignPct = wavg(assigns);
  const tTrend = trend(tests), aTrend = trend(assigns);
  const attPct = a.conducted ? (a.attended / a.conducted) * 100 : 100;
  const raw = {
    attPct, attRecentPct: a.recentPct ?? attPct,
    // Missing marks are imputed from previous performance so they neither help nor hurt.
    assessPct: assessPct ?? prevSgpa * 9, assessTrend: tTrend.value,
    assignPct: assignPct ?? prevSgpa * 9, assignTrend: aTrend.value,
    prevSgpa, prevTrend,
  };
  return { raw, attendance: a, marks, tests, assigns, tTrend, aTrend, hist, hasAssess: assessPct !== null, hasAssign: assignPct !== null };
}

const r1 = (x) => Math.round(x * 10) / 10;

function explain(ctx, contribs, cfg, courseName) {
  const { raw, tTrend, aTrend, hist, attendance } = ctx;
  const factors = [];
  const add = (key, text, weight, kind = 'risk') => factors.push({ key, text, weight: +weight.toFixed(3), kind });
  const c = Object.fromEntries(FEATURES.map((f, i) => [f.key, contribs[i]]));
  const T = cfg.attendance_threshold;
  if (attendance.conducted) {
    if (raw.attPct < T) add('att_gap', `Attendance is below the ${T}% threshold (${r1(raw.attPct)}%)`, Math.max(c.att_gap, 0.5));
    else if (raw.attPct < T + cfg.attendance_attention_buffer) add('att_gap', `Attendance is close to the ${T}% threshold (${r1(raw.attPct)}%)`, Math.max(c.att_gap, 0.2));
    if (raw.attPct - raw.attRecentPct >= 5) add('att_decline', `Attendance is declining: ${r1(raw.attRecentPct)}% in the last ${Math.min(cfg.risk_recent_window, attendance.conducted)} classes against ${r1(raw.attPct)}% overall`, Math.max(c.att_decline, 0.15));
  }
  if (ctx.hasAssess && raw.assessPct < 55) add('assess_low', `Assessment average is low (${r1(raw.assessPct)}%)`, c.assess_low);
  if (tTrend.latest && tTrend.value <= -5) add('assess_drop', `Recent assessment performance decreased: ${r1(pct(tTrend.latest.marks, tTrend.latest.max_marks))}% in ${tTrend.latest.name} against ${r1(tTrend.earlier)}% earlier`, Math.max(c.assess_drop, 0.15));
  if (ctx.hasAssign && raw.assignPct < 55) add('assign_low', `Assignment performance is low (${r1(raw.assignPct)}%)`, c.assign_low);
  if (aTrend.latest && aTrend.value <= -10) add('assign_drop', `Assignment performance is declining: ${r1(pct(aTrend.latest.marks, aTrend.latest.max_marks))}% in ${aTrend.latest.name} against ${r1(aTrend.earlier)}% earlier`, Math.max(c.assign_drop, 0.15));
  if (hist.length && raw.prevSgpa < 6.5) add('prev_low', `Previous academic performance is weak (average SGPA ${r1(raw.prevSgpa)})`, c.prev_low);
  if (hist.length >= 2 && raw.prevTrend <= -0.4) add('prev_drop', `Previous performance trend is negative (SGPA ${hist[hist.length - 2].sgpa} to ${hist[hist.length - 1].sgpa})`, Math.max(c.prev_drop, 0.1));
  factors.sort((a, b) => b.weight - a.weight);

  const positives = [];
  if (attendance.conducted && raw.attPct >= T + cfg.attendance_attention_buffer) positives.push(`Attendance is healthy (${r1(raw.attPct)}%)`);
  if (ctx.hasAssess && raw.assessPct >= 75 && tTrend.value > -5) positives.push(`Assessment average is strong (${r1(raw.assessPct)}%)`);
  if (ctx.hasAssign && raw.assignPct >= 75 && aTrend.value > -10) positives.push(`Assignments are on track (${r1(raw.assignPct)}%)`);

  const recs = [];
  const pred = att.predict(attendance.attended, attendance.conducted, T, cfg.attendance_recovery_target, cfg.attendance_attention_buffer);
  if (factors.some((f) => f.key === 'att_gap' || f.key === 'att_decline')) recs.push(pred.guidance[0]);
  if (factors.some((f) => f.key === 'assess_low' || f.key === 'assess_drop')) recs.push(`Review recent ${courseName} topics with the course faculty before the next assessment.`);
  if (factors.some((f) => f.key === 'assign_low' || f.key === 'assign_drop')) recs.push('Submit pending assignments and ask for feedback on the last one.');
  if (factors.some((f) => f.key === 'prev_low' || f.key === 'prev_drop')) recs.push('Consider meeting your academic mentor to plan support for this semester.');
  return { factors, positives, recommendations: recs.filter(Boolean), attendancePrediction: pred };
}

// Configurable, explainable policy rules applied on top of the model probability.
function levelFor(p, raw, cfg, hasAttendance, factors) {
  let level = p >= cfg.risk_high_probability ? 'High' : p >= cfg.risk_attention_probability ? 'Attention' : 'Normal';
  const rules = [];
  const raise = (to, text) => { if (RANK[to] > RANK[level]) { level = to; rules.push(text); } };
  const T = cfg.attendance_threshold;
  const has = (k) => factors.some((f) => f.key === k);
  if (hasAttendance && raw.attPct < T - 10) raise('High', `Attendance is more than 10 points below the ${T}% threshold`);
  if (hasAttendance && raw.attPct < T) raise('Attention', `Attendance is below the ${T}% threshold`);
  if (cfg.risk_policy_rules) {
    const nearOrBelow = hasAttendance && raw.attPct < T + cfg.attendance_attention_buffer;
    if (nearOrBelow && has('att_decline')) raise('Attention', 'Attendance is near the threshold and declining');
    if (nearOrBelow && has('att_decline') && has('assess_drop') && (has('assign_drop') || has('assign_low') || has('assess_low')))
      raise('High', 'Attendance decline combined with falling assessment and assignment performance');
  }
  return { level, rules };
}

function scoreCourse(studentId, offering, cfg) {
  const model = getModel();
  const ctx = courseFeatures(studentId, offering.id, cfg);
  const x = vectorize(ctx.raw, cfg.attendance_threshold);
  const { w, b, means } = model.coef;
  const p = sigmoid(b + x.reduce((s, xi, i) => s + xi * w[i], 0));
  const contribs = x.map((xi, i) => w[i] * (xi - means[i]));
  const ex = explain(ctx, contribs, cfg, offering.course_name);
  const { level, rules } = levelFor(p, ctx.raw, cfg, ctx.attendance.conducted > 0, ex.factors);
  return {
    offering_id: offering.id, course_code: offering.course_code, course_name: offering.course_name,
    level, probability: +p.toFixed(4), factors: ex.factors, positives: ex.positives, rules,
    recommendations: ex.recommendations, attendance: ex.attendancePrediction,
    features: Object.fromEntries(Object.entries({ ...ctx.raw, hasAssess: +ctx.hasAssess, hasAssign: +ctx.hasAssign, threshold: cfg.attendance_threshold,
      attended: ctx.attendance.attended, conducted: ctx.attendance.conducted, safeMisses: ex.attendancePrediction.safeMisses ?? 0,
      classesToRecover: ex.attendancePrediction.classesToRecover }).map(([k, v]) => [k, +Number(v).toFixed(2)])),
  };
}

const RANK = { Normal: 0, Attention: 1, High: 2 };

function studentOfferings(studentId) {
  return db.all(`SELECT o.id, c.code AS course_code, c.name AS course_name FROM course_registrations r
    JOIN course_offerings o ON o.id = r.offering_id JOIN courses c ON c.id = o.course_id
    WHERE r.student_id = ? AND r.status = 'Registered' AND o.active = 1 ORDER BY c.code`, studentId);
}

// Compute, persist (with model monitoring metadata) and return the risk picture.
function recomputeStudent(studentId, trigger = 'scheduled') {
  const student = db.get('SELECT * FROM students WHERE id = ?', studentId);
  if (!student) return null;
  const cfg = settings.forCollege(student.college_id);
  const model = getModel();
  const courses = studentOfferings(studentId).map((o) => scoreCourse(studentId, o, cfg));
  const worst = courses.reduce((m, c) => (RANK[c.level] > RANK[m] ? c.level : m), 'Normal');
  const overallP = courses.length ? Math.max(...courses.map((c) => c.probability)) : 0;
  const overallFactors = courses.filter((c) => c.level !== 'Normal')
    .flatMap((c) => c.factors.slice(0, 2).map((f) => ({ ...f, text: `${c.course_name}: ${f.text}` })))
    .sort((a, b) => b.weight - a.weight).slice(0, 6);
  const previous = db.all('SELECT offering_id, level FROM risk_analysis WHERE student_id = ? AND is_latest = 1', studentId);
  const prevMap = new Map(previous.map((p) => [p.offering_id ?? 0, p.level]));
  db.run('UPDATE risk_analysis SET is_latest = 0 WHERE student_id = ? AND is_latest = 1', studentId);
  const ins = db.open().prepare(`INSERT INTO risk_analysis (college_id, student_id, offering_id, level, probability, factors, features, model_version, dataset_version, trigger)
    VALUES (?,?,?,?,?,?,?,?,?,?)`);
  for (const c of courses) {
    ins.run(student.college_id, studentId, c.offering_id, c.level, c.probability,
      JSON.stringify({ factors: c.factors, positives: c.positives, rules: c.rules, recommendations: c.recommendations }),
      JSON.stringify(c.features), model.version, model.dataset_version, trigger);
  }
  ins.run(student.college_id, studentId, null, worst, overallP, JSON.stringify({ factors: overallFactors, positives: [], rules: [], recommendations: [] }),
    JSON.stringify({ courses: courses.length }), model.version, model.dataset_version, trigger);
  const changes = courses.map((c) => ({ ...c, previousLevel: prevMap.get(c.offering_id) || null }));
  return { studentId, level: worst, probability: overallP, factors: overallFactors, courses: changes, previousLevel: prevMap.get(0) || null };
}

module.exports = { recomputeStudent, getModel, trainAndRegister, scoreCourse, RANK, MODEL_VERSION, DATASET_VERSION, FEATURES, vectorize };
