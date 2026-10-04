// Rule-based parser for spoken mark entry.
// transcript -> normalisation -> student identification -> assessment
// identification -> mark extraction -> validation. It never saves anything:
// the result is a proposal the professor must confirm.

const UNITS = { zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS = { twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const ORDINALS = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5 };

function wordsToNumbers(text) {
  const toks = text.split(/\s+/).filter(Boolean);
  const out = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t in TENS) {
      let v = TENS[t];
      if (toks[i + 1] in UNITS && UNITS[toks[i + 1]] < 10) { v += UNITS[toks[i + 1]]; i++; }
      out.push(String(v));
    } else if (t in UNITS) {
      out.push(String(UNITS[t]));
    } else if (t === 'hundred' && out.length && /^\d+$/.test(out[out.length - 1])) {
      out[out.length - 1] = String(Number(out[out.length - 1]) * 100);
    } else out.push(t);
  }
  let s = out.join(' ');
  s = s.replace(/(\d+) point (\d)/g, '$1.$2')
    .replace(/(\d+) and a half/g, (_, n) => String(Number(n) + 0.5))
    .replace(/(\d+) and half/g, (_, n) => String(Number(n) + 0.5))
    .replace(/(\d+)\s*½/g, (_, n) => String(Number(n) + 0.5));
  return s;
}

