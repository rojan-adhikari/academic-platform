// nerd AI: the signed-in person's own facts (used by the offline assistant in the
// browser) and optional online modes for open-ended conversation, tried in this order:
//   1. Claude: set ANTHROPIC_API_KEY (or ANTHROPIC_AUTH_TOKEN) and run `npm install @anthropic-ai/sdk`. Paid per use.
//   2. Any OpenAI-compatible endpoint: set NERD_AI_URL and NERD_AI_MODEL (and NERD_AI_KEY if it needs one),
//      for example a free cloud tier or LM Studio.
//   3. Ollama on this computer: free, no key. Detected automatically at http://127.0.0.1:11434
//      (NERD_AI_OLLAMA changes the address, NERD_AI_OLLAMA=off turns it off, NERD_AI_MODEL picks the model).
// With none of these the assistant runs fully offline in the browser.
const db = require('./db');
const scope = require('./scope');
const views = require('./views');
const TT = require('./timetable');

const CLAUDE_MODEL = process.env.NERD_AI_CLAUDE_MODEL || 'claude-opus-5-5';

// ---------------- facts about the signed-in person ----------------
function todayIndex() { const d = new Date().getDay(); return d === 0 ? null : d; } // timetable days are 1 (Mon) .. 6 (Sat)
const periodTime = (p) => { const x = TT.PERIODS.find((q) => q.p === p); return x ? `${x.start}–${x.end}` : ''; };

function studentFacts(user) {
  const s = scope.studentRow(user);
  if (!s) return null;
  const profile = views.studentProfile(s.id);
  const att = views.studentAttendance(s.id);
  const perf = views.studentPerformance(s.id);
  const risk = views.studentRisk(s.id);
  const day = todayIndex();
  const slots = s.section_id ? db.all(`SELECT t.day, t.period, t.kind, t.label, c.code, c.name, u.name AS faculty
      FROM timetable_slots t LEFT JOIN course_offerings o ON o.id = t.offering_id LEFT JOIN courses c ON c.id = o.course_id
      LEFT JOIN staff st ON st.id = o.staff_id LEFT JOIN users u ON u.id = st.user_id WHERE t.section_id = ? ORDER BY t.day, t.period`, s.section_id) : [];
  const today = new Date().toISOString().slice(0, 10);
  const deadlines = db.all(`SELECT p.title, p.due_on, c.code, c.name AS course,
      (SELECT status FROM classroom_submissions sub WHERE sub.post_id = p.id AND sub.student_id = ?) AS my_status
    FROM classroom_posts p JOIN course_offerings o ON o.id = p.offering_id JOIN courses c ON c.id = o.course_id
    JOIN course_registrations r ON r.offering_id = o.id AND r.student_id = ? AND r.status = 'Registered'
    WHERE p.kind = 'assignment' AND p.due_on >= ? ORDER BY p.due_on LIMIT 6`, s.id, s.id, today);
  const riskBy = new Map(risk.courses.map((r) => [r.offering_id, r]));
  const perfBy = new Map(perf.courses.map((c) => [c.offering_id, c]));
  return {
    role: 'student', name: profile.name, first: profile.first_name, rollNo: profile.roll_no, college: profile.college, department: profile.department,
    semester: profile.current_semester, section: profile.section, threshold: att.threshold,
    attendance: { percentage: att.overall.percentage, status: att.overall.status, attended: att.overall.attended, conducted: att.overall.conducted },
    courses: att.courses.map((c) => {
      const p = perfBy.get(c.offering_id), r = riskBy.get(c.offering_id);
      return { code: c.code, name: c.name, faculty: c.faculty, attendance: c.percentage, status: c.status, safeMisses: c.safeMisses, classesToRecover: Number.isFinite(c.classesToRecover) ? c.classesToRecover : null,
        trend: c.trend, marks: p ? p.overallPct : null, marksTrend: p ? p.trend : null, risk: r ? r.level : 'Normal', riskReason: r && r.factors[0] ? r.factors[0].text : null,
        nextStep: r && r.recommendations && r.recommendations[0] ? (r.recommendations[0].text || r.recommendations[0]) : null };
    }),
    overallRisk: risk.overall ? risk.overall.level : 'Normal',
    performance: { currentPct: perf.currentPct, cgpa: perf.cgpa, previousSgpa: perf.previousSgpa },
    timetable: slots.map((x) => ({ day: TT.DAYS[x.day - 1], period: x.period, time: periodTime(x.period), code: x.code, name: x.name || x.label, faculty: x.faculty, kind: x.kind })),
    todayName: day ? TT.DAYS[day - 1] : 'Sunday',
    deadlines: deadlines.map((d) => ({ title: d.title, due: d.due_on, course: `${d.code} ${d.course}`, submitted: d.my_status === 'Submitted' })),
  };
}

function staffFacts(user) {
  const st = scope.staffRow(user);
  if (!st) return null;
  const courses = db.all(`SELECT o.id, c.code, c.name, sec.name AS section, b.name AS batch,
      (SELECT COUNT(*) FROM course_registrations r WHERE r.offering_id = o.id AND r.status = 'Registered') AS students,
      (SELECT COUNT(*) FROM risk_analysis ra WHERE ra.offering_id = o.id AND ra.is_latest = 1 AND ra.level = 'High') AS high_risk,
      (SELECT COUNT(*) FROM risk_analysis ra WHERE ra.offering_id = o.id AND ra.is_latest = 1 AND ra.level = 'Attention') AS attention,
      (SELECT ROUND(AVG(a.present) * 100, 1) FROM attendance a WHERE a.offering_id = o.id) AS avg_attendance
    FROM course_offerings o JOIN courses c ON c.id = o.course_id LEFT JOIN sections sec ON sec.id = o.section_id LEFT JOIN batches b ON b.id = o.batch_id
    WHERE o.staff_id = ? ORDER BY c.code`, st.id);
  const ids = courses.map((c) => c.id);
  const ph = ids.map(() => '?').join(',') || 'NULL';
  const pending = ids.length ? db.all(`SELECT a.name, c.code, (SELECT COUNT(*) FROM course_registrations r WHERE r.offering_id = a.offering_id AND r.status = 'Registered') - (SELECT COUNT(*) FROM marks m WHERE m.assessment_id = a.id) AS missing
    FROM assessments a JOIN course_offerings o ON o.id = a.offering_id JOIN courses c ON c.id = o.course_id WHERE a.offering_id IN (${ph})`, ...ids).filter((x) => x.missing > 0) : [];
  const slots = db.all(`SELECT t.day, t.period, c.code, c.name, sec.name AS section FROM timetable_slots t JOIN course_offerings o ON o.id = t.offering_id
    JOIN courses c ON c.id = o.course_id JOIN sections sec ON sec.id = t.section_id WHERE o.staff_id = ? ORDER BY t.day, t.period`, st.id);
  const day = todayIndex();
  return {
    role: 'staff', name: user.name, first: user.name.replace(/^(Dr|Prof|Mr|Ms|Mrs)\.?\s+/i, '').split(/\s+/)[0], designation: st.designation, employeeCode: st.employee_code,
    courses: courses.map(({ id, ...c }) => c),
    pendingMarks: pending.map((p) => ({ assessment: p.name, course: p.code, missing: p.missing })),
    timetable: slots.map((x) => ({ day: TT.DAYS[x.day - 1], period: x.period, time: periodTime(x.period), code: x.code, name: x.name, section: x.section })),
    todayName: day ? TT.DAYS[day - 1] : 'Sunday',
  };
}

function adminFacts(user) {
  const f = scope.orgFilter(user, 't', { department: true });
  const n = (table) => db.get(`SELECT COUNT(*) n FROM ${table} t WHERE t.active = 1 AND ${f.sql}`, ...f.params).n;
  return { role: 'admin', name: user.name, first: user.name.split(/\s+/)[0], roleLabel: scope.ROLE_LABEL[user.role], students: n('students'), staff: n('staff') };
}

function factsFor(user) {
  if (!user) return null;
  if (user.role === 'student') return studentFacts(user);
  if (user.role === 'staff') return staffFacts(user);
  return adminFacts(user);
}