function normalise(text) {
  let s = String(text || '').toLowerCase();
  s = s.replace(/[’']s\b/g, '').replace(/[-_]/g, ' ').replace(/(\d)\s*\/\s*(\d)/g, '$1 out of $2')
    .replace(/[^a-z0-9.\s½]/g, ' ').replace(/\.(?!\d)/g, ' ').replace(/\s+/g, ' ').trim();
  s = wordsToNumbers(s);
  for (const [w, n] of Object.entries(ORDINALS)) s = s.replace(new RegExp(`\\b${w}\\b`, 'g'), String(n));
  return s;
}

// Jaro-Winkler similarity for tolerant name matching (speech-to-text errors).
function jaroWinkler(a, b) {
  if (a === b) return 1;
  const la = a.length, lb = b.length;
  if (!la || !lb) return 0;
  const range = Math.max(0, Math.floor(Math.max(la, lb) / 2) - 1);
  const ma = new Array(la).fill(false), mb = new Array(lb).fill(false);
  let m = 0;
  for (let i = 0; i < la; i++) {
    for (let j = Math.max(0, i - range); j < Math.min(lb, i + range + 1); j++) {
      if (!mb[j] && a[i] === b[j]) { ma[i] = mb[j] = true; m++; break; }
    }
  }
  if (!m) return 0;
  let t = 0, k = 0;
  for (let i = 0; i < la; i++) if (ma[i]) { while (!mb[k]) k++; if (a[i] !== b[k]) t++; k++; }
  const jaro = (m / la + m / lb + (m - t / 2) / m) / 3;
  let p = 0; while (p < 4 && a[p] === b[p]) p++;
  return jaro + p * 0.1 * (1 - jaro);
}

const KIND_WORDS = [
  { re: /\b(internal assessment|internal test|internal|ia|cat|cia|periodical|unit test|test)\s*(\d+)?\b/, kind: 'internal' },
  { re: /\b(assignment|homework)\s*(\d+)?\b/, kind: 'assignment' },
  { re: /\b(quiz)\s*(\d+)?\b/, kind: 'quiz' },
  { re: /\b(lab|laboratory|practical|record)\s*(\d+)?\b/, kind: 'lab' },
  { re: /\b(model exam|model|semester exam|final exam|exam)\s*(\d+)?\b/, kind: 'exam' },
];
const FILLER = new Set(['scored', 'score', 'scores', 'got', 'gets', 'get', 'give', 'gave', 'given', 'marks', 'mark', 'out', 'of', 'in', 'for',
  'the', 'to', 'has', 'have', 'is', 'was', 'student', 'roll', 'number', 'no', 'a', 'an', 'and', 'with', 'obtained', 'secured', 'awarded',
  'enter', 'put', 'update', 'set', 'he', 'she', 'they', 'their', 'his', 'her', 'on', 'at', 'as', 'please', 'points', 'point', 'by', 'mister', 'miss', 'ms', 'mr']);

function findAssessment(s, assessments) {
  for (const kw of KIND_WORDS) {
    const m = s.match(kw.re);
    if (!m) continue;
    const num = m[2] ? Number(m[2]) : null;
    const ofKind = assessments.filter((a) => a.kind === kw.kind).sort((x, y) => x.sequence - y.sequence || x.id - y.id);
    let cands = ofKind;
    if (num !== null) {
      cands = ofKind.filter((a, idx) => new RegExp(`\\b${num}\\b`).test(`${a.name} ${a.short_name || ''}`) || (!/\d/.test(a.name) && idx + 1 === num));
      if (!cands.length && ofKind[num - 1]) cands = [ofKind[num - 1]];
    }
    return { phrase: m[0], kind: kw.kind, number: num, candidates: cands };
  }
  // Fall back to matching an assessment's own name or short name.
  for (const a of assessments) {
    const names = [a.name, a.short_name].filter(Boolean).map((n) => normalise(n));
    for (const n of names) if (n.length > 2 && new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(s)) return { phrase: n, kind: a.kind, number: null, candidates: [a] };
  }
  return null;
}

function findMarks(s, assessPhrase) {
  let work = assessPhrase ? s.replace(assessPhrase, ' ') : s;
  work = work.replace(/\b\d{2}[a-z]{2,4}\d{2,4}\b/g, ' '); // roll numbers like 25cs101
  let m = work.match(/(\d+(?:\.\d+)?)\s*(?:out of|outof|over|by)\s*(\d+(?:\.\d+)?)/);
  if (m) return { value: Number(m[1]), outOf: Number(m[2]), phrase: m[0] };
  m = work.match(/(?:scored|score|got|gets|get|obtained|secured|awarded|give|gave|given|marks?|is|has)\s+(?:[a-z]+\s+){0,3}?(\d+(?:\.\d+)?)/);
  if (m) return { value: Number(m[1]), outOf: null, phrase: m[1] };
  const nums = work.match(/\d+(?:\.\d+)?/g);
  if (nums && nums.length === 1) return { value: Number(nums[0]), outOf: null, phrase: nums[0] };
  if (nums && nums.length > 1) return { value: null, outOf: null, ambiguousNumbers: nums.map(Number) };
  return null;
}

// Roll numbers as recognisers write them: "25 CS 324", "25 C S 324", "25 see ess 324", "two five cs three two four".
const LETTER_SOUNDS = { bee: 'b', be: 'b', see: 'c', sea: 'c', cee: 'c', dee: 'd', ee: 'e', ef: 'f', eff: 'f', gee: 'g', jee: 'g', aitch: 'h', jay: 'j', kay: 'k', el: 'l', ell: 'l', em: 'm', en: 'n',
  pee: 'p', cue: 'q', queue: 'q', ar: 'r', are: 'r', es: 's', ess: 's', as: 's', yes: 's', tee: 't', tea: 't', you: 'u', vee: 'v', ex: 'x', why: 'y', zed: 'z', zee: 'z' };
function rollKey(toks) {
  let out = '';
  for (const t of toks) {
    if (/^\d+$/.test(t)) out += t;
    else if (LETTER_SOUNDS[t]) out += LETTER_SOUNDS[t];
    else if (/^[a-z0-9]{1,4}$/.test(t) || /^(?=.*\d)[a-z0-9]{2,20}$/.test(t)) out += t;
    else return null;
  }
  return /\d/.test(out) ? out : null;
}
// Finds a spoken roll number (longest span first); returns the students and the words it used.
function findRoll(s, students) {
  const toks = s.split(/\s+/).filter(Boolean);
  const byRoll = new Map(); for (const st of students) byRoll.set(String(st.roll_no).toLowerCase().replace(/[^a-z0-9]/g, ''), st);
  for (let len = Math.min(6, toks.length); len >= 1; len--) {
    for (let i = 0; i + len <= toks.length; i++) {
      const key = rollKey(toks.slice(i, i + len));
      if (key && byRoll.has(key)) return { student: byRoll.get(key), phrase: toks.slice(i, i + len).join(' ') };
    }
  }
  return null;
}
// Sound-alike key for Indian names as recognisers spell them: Mohamed/Mohammed, Shri/Sri, Darshini/Dharshini.
const nameKey = (w) => w.replace(/[^a-z]/g, '').replace(/ph/g, 'f').replace(/ck|q/g, 'k').replace(/x/g, 'ks').replace(/w/g, 'v').replace(/z/g, 's')
  .replace(/ee|y/g, 'i').replace(/oo/g, 'u').replace(/(.)h/g, '$1').replace(/(.)\1+/g, '$1');

function findStudents(s, students, consumed, roll) {
  let rest = s;
  for (const c of consumed) if (c) rest = rest.replace(c, ' ');
  if (roll) return { candidates: [{ ...roll.student, score: 1 }], by: 'roll number' };
  const tokens = rest.split(/\s+/).filter((t) => t && !FILLER.has(t) && !/^\d/.test(t) && t.length > 1);
  if (!tokens.length) return { candidates: [], tokens };
  const keys = tokens.map(nameKey);
  // A name split by the recogniser ("kavya sri" for Kavyasri) is also tried joined with its neighbour.
  for (let i = 0; i + 1 < tokens.length; i++) keys.push(nameKey(tokens[i] + tokens[i + 1]));
  const scored = students.map((st) => {
    const parts = `${st.first_name} ${st.last_name}`.toLowerCase().split(/\s+/).filter(Boolean);
    let score = 0;
    for (const p of parts) {
      const pk = nameKey(p);
      const best = Math.max(...tokens.map((t) => jaroWinkler(p, t)), ...keys.map((k) => (k === pk ? 1 : jaroWinkler(pk, k))));
      if (best >= 0.84) score += best;
    }
    return { ...st, score: +score.toFixed(3) };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
  if (!scored.length) return { candidates: [], tokens };
  const top = scored[0].score;
  return { candidates: scored.filter((x) => x.score >= top - 0.25).slice(0, 6), tokens, by: 'name' };
}

// students: [{id, first_name, last_name, roll_no}], assessments: [{id,name,short_name,kind,sequence,max_marks}]
// existing: Map(`${assessmentId}:${studentId}` -> marks)
function parseOne(raw, students, assessments, existing, defaultAssessmentId) {
  const s = normalise(raw);
  const issues = [];
  const roll = findRoll(s, students);
  const sNoRoll = roll ? s.replace(roll.phrase, ' ') : s;
  const assess = findAssessment(sNoRoll, assessments);
  const mk = findMarks(sNoRoll, assess && assess.phrase);
  const stud = findStudents(sNoRoll, students, [assess && assess.phrase, mk && mk.phrase, mk && mk.outOf ? `out of ${mk.outOf}` : null], roll);

  const student = { status: 'not_found', candidates: [], selectedId: null };
  if (stud.candidates.length === 1) {
    const c = stud.candidates[0];
    const parts = `${c.first_name} ${c.last_name}`.trim().split(/\s+/).length;
    student.status = 'matched'; student.selectedId = c.id;
    student.confidence = stud.by === 'roll number' ? 1 : +(Math.min(1, c.score / Math.max(1, Math.min(parts, stud.tokens.length)))).toFixed(2);
  } else if (stud.candidates.length > 1) {
    student.status = 'ambiguous';
    const first = stud.candidates[0].first_name;
    issues.push({ level: 'question', text: stud.candidates.every((c) => c.first_name === first)
      ? `I found ${stud.candidates.length} students named ${first}. Please select one.`
      : 'More than one student matches what was said. Please select one.' });
  } else {
    issues.push({ level: 'error', text: 'No student in this course matches what was said. Select the student manually.' });
  }
  student.candidates = stud.candidates.map((c) => ({ id: c.id, name: `${c.first_name} ${c.last_name}`.trim(), roll_no: c.roll_no, score: c.score }));

  const marks = { value: mk ? mk.value : null, spokenOutOf: mk ? mk.outOf : null };
  if (!mk || mk.value === null) {
    issues.push({ level: 'error', text: mk && mk.ambiguousNumbers ? `Several numbers were heard (${mk.ambiguousNumbers.join(', ')}). Enter the mark manually.` : 'No mark was heard. Enter the mark manually.' });
  }

  const assessment = { status: 'not_found', candidates: [], selectedId: null, inferred: false };
  let cands = assess ? assess.candidates : [];
  if (assess && !cands.length) issues.push({ level: 'warning', text: `No assessment matching "${assess.phrase}" exists in this course.` });
  if (!assess) {
    // Infer: assessments whose maximum matches the spoken "out of", then those still missing this student's mark.
    cands = assessments.slice();
    if (marks.spokenOutOf) { const byMax = cands.filter((a) => a.max_marks === marks.spokenOutOf); if (byMax.length) cands = byMax; }
    if (marks.value !== null) { const fits = cands.filter((a) => a.max_marks >= marks.value); if (fits.length) cands = fits; }
    const def = cands.find((a) => a.id === defaultAssessmentId);
    if (student.selectedId) {
      const missing = cands.filter((a) => !existing.has(`${a.id}:${student.selectedId}`));
      if (missing.length) cands = missing;
    }
    if (def && cands.length > 1) cands = [def];
    assessment.inferred = true;
  }
  if (cands.length === 1) {
    assessment.status = assessment.inferred ? 'inferred' : 'matched';
    assessment.selectedId = cands[0].id;
    if (assessment.inferred) issues.push({ level: 'warning', text: `Assessment was not said; ${cands[0].name} was inferred. Check it before saving.` });
  } else if (cands.length > 1) {
    assessment.status = 'ambiguous';
    issues.push({ level: 'question', text: 'Please select which assessment this mark is for.' });
  }
  assessment.candidates = (cands.length ? cands : assessments).map((a) => ({ id: a.id, name: a.name, max_marks: a.max_marks, kind: a.kind }));

  const sel = assessments.find((a) => a.id === assessment.selectedId);
  if (sel && marks.value !== null) {
    marks.max = sel.max_marks;
    if (marks.spokenOutOf && marks.spokenOutOf !== sel.max_marks) issues.push({ level: 'warning', text: `You said "out of ${marks.spokenOutOf}", but ${sel.name} is marked out of ${sel.max_marks}.` });
    if (marks.value > sel.max_marks) issues.push({ level: 'error', text: `${marks.value} / ${sel.max_marks} is not valid: marks cannot exceed the maximum.` });
    if (marks.value < 0) issues.push({ level: 'error', text: 'Marks cannot be negative.' });
    if (student.selectedId && existing.has(`${sel.id}:${student.selectedId}`)) {
      marks.previous = existing.get(`${sel.id}:${student.selectedId}`);
      issues.push({ level: 'info', text: `A mark of ${marks.previous} already exists; confirming will update it.` });
    }
  }
  const hasError = issues.some((i) => i.level === 'error');
  const resolved = student.status === 'matched' && assessment.selectedId && marks.value !== null && !hasError;
  let confidence = 'low';
  if (resolved) confidence = (assessment.status === 'matched' && (student.confidence || 0) >= 0.9 && !issues.some((i) => i.level === 'warning')) ? 'high' : 'medium';
  return { heard: raw, normalised: s, student, assessment, marks, issues, confidence, readyToConfirm: !!resolved, autoSaved: false };
}

function parse(transcript, students, assessments, existing = new Map(), defaultAssessmentId = null) {
  const parts = String(transcript || '').split(/[;,\n]|\bnext\b|\bthen\b/i).map((p) => p.trim()).filter((p) => /[a-z]/i.test(p));
  if (!parts.length) return { entries: [], error: 'Voice could not be understood. Please try again.' };
  return { entries: parts.slice(0, 20).map((p) => parseOne(p, students, assessments, existing, defaultAssessmentId)) };
}

module.exports = { parse, normalise, jaroWinkler };