// ---------------- the same facts as short text (for small local models) ----------------
function timetableLines(slots, label) {
  const byDay = new Map();
  for (const x of slots || []) {
    if (!byDay.has(x.day)) byDay.set(x.day, []);
    byDay.get(x.day).push(`P${x.period} ${String(x.time).split(/[–-]/)[0]} ${label(x)}`);
  }
  return [...byDay].map(([d, list]) => `- ${d}: ${list.join(', ')}`);
}
const bare = (x) => String(x).replace(/[.\s]+$/, '');
function factsText(f) {
  if (!f) return 'Not signed in.';
  const L = [];
  if (f.role === 'student') {
    const p = f.performance || {};
    L.push(`${f.name}, student, roll number ${f.rollNo}. ${f.department}, semester ${f.semester}${f.section ? `, section ${f.section}` : ''}, ${f.college}.`);
    L.push(`Overall attendance ${f.attendance.percentage}% (${f.attendance.status}), ${f.attendance.attended} of ${f.attendance.conducted} classes. Minimum is ${f.threshold}%.`);
    L.push(`Marks average ${p.currentPct == null ? 'not available' : p.currentPct + '%'}${p.cgpa ? `, CGPA ${p.cgpa}` : ''}${p.previousSgpa ? `, previous SGPA ${p.previousSgpa}` : ''}. Overall academic risk: ${f.overallRisk}.`);
    L.push('Courses:');
    for (const c of f.courses) {
      L.push(`- ${c.code} ${c.name} (teacher: ${c.faculty || 'not assigned'}): attendance ${c.attendance}% ${c.status}, can miss ${c.safeMisses} more${c.classesToRecover ? `, needs ${c.classesToRecover} classes in a row to recover` : ''}; marks ${c.marks == null ? 'none yet' : `${c.marks}%${c.marksTrend ? ` (${c.marksTrend})` : ''}`}; risk ${c.risk}${c.riskReason ? ` because ${bare(c.riskReason)}` : ''}${c.nextStep ? `; next step: ${bare(c.nextStep)}` : ''}.`);
    }
    L.push(`Weekly timetable (today is ${f.todayName}):`, ...timetableLines(f.timetable, (x) => x.code || x.name));
    L.push(f.deadlines.length ? 'Upcoming deadlines:' : 'No upcoming deadlines.');
    for (const d of f.deadlines) L.push(`- ${d.title} (${d.course}), due ${d.due}, ${d.submitted ? 'submitted' : 'not submitted yet'}`);
  } else if (f.role === 'staff') {
    L.push(`${f.name}, ${f.designation || 'teacher'} (employee code ${f.employeeCode}).`);
    L.push('Classes taught:');
    for (const c of f.courses) L.push(`- ${c.code} ${c.name}${c.section ? `, section ${c.section}` : ''}${c.batch ? `, batch ${c.batch}` : ''}: ${c.students} students, average attendance ${c.avg_attendance == null ? 'n/a' : c.avg_attendance + '%'}, ${c.high_risk} high risk, ${c.attention} need attention.`);
    L.push(f.pendingMarks.length ? 'Marks still to enter:' : 'All marks are entered.');
    for (const x of f.pendingMarks) L.push(`- ${x.assessment} in ${x.course}: ${x.missing} students missing`);
    L.push(`Weekly timetable (today is ${f.todayName}):`, ...timetableLines(f.timetable, (x) => `${x.code}${x.section ? ` sec ${x.section}` : ''}`));
  } else {
    L.push(`${f.name}, ${f.roleLabel}. Looks after ${f.students} students and ${f.staff} teachers.`);
  }
  return L.join('\n');
}

// ---------------- online modes ----------------
let client, clientState = 'unchecked', Anthropic;
function getClient() {
  if (clientState === 'ready') return client;
  if (clientState === 'off') return null;
  clientState = 'off';
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) return null;
  try {
    const mod = require('@anthropic-ai/sdk');
    Anthropic = mod.default || mod.Anthropic || mod;
    client = new Anthropic();
    clientState = 'ready';
    return client;
  } catch {
    console.warn('[nerd AI] ANTHROPIC_API_KEY is set but @anthropic-ai/sdk is not installed. Run `npm install @anthropic-ai/sdk` to enable the Claude-powered assistant.');
    return null;
  }
}

const OLLAMA_URL = (process.env.NERD_AI_OLLAMA && !/^(off|false|no|0)$/i.test(process.env.NERD_AI_OLLAMA) ? process.env.NERD_AI_OLLAMA : 'http://127.0.0.1:11434').replace(/\/+$/, '');
const OLLAMA_OFF = /^(off|false|no|0)$/i.test(process.env.NERD_AI_OLLAMA || '');
const PREFERRED = ['llama3.2', 'llama3.1', 'gemma3', 'qwen2.5', 'phi4', 'mistral', 'gemma2', 'phi3', 'llama3', 'qwen3']; // general chat models, best first
let found = null, foundAt = 0, finding = null, announced = '';

async function findOllama() {
  if (OLLAMA_OFF) return null;
  try {
    const r = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(1500) });
    if (!r.ok) return null;
    const names = ((await r.json()).models || []).map((m) => m.name || m.model).filter((n) => n && !/embed|nomic|bge|minilm|clip|whisper|rerank|vision/i.test(n));
    if (!names.length && !process.env.NERD_AI_MODEL) return null;
    const model = process.env.NERD_AI_MODEL || PREFERRED.map((p) => names.find((n) => n.startsWith(p))).find(Boolean) || names[0];
    return { name: 'ollama', model };
  } catch { return null; }
}
function announce(p) {
  const label = `${p.name}${p.model ? ` (${p.model})` : ''}`;
  if (label === announced) return;
  announced = label;
  console.log(`[nerd AI] Online answers via ${label}.`);
}
// Which online mode is available right now, or null. Ollama is re-checked every 30 seconds,
// so starting Ollama after nerd works without a restart.
async function provider() {
  if (getClient()) return { name: 'claude', model: CLAUDE_MODEL };
  if (process.env.NERD_AI_URL) {
    if (!process.env.NERD_AI_MODEL) { if (announced !== 'no-model') { announced = 'no-model'; console.warn('[nerd AI] NERD_AI_URL is set but NERD_AI_MODEL is not, so answers stay offline.'); } return null; }
    return { name: 'openai', model: process.env.NERD_AI_MODEL, url: process.env.NERD_AI_URL.replace(/\/+$/, '') };
  }
  if (Date.now() - foundAt < 30000) return found;
  if (!finding) finding = findOllama().then((p) => { found = p; foundAt = Date.now(); finding = null; if (p) announce(p); return p; });
  return finding;
}
const forget = () => { foundAt = 0; };

// Stable instructions first (cache-friendly); the person's facts follow.
const SYSTEM = `You are nerd AI, the friendly assistant inside "nerd", an academic platform used by universities and colleges in India.
You talk with students, teachers and college administrators. Sound like a helpful senior or a kind staff member: warm, plain and brief.

How to answer:
- Keep replies short and conversational: a few sentences, or a few short bullet points when listing. For study topics, concepts or code, give a clear explanation and offer to go deeper. Use **bold** sparingly.
- Answer from the person's own facts below whenever the question is about them (attendance, marks, risk, timetable, deadlines, courses). Quote real numbers.
- If the question is unclear or could mean several things, ask ONE short clarifying question instead of guessing.
- You can also chat about general topics, study tips, exam prep, careers, or explain concepts from their subjects. Be genuinely useful.
- Never invent data that is not in the facts. If something is not available, say so and point to the right page.
- Never reveal other people's records. Never claim to change data; explain where in nerd they can do it.

Platform facts:
- Attendance status: Safe = at least 80% and more than two classes of margin. Attention = close to 75%, or two absences would cross it. Critical = below 75%. The minimum is 75% (colleges can change it).
- "Safe misses" = how many classes can be missed and still stay at or above the minimum.
- Academic risk levels: Normal (on track), Attention (watch), High. Each comes with reasons and suggested next steps.
- Student pages: Dashboard, Attendance, My Courses, Timetable, Classroom (assignments, notes, PDF uploads), Performance (marks and risk), Clubs, Notifications, Campus Guide (live GPS map), Profile.
- Teacher pages: Dashboard, My Courses, Timetable, Classroom, Students, Attendance, Marks, Voice Entry (say a student's name and mark), Voice Sheets, Analytics & Risk, Clubs.
- Admin pages: Dashboard, Students, Teachers, Administrators, Student & teacher portals (switch portal features on or off), Course requests, Notifications, Departments, Campuses, Campus Guide, Import/Export, Audit Logs, Settings.
- Languages: English, Tamil and Hindi (switch from the language menu).
- Forgot password: use "Forgot password" on the sign-in page; a one-time code is emailed.`;

const JSON_FORMAT = 'Reply format: JSON with "reply" (your message, may use simple Markdown bold and bullet lists) and "suggestions" (zero to three short follow-up questions the person might tap next, each under 40 characters).';
const TEXT_FORMAT = `Reply format: plain text. You may use **bold**, lines starting with "- " for bullets, and \`\`\` code blocks. No headings, no tables.
After your reply, on the very last line, write "Suggestions:" followed by up to three short follow-up questions the person might ask next, separated by " | ".`;

const REPLY_SCHEMA = {
  type: 'object',
  properties: { reply: { type: 'string' }, suggestions: { type: 'array', items: { type: 'string' } } },
  required: ['reply', 'suggestions'],
  additionalProperties: false,
};

function cleanHistory(raw) {
  const msgs = (Array.isArray(raw) ? raw : []).slice(-16)
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }));
  while (msgs.length && msgs[0].role !== 'user') msgs.shift();
  return msgs;
}

// Plain-text reply with an optional trailing "Suggestions: a | b | c" line (or a short list under it).
function parseText(raw) {
  let text = String(raw || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const lines = text.split('\n');
  let at = -1;
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 6); i--) if (/^\s*[*_#]*\s*(suggestions?|follow[- ]?ups?)\s*[*_]*\s*:/i.test(lines[i])) { at = i; break; }
  let suggestions = [];
  if (at >= 0) {
    const inlineList = lines[at].replace(/^[^:]*:/, '').split('|');
    const below = lines.slice(at + 1).map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, ''));
    suggestions = inlineList.concat(below).map((x) => x.replace(/[*_]/g, '').replace(/^["'“”\s]+|["'“”\s]+$/g, '')).filter((x) => x.length > 1 && x.length <= 60).slice(0, 3);
    text = lines.slice(0, at).join('\n').trim();
  }
  return { reply: text, suggestions };
}

async function chatOpen(p, user, messages, page) {
  const system = `${SYSTEM}\n\n${TEXT_FORMAT}\n\nToday is ${new Date().toDateString()}. The person is on the page "${String(page || '').slice(0, 60)}".\nAbout the person:\n${factsText(factsFor(user))}`;
  const msgs = [{ role: 'system', content: system }, ...messages];
  let text;
  if (p.name === 'ollama') {
    const r = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(90000),
      body: JSON.stringify({ model: p.model, messages: msgs, stream: false, keep_alive: '30m', options: { num_ctx: 8192, num_predict: 1024, temperature: 0.5 } }),
    });
    if (!r.ok) throw new Error(`Ollama returned ${r.status}: ${(await r.text()).slice(0, 200)}`);
    text = ((await r.json()).message || {}).content;
  } else {
    const r = await fetch(`${p.url}/chat/completions`, {
      method: 'POST', signal: AbortSignal.timeout(60000),
      headers: { 'Content-Type': 'application/json', ...(process.env.NERD_AI_KEY ? { Authorization: `Bearer ${process.env.NERD_AI_KEY}` } : {}) },
      body: JSON.stringify({ model: p.model, messages: msgs, temperature: 0.5 }),
    });
    if (!r.ok) throw new Error(`${p.url} returned ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const d = await r.json();
    text = d.choices && d.choices[0] && d.choices[0].message ? d.choices[0].message.content : '';
  }
  return parseText(text);
}

async function chat(user, history, page) {
  const p = await provider();
  if (!p) return null;
  const messages = cleanHistory(history);
  if (!messages.length || messages[messages.length - 1].role !== 'user') return null;
  if (p.name !== 'claude') return chatOpen(p, user, messages, page);
  const facts = factsFor(user);
  const context = `Today is ${new Date().toDateString()}. The person is on the page "${String(page || '').slice(0, 60)}".\nTheir facts (JSON):\n${JSON.stringify(facts)}`;
  const response = await getClient().beta.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema: REPLY_SCHEMA } },
    system: [{ type: 'text', text: `${SYSTEM}\n\n${JSON_FORMAT}`, cache_control: { type: 'ephemeral' } }, { type: 'text', text: context }],
    messages,
  });
  if (response.stop_reason === 'refusal') return { reply: "Sorry, I can't help with that one. Ask me about your classes, attendance, marks or anything on campus.", suggestions: [] };
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  try {
    const parsed = JSON.parse(text);
    return { reply: String(parsed.reply || '').trim(), suggestions: (parsed.suggestions || []).map(String).slice(0, 3) };
  } catch {
    return { reply: text.trim(), suggestions: [] };
  }
}

module.exports = { factsFor, factsText, parseText, chat, provider, forget, CLAUDE_MODEL, getAnthropic: () => Anthropic };
