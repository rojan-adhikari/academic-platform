/* Voice sheets: an Excel-style grid that staff fill by voice (Web Speech API) or by typed commands.
   Row 1 is the header row and data starts at row 2, so cell references match Excel (E5 = column E, sheet row 5).
   Nothing a recogniser mishears is ever written: every utterance is parsed, validated against its column,
   and either written (and logged) or rejected with the reason (and logged). */
(function () {
  'use strict';
  const { html, $, $$, api, route, go, state, bind, toast, modal, confirmBox, loading, errorBox, icon, shell, fmt } = App;
  const STAFF = { roles: ['staff'] };
  const ADMIN = { roles: ['super_admin', 'university_admin', 'college_admin', 'department_admin'] };
  const MAX_ROWS = 500, MAX_COLS = 40;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const baseFor = () => (state.me.role === 'staff' ? '#/staff' : '#/admin');

  // ================= small helpers =================
  const colName = (i) => { let s = ''; let n = i + 1; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
  const colIndex = (l) => { let n = 0; for (const ch of String(l).toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };
  const refOf = (r, c) => colName(c) + (r + 2);
  const compact = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const isFormula = (v) => typeof v === 'string' && v.startsWith('=');
  const round2 = (x) => Math.round(x * 100) / 100;
  const fmtNum = (x) => String(round2(x));
  const isNumText = (v) => typeof v === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(v);
  const isBlank = (v) => v === null || v === undefined || v === '';
  // Same inference the server uses for blank sheets.
  const STAT_HEADER = /^(total|sum|avg|average|mean|max|min|count|percentage|percent|((sample|population) )?(variance|var|sd|s\.d\.?|std|stdev|std\.? dev\.?|std deviation|standard deviation))$/;
  function inferColumn(header) {
    const h = String(header).trim().slice(0, 60); const k = h.toLowerCase();
    if (STAT_HEADER.test(k)) return { header: h, type: 'formula' };
    if (/^(name|roll|roll no|roll number|register number|reg no|remarks?)$/.test(k)) return { header: h, type: 'text' };
    return { header: h, type: 'number', max: 100 };
  }
  function fnForHeader(h) {
    const k = String(h || '').toLowerCase();
    if (/percent|%/.test(k)) return 'PCT';
    if (/\b(variance|var)\b/.test(k)) return /\bsample\b/.test(k) ? 'VAR.S' : 'VAR.P';
    if (/\b(sd|s\.d|std|stdev|deviation)\b/.test(k)) return /\bsample\b/.test(k) ? 'STDEV.S' : 'STDEV.P';
    if (/\b(avg|average|mean)\b/.test(k)) return 'AVERAGE';
    if (/\b(max|maximum|highest|best|top)\b/.test(k)) return 'MAX';
    if (/\b(min|minimum|lowest|least)\b/.test(k)) return 'MIN';
    if (/\bcount\b/.test(k)) return 'COUNT';
    if (/\b(total|sum)\b/.test(k)) return 'SUM';
    return null;
  }
  const FN_WORDS = { sum: 'SUM', add: 'SUM', average: 'AVERAGE', avg: 'AVERAGE', mean: 'AVERAGE', max: 'MAX', maximum: 'MAX', highest: 'MAX', min: 'MIN', minimum: 'MIN', lowest: 'MIN', count: 'COUNT', percentage: 'PCT', percent: 'PCT',
    variance: 'VAR', variances: 'VAR', variants: 'VAR', var: 'VAR', stdev: 'STDEV', sd: 'STDEV', std: 'STDEV', deviation: 'STDEV' };
  const FN_LABEL = { SUM: 'Sum', AVERAGE: 'Average', MAX: 'Highest', MIN: 'Lowest', COUNT: 'Count', PCT: 'Percentage',
    'VAR.P': 'Variance', 'VAR.S': 'Sample variance', 'STDEV.P': 'Standard deviation', 'STDEV.S': 'Sample standard deviation' };
  const FN_HINT = { 'VAR.P': 'Variance', 'VAR.S': 'Sample var', 'STDEV.P': 'SD', 'STDEV.S': 'Sample SD' };
  // Spoken variance and standard deviation divide by the number of marks (the whole class); "sample" divides by one less.
  const VARIANT = { sample: 'S', population: 'P' };
  const statFn = (fn, v) => { const m = /^(VAR|STDEV)(?:\.([SP]))?$/.exec(fn || ''); return m ? `${m[1]}.${v || m[2] || 'P'}` : fn; };
  const colMax = (col) => (Number.isFinite(col.max) && col.max > 0 ? col.max : 100);
  function lev(a, b) {
    if (a === b) return 0; if (!a.length) return b.length; if (!b.length) return a.length;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[b.length];
  }
  // Jaro-Winkler similarity (0–1), tolerant of the letter swaps speech recognisers make in names.
  function jaroWinkler(a, b) {
    if (a === b) return 1;
    const la = a.length, lb = b.length; if (!la || !lb) return 0;
    const range = Math.max(0, Math.floor(Math.max(la, lb) / 2) - 1);
    const ma = new Array(la).fill(false), mb = new Array(lb).fill(false); let m = 0;
    for (let i = 0; i < la; i++) for (let j = Math.max(0, i - range); j < Math.min(lb, i + range + 1); j++) if (!mb[j] && a[i] === b[j]) { ma[i] = mb[j] = true; m++; break; }
    if (!m) return 0;
    let t = 0, k = 0;
    for (let i = 0; i < la; i++) if (ma[i]) { while (!mb[k]) k++; if (a[i] !== b[k]) t++; k++; }
    const jaro = (m / la + m / lb + (m - t / 2) / m) / 3;
    let p = 0; while (p < 4 && a[p] === b[p]) p++;
    return jaro + p * 0.1 * (1 - jaro);
  }
  // Sound-alike key for Indian names as recognisers spell them: Mohamed/Mohammed, Shri/Sri, Darshini/Dharshini.
  const nameKey = (s) => compact(s).replace(/[^a-z]/g, '').replace(/ph/g, 'f').replace(/ck|q/g, 'k').replace(/x/g, 'ks').replace(/w/g, 'v').replace(/z/g, 's')
    .replace(/ee|y/g, 'i').replace(/oo/g, 'u').replace(/(.)h/g, '$1').replace(/(.)\1+/g, '$1');

  // ================= formula engine (a small parser; no eval) =================
  class FErr { constructor(code) { this.code = code; } }
  // Functions over a list of numbers, shared by formulas and spoken answers.
  // VAR and STDEV follow Excel (sample, divide by n − 1); VAR.P and STDEV.P divide by n.
  function aggregate(name, xs) {
    const n = xs.length; const sum = xs.reduce((a, b) => a + b, 0);
    switch (name) {
      case 'SUM': return sum;
      case 'AVERAGE': case 'AVG': case 'MEAN': if (!n) throw new FErr('#ERR'); return sum / n;
      case 'MAX': return n ? Math.max(...xs) : 0;
      case 'MIN': return n ? Math.min(...xs) : 0;
      case 'COUNT': return n;
      case 'VAR': case 'VAR.S': case 'VAR.P': case 'VARP': case 'STDEV': case 'STDEV.S': case 'STDEV.P': case 'STDEVP': {
        const pop = name.endsWith('P');
        if (n < (pop ? 1 : 2)) throw new FErr('#ERR');
        const mean = sum / n; const v = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (pop ? n : n - 1);
        return name.startsWith('STDEV') ? Math.sqrt(v) : v;
      }
      default: throw new FErr('#ERR');
    }
  }
  const TOK = /\s*(?:(\d+(?:\.\d+)?|\.\d+)|([A-Z]{1,2})(\d{1,4})(?:\s*:\s*([A-Z]{1,2})(\d{1,4}))?(?![A-Z0-9(])|([A-Z][A-Z.]*)\s*(?=\()|([-+*/(),]))/y;
  function tokenize(src) {
    const s = String(src).toUpperCase(); const out = []; let pos = 0;
    while (pos < s.length) {
      if (!s.slice(pos).trim()) break;
      TOK.lastIndex = pos; const m = TOK.exec(s);
      if (!m) throw new FErr('#ERR');
      pos = TOK.lastIndex;
      if (m[1] !== undefined) out.push({ t: 'num', v: Number(m[1]) });
      else if (m[2]) {
        const a = { c: colIndex(m[2]), r: Number(m[3]) - 2 };
        out.push(m[4] ? { t: 'range', a, b: { c: colIndex(m[4]), r: Number(m[5]) - 2 } } : { t: 'ref', ...a });
      } else if (m[6]) out.push({ t: 'fn', v: m[6] });
      else out.push({ t: 'op', v: m[7] });
    }
    return out;
  }
  function makeEngine(S) {
    const cache = new Map();
    const inBounds = (r, c) => c >= 0 && c < S.columns.length && r >= -1 && r < S.rows.length;
    const rawAt = (r, c) => (r === -1 ? S.columns[c].header : (S.rows[r][c] ?? null));
    function value(r, c, stack) {
      if (!inBounds(r, c)) throw new FErr('#REF');
      const v = rawAt(r, c);
      if (isFormula(v)) { const res = evalCell(r, c, stack); if (res instanceof FErr) throw res; return res; }
      return v;
    }
    function evalCell(r, c, stack = new Set()) {
      const key = r * 64 + c;
      if (cache.has(key)) return cache.get(key);
      if (stack.has(key)) return new FErr('#ERR');
      stack.add(key);
      let res;
      try { res = evalFormula(String(rawAt(r, c)).slice(1), stack); if (!Number.isFinite(res)) res = new FErr('#ERR'); }
      catch (e) { res = e instanceof FErr ? e : new FErr('#ERR'); }
      stack.delete(key);
      cache.set(key, res);
      return res;
    }
    function evalFormula(src, stack) {
      const t = tokenize(src); let i = 0;
      if (!t.length) throw new FErr('#ERR');
      const isOp = (v) => t[i] && t[i].t === 'op' && t[i].v === v;
      const num = (v) => { if (isBlank(v)) return 0; if (typeof v === 'number') return v; if (isNumText(v)) return Number(v); throw new FErr('#ERR'); };
      const collect = (v, out) => { if (typeof v === 'number') out.push(v); else if (isNumText(v)) out.push(Number(v)); };
      function rangeVals(a, b) {
        const out = [];
        for (let r = Math.min(a.r, b.r); r <= Math.max(a.r, b.r); r++) for (let c = Math.min(a.c, b.c); c <= Math.max(a.c, b.c); c++) collect(value(r, c, stack), out);
        return out;
      }
      function expr() { let v = term(); while (isOp('+') || isOp('-')) { const op = t[i++].v; const w = term(); v = op === '+' ? v + w : v - w; } return v; }
      function term() { let v = factor(); while (isOp('*') || isOp('/')) { const op = t[i++].v; const w = factor(); if (op === '/' && w === 0) throw new FErr('#ERR'); v = op === '*' ? v * w : v / w; } return v; }
      function arg() {
        const k = t[i]; const nx = t[i + 1];
        if (k && k.t === 'range') { i++; return rangeVals(k.a, k.b); }
        if (k && k.t === 'ref' && (!nx || (nx.t === 'op' && (nx.v === ',' || nx.v === ')')))) { i++; const out = []; collect(value(k.r, k.c, stack), out); return out; }
        return [expr()];
      }
      function call(name, args) {
        if (name === 'ROUND') { const d = args[1] ? args[1][0] || 0 : 0; const f = 10 ** d; return Math.round((args[0] ? args[0][0] || 0 : 0) * f) / f; }
        if (name === 'ABS') return Math.abs(args.flat()[0] || 0);
        return aggregate(name, args.flat());
      }
      function factor() {
        const k = t[i]; if (!k) throw new FErr('#ERR');
        if (k.t === 'op' && (k.v === '-' || k.v === '+')) { i++; const v = factor(); return k.v === '-' ? -v : v; }
        if (k.t === 'num') { i++; return k.v; }
        if (k.t === 'ref') { i++; return num(value(k.r, k.c, stack)); }
        if (k.t === 'op' && k.v === '(') { i++; const v = expr(); if (!isOp(')')) throw new FErr('#ERR'); i++; return v; }
        if (k.t === 'fn') {
          i++; if (!isOp('(')) throw new FErr('#ERR'); i++;
          const args = [];
          if (!isOp(')')) { args.push(arg()); while (isOp(',')) { i++; args.push(arg()); } }
          if (!isOp(')')) throw new FErr('#ERR'); i++;
          return call(k.v, args);
        }
        throw new FErr('#ERR');
      }
      const v = expr();
      if (i !== t.length) throw new FErr('#ERR');
      return v;
    }
    function display(r, c) {
      const v = rawAt(r, c);
      if (isBlank(v)) return '';
      if (isFormula(v)) { const res = evalCell(r, c); return res instanceof FErr ? res.code : fmtNum(res); }
      if (typeof v === 'number') return fmtNum(v);
      return String(v);
    }
    // Numeric value of a data cell (for posting): null = blank, NaN = not a number.
    function numeric(r, c) {
      const v = rawAt(r, c);
      if (isBlank(v)) return null;
      if (isFormula(v)) { const res = evalCell(r, c); return res instanceof FErr ? NaN : res; }
      if (typeof v === 'number') return v;
      return isNumText(v) ? Number(v) : NaN;
    }
    return { evalCell, display, numeric, invalidate: () => cache.clear() };
  }
  const shiftRows = (f, d) => f.replace(/\b([A-Z]{1,2})(\d{1,4})\b/g, (m, l, n) => l + (Number(n) + d));
  const shiftCols = (f, at, d) => f.replace(/\b([A-Z]{1,2})(\d{1,4})\b/g, (m, l, n) => { const ci = colIndex(l); return (ci >= at ? colName(ci + d) : l) + n; });

  // ================= speech parsing =================
  const ONES = { zero: 0, nil: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
  const TENS = { twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
  const isDigits = (t) => /^\d+(\.\d+)?$/.test(t);
  const isInt = (t) => /^\d+$/.test(t);
  function wordsToNumbers(tokens) {
    const out = []; let i = 0;
    while (i < tokens.length) {
      const t = tokens[i];
      const start = t in ONES || t in TENS || t === 'hundred' || (t === 'a' && tokens[i + 1] === 'hundred') || (isDigits(t) && (tokens[i + 1] === 'point' || tokens[i + 1] === 'hundred'));
      if (!start) { out.push(t); i++; continue; }
      let j = i; let val;
      if (isDigits(t)) { val = Number(t); j++; if (tokens[j] === 'hundred') { val *= 100; j++; } }
      else {
        let cur = 0; let last = null;
        for (;;) {
          const w = tokens[j];
          if (w === 'a' && tokens[j + 1] === 'hundred' && last === null) { j++; last = 'a'; continue; }
          if (w === 'hundred' && (last === null || last === 'a' || last === 'ones') && cur < 10) { cur = (cur || 1) * 100; last = 'hundred'; j++; if (tokens[j] === 'and' && (tokens[j + 1] in ONES || tokens[j + 1] in TENS)) j++; continue; }
          if (w in TENS && (last === null || last === 'hundred')) { cur += TENS[w]; last = 'tens'; j++; continue; }
          if (w in ONES && (last === null || last === 'hundred')) { cur += ONES[w]; last = ONES[w] < 10 ? 'ones' : 'teen'; j++; continue; }
          if (w in ONES && last === 'tens' && ONES[w] > 0 && ONES[w] < 10) { cur += ONES[w]; last = 'unit'; j++; continue; }
          if (w && /^[1-9]$/.test(w) && last === 'tens') { cur += Number(w); last = 'unit'; j++; continue; }
          break;
        }
        val = cur;
      }
      if (tokens[j] === 'point' && tokens[j + 1] !== undefined && (tokens[j + 1] in ONES || tokens[j + 1] in TENS || isInt(tokens[j + 1]))) {
        j++; let digits = '';
        while (tokens[j] !== undefined) {
          const w = tokens[j];
          if (w in ONES && ONES[w] < 10) { digits += ONES[w]; j++; }
          else if (w in TENS) { let n = TENS[w]; j++; if (tokens[j] in ONES && ONES[tokens[j]] < 10) { n += ONES[tokens[j]]; j++; } digits += n; }
          else if (isInt(w)) { digits += w; j++; }
          else break;
        }
        val = Number(`${Math.trunc(val)}.${digits}`);
      }
      out.push(String(val)); i = j;
    }
    return out;
  }
  function normalize(text) {
    let s = String(text || '').toLowerCase();
    s = s.replace(/(\d)\.(\d)/g, '$1\u0001$2').replace(/\./g, ' ').replace(/\u0001/g, '.');
    s = s.replace(/\b([a-z]{1,2}) ?(\d{1,3})\s*[:\-–—]\s*([a-z]{1,2}) ?(\d{1,3})\b/g, '$1$2 to $3$4');
    s = s.replace(/%/g, ' percent ').replace(/[-–—:=,;!?"“”'’()]/g, ' ').replace(/[^a-z0-9.\s]/g, ' ');
    s = s.replace(/\b(?:standard|std)\s+(?:dev(?:iation)?s?|division)\b/g, 'stdev').replace(/\bs\s+d\s+(?=(?:of|for|in)\b)/g, 'sd ');
    return wordsToNumbers(s.split(/\s+/).filter(Boolean));
  }
  const FILLER = new Set(['is', 'equals', 'equal', 'marks', 'mark', 'mk', 'scored', 'score', 'scores', 'got', 'gets', 'get', 'give', 'gave', 'put', 'enter', 'set', 'the', 'in', 'of', 'and', 'please', 'value', 'as', 'has', 'with', 'student', 'roll', 'number', 'no', 'name', 'for', 'to', 'too', 'fore', 'ate', 'at', 'um', 'uh', 'okay', 'ok', 'then', 'now', 'a', 'an', 'into', 'cell', 'column', 'col', 'from', 'calculate', 'compute', 'find', 'write', 'type', 'make', 'it', 'marked', 'was', 'are', 'by', 'on', 'this', 'that', 'here', 'out', 'points', 'point', 'percent']);
  const HOMOPHONE = { to: 2, too: 2, for: 4, fore: 4, ate: 8 };
  const CLEAR_WORDS = new Set(['clear', 'blank', 'empty', 'delete', 'erase', 'remove', 'nothing', 'null']);
  const ABSENT_WORDS = new Set(['absent', 'ab', 'absentee']);

  // Header matching: exact or alias (3), shared prefix of 4+ letters (2), one or two typos (1). Text columns never match.
  const ALIASES = { avg: ['average', 'mean'], average: ['avg', 'mean'], mean: ['avg', 'average'], total: ['sum', 'grandtotal'], math: ['maths', 'mathematics'], maths: ['math', 'mathematics'], mathematics: ['math', 'maths'], percentage: ['percent'], max: ['maximum', 'highest'], min: ['minimum', 'lowest'] };
  // "SD", "Std Dev", "Standard Deviation" and "stdev" all name the same column; so do "Var" and "Variance".
  const statCanon = (s) => { const m = /^(sample|population)?(standarddeviation|stddeviation|stddev|stdev|std|sd|deviation|variances|variance|variants|var)$/.exec(s); return m ? `${m[1] === 'sample' ? 'S' : 'P'}${m[2].startsWith('var') ? 'VAR' : 'SD'}` : null; };
  function headerScore(spoken, col) {
    const names = [compact(col.header)]; if (col.title) names.push(compact(col.title));
    let best = 0;
    for (const h of names) {
      if (!h) continue;
      if (h === spoken || (ALIASES[h] || []).includes(spoken)) return 3;
      if (statCanon(h) && statCanon(h) === statCanon(spoken)) return 3;
      if (/\d/.test(spoken) || /\d/.test(h)) continue;
      if (Math.min(h.length, spoken.length) >= 4 && (h.startsWith(spoken) || spoken.startsWith(h))) best = Math.max(best, 2);
      else if (spoken.length >= 5 && lev(h, spoken) <= (spoken.length >= 8 ? 2 : 1)) best = Math.max(best, 1);
    }
    return best;
  }
  function matchHeader(S, spanTokens, { formulaOnly = false } = {}) {
    const spoken = compact(spanTokens.join(''));
    if (spoken.length < 2 || isInt(spoken)) return null;
    let best = 0, hits = [];
    S.columns.forEach((col, c) => {
      if (col.type === 'text' || (formulaOnly && col.type !== 'formula')) return;
      const sc = headerScore(spoken, col);
      if (sc > best) { best = sc; hits = [c]; } else if (sc && sc === best) hits.push(c);
    });
    if (!best) return null;
    return hits.length === 1 ? { c: hits[0], score: best } : { ambiguous: hits, score: best };
  }
  function findSpan(toks, maxLen, test) {
    for (let len = Math.min(maxLen, toks.length); len >= 1; len--) {
      for (let i = 0; i + len <= toks.length; i++) {
        const span = toks.slice(i, i + len);
        if (span.some((x) => x.used)) continue;
        const res = test(span.map((x) => x.t));
        if (res) return { i, len, res };
      }
    }
    return null;
  }
  const consume = (toks, hit) => { for (let k = hit.i; k < hit.i + hit.len; k++) toks[k].used = true; };
  const spanText = (toks, hit) => toks.slice(hit.i, hit.i + hit.len).map((x) => x.t).join(' ');
  const textCol = (S, re) => S.columns.findIndex((c) => c.type === 'text' && re.test(c.header));
  // Roll numbers as recognisers write them: "25 CS 324", "25 C S 324", "25 see ess 324", "two five cs three two four".
  const LETTER_SOUNDS = { bee: 'b', be: 'b', see: 'c', sea: 'c', cee: 'c', dee: 'd', ee: 'e', ef: 'f', eff: 'f', gee: 'g', jee: 'g', aitch: 'h', eich: 'h', jay: 'j', kay: 'k', el: 'l', ell: 'l', em: 'm', en: 'n', pee: 'p', cue: 'q', queue: 'q', ar: 'r', are: 'r', es: 's', ess: 's', as: 's', yes: 's', tee: 't', tea: 't', you: 'u', vee: 'v', ex: 'x', why: 'y', zed: 'z', zee: 'z' };
  function rollKey(toks) {
    let out = ''; let rep = 0;
    for (const t of toks) {
      if (t === 'double') { rep = 2; continue; } if (t === 'triple') { rep = 3; continue; }
      let piece;
      if (/^\d+$/.test(t)) piece = t;
      else if (LETTER_SOUNDS[t]) piece = LETTER_SOUNDS[t];
      else if (/^[a-z0-9]{1,4}$/.test(t) || /^(?=.*\d)[a-z0-9]{2,20}$/.test(t)) piece = t;
      else return null;
      out += rep && piece.length === 1 ? piece.repeat(rep) : piece; rep = 0;
    }
    return /\d/.test(out) ? out : null;
  }
  const digitsOf = (s) => String(s).replace(/\D/g, '');
  function rowsByRoll(S, span) {
    const rc = textCol(S, /roll|reg/i); if (rc < 0) return null;
    const key = rollKey(span); if (!key) return null;
    const rows = []; S.rows.forEach((row, r) => { if (row[rc] && compact(row[rc]) === key) rows.push(r); });
    if (rows.length) return rows;
    // Letters misheard beyond repair ("25 sees 324"): the digits alone still identify a roll when they are unique.
    const d = digitsOf(key); if (d.length < 5 || !/^\d/.test(span[0]) || !/^\d+$/.test(span[span.length - 1])) return null;
    S.rows.forEach((row, r) => { if (row[rc] && digitsOf(row[rc]) === d) rows.push(r); });
    return rows.length === 1 ? rows : null;
  }
  // Exact (or sound-alike) name or name part wins; otherwise the closest name if it is clearly closest.
  function rowsByName(S, spoken, exactOnly = false) {
    const nc = textCol(S, /name/i); if (nc < 0 || spoken.length < 3 || /\d/.test(spoken)) return null;
    const exact = [], scored = []; const sk = nameKey(spoken);
    S.rows.forEach((row, r) => {
      const full = String(row[nc] ?? '').toLowerCase().trim(); if (!full) return;
      const parts = full.split(/\s+/).map(compact).filter(Boolean); const fc = compact(full);
      const forms = [fc, ...parts]; if (parts.length > 2) forms.push(parts[0] + parts[parts.length - 1]);
      if (forms.includes(spoken) || (sk.length >= 3 && forms.some((f) => nameKey(f) === sk))) { exact.push(r); return; }
      if (exactOnly || spoken.length < 4) return;
      const best = Math.max(...forms.map((f) => jaroWinkler(nameKey(f), sk)));
      if (best >= 0.88) scored.push({ r, best });
    });
    if (exact.length) return exact;
    if (!scored.length) return null;
    scored.sort((a, b) => b.best - a.best);
    return scored.filter((x) => x.best >= scored[0].best - 0.02).map((x) => x.r);
  }

  // ----- dictating into the Name / Roll columns -----
  const TEXT_LEAD = new Set(['set', 'enter', 'put', 'write', 'type', 'the', 'student', 'students', 'is', 'as', 'equals', 'to', 'please', 'his', 'her', 'their', 'number', 'no']);
  const isRollCol = (col) => /roll|reg/i.test(col.header);
  function formatName(raw) {
    const words = String(raw).replace(/[^A-Za-zÀ-ɏ.' ]/g, ' ').split(/\s+/).filter(Boolean);
    while (words.length && TEXT_LEAD.has(words[0].toLowerCase())) words.shift();
    return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ').slice(0, 80);
  }
  // Returns a write action, an error, or null when the phrase is not a dictation (so normal parsing continues).
  function parseDictation(S, tokens) {
    const err = (msg) => ({ kind: 'error', msg });
    // An explicit text heading at the start ("name Rojan Adhikari", "roll number 25 CS 324")?
    let lead = 0; while (lead < tokens.length && TEXT_LEAD.has(tokens[lead])) lead++;
    let c = null; let skip = 0;
    for (let len = Math.min(3, tokens.length - lead); len >= 1 && c === null; len--) {
      const sp = compact(tokens.slice(lead, lead + len).join(''));
      const hit = S.columns.findIndex((col) => col.type === 'text' && (compact(col.header) === sp || (isRollCol(col) && /^(roll|rollno|rollnumber|reg|regno|registerno|registernumber|registrationnumber)$/.test(sp)) || (/name/i.test(col.header) && /^(name|studentname|fullname)$/.test(sp))));
      if (hit >= 0) { c = hit; skip = lead + len; }
    }
    const explicit = c !== null;
    if (!explicit) { const ac = S.columns[S.active.c]; if (!ac || ac.type !== 'text') return null; c = S.active.c; }
    const col = S.columns[c];
    let rest = tokens.slice(skip); while (rest.length && TEXT_LEAD.has(rest[0])) rest = rest.slice(1);
    if (!rest.length) return explicit ? err(`Say the ${col.header.toLowerCase()} after "${col.header}".`) : null;
    // A marks heading or a bare value means this is a mark for a student, not dictation.
    const view = rest.map((t) => ({ t, used: FILLER.has(t) }));
    if (findSpan(view, 3, (span) => { const m = matchHeader(S, span); return m && m.score >= 2 ? m : null; })) return null;
    if (rest.length === 1 && (CLEAR_WORDS.has(rest[0]) || ABSENT_WORDS.has(rest[0]))) return null;
    let value;
    if (isRollCol(col)) {
      if (explicit && findSpan(rest.map((t) => ({ t, used: false })), 6, (span) => rowsByRoll(S, span))) return null; // "roll 25CS324 …" names a student
      if (!explicit && rest.every((t) => isDigits(t)) && rest.length === 1 && rest[0].length <= 3) return null; // a mark said in the wrong column
      const key = rollKey(rest);
      if (!key || key.length < 4 || key.length > 20) return err(`Could not read a roll number from "${rest.join(' ')}". Say it like "25 CS 324".`);
      value = key.toUpperCase();
    } else {
      if (rest.some((t) => /\d/.test(t))) { if (explicit) return err(`A name cannot contain numbers ("${rest.join(' ')}").`); return null; }
      value = formatName(rest.join(' '));
      if (value.length < 2) return err('That name is too short. Say the full name.');
    }
    // A selected Name/Roll cell is written as is; "name …" / "roll …" said from another column fills this row
    // if its cell is still empty, otherwise the column's next empty cell (so a roster can be dictated row by row).
    let r = S.active.r;
    if (explicit && S.active.c !== c && r >= 0 && !isBlank(S.rows[r][c])) r = -1;
    if (r === -1) { r = firstEmpty(S, c); if (r < 0) return err(`Every cell under "${col.header}" is already filled.`); }
    if (isRollCol(col)) { const dup = S.rows.findIndex((row, i) => i !== r && row[c] && compact(row[c]) === compact(value)); if (dup >= 0) return err(`Roll ${value} is already on row ${dup + 2}.`); }
    return { kind: 'write', r, c, value, how: 'dictated' };
  }
  const rowLabel = (S, r) => { const nc = textCol(S, /name/i); const rc = textCol(S, /roll|reg/i); const row = S.rows[r] || []; return [nc >= 0 ? row[nc] : '', rc >= 0 ? row[rc] : ''].filter(Boolean).join(' · ') || `row ${r + 2}`; };
  const firstEmpty = (S, c) => S.rows.findIndex((x) => isBlank(x[c]));
  const rowName = (S, r, where) => { const l = rowLabel(S, r); return l === `row ${r + 2}` ? `row ${r + 2} (${where})` : `${l} (${where})`; };

  // ----- figures worked out and said back; nothing is written -----
  const STAT_PURE = new Set(['mean', 'average', 'avg', 'variance', 'variances', 'variants', 'var', 'stdev', 'sd', 'std', 'deviation']);
  const ASK_WORDS = new Set(['what', 'whats', 'tell', 'me', 'show', 'work', 'figure', 'how', 'much', 'say', 'read', 'can', 'you', 'could', 'would', 'will', 'i', 'need', 'want', 'know', 'class', 'whole', 'all', 'overall', 'students', 'everyone', 'entire', 'subject', 'his', 'her', 'their', 's', 'about', 'so', 'far', 'current', 'please']);
  function statAnswer(S, fns, cells, label, said) {
    const E = makeEngine(S); const xs = []; let absent = 0, pctSum = 0, pctMax = 0;
    for (const { r, c } of cells) {
      const v = E.numeric(r, c); const has = v !== null && Number.isFinite(v);
      if (has) xs.push(v); else if (S.rows[r][c] === 'AB') absent++;
      if (S.columns[c].type === 'number') { pctMax += colMax(S.columns[c]); if (has) pctSum += v; }
    }
    const nameOf = (fn) => (fn === 'AVERAGE' && said.includes('mean') ? 'Mean' : FN_LABEL[fn] || fn);
    if (!xs.length) return { kind: 'error', msg: `There are no marks in ${label} yet.` };
    const parts = [];
    for (const fn of [...new Set(fns)]) {
      let v;
      if (fn === 'PCT') {
        if (new Set(cells.map((x) => x.r)).size > 1 || !pctMax) return { kind: 'error', msg: 'Percentage works on one student’s marks, for example "percentage for Rojan". For a column, ask for the mean.' };
        v = (pctSum / pctMax) * 100;
      } else {
        try { v = aggregate(fn, xs); } catch (e) { return { kind: 'error', msg: `${nameOf(fn)} needs at least two marks, and ${label} has ${xs.length}.` }; }
      }
      parts.push({ fn, name: nameOf(fn), value: v });
    }
    const from = `${xs.length} mark${xs.length === 1 ? '' : 's'}${absent ? ` (${absent} absent left out)` : ''}`;
    const msg = parts.length === 1
      ? (parts[0].fn === 'COUNT' ? `${label} has ${from}.` : `${parts[0].name} of ${label} is ${fmtNum(parts[0].value)}, from ${from}.`)
      : `${label}, from ${from}: ${parts.map((p) => `${p.name.toLowerCase()} ${fmtNum(p.value)}`).join(', ')}.`;
    return { kind: 'answer', parts, n: xs.length, cells, msg: `${msg} The sheet is unchanged.` };
  }
  // "mean of physics", "physics average", "standard deviation for Rojan", "variance of row 5", "mean and SD of column C".
  // Returns an answer, an error, or null when the phrase is not asking for a figure (so names like "Max Kumar" still dictate).
  function parseStats(S, tokens) {
    const err = (msg) => ({ kind: 'error', msg });
    const isFn = (t) => !!FN_WORDS[t] && t !== 'add' && t !== 'percent';
    if (!tokens.some(isFn)) return null;
    const toks = tokens.map((t) => ({ t, used: false }));
    let row = null, col = null, variant = null;
    // A full name that contains a calculation word ("Max Mueller") names the student.
    const named = findSpan(toks, 3, (span) => (span.length > 1 && span.some(isFn) && !span.some((t) => /\d/.test(t)) ? rowsByName(S, compact(span.join('')), true) : null));
    if (named && named.res.length === 1) { row = named.res[0]; consume(toks, named); }
    const fi = toks.findIndex((x) => !x.used && isFn(x.t)); if (fi < 0) return null;
    toks[fi].used = true;
    const pure = STAT_PURE.has(toks[fi].t); const fns = [FN_WORDS[toks[fi].t]];
    const nCols = S.columns.length; const lastData = S.rows.length + 1;
    const ex = (S.columns.find((c) => c.type === 'number') || { header: 'Physics' }).header;
    for (let k = 0; k + 1 < toks.length && row === null && col === null; k++) {
      const a = toks[k], b = toks[k + 1]; if (a.used || b.used) continue;
      if (a.t === 'row' && isInt(b.t)) {
        const n = Number(b.t); if (n < 2 || n > lastData) return err(`Row ${n} is not a data row (data rows are 2–${lastData}).`);
        row = n - 2; a.used = b.used = true;
      } else if ((a.t === 'column' || a.t === 'col') && /^[a-z]{1,2}$/.test(b.t)) {
        const c = colIndex(b.t); if (c >= nCols) return err(`Column ${b.t.toUpperCase()} does not exist in this sheet (A–${colName(nCols - 1)}).`);
        col = c; a.used = b.used = true;
      }
    }
    if (row === null && col === null) {
      const hit = findSpan(toks, 6, (span) => rowsByRoll(S, span));
      if (hit) { if (hit.res.length > 1) return err(`Roll "${spanText(toks, hit)}" appears on more than one row.`); row = hit.res[0]; consume(toks, hit); }
    }
    for (const x of toks) {
      if (x.used) continue;
      if (VARIANT[x.t]) { variant = VARIANT[x.t]; x.used = true; } else if (FILLER.has(x.t) || ASK_WORDS.has(x.t)) x.used = true;
    }
    const plain = (span) => span.every((t) => !isFn(t));
    if (row === null && col === null) {
      const hh = findSpan(toks, 3, (span) => { if (!plain(span)) return null; const m = matchHeader(S, span); if (m && m.score < 3 && rowsByName(S, compact(span.join('')), true)) return null; return m; });
      if (hh) { if (hh.res.ambiguous) return err(`"${spanText(toks, hh)}" could be ${hh.res.ambiguous.map((c) => S.columns[c].header).join(' or ')}. Say the full column name.`); col = hh.res.c; consume(toks, hh); }
    }
    if (row === null && col === null) {
      const hit = findSpan(toks, 3, (span) => (!plain(span) || span.some((t) => /\d/.test(t)) ? null : rowsByName(S, compact(span.join('')))));
      if (hit) {
        if (hit.res.length > 1) return err(`"${spanText(toks, hit)}" matches ${hit.res.length} students (rows ${hit.res.slice(0, 4).map((r) => r + 2).join(', ')}). Say the roll number instead.`);
        row = hit.res[0]; consume(toks, hit);
        // "Max Kumar" is a student, not "the highest mark of Kumar".
        const nc = textCol(S, /name/i);
        if (!pure && String(S.rows[row][nc] || '').toLowerCase().split(/\s+/).map(compact).includes(toks[fi].t)) return null;
      }
    }
    if (row === null && col === null) {
      const rest = toks.filter((x) => !x.used);
      if (rest.length === 1 && /^[b-z]$/.test(rest[0].t) && colIndex(rest[0].t) < nCols) { col = colIndex(rest[0].t); rest[0].used = true; }
    }
    // More calculation words: "mean and standard deviation of …" asks for both; "mean of avg" names the Avg column.
    toks.forEach((x, k) => {
      if (x.used || !isFn(x.t)) return;
      x.used = true;
      if (row === null && col === null && k > 0 && /^(of|for|in)$/.test(toks[k - 1].t)) { const m = matchHeader(S, [x.t]); if (m && m.c !== undefined) { col = m.c; return; } }
      fns.push(FN_WORDS[x.t]);
    });
    const left = toks.filter((x) => !x.used).map((x) => x.t);
    if (left.length) return pure ? err(`Could not find "${left.join(' ')}" on this sheet. Say a column, a student or a range, for example "mean of ${ex}" or "mean of C2 to C21".`) : null;
    const asked = fns.map((f) => statFn(f, variant));
    if (row === null && col === null) {
      const ac = S.columns[S.active.c];
      if (!ac || ac.type === 'text') return pure ? err(`Say which marks to use, for example "mean of ${ex}", or select a marks column first.`) : null;
      const fam = (f) => String(f || '').replace(/\.[SP]$/, '');
      const mk = S.columns.map((cc, c) => (cc.type === 'number' ? c : -1)).filter((c) => c >= 0);
      if (ac.type === 'formula' && S.active.r >= 0 && mk.length && asked.some((f) => fam(f) === fam(fnForHeader(ac.header)))) {
        const word = toks[fi].t === 'stdev' ? 'standard deviation' : toks[fi].t; const r = S.active.r;
        return err(`To fill ${refOf(r, S.active.c)}, say the marks to use, for example "${refOf(r, mk[0])} to ${refOf(r, mk[mk.length - 1])}". For the whole class, say "${word} of ${ex}".`);
      }
      col = S.active.c;
    }
    if (col !== null) {
      const cc = S.columns[col];
      if (cc.type === 'text') return err(`"${cc.header}" (column ${colName(col)}) is a text column, so there are no marks to work out.`);
      return statAnswer(S, asked, S.rows.map((_, r) => ({ r, c: col })), `${cc.header} (${refOf(0, col)}:${refOf(S.rows.length - 1, col)})`, tokens);
    }
    const marks = S.columns.map((cc, c) => (cc.type === 'number' ? c : -1)).filter((c) => c >= 0);
    if (!marks.length) return err('This sheet has no marks columns.');
    return statAnswer(S, asked, marks.map((c) => ({ r: row, c })), rowName(S, row, `row ${row + 2}`), tokens);
  }

  // Parse one utterance into an action. It never writes anything itself.
  function parseUtterance(S, text) {
    const tokens = normalize(text);
    const j = tokens.join(' ');
    const err = (msg) => ({ kind: 'error', msg });
    const lastData = S.rows.length + 1;
    if (!tokens.length) return err('Nothing was heard.');
    if (/^(undo|undo that|undo last|undo last entry|go back)$/.test(j)) return { kind: 'cmd', cmd: 'undo' };
    if (/^(stop|stop listening|stop voice|stop dictation|mic off|stop mic|stop the mic)$/.test(j)) return { kind: 'cmd', cmd: 'stop' };
    if (/^(next row|new row|next line)$/.test(j)) return { kind: 'cmd', cmd: 'nextRow' };
    if (/^(next column|next cell|skip|next)$/.test(j)) return { kind: 'cmd', cmd: 'next' };
    const gm = j.match(/^(?:go to|goto|go|select|move to|jump to)\s+(.+)$/);
    if (gm) {
      const rest = gm[1];
      let m = rest.match(/^([a-z]{1,2}) ?(\d{1,3})$/);
      if (m) { const c = colIndex(m[1]), r = Number(m[2]) - 2; if (c >= S.columns.length || r < -1 || r >= S.rows.length) return err(`${m[1].toUpperCase()}${m[2]} is outside this sheet (columns A–${colName(S.columns.length - 1)}, rows 1–${lastData}).`); return { kind: 'cmd', cmd: 'goto', r, c }; }
      m = rest.match(/^row (\d{1,3})$/);
      if (m) { const r = Number(m[1]) - 2; if (r < -1 || r >= S.rows.length) return err(`Row ${m[1]} does not exist (rows 1–${lastData}).`); return { kind: 'cmd', cmd: 'goto', r, c: S.active.c }; }
      const hc = matchHeader(S, rest.split(' '));
      if (hc && hc.c !== undefined) return { kind: 'cmd', cmd: 'goto', r: S.active.r, c: hc.c };
      return err(`Could not find "${rest}" to go to.`);
    }

    // ----- mode 3: range calculation ("E5 to I5", "total C5 through G5", "sum of C5 to G5", "standard deviation of C2 to C21") -----
    const RANGE = /\b([a-z]{1,2}) ?(\d{1,3}) (?:to|2|too|two|through|thru|till|until|up to|upto) ([a-z]{1,2}) ?(\d{1,3})\b/;
    const RANGE_COLS = /\b([a-z]) (?:to|through|thru|till|until) ([a-z])\b/;
    let rm = j.match(RANGE); let rowFromActive = false;
    if (!rm && S.active.r >= 0) {
      const lm = j.match(RANGE_COLS);
      if (lm) { rm = [lm[0], lm[1], String(S.active.r + 2), lm[2], String(S.active.r + 2)]; rm.index = lm.index; rowFromActive = true; }
    }
    if (rm) {
      const c1 = colIndex(rm[1]), r1 = Number(rm[2]) - 2, c2 = colIndex(rm[3]), r2 = Number(rm[4]) - 2;
      const restToks = (j.slice(0, rm.index) + ' ' + j.slice(rm.index + rm[0].length)).split(/\s+/).filter(Boolean).map((t) => ({ t, used: false }));
      const fns = []; let targetC = null; let variant = null;
      const hh = findSpan(restToks, 3, (span) => matchHeader(S, span, { formulaOnly: true }));
      if (hh) { if (hh.res.ambiguous) return err(`"${spanText(restToks, hh)}" matches more than one column.`); targetC = hh.res.c; consume(restToks, hh); }
      for (const x of restToks) {
        if (x.used) continue;
        if (FN_WORDS[x.t]) { fns.push(FN_WORDS[x.t]); x.used = true; }
        else if (VARIANT[x.t]) { variant = VARIANT[x.t]; x.used = true; }
        else if (FILLER.has(x.t) || ASK_WORDS.has(x.t)) x.used = true;
      }
      const left = restToks.filter((x) => !x.used).map((x) => x.t);
      if (left.length) return err(`Did not understand "${left.join(' ')}" in the calculation.`);
      const nCols = S.columns.length;
      if (c1 >= nCols || c2 >= nCols) return err(`Column ${(c1 >= nCols ? rm[1] : rm[3]).toUpperCase()} does not exist in this sheet (A–${colName(nCols - 1)}).`);
      // A block over several rows, more than one figure, or a calculation asked for while a marks cell is selected:
      // work it out and say it. Only a single calculation on one row goes into a calculated cell.
      const tc0 = S.columns[targetC !== null ? targetC : S.active.c];
      const asked = [...new Set([...(hh ? [fnForHeader(S.columns[targetC].header)] : []), ...fns].filter(Boolean).map((f) => statFn(f, variant)))];
      const hhWord = hh && restToks.slice(hh.i, hh.i + hh.len).every((x) => FN_WORDS[x.t]);
      const many = new Set([...(hhWord ? [statFn(fnForHeader(S.columns[targetC].header), variant)] : []), ...fns.map((f) => statFn(f, variant))].filter(Boolean)).size > 1;
      if (r1 !== r2 || many || (fns.length && !(tc0 && tc0.type === 'formula'))) {
        if (!asked.length) return err(`${refOf(r1, c1)} to ${refOf(r2, c2)} covers more than one row, so it cannot go in one cell. To hear a figure for it, say what to work out, for example "mean of ${refOf(r1, c1)} to ${refOf(r2, c2)}".`);
        const rlo = Math.min(r1, r2), rhi = Math.max(r1, r2), clo = Math.min(c1, c2), chi = Math.max(c1, c2);
        if (rlo < 0 || rhi >= S.rows.length) return err(`Row ${(rlo < 0 ? rlo : rhi) + 2} is not a data row (data rows are 2–${lastData}).`);
        const cells = []; for (let r = rlo; r <= rhi; r++) for (let c = clo; c <= chi; c++) cells.push({ r, c });
        const rng = `${refOf(rlo, clo)}:${refOf(rhi, chi)}`;
        const label = clo === chi ? `${S.columns[clo].header} (${rng})` : rlo === rhi ? rowName(S, rlo, rng) : rng;
        return statAnswer(S, asked, cells, label, tokens);
      }
      if (targetC === null) targetC = S.active.c;
      const tcol = S.columns[targetC];
      if (!tcol || tcol.type !== 'formula') return err(`${tcol ? `"${tcol.header}"` : 'This column'} is not a calculated column. Select a Total, Avg or other formula cell first.`);
      if (r1 < 0 || r1 >= S.rows.length) return err(`Row ${r1 + 2} is not a data row (data rows are 2–${lastData}).`);
      const r = S.active.r === -1 ? r1 : S.active.r;
      if (r !== r1 && !rowFromActive) return err(`Wrong row: the selected cell is on row ${r + 2}, but you said row ${r1 + 2}. Nothing was calculated.`);
      const lo = Math.min(c1, c2), hi = Math.max(c1, c2);
      if (targetC >= lo && targetC <= hi) return err(`The range ${refOf(r1, lo)}:${refOf(r1, hi)} includes the ${tcol.header} column itself.`);
      for (let c = lo; c <= hi; c++) {
        const col = S.columns[c];
        if (col.type === 'text') return err(`The range includes "${col.header}" (column ${colName(c)}), which is a text column.`);
        if (col.type === 'formula') return err(`The range includes "${col.header}" (column ${colName(c)}), which is already a calculated column.`);
      }
      const headerFn = fnForHeader(tcol.header);
      const fn = statFn(fns[0] || headerFn, variant);
      if (!fn) return err(`Cannot tell which calculation "${tcol.header}" needs. Say, for example, "sum of ${refOf(r1, lo)} to ${refOf(r1, hi)}".`);
      if (/\.S$/.test(fn) && lo === hi) return err(`${FN_LABEL[fn]} needs at least two cells; ${refOf(r1, lo)} is one.`);
      const rng = `${refOf(r1, lo)}:${refOf(r1, hi)}`;
      let formula;
      if (fn === 'PCT') { let mx = 0; for (let c = lo; c <= hi; c++) mx += colMax(S.columns[c]); formula = `=SUM(${rng})/${mx}*100`; }
      else formula = `=${fn}(${rng})`;
      const covered = []; for (let c = lo; c <= hi; c++) covered.push(refOf(r1, c));
      const spoken = fn !== headerFn ? `${FN_LABEL[fn]} as spoken` : '';
      return { kind: 'formula', r: r1, c: targetC, formula, fn, note: [spoken, `${covered.length} cell${covered.length === 1 ? '' : 's'}: ${covered.join(', ')}`].filter(Boolean).join('; ') };
    }

    // ----- figures said out loud: "mean of physics", "standard deviation for Rojan", "variance of row 5" -----
    const st = parseStats(S, tokens);
    if (st) return st;

    // ----- names and roll numbers spoken into a Name / Roll column -----
    const dict = parseDictation(S, tokens);
    if (dict) return dict;

    // ----- modes 1 and 2: a value, optionally with a column, cell or row -----
    const toks = tokens.map((t) => ({ t, used: false }));
    let outOf = null;
    for (let k = 0; k + 2 < toks.length; k++) if (toks[k].t === 'out' && toks[k + 1].t === 'of' && isDigits(toks[k + 2].t)) { outOf = Number(toks[k + 2].t); toks[k].used = toks[k + 1].used = toks[k + 2].used = true; break; }
    let row = null; let rowWhy = '';
    for (let k = 0; k + 1 < toks.length; k++) {
      if (toks[k].t === 'row' && isInt(toks[k + 1].t)) {
        const n = Number(toks[k + 1].t);
        if (n - 2 < 0 || n - 2 >= S.rows.length) return err(`Row ${n} does not exist. Data rows are 2–${lastData}.`);
        row = n - 2; rowWhy = `row ${n}`; toks[k].used = toks[k + 1].used = true; break;
      }
    }
    if (row === null) {
      const hit = findSpan(toks, 6, (span) => rowsByRoll(S, span));
      if (hit) { if (hit.res.length > 1) return err(`Roll "${spanText(toks, hit)}" appears on more than one row.`); row = hit.res[0]; rowWhy = 'roll'; consume(toks, hit); }
    }
    // Column heading (fillers are skipped; a weak heading match never beats an exact student name).
    let col = null;
    const view = toks.map((x) => (FILLER.has(x.t) && !x.used ? { ...x, used: true } : x));
    const hh = findSpan(view, 3, (span) => { const m = matchHeader(S, span); if (m && m.score < 3 && row === null && rowsByName(S, compact(span.join('')), true)) return null; return m; });
    if (hh) { if (hh.res.ambiguous) return err(`"${spanText(toks, hh)}" could be ${hh.res.ambiguous.map((c) => S.columns[c].header).join(' or ')}. Say the full column name.`); col = hh.res.c; consume(toks, hh); }
    // Cell reference ("E5", "E 5").
    let ref = null;
    for (let k = 0; k < toks.length && !ref; k++) {
      if (toks[k].used) continue;
      let m = toks[k].t.match(/^([a-z]{1,2})(\d{1,3})$/); let len = 1;
      if (!m && /^[a-z]{1,2}$/.test(toks[k].t) && toks[k].t !== 'a' && !FILLER.has(toks[k].t) && toks[k + 1] && !toks[k + 1].used && /^\d{1,3}$/.test(toks[k + 1].t) && colIndex(toks[k].t) < S.columns.length) { m = [null, toks[k].t, toks[k + 1].t]; len = 2; }
      if (!m) continue;
      const c = colIndex(m[1]); const r = Number(m[2]) - 2;
      if (c >= S.columns.length) { if (m[1].length === 1) return err(`Column ${m[1].toUpperCase()} does not exist in this sheet (A–${colName(S.columns.length - 1)}).`); continue; }
      if (r < 0 || r >= S.rows.length) return err(`${m[1].toUpperCase()}${m[2]} is not a data cell. Data rows are 2–${lastData}.`);
      ref = { r, c }; toks[k].used = true; if (len === 2) toks[k + 1].used = true;
    }
    for (const x of toks) if (!x.used && FILLER.has(x.t)) { x.used = true; x.filler = true; }
    if (row === null && !ref) {
      const hit = findSpan(toks, 3, (span) => (span.some((t) => /\d/.test(t)) ? null : rowsByName(S, compact(span.join('')))));
      if (hit) {
        if (hit.res.length > 1) return err(`"${spanText(toks, hit)}" matches ${hit.res.length} rows (${hit.res.slice(0, 4).map((r) => r + 2).join(', ')}). Say the roll number instead.`);
        row = hit.res[0]; rowWhy = 'name'; consume(toks, hit);
      }
    }
    const values = []; const unknown = [];
    for (const x of toks) {
      if (x.used) continue;
      if (isDigits(x.t)) values.push(Number(x.t));
      else if (ABSENT_WORDS.has(x.t)) values.push('AB');
      else if (CLEAR_WORDS.has(x.t)) values.push(null);
      else unknown.push(x.t);
    }
    if (unknown.length) {
      const nc = textCol(S, /name/i);
      if (nc >= 0 && !values.length && unknown.every((t) => /^[a-z]+$/.test(t))) return err(`"${unknown.join(' ')}" is not a student on this sheet. To write it as a name, select the ${S.columns[nc].header} column or say "${S.columns[nc].header.toLowerCase()} ${unknown.join(' ')}".`);
      return err(`Did not recognise "${unknown.join(' ')}" — no column, student or command matches it.`);
    }
    // "to"/"for" heard as the whole value ("physics for") only in short phrases with no cell reference.
    const lastTok = toks[toks.length - 1];
    if (!values.length && !ref && tokens.length <= 3 && lastTok.filler && HOMOPHONE[lastTok.t] !== undefined) values.push(HOMOPHONE[lastTok.t]);
    if (!values.length) return err('No value was heard. Say a number such as "75", or "absent".');
    if (values.length > 1) return err(`Heard more than one value (${values.map((x) => (x === null ? 'clear' : x)).join(', ')}). Say one value at a time.`);
    const value = values[0];

    let r, c, how;
    if (ref) {
      if (col !== null && col !== ref.c) return err(`${refOf(ref.r, ref.c)} is in "${S.columns[ref.c].header}", not "${S.columns[col].header}".`);
      if (row !== null && row !== ref.r) return err(`${refOf(ref.r, ref.c)} is on row ${ref.r + 2}, but the ${rowWhy} points to row ${row + 2}.`);
      ({ r, c } = ref); how = 'cell';
    } else if (row !== null) {
      c = col !== null ? col : S.active.c; r = row; how = rowWhy;
      if (col === null && S.columns[c].type !== 'number') return err(`Say which column for ${rowLabel(S, r)}; the selected column "${S.columns[c].header}" does not take marks.`);
    } else {
      c = col !== null ? col : S.active.c; r = S.active.r; how = col !== null ? 'column' : 'active';
      if (r === -1) { r = firstEmpty(S, c); if (r < 0) return err(`Every cell under "${S.columns[c].header}" is already filled.`); how = 'next empty'; }
    }
    const tc = S.columns[c];
    if (outOf !== null && tc.type === 'number' && outOf !== colMax(tc)) return err(`You said "out of ${outOf}", but ${tc.header} is marked out of ${colMax(tc)}.`);
    const v = validateValue(tc, value, 'voice');
    if (v.error) return err(v.error);
    return { kind: 'write', r, c, value: v.value, how };
  }
  // Validation shared by voice and typing. Voice only writes marks, "absent" or "clear" into mark columns.
  function validateValue(col, value, source) {
    if (value === null) return { value: null };
    if (col.type === 'formula') {
      if (isFormula(value)) return { value: value.toUpperCase().replace(/\s+/g, '') };
      return { error: `"${col.header}" is a calculated column. ${source === 'voice' ? 'Say a range such as "C5 to G5" here.' : 'Type a formula such as =SUM(C2:G2), or clear it.'}` };
    }
    if (col.type === 'text') {
      if (source === 'voice') return { error: `"${col.header}" takes ${isRollCol(col) ? 'a roll number such as "25 CS 324"' : 'a name, not a mark'}. For a mark, say the column too, e.g. "physics 75".` };
      return { value: isFormula(value) ? value.toUpperCase().replace(/\s+/g, '') : String(value).slice(0, 200) };
    }
    if (value === 'AB') return { value: 'AB' };
    if (isFormula(value)) return { value: value.toUpperCase().replace(/\s+/g, '') };
    const n = typeof value === 'number' ? value : isNumText(value) ? Number(value) : NaN;
    if (!Number.isFinite(n)) return { error: `"${value}" is not a number. ${col.header} takes marks from 0 to ${colMax(col)}.` };
    if (n < 0 || n > colMax(col)) return { error: `${fmtNum(n)} is out of range for ${col.header} (0–${colMax(col)}).` };
    if (round2(n) !== n) return { error: `${n} has more than two decimal places.` };
    return { value: n };
  }
  function parseTyped(col, text) {
    const s = String(text).trim();
    if (!s) return { value: null };
    if (s.startsWith('=')) return validateValue(col, s, 'typed');
    if (col.type === 'number' && /^(ab|absent)$/i.test(s)) return { value: 'AB' };
    if (col.type === 'number') return validateValue(col, isNumText(s) ? Number(s) : s, 'typed');
    return validateValue(col, s, 'typed');
  }

  // ================= CSV =================
  function parseCSV(text) {
    const rows = []; let row = [], cur = '', q = false;
    const s = String(text).replace(/^﻿/, '');
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (q) { if (ch === '"') { if (s[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
      else if (ch === '"') q = true;
      else if (ch === ',') { row.push(cur); cur = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && s[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
      else cur += ch;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    return rows.filter((r) => r.some((x) => x.trim() !== ''));
  }
  const csvCell = (v) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

  // ================= list page =================
  async function listView(query) {
    const base = baseFor();
    const v = shell(`${base}/sheets`);
    const fromOffering = Number(query.offering) || null;
    async function load() {
      try {
        const [sheets, offs] = await Promise.all([api.get('/api/sheets'), api.get('/api/offerings?pageSize=200').catch(() => ({ rows: [] }))]);
        draw(sheets, offs.rows || []);
        return sheets;
      } catch (e) { errorBox(v, e, load); return null; }
    }
    function draw(sheets, offerings) {
      v.innerHTML = html`<div class="page-head"><div><h1>Voice Sheets</h1><p>Spreadsheet-style mark entry. Open a sheet, press <kbd>Ctrl</kbd>+<kbd>Alt</kbd> and speak: each value fills the selected cell and the cursor moves on.</p></div>
        ${state.me.role === 'staff' ? html`<a class="btn" href="#/staff/go/voice">${icon('mic', 16)} Single-mark Voice Entry</a>` : ''}</div>
        <div class="sh-new grid g2">
          <form class="card card-pad" data-submit="blank" aria-labelledby="sh-nb">
            <h2 id="sh-nb">${icon('grid', 18)} New blank sheet</h2>
            <div class="field"><label for="nb-title">Title</label><input class="input" id="nb-title" name="title" maxlength="120" value="Class marks" required></div>
            <div class="field"><label for="nb-headers">Column headings</label><input class="input" id="nb-headers" name="headers" value="Name, Roll, Physics, Chemistry, Math, English, History, Total, Avg">
              <div class="hint">Comma separated. Total, Sum, Avg, Max, Min, Count, Percentage, SD and Variance become calculated columns; Name and Roll are text; every other heading takes marks out of 100.</div></div>
            <div class="field"><label for="nb-rows">Rows</label><input class="input" id="nb-rows" name="rowCount" type="number" min="1" max="${MAX_ROWS}" value="20" style="max-width:120px"></div>
            <button class="btn primary">${icon('plus', 16)} Create sheet</button>
          </form>
          <form class="card card-pad" data-submit="course" aria-labelledby="sh-nc">
            <h2 id="sh-nc">${icon('book', 18)} New from a course</h2>
            <p class="small muted">One row per student and one column per assessment. Marks already entered are filled in.</p>
            ${offerings.length ? html`<div class="field"><label for="nc-off">Course</label><select class="input" id="nc-off" name="offeringId" required>${offerings.map((o) => html`<option value="${o.id}" ${o.id === fromOffering ? 'selected' : ''}>${o.code} · ${o.name} · ${o.batch}${o.section ? ` · Sec ${o.section}` : ''} (${o.students} students)</option>`)}</select></div>
              <button class="btn primary">${icon('plus', 16)} Build from course</button>` : html`<div class="empty"><b>No courses available.</b>You can still create a blank sheet.</div>`}
          </form>
        </div>
        <div class="card" style="margin-top:16px"><div class="card-head"><h2>My sheets</h2><span class="small muted">${sheets.length} sheet${sheets.length === 1 ? '' : 's'}</span></div>
          ${sheets.length ? html`<div class="table-wrap"><table class="table stack-sm"><thead><tr><th>Title</th><th>Course</th><th class="num">Rows</th><th>Updated</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>
            ${sheets.map((s) => html`<tr class="clickable" data-click="open" data-id="${s.id}"><td data-label="Title"><b>${s.title}</b></td><td data-label="Course">${s.courseCode ? html`<span class="mono small">${s.courseCode}</span> ${s.course}` : html`<span class="muted">Blank sheet</span>`}</td>
              <td data-label="Rows" class="num">${s.rowCount}</td><td data-label="Updated">${fmt.dateTime(s.updatedAt)}</td><td><div class="btn-row"><a class="btn sm" href="${base}/sheet/${s.id}">Open</a><button class="btn sm danger" data-click="del" data-id="${s.id}" aria-label="Delete ${s.title}">${icon('trash', 15)}</button></div></td></tr>`)}
          </tbody></table></div>` : html`<div class="empty"><b>No sheets yet.</b>Create a blank sheet or build one from a course.</div>`}</div>`.s;
    }
    const create = async (offeringId) => {
      try { const s = await api.post('/api/sheets', { offeringId }); go(`${base}/sheet/${s.id}`); } catch (e) { toast(e.message, 'error', 'Sheet not created'); }
    };
    bind(v, {
      open: (el) => go(`${base}/sheet/${el.dataset.id}`),
      del: async (el) => {
        if (!(await confirmBox('Delete sheet?', 'The sheet will be removed permanently. Marks already posted to a course are not affected.', 'Delete', true))) return;
        try { await api.del(`/api/sheets/${el.dataset.id}`); toast('Sheet deleted.', 'success'); load(); } catch (e) { toast(e.message, 'error'); }
      },
      blank: async (f) => {
        const headers = f.elements.headers.value.split(',').map((x) => x.trim()).filter(Boolean);
        if (headers.length > MAX_COLS) return toast(`Use at most ${MAX_COLS} columns.`, 'error');
        if (headers.some((h) => h.length > 60)) return toast('Each heading can be at most 60 characters.', 'error');
        try { const s = await api.post('/api/sheets', { title: f.elements.title.value, headers, rowCount: Number(f.elements.rowCount.value) || 20 }); go(`${base}/sheet/${s.id}`); } catch (e) { toast(e.message, 'error', 'Sheet not created'); }
      },
      course: (f) => create(Number(f.elements.offeringId.value)),
    });
    v.innerHTML = loading(3).s;
    const sheets = await load();
    // Link-in from a course's Voice Entry tab (?offering=ID): reuse the latest sheet for that course, or build one.
    if (fromOffering && sheets) {
      history.replaceState(null, '', `${base}/sheets`);
      const mine = sheets.filter((s) => s.offeringId === fromOffering);
      if (!mine.length) { await create(fromOffering); return; }
      const m = modal({ title: 'Open as voice sheet', body: html`<p>You already have ${mine.length === 1 ? 'a sheet' : `${mine.length} sheets`} for this course. The latest is <b>${mine[0].title}</b>, updated ${fmt.dateTime(mine[0].updatedAt)}.</p><p class="small muted">A new sheet starts from the current roster and the marks saved in the course right now.</p>`,
        foot: html`<button class="btn" id="fo-new">Create a new sheet</button><button class="btn primary" id="fo-open">Open latest</button>` });
      $('#fo-open', m.el).onclick = () => { m.close(); go(`${base}/sheet/${mine[0].id}`); };
      $('#fo-new', m.el).onclick = () => { m.close(); create(fromOffering); };
    }
  }

  // ================= sheet page =================
  async function sheetView(id) {
    const base = baseFor();
    const v = shell(`${base}/sheets`);
    let data;
    try { data = await api.get(`/api/sheets/${id}`); } catch (e) { errorBox(v, e, () => App.render()); return; }
    const myView = state.view;
    const S = {
      id: data.id, title: data.title, offeringId: data.offeringId, studentIds: data.studentIds || [],
      columns: data.columns, rows: data.rows.map((r) => data.columns.map((_, c) => (r[c] === undefined ? null : r[c]))),
      active: { r: 0, c: 0 }, dir: 'right', undo: [], log: [], listening: false, wantListen: false, rec: null, editing: null, saved: '', discard: false,
      gate: VoiceGate.create(), segStart: 0, holding: false, gateOff: null, meterWarned: false,
    };
    const firstNum = () => S.columns.findIndex((c) => c.type === 'number');
    if (firstNum() >= 0) S.active.c = firstNum();
    if (!S.rows.length) S.rows.push(S.columns.map(() => null));
    const E = makeEngine(S);
    const payload = () => JSON.stringify({ title: S.title, columns: S.columns, rows: S.rows });
    S.saved = payload();
    const isDirty = () => !S.discard && payload() !== S.saved;
    const hasAssess = () => S.columns.some((c) => c.assessmentId) && S.studentIds.length > 0;
    const alive = () => state.view === myView && document.body.contains(v) && !!$('#sh-root', v);

    v.innerHTML = html`<div id="sh-root" class="sh-root">
      <div class="page-head sh-head"><div class="grow" style="min-width:0">
          <a class="small" href="${base}/sheets">← All voice sheets</a>
          <label class="sr-only" for="sh-title">Sheet title</label>
          <input class="sh-title" id="sh-title" maxlength="120" value="${S.title}" data-change="title" title="Click to rename">
          <div class="small muted" id="sh-meta"></div></div>
        <div class="btn-row"><span class="sh-dirty" id="sh-dirty" role="status"></span>
          <button class="btn primary" data-click="save" id="sh-save">${icon('save', 16)} Save</button></div></div>
      <div class="card sh-bar">
        <div class="sh-tools" role="toolbar" aria-label="Sheet tools">
          <button class="sh-mic" data-click="mic" id="sh-mic" aria-pressed="false" aria-label="Start voice input (Ctrl+Alt)">${icon('mic', 18)}<span>Voice</span><kbd>Ctrl+Alt</kbd></button>
          <button class="sh-dir" data-click="dir" id="sh-dir"></button>
          <span class="sh-sep" aria-hidden="true"></span>
          <button class="btn sm" data-click="undo" id="sh-undo" aria-label="Undo (Ctrl+Z)">${icon('undo', 15)} Undo</button>
          <button class="btn sm" data-click="addRow" aria-label="Add a row at the end">${icon('plus', 15)} Row</button>
          <button class="btn sm" data-click="addCol" aria-label="Add a column">${icon('plus', 15)} Column</button>
          <button class="btn sm" data-click="colSettings" aria-label="Settings for the selected column">${icon('settings', 15)} Column settings</button>
          <button class="btn sm" data-click="fillDown" title="Copy the selected formula to the empty cells below">${icon('sigma', 15)} Fill down</button>
          <span class="sh-sep" aria-hidden="true"></span>
          <button class="btn sm" data-click="importCsv">${icon('upload', 15)} Import CSV</button>
          <button class="btn sm" data-click="exportCsv">${icon('download', 15)} Export CSV</button>
          <button class="btn sm accent ${hasAssess() ? '' : 'hidden'}" data-click="post" id="sh-post">${icon('check', 15)} Post marks to course</button>
          <span class="grow"></span>
          <button class="btn sm ghost" data-click="help" id="sh-help-btn" aria-controls="sh-help">${icon('info', 15)} Help</button>
          <button class="btn sm ghost danger" data-click="delSheet" aria-label="Delete sheet">${icon('trash', 15)}</button>
        </div>
        <div class="sh-vg" id="sh-vg"></div>
        <div class="sh-voice" id="sh-voice" aria-hidden="true"><span class="sh-pulse" aria-hidden="true"></span><b>Listening…</b><span class="sh-interim" id="sh-interim"></span></div>
        <form class="sh-cmd" data-submit="cmd"><label class="sr-only" for="sh-cmd">Voice command (typed)</label>
          <span class="sh-cmd-ico" aria-hidden="true">${icon('mic', 15)}</span>
          <input class="input" id="sh-cmd" name="cmd" autocomplete="off" placeholder="${SR ? 'Or type what you would say: 75 · physics 82 · E5 to I5 · mean of physics' : 'Speech is not available in this browser. Type what you would say: 75 · physics 82 · E5 to I5 · mean of physics'}">
          <button class="btn sm primary">Run</button></form>
        <div class="sh-banner hidden" id="sh-banner" role="alert"></div>
        <div class="sh-fx"><label class="sr-only" for="sh-name">Cell reference</label><input class="sh-name" id="sh-name" autocomplete="off" spellcheck="false">
          <span class="sh-fx-ico" aria-hidden="true">ƒx</span><label class="sr-only" for="sh-fxv">Cell content</label><input class="sh-fxv" id="sh-fxv" autocomplete="off" spellcheck="false"></div>
        <div class="sh-scroll" id="sh-scroll"></div>
        <div class="sh-status"><span id="sh-last" class="sh-last">Ready.</span><span id="sh-sel" class="muted"></span></div>
      </div>
      <div class="sh-panels">
        <div class="card"><div class="card-head"><h3>Voice log</h3><span class="small muted" id="sh-log-n"></span></div><ol class="sh-log" id="sh-log" aria-label="Voice log, newest first"></ol></div>
        <div class="card sh-help" id="sh-help" tabindex="-1"><div class="card-head"><h3>How voice entry works</h3></div><div class="card-body small">
          <p>Press <kbd>Ctrl</kbd>+<kbd>Alt</kbd> (or the Voice button) to start and stop listening. Every phrase is checked before anything is written; anything unclear is shown in red and nothing changes.</p>
          <h4>1 · Fill and move on</h4>
          <p>Say <q>75</q>, <q>eighty two point five</q> or <q>absent</q>. The value goes into the selected cell, then the cursor moves <b>right</b> or <b>down</b>, following your last move (arrow keys, Tab, Enter or a click). Click the <b>Next</b> chip to switch.</p>
          <h4>2 · Let the column decide</h4>
          <p>With no column or row named, the value is checked against the selected column’s heading (marks 0–max, text or calculated). Select a heading in row 1 and say <q>75</q> to fill that column’s next empty cell. You can also say <q>physics 75</q>, <q>E5 82</q>, <q>row 7 history 64</q>, or a roll number or name with a column (<q>25 CS 324 physics 80</q>, <q>Rojan math 70</q>).</p>
          <p>To fill in students, select a Name or Roll cell and say the name or roll number (<q>Rojan Adhikari</q>, <q>25 CS 324</q>), or say <q>name Kavya Sri</q> / <q>roll 25 CS 101</q> from anywhere on the row.</p>
          <h4>3 · Calculate on Total, Avg, SD…</h4>
          <p>Select a Total or Avg cell and say <q>C5 to G5</q> (or <q>sum of C5 through G5</q>). Every cell from the first to the last is included, so <q>C5 to E5</q> uses C5, D5 and E5. The heading decides: Total/Sum → SUM, Avg/Mean → AVERAGE, SD → STDEV.P, Variance → VAR.P, Max/Highest, Min/Lowest, Count, Percentage. The result stays live as marks change. A range on another row, across text or calculated columns, or including the column itself is rejected. <b>Fill down</b> copies a formula to the empty cells below, in rows that hold data.</p>
          <h4>4 · Ask for a figure</h4>
          <p>Say <q>mean of physics</q>, <q>standard deviation of total</q>, <q>variance for Rojan</q> or <q>mean and standard deviation of C2 to C21</q>. You hear the answer and the sheet is unchanged. Variance and standard deviation use the whole class (divide by n); say <q>sample standard deviation</q> to divide by n − 1. Absent and blank cells are left out.</p>
          <h4>Noisy rooms</h4>
          <p><b>Nearest voice only</b> accepts a phrase only when the microphone heard it clearly above the room's background, so colleagues talking nearby are ignored and logged as background. Watch the meter: your voice should pass the line. Lower the <b>sensitivity</b> if chatter still gets through, raise it if you are being ignored. <b>Hold Ctrl+Alt to talk</b> listens only while the keys are held. Unclear recognitions are rejected. Browsers have limited noise cancellation, so a headset or close-talk microphone works best.</p>
          <h4>Commands</h4>
          <p><q>undo</q>, <q>clear</q>, <q>next row</q>, <q>go to E5</q>, <q>stop listening</q>.</p>
          <h4>Keyboard</h4>
          <p>Arrows, Tab and Enter move; type to replace a cell; <kbd>F2</kbd> or double-click edits; <kbd>Esc</kbd> cancels; <kbd>Delete</kbd> clears; <kbd>Ctrl</kbd>+<kbd>Z</kbd> undoes; <kbd>Ctrl</kbd>+<kbd>S</kbd> saves. Formulas such as <code>=SUM(C2:G2)</code>, <code>=AVERAGE(C2:G2)</code>, <code>=STDEV.P(C2:C21)</code>, <code>=VAR.P(C2:C21)</code> or <code>=C2+D2*2</code> work in any cell.</p>
        </div></div>
      </div>
      <div class="sr-only" aria-live="assertive" id="sh-live"></div>
      <input type="file" id="sh-file" accept=".csv,text/csv" class="hidden" aria-hidden="true" tabindex="-1">
    </div>`.s;

    const scroll = $('#sh-scroll', v);
    let table = null; let tds = [];

    // ---------- grid rendering ----------
    function colClass(c) {
      const col = S.columns[c];
      const t = col.type === 'number' ? 't-num' : col.type === 'formula' ? 't-fx' : 't-text';
      const w = c === 0 && col.type === 'text' ? 'w-name frz' : col.type === 'text' ? 'w-text' : col.type === 'formula' ? 'w-fx' : 'w-num';
      return `${t} ${w}`;
    }
    function headerHint(col) {
      if (col.type === 'number') return `0–${colMax(col)}`;
      if (col.type === 'formula') { const f = fnForHeader(col.header); return f ? `ƒ ${FN_HINT[f] || FN_LABEL[f]}` : 'ƒ formula'; }
      return 'text';
    }
    const cellId = (r, c) => `shc-${r + 1}-${c}`;
    function renderGrid() {
      const nC = S.columns.length;
      const frz = S.columns[0].type === 'text';
      scroll.classList.toggle('frz', frz);
      scroll.innerHTML = html`<table class="sh-table" id="sh-grid" role="grid" tabindex="0" aria-label="${S.title}" aria-rowcount="${S.rows.length + 2}" aria-colcount="${nC + 1}" aria-describedby="sh-sel">
        <thead><tr role="row" aria-rowindex="1"><th class="sh-corner" role="columnheader" aria-colindex="1"><span class="sr-only">Row numbers</span></th>
          ${S.columns.map((col, c) => html`<th role="columnheader" aria-colindex="${c + 2}" class="sh-letter ${colClass(c)}" data-c="${c}" data-r="-1" aria-label="Column ${colName(c)}, ${col.header}">${colName(c)}</th>`)}</tr></thead>
        <tbody>
          <tr role="row" aria-rowindex="2" class="sh-hrow"><th role="rowheader" class="sh-rn" aria-colindex="1">1</th>
            ${S.columns.map((col, c) => html`<td role="gridcell" id="shc-0-${c}" aria-colindex="${c + 2}" class="sh-h ${colClass(c)}" data-r="-1" data-c="${c}" title="${col.title || col.header}${col.assessmentId ? ` · out of ${colMax(col)}` : ''}"><span class="sh-hn">${col.header}</span><span class="sh-ht">${headerHint(col)}</span></td>`)}</tr>
          ${S.rows.map((row, r) => html`<tr role="row" aria-rowindex="${r + 3}"><th role="rowheader" class="sh-rn" aria-colindex="1">${r + 2}</th>${S.columns.map((col, c) => html`<td role="gridcell" id="shc-${r + 1}-${c}" aria-colindex="${c + 2}" class="${colClass(c)}" data-r="${r}" data-c="${c}"></td>`)}</tr>`)}
        </tbody></table>`.s;
      table = $('#sh-grid', v);
      tds = [];
      for (const td of $$('td[data-r]', table)) { const r = Number(td.dataset.r) + 1; (tds[r] = tds[r] || [])[Number(td.dataset.c)] = td; }
      table.addEventListener('keydown', onGridKey);
      table.addEventListener('mousedown', onGridMouse);
      table.addEventListener('dblclick', (e) => { if (e.target.closest('td[data-r]') && !S.editing) startEdit(false); });
      E.invalidate(); refreshAll();
      select(Math.min(S.active.r, S.rows.length - 1), Math.min(S.active.c, nC - 1), { noScroll: true });
      updateMeta();
    }
    function paint(r, c) {
      const td = tds[r + 1] && tds[r + 1][c]; if (!td) return;
      const raw = S.rows[r][c];
      const d = E.display(r, c);
      if (td.textContent !== d) td.textContent = d;
      const col = S.columns[c];
      let bad = false;
      if (col.type === 'number' && !isBlank(raw) && raw !== 'AB' && !isFormula(raw)) { const n = typeof raw === 'number' ? raw : isNumText(raw) ? Number(raw) : NaN; bad = !(Number.isFinite(n) && n >= 0 && n <= colMax(col)); }
      td.classList.toggle('err', d.startsWith('#'));
      td.classList.toggle('bad', bad);
      td.classList.toggle('ab', raw === 'AB');
      td.classList.toggle('is-fx', isFormula(raw));
      if (bad) td.title = `Not a valid mark for ${col.header} (0–${colMax(col)})`; else if (td.hasAttribute('title')) td.removeAttribute('title');
    }
    function refreshAll() { for (let r = 0; r < S.rows.length; r++) for (let c = 0; c < S.columns.length; c++) paint(r, c); }
    function refreshAfter(changes) {
      E.invalidate();
      const keys = new Set();
      for (let r = 0; r < S.rows.length; r++) for (let c = 0; c < S.columns.length; c++) if (isFormula(S.rows[r][c])) keys.add(r * 64 + c);
      for (const ch of changes) keys.add(ch.r * 64 + ch.c);
      for (const k of keys) { const r = Math.floor(k / 64), c = k % 64; if (r < S.rows.length && c < S.columns.length) paint(r, c); }
      updateFx(); updateDirty();
    }
    function updateMeta() {
      const cnt = S.columns.filter((c) => c.assessmentId).length;
      $('#sh-meta', v).textContent = `${S.rows.length} rows × ${S.columns.length} columns · ${S.offeringId ? `built from a course (${cnt} assessment column${cnt === 1 ? '' : 's'})` : 'blank sheet'}`;
      $('#sh-post', v).classList.toggle('hidden', !hasAssess());
    }
    function updateDirty() {
      const d = isDirty();
      const el = $('#sh-dirty', v); el.textContent = d ? 'Unsaved changes' : 'All changes saved'; el.classList.toggle('on', d);
      $('#sh-save', v).disabled = !d;
      $('#sh-undo', v).disabled = !S.undo.length;
    }
    function updateDir() {
      const b = $('#sh-dir', v);
      b.innerHTML = html`<span class="muted">Next:</span> <b>${S.dir === 'right' ? '→ right' : '↓ down'}</b>`.s;
      b.setAttribute('aria-label', `After each entry the cursor moves ${S.dir}. Activate to switch to ${S.dir === 'right' ? 'down' : 'right'}.`);
    }
    function updateFx() {
      const { r, c } = S.active; const col = S.columns[c];
      $('#sh-name', v).value = refOf(r, c);
      const raw = r === -1 ? col.header : S.rows[r][c];
      const fxv = $('#sh-fxv', v);
      if (document.activeElement !== fxv && !S.editing) fxv.value = isBlank(raw) ? '' : String(raw);
      $('#sh-sel', v).textContent = r === -1 ? `${refOf(r, c)} · heading of column ${colName(c)} · ${col.type === 'number' ? `marks 0–${colMax(col)}` : col.type === 'formula' ? 'calculated' : 'text'}`
        : `${refOf(r, c)} · ${col.header} · ${rowLabel(S, r)}`;
    }
    function select(r, c, opts = {}) {
      r = Math.max(-1, Math.min(S.rows.length - 1, r)); c = Math.max(0, Math.min(S.columns.length - 1, c));
      const prev = S.active;
      if (opts.how === 'click' && prev) {
        if (prev.r === r && prev.c !== c) S.dir = 'right'; else if (prev.c === c && prev.r !== r) S.dir = 'down';
        updateDir();
      }
      $$('.sel', table).forEach((x) => { x.classList.remove('sel'); x.setAttribute('aria-selected', 'false'); });
      $$('.on', table).forEach((x) => x.classList.remove('on'));
      S.active = { r, c };
      const td = tds[r + 1][c]; td.classList.add('sel'); td.setAttribute('aria-selected', 'true');
      const letter = $(`th.sh-letter[data-c="${c}"]`, table); if (letter) letter.classList.add('on');
      td.parentElement.firstElementChild.classList.add('on');
      table.setAttribute('aria-activedescendant', td.id);
      if (!opts.noScroll) td.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      updateFx();
    }
    function move(dr, dc, dirName) {
      if (dirName) { S.dir = dirName; updateDir(); }
      select(S.active.r + dr, S.active.c + dc);
    }
    function advance() {
      if (S.dir === 'right') { if (S.active.c < S.columns.length - 1) select(S.active.r, S.active.c + 1); }
      else if (S.active.r < S.rows.length - 1) select(S.active.r + 1, S.active.c);
    }

    // ---------- changes & undo ----------
    function setCells(list, label) {
      const changes = list.map(({ r, c, next }) => ({ r, c, prev: S.rows[r][c] ?? null, next })).filter((x) => x.prev !== x.next);
      if (!changes.length) return false;
      for (const ch of changes) S.rows[ch.r][ch.c] = ch.next;
      S.undo.push({ label, changes }); if (S.undo.length > 300) S.undo.shift();
      refreshAfter(changes);
      return true;
    }
    function snapshot(label) { S.undo.push({ label, snap: JSON.parse(payload()) }); if (S.undo.length > 300) S.undo.shift(); }
    function undo() {
      if (S.editing) cancelEdit();
      const u = S.undo.pop();
      if (!u) { say('Nothing to undo.'); updateDirty(); return null; }
      if (u.snap) { S.title = u.snap.title; S.columns = u.snap.columns; S.rows = u.snap.rows; $('#sh-title', v).value = S.title; renderGrid(); }
      else { for (const ch of u.changes) S.rows[ch.r][ch.c] = ch.prev; refreshAfter(u.changes); const f = u.changes[0]; select(f.r, f.c); }
      updateDirty();
      const last = $('#sh-last', v); last.className = 'sh-last'; last.textContent = `Undid ${u.label}.`;
      say(`Undid ${u.label}.`);
      return u;
    }

    // ---------- feedback ----------
    function say(msg) { const l = $('#sh-live', v); l.textContent = ''; setTimeout(() => { l.textContent = msg; }, 30); }
    function log(heard, okay, msg, source) {
      S.log.unshift({ at: new Date(), heard, ok: okay, msg, source }); if (S.log.length > 200) S.log.pop();
      $('#sh-log', v).innerHTML = S.log.map((x) => html`<li class="${x.ok ? 'ok' : x.source === 'ignored' ? 'ign' : 'err'}"><span class="sh-lt">${x.at.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}${x.source === 'typed' ? ' · typed' : x.source === 'voice' ? ' · voice' : x.source === 'ignored' ? ' · ignored' : ''}</span>
        ${x.heard ? html`<span class="sh-lh">“${x.heard}”</span>` : ''}<span class="sh-lm"><span aria-hidden="true">${x.ok ? '✓' : '✕'}</span> ${x.ok ? '' : html`<span class="sr-only">Rejected:</span>`}${x.msg}</span></li>`.s).join('');
      const done = S.log.filter((x) => x.ok && x.heard).length, rej = S.log.filter((x) => !x.ok && x.source !== 'ignored').length, ign = S.log.filter((x) => x.source === 'ignored').length;
      $('#sh-log-n', v).textContent = `${done} done · ${rej} rejected${ign ? ` · ${ign} background ignored` : ''}`;
    }
    function ok(heard, msg, source) {
      log(heard, true, msg, source);
      const last = $('#sh-last', v); last.className = 'sh-last ok'; last.textContent = msg;
      $('#sh-banner', v).classList.add('hidden');
      say(msg);
    }
    function ignored(heard, msg) {
      log(heard, false, msg, 'ignored');
      const last = $('#sh-last', v); last.className = 'sh-last'; last.textContent = msg;
    }
    function fail(heard, msg, source) {
      log(heard, false, msg, source);
      const b = $('#sh-banner', v);
      b.innerHTML = html`<span class="sh-bi" aria-hidden="true">!</span><div class="grow"><b>Not written.</b> ${heard ? html`Heard “${heard}”: ` : ''}${msg}</div><button class="icon-btn" data-click="hideBanner" aria-label="Dismiss">${icon('x', 15)}</button>`.s;
      b.classList.remove('hidden');
      const last = $('#sh-last', v); last.className = 'sh-last err'; last.textContent = `Rejected: ${msg}`;
      toast(msg, 'error', 'Nothing was written');
      say(`Error. ${msg} Nothing was written.`);
    }
    function flash(r, c) { const td = tds[r + 1] && tds[r + 1][c]; if (!td) return; td.classList.remove('flash'); void td.offsetWidth; td.classList.add('flash'); }

    // ---------- the voice / command pipeline ----------
    function handle(text, source) {
      const heard = String(text || '').trim();
      if (!heard) return;
      if (S.editing) cancelEdit();
      let act;
      try { act = parseUtterance(S, heard); } catch (e) { console.error(e); act = { kind: 'error', msg: 'That phrase could not be processed.' }; }
      if (act.kind === 'error') { fail(heard, act.msg, source); return; }
      if (act.kind === 'cmd') {
        if (act.cmd === 'undo') { const u = undo(); if (u) ok(heard, `Undid ${u.label}`, source); else fail(heard, 'There is nothing to undo.', source); return; }
        if (act.cmd === 'stop') { stopVoice(); ok(heard, 'Stopped listening', source); return; }
        if (act.cmd === 'nextRow') { if (S.active.r >= S.rows.length - 1) { fail(heard, 'This is the last row. Add a row first.', source); return; } const c = firstNum() >= 0 ? firstNum() : S.active.c; select(S.active.r + 1, c); ok(heard, `Moved to ${refOf(S.active.r, S.active.c)}`, source); return; }
        if (act.cmd === 'next') { advance(); ok(heard, `Moved to ${refOf(S.active.r, S.active.c)}`, source); return; }
        if (act.cmd === 'goto') { select(act.r, act.c); ok(heard, `Moved to ${refOf(act.r, act.c)}`, source); return; }
      }
      if (act.kind === 'answer') { for (const x of act.cells.slice(0, 600)) flash(x.r, x.c); ok(heard, act.msg, source); return; }
      const { r, c } = act; const col = S.columns[c];
      const next = act.kind === 'formula' ? act.formula : act.value;
      const before = E.display(r, c);
      const changed = setCells([{ r, c, next }], `${refOf(r, c)} ${col.header}`);
      select(r, c); flash(r, c);
      const shown = E.display(r, c);
      const what = act.kind === 'formula' ? `${refOf(r, c)} ${col.header} ← ${act.formula} = ${shown}${act.note ? ` (${act.note})` : ''}`
        : `${refOf(r, c)} ${col.header} ← ${next === null ? 'cleared' : next === 'AB' ? 'absent (AB)' : shown}${act.how === 'roll' || act.how === 'name' || act.how === 'next empty' ? ` · ${rowLabel(S, r)}` : ''}${changed && before && before !== shown ? ` (was ${before})` : ''}${changed ? '' : ' (unchanged)'}`;
      advance();
      ok(heard, what, source);
    }

    // ---------- speech ----------
    function setListening(on) {
      S.listening = on;
      const b = $('#sh-mic', v); if (!b) return;
      b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); b.setAttribute('aria-label', on ? 'Stop voice input (Ctrl+Alt)' : 'Start voice input (Ctrl+Alt)');
      $('span', b).textContent = on ? 'Listening' : 'Voice';
      const vb = $('#sh-voice', v); vb.classList.toggle('on', on); vb.setAttribute('aria-hidden', String(!on));
    }
    function startVoice() {
      if (!SR) { toast('Speech recognition is not available in this browser. Type the same phrases in the command box.', 'error'); $('#sh-cmd', v).focus(); return; }
      if (S.rec) return;
      S.wantListen = true;
      clearTimeout(S.gateOff);
      S.gate.start().then((okMeter) => { if (!okMeter && VoiceGate.settings.gate && !S.meterWarned) { S.meterWarned = true; toast('The microphone level meter is unavailable, so background voices cannot be filtered. Use a headset microphone in noisy rooms.', 'error'); } });
      const rec = new SR(); S.rec = rec;
      rec.lang = 'en-IN'; rec.continuous = true; rec.interimResults = true; rec.maxAlternatives = 3;
      S.segStart = performance.now();
      rec.onspeechstart = () => { if (!S.segStart) S.segStart = performance.now(); };
      rec.onstart = () => { if (!S.listening) { setListening(true); $('#sh-interim', v).textContent = 'Say a value, e.g. “75”, “physics 82” or “C5 to G5”.'; say('Listening.'); } };
      rec.onresult = (ev) => {
        let interim = '';
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          const res = ev.results[i];
          if (res.isFinal) heardFinal(res); else interim += res[0].transcript;
        }
        const el = $('#sh-interim', v); if (el) el.textContent = interim ? `“${interim}”` : 'Listening for the next value…';
      };
      rec.onerror = (ev) => {
        if (ev.error === 'no-speech' || ev.error === 'aborted') return;
        if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') { S.wantListen = false; toast('Microphone permission was denied. Allow microphone access, or type the phrases in the command box.', 'error'); }
        else toast(`Voice input problem (${ev.error}). Listening will restart.`, 'error');
      };
      rec.onend = () => {
        S.rec = null;
        if (S.wantListen && alive()) { setTimeout(() => { if (S.wantListen && alive() && !S.rec) startVoice(); }, 250); return; }
        setListening(false);
      };
      try { rec.start(); } catch { S.rec = null; S.wantListen = false; setListening(false); toast('Voice input could not be started. Please try again.', 'error'); }
    }
    // A final phrase only counts if the person at the microphone said it: loud enough above the room's
    // background while it was spoken, and recognised with reasonable confidence.
    function heardFinal(res) {
      const from = S.segStart || performance.now() - 4000; S.segStart = performance.now();
      const p = S.gate.pick(res, (t) => { try { return parseUtterance(S, t).kind !== 'error'; } catch { return false; } });
      const j = S.gate.judge(from);
      const text = (p.transcript || res[0].transcript || '').trim();
      if (!j.ok) { ignored(text, VoiceGate.reason(j)); return; }
      if (!p.ok) { fail(text, `${p.reason} Say it again, closer to the microphone.`, 'voice'); return; }
      handle(p.transcript, 'voice');
    }
    function stopVoice(quiet) {
      S.wantListen = false; if (S.rec) { try { S.rec.stop(); } catch { /* already stopped */ } } setListening(false);
      // Keep measuring briefly: the last phrase's final result arrives just after stopping.
      clearTimeout(S.gateOff); S.gateOff = setTimeout(() => { if (!S.wantListen) S.gate.stop(); }, 2500);
      if (!quiet) say('Stopped listening.');
    }
    const toggleVoice = () => (S.wantListen ? stopVoice() : startVoice());

    // ---------- in-cell editing ----------
    function startEdit(fresh, ch = '') {
      if (S.editing) return;
      const { r, c } = S.active; const td = tds[r + 1][c];
      const raw = r === -1 ? S.columns[c].header : S.rows[r][c];
      const inp = document.createElement('input');
      inp.className = 'sh-editor'; inp.setAttribute('aria-label', `Edit ${refOf(r, c)}`); inp.autocomplete = 'off'; inp.spellcheck = false;
      inp.value = fresh ? ch : isBlank(raw) ? '' : String(raw);
      S.editing = { r, c, inp, fresh };
      td.classList.add('editing'); td.appendChild(inp); inp.focus();
      inp.setSelectionRange(inp.value.length, inp.value.length);
      $('#sh-fxv', v).value = inp.value;
      inp.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); return; }
        const nav = { Enter: [e.shiftKey ? -1 : 1, 0, 'down'], Tab: [0, e.shiftKey ? -1 : 1, 'right'] };
        if (S.editing && S.editing.fresh) Object.assign(nav, { ArrowDown: [1, 0, 'down'], ArrowUp: [-1, 0, 'down'], ArrowRight: [0, 1, 'right'], ArrowLeft: [0, -1, 'right'] });
        if (nav[e.key]) { e.preventDefault(); if (commitEdit()) move(...nav[e.key]); }
      });
      inp.addEventListener('blur', () => { if (S.editing && S.editing.inp === inp && !commitEdit(true)) cancelEdit(true); });
      inp.addEventListener('input', () => { inp.classList.remove('invalid'); $('#sh-fxv', v).value = inp.value; });
    }
    function closeEditor(keepFocus) {
      const ed = S.editing; if (!ed) return; S.editing = null;
      const td = tds[ed.r + 1] && tds[ed.r + 1][ed.c]; if (td) td.classList.remove('editing');
      ed.inp.remove();
      if (!keepFocus && table) table.focus({ preventScroll: true });
    }
    function cancelEdit(fromBlur) { closeEditor(fromBlur); updateFx(); }
    function checkValue(r, c, text) {
      if (r === -1) { const h = String(text).trim(); return !h || h.length > 60 ? { error: 'A heading needs 1 to 60 characters.' } : { value: h }; }
      return parseTyped(S.columns[c], text);
    }
    function commitEdit(fromBlur) {
      const ed = S.editing; if (!ed) return true;
      const res = checkValue(ed.r, ed.c, ed.inp.value);
      if (res.error) { fail(String(ed.inp.value).trim(), res.error, 'typed'); if (!fromBlur) { ed.inp.classList.add('invalid'); ed.inp.focus(); } return false; }
      const text = ed.inp.value;
      closeEditor(fromBlur);
      commitValue(ed.r, ed.c, text);
      return true;
    }
    function commitValue(r, c, text) {
      const res = checkValue(r, c, text);
      if (res.error) { fail(String(text).trim(), res.error, 'typed'); return false; }
      if (r === -1) {
        if (res.value === S.columns[c].header) return true;
        snapshot(`rename column ${colName(c)}`); S.columns[c].header = res.value; renderGrid(); select(-1, c); updateDirty();
        ok('', `Column ${colName(c)} renamed to ${res.value}`, 'typed'); return true;
      }
      if (setCells([{ r, c, next: res.value }], `${refOf(r, c)} ${S.columns[c].header}`)) { flash(r, c); $('#sh-banner', v).classList.add('hidden'); say(`${refOf(r, c)} ${E.display(r, c) || 'cleared'}`); }
      return true;
    }

    // ---------- keyboard & mouse ----------
    function onGridKey(e) {
      if (S.editing) return;
      const k = e.key; const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.altKey && k.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
      if (mod && !e.altKey && k.toLowerCase() === 's') { e.preventDefault(); save(); return; }
      const nav = { ArrowRight: [0, 1, 'right'], ArrowLeft: [0, -1, 'right'], ArrowDown: [1, 0, 'down'], ArrowUp: [-1, 0, 'down'], Tab: [0, e.shiftKey ? -1 : 1, 'right'], Enter: [e.shiftKey ? -1 : 1, 0, 'down'], PageDown: [10, 0, 'down'], PageUp: [-10, 0, 'down'] };
      if (nav[k] && !mod && !e.altKey) { e.preventDefault(); move(...nav[k]); return; }
      if (k === 'Home') { e.preventDefault(); select(mod ? -1 : S.active.r, 0); return; }
      if (k === 'End') { e.preventDefault(); select(mod ? S.rows.length - 1 : S.active.r, S.columns.length - 1); return; }
      if (k === 'F2') { e.preventDefault(); startEdit(false); return; }
      if (k === 'Delete' || k === 'Backspace') {
        e.preventDefault();
        if (S.active.r === -1) return;
        if (setCells([{ r: S.active.r, c: S.active.c, next: null }], `clear ${refOf(S.active.r, S.active.c)}`)) say(`${refOf(S.active.r, S.active.c)} cleared`);
        return;
      }
      if (k.length === 1 && !mod && !e.altKey) { e.preventDefault(); startEdit(true, k); }
    }
    function onGridMouse(e) {
      const cell = e.target.closest('td[data-r], th.sh-letter'); if (!cell || e.button !== 0) return;
      if (S.editing) { if (S.editing.inp === e.target) return; if (!commitEdit()) { e.preventDefault(); return; } }
      e.preventDefault(); table.focus({ preventScroll: true });
      select(Number(cell.dataset.r), Number(cell.dataset.c), { how: 'click' });
    }
    const inField = (t) => t && t.closest && t.closest('input, textarea, select, [contenteditable="true"]');
    const onDocKey = (e) => {
      if (!alive()) { cleanup(); return; }
      if ($('#modal-root').children.length) return;
      if (e.ctrlKey && e.altKey && !e.shiftKey && !e.metaKey && (e.key === 'Control' || e.key === 'Alt') && !e.repeat) {
        if (inField(e.target)) return;
        e.preventDefault();
        if (VoiceGate.settings.mode === 'hold') { S.holding = true; if (!S.wantListen) startVoice(); } else toggleVoice();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !inField(e.target) && !(table && table.contains(e.target))) {
        if (e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); } else if (e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
      }
    };
    // Hold-to-talk: releasing Ctrl or Alt ends the phrase.
    const onDocKeyUp = (e) => {
      if (!S.holding || (e.key !== 'Control' && e.key !== 'Alt')) return;
      S.holding = false; if (S.wantListen) stopVoice(true);
    };
    const onBeforeUnload = (e) => { if (alive() && isDirty()) { e.preventDefault(); e.returnValue = ''; } };
    const onLinkClick = async (e) => {
      if (!alive()) { cleanup(); return; }
      const a = e.target.closest && e.target.closest('a[href^="#"]');
      if (!a || !isDirty() || e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
      const href = a.getAttribute('href'); if (href === location.hash) return;
      e.preventDefault(); e.stopPropagation();
      if (await confirmBox('Leave without saving?', 'This sheet has unsaved changes. If you leave now they will be lost.', 'Leave without saving', true)) { S.discard = true; go(href); }
    };
    const onHash = () => { setTimeout(() => { if (!alive()) cleanup(); }, 0); };
    function cleanup() {
      S.wantListen = false; if (S.rec) { try { S.rec.abort(); } catch { /* ignore */ } S.rec = null; }
      clearTimeout(S.gateOff); S.gate.stop();
      document.removeEventListener('keydown', onDocKey); document.removeEventListener('keyup', onDocKeyUp); window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onLinkClick, true); window.removeEventListener('hashchange', onHash);
    }
    document.addEventListener('keydown', onDocKey); document.addEventListener('keyup', onDocKeyUp); window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onLinkClick, true); window.addEventListener('hashchange', onHash);

    // formula bar & name box
    const fxv = $('#sh-fxv', v); const nameBox = $('#sh-name', v);
    fxv.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); if (commitValue(S.active.r, S.active.c, fxv.value)) { fxv.blur(); table.focus(); } }
      else if (e.key === 'Escape') { e.preventDefault(); fxv.blur(); updateFx(); table.focus(); }
    });
    fxv.addEventListener('blur', () => setTimeout(updateFx, 0));
    nameBox.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { nameBox.blur(); updateFx(); table.focus(); return; }
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const m = nameBox.value.trim().match(/^([A-Za-z]{1,2})(\d{1,3})$/);
      if (!m) { toast('Type a cell such as E5.', 'error'); return; }
      const c = colIndex(m[1]), r = Number(m[2]) - 2;
      if (c >= S.columns.length || r < -1 || r >= S.rows.length) { toast(`${m[0].toUpperCase()} is outside this sheet.`, 'error'); return; }
      select(r, c); table.focus();
    });

    // ---------- save, structure, CSV, post ----------
    async function save() {
      if (S.editing && !commitEdit()) return false;
      if (!isDirty()) { toast('No changes to save.'); return true; }
      const btn = $('#sh-save', v); btn.disabled = true;
      try {
        const r = await api.put(`/api/sheets/${S.id}`, JSON.parse(payload()));
        S.saved = JSON.stringify({ title: r.title, columns: r.columns, rows: r.rows }); S.title = r.title;
        updateDirty(); toast('Sheet saved.', 'success'); say('Sheet saved.');
        return true;
      } catch (e) { toast(e.message, 'error', 'Sheet not saved'); updateDirty(); return false; }
    }
    function addColumnModal() {
      if (S.columns.length >= MAX_COLS) { toast(`A sheet can have at most ${MAX_COLS} columns.`, 'error'); return; }
      const firstFx = S.columns.findIndex((c) => c.type === 'formula');
      const m = modal({ title: 'Add a column', body: html`<form id="ac-f">
          <div class="field"><label for="ac-h">Heading</label><input class="input" id="ac-h" name="header" maxlength="60" required placeholder="e.g. Biology, Percentage, Remarks"></div>
          <div class="field"><label for="ac-t">Type</label><select class="input" id="ac-t" name="type"><option value="auto">Decide from the heading</option><option value="number">Marks (number)</option><option value="formula">Calculated (formula)</option><option value="text">Text</option></select>
            <div class="hint" id="ac-hint"></div></div>
          <div class="field"><label for="ac-m">Maximum marks</label><input class="input" id="ac-m" name="max" type="number" min="1" max="10000" step="0.5" value="100" style="max-width:140px"></div>
          <div class="field"><label for="ac-p">Position</label><select class="input" id="ac-p" name="pos">
            ${firstFx > 0 ? html`<option value="${firstFx}">Before ${S.columns[firstFx].header} (column ${colName(firstFx)})</option>` : ''}
            <option value="${S.columns.length}">At the end</option>
            <option value="${S.active.c}">Before the selected column (${colName(S.active.c)}, ${S.columns[S.active.c].header})</option></select>
            <div class="hint">Formulas that point past the new column are adjusted, as in Excel.</div></div></form>`,
      foot: html`<button class="btn" data-close>Cancel</button><button class="btn primary" id="ac-ok">Add column</button>` });
      const f = $('#ac-f', m.el);
      const typeOf = () => (f.elements.type.value === 'auto' ? inferColumn(f.elements.header.value || 'x').type : f.elements.type.value);
      const hint = () => { const t = typeOf(); $('#ac-hint', m.el).textContent = `This column will hold ${t === 'number' ? 'marks' : t === 'formula' ? 'calculated values' : 'text'}.`; f.elements.max.disabled = t !== 'number'; };
      f.addEventListener('input', hint); f.addEventListener('change', hint); hint();
      f.addEventListener('submit', (e) => { e.preventDefault(); $('#ac-ok', m.el).click(); });
      $('#ac-ok', m.el).onclick = () => {
        const h = f.elements.header.value.trim(); if (!h) { f.elements.header.focus(); return; }
        const type = typeOf();
        const col = { header: h, type };
        if (type === 'number') { const mx = Number(f.elements.max.value); if (!(mx > 0 && mx <= 10000)) { toast('Maximum must be between 1 and 10000.', 'error'); return; } col.max = mx; }
        const at = Math.max(0, Math.min(S.columns.length, Number(f.elements.pos.value)));
        snapshot(`add column ${h}`);
        for (const row of S.rows) for (let c = 0; c < row.length; c++) if (isFormula(row[c])) row[c] = shiftCols(row[c], at, 1);
        S.columns.splice(at, 0, col); for (const row of S.rows) row.splice(at, 0, null);
        m.close(); renderGrid(); select(-1, at); updateDirty();
        ok('', `Added column ${colName(at)}: ${h} (${type === 'number' ? `marks 0–${col.max}` : type === 'formula' ? 'calculated' : 'text'})`, 'typed');
      };
    }
    function colSettingsModal() {
      const c = S.active.c; const col = S.columns[c]; const linked = !!col.assessmentId;
      const m = modal({ title: `Column ${colName(c)} settings`, body: html`<form id="cs-f">
          <div class="field"><label for="cs-h">Heading</label><input class="input" id="cs-h" name="header" maxlength="60" value="${col.header}" required></div>
          <div class="field"><label for="cs-t">Type</label><select class="input" id="cs-t" name="type" ${linked ? 'disabled' : ''}>${[['number', 'Marks (number)'], ['formula', 'Calculated (formula)'], ['text', 'Text']].map(([k, l]) => html`<option value="${k}" ${col.type === k ? 'selected' : ''}>${l}</option>`)}</select></div>
          <div class="field"><label for="cs-m">Maximum marks</label><input class="input" id="cs-m" name="max" type="number" min="1" max="10000" step="0.5" value="${colMax(col)}" style="max-width:140px" ${linked ? 'disabled' : ''}></div>
          ${linked ? html`<div class="alert info"><div class="ico">i</div><div>Linked to the course assessment <b>${col.title || col.header}</b> (out of ${colMax(col)}). Its type and maximum come from the course.</div></div>` : ''}</form>`,
      foot: html`<button class="btn" data-close>Cancel</button><button class="btn primary" id="cs-ok">Apply</button>` });
      $('#cs-f', m.el).addEventListener('submit', (e) => { e.preventDefault(); $('#cs-ok', m.el).click(); });
      $('#cs-ok', m.el).onclick = () => {
        const f = $('#cs-f', m.el); const h = f.elements.header.value.trim();
        if (!h) { f.elements.header.focus(); return; }
        const type = linked ? col.type : f.elements.type.value; const mx = Number(f.elements.max.value);
        if (type === 'number' && !linked && !(mx > 0 && mx <= 10000)) { toast('Maximum must be between 1 and 10000.', 'error'); return; }
        snapshot(`column ${colName(c)} settings`);
        const nc = { ...col, header: h, type }; if (type === 'number') nc.max = linked ? col.max : mx; else delete nc.max;
        S.columns[c] = nc; m.close(); renderGrid(); updateDirty();
        ok('', `Column ${colName(c)} is now ${h} (${type === 'number' ? `marks 0–${nc.max}` : type === 'formula' ? 'calculated' : 'text'})`, 'typed');
      };
    }
    function fillDown() {
      const { r, c } = S.active; const raw = r >= 0 ? S.rows[r][c] : null;
      if (!isFormula(raw)) { fail('', 'Select a cell that holds a formula (for example a Total you calculated by voice), then choose Fill down.', 'typed'); return; }
      const list = [];
      const hasData = (k) => S.rows[k].some((x, ci) => ci !== c && S.columns[ci].type !== 'formula' && !isBlank(x));
      for (let k = r + 1; k < S.rows.length; k++) if (isBlank(S.rows[k][c]) && hasData(k)) list.push({ r: k, c, next: shiftRows(raw, k - r) });
      if (!list.length) { toast('There are no empty cells below (in rows that hold data) to fill.'); return; }
      setCells(list, `fill down ${S.columns[c].header}`);
      ok('', `Filled ${list.length} empty cell${list.length === 1 ? '' : 's'} below ${refOf(r, c)} (rows with data) with ${raw}, adjusted for each row`, 'typed');
    }
    function addRow() {
      if (S.rows.length >= MAX_ROWS) { toast(`A sheet can have at most ${MAX_ROWS} rows.`, 'error'); return; }
      snapshot('add row');
      S.rows.push(S.columns.map(() => null));
      renderGrid(); select(S.rows.length - 1, S.active.c); updateDirty();
      say(`Row ${S.rows.length + 1} added.`);
    }
    function exportCsv() {
      const lines = [S.columns.map((c) => csvCell(c.header)).join(',')];
      S.rows.forEach((row, r) => lines.push(S.columns.map((_, c) => csvCell(E.display(r, c))).join(',')));
      const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `${S.title.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'sheet'}.csv`;
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
      toast('CSV downloaded. Calculated columns are exported as values.', 'success');
    }
    function confirmImport(summary, issues, apply) {
      const m = modal({ title: 'Import CSV', wide: true, body: html`<p>${summary}</p>
        ${issues.length ? html`<div class="alert warning"><div class="ico">!</div><div><b>${issues.length} value${issues.length === 1 ? '' : 's'} cannot be imported and will be left empty:</b>
          <ul class="small sh-issues">${issues.slice(0, 12).map((x) => html`<li>${x}</li>`)}${issues.length > 12 ? html`<li>…and ${issues.length - 12} more</li>` : ''}</ul></div></div>` : ''}
        <p class="small muted" style="margin-top:10px">You can undo the import. Nothing is saved until you press Save.</p>`,
      foot: html`<button class="btn" data-close>Cancel</button><button class="btn primary" id="im-ok">Import</button>` });
      $('#im-ok', m.el).onclick = () => { m.close(); apply(); };
    }
    function importCsv(text) {
      const rows = parseCSV(text);
      if (!rows.length) { toast('The file has no rows.', 'error'); return; }
      const head = rows[0].map((h) => h.trim()); const body = rows.slice(1);
      const issues = [];
      if (hasAssess()) {
        // Course sheet: merge by Roll and heading. The roster and the column structure stay as they are.
        const rc = textCol(S, /roll|reg/i); const hr = head.findIndex((h) => /roll|reg/i.test(h));
        if (rc < 0 || hr < 0) { toast('The file needs a Roll column to match students.', 'error'); return; }
        const map = head.map((h, i) => (i === hr ? -1 : S.columns.findIndex((c) => c.type === 'number' && (compact(c.header) === compact(h) || (c.title && compact(c.title) === compact(h))))));
        const used = map.filter((x) => x >= 0).length;
        if (!used) { toast('No column in the file matches a mark column in this sheet.', 'error'); return; }
        const list = []; let unknown = 0;
        for (const line of body) {
          const r = S.rows.findIndex((x) => compact(x[rc]) === compact(line[hr]));
          if (r < 0) { unknown++; continue; }
          map.forEach((c, i) => {
            if (c < 0) return; const raw = (line[i] ?? '').trim(); if (raw === '') return;
            const res = parseTyped(S.columns[c], raw);
            if (res.error) issues.push(`${refOf(r, c)}: ${res.error}`); else list.push({ r, c, next: res.value });
          });
        }
        confirmImport(`${list.length} cell${list.length === 1 ? '' : 's'} in ${used} column${used === 1 ? '' : 's'} will be updated, matched by roll number.${unknown ? ` ${unknown} roll number${unknown === 1 ? '' : 's'} in the file ${unknown === 1 ? 'is' : 'are'} not on this sheet and will be skipped.` : ''}`, issues, () => {
          setCells(list, 'CSV import');
          ok('', `Imported ${list.length} cells from CSV`, 'typed');
        });
        return;
      }
      if (head.length > MAX_COLS || head.some((h) => !h || h.length > 60)) { toast(`The first row must hold 1–${MAX_COLS} headings of up to 60 characters.`, 'error'); return; }
      if (body.length > MAX_ROWS) { toast(`The file has ${body.length} rows; a sheet can hold ${MAX_ROWS}.`, 'error'); return; }
      const cols = head.map(inferColumn); let dropped = 0;
      const newRows = (body.length ? body : [[]]).map((line, r) => cols.map((col, c) => {
        const raw = (line[c] ?? '').trim(); if (raw === '') return null;
        if (col.type === 'formula' && !raw.startsWith('=')) { dropped++; return null; }
        const res = parseTyped(col, raw);
        if (res.error) { issues.push(`${refOf(r, c)}: ${res.error}`); return null; }
        return res.value;
      }));
      confirmImport(`This replaces the whole sheet with ${newRows.length} row${newRows.length === 1 ? '' : 's'} and ${cols.length} columns (${cols.map((c) => `${c.header}: ${c.type === 'number' ? 'marks' : c.type === 'formula' ? 'calculated' : 'text'}`).join(', ')}).${dropped ? ` ${dropped} calculated value${dropped === 1 ? '' : 's'} will be left empty; recalculate them by voice or with Fill down.` : ''}`, issues, () => {
        snapshot('CSV import'); S.columns = cols; S.rows = newRows; S.active = { r: 0, c: Math.max(0, firstNum()) };
        renderGrid(); updateDirty(); ok('', `Imported ${newRows.length} rows from CSV`, 'typed');
      });
    }
    async function postMarks() {
      if (S.editing && !commitEdit()) return;
      // Compare with the marks in the course right now, so the summary shows what will actually change.
      let current = null;
      try { const d = await api.get(`/api/offerings/${S.offeringId}/marks`); current = new Map(d.students.map((s) => [s.id, s.marks || {}])); } catch { current = null; }
      const plan = S.columns.map((col, c) => ({ col, c })).filter((x) => x.col.assessmentId).map(({ col, c }) => {
        const entries = [], problems = []; let blank = 0, absent = 0, same = 0, fresh = 0, changed = 0;
        S.studentIds.forEach((sid, r) => {
          if (r >= S.rows.length || !sid) return;
          const raw = S.rows[r][c];
          if (isBlank(raw)) { blank++; return; }
          if (raw === 'AB') { absent++; return; }
          const n = E.numeric(r, c);
          if (!Number.isFinite(n) || n < 0 || n > colMax(col) || round2(n) !== n) { problems.push(`${refOf(r, c)} (${rowLabel(S, r)}): “${E.display(r, c)}” is not a valid mark out of ${colMax(col)}`); return; }
          const was = current && current.has(sid) ? current.get(sid)[col.assessmentId] : undefined;
          if (current && was !== null && was !== undefined && Number(was) === n) { same++; return; }
          if (current && (was === null || was === undefined)) fresh++; else changed++;
          entries.push({ studentId: sid, marks: n });
        });
        return { col, entries, blank, absent, same, fresh, changed, problems };
      });
      const problems = plan.flatMap((p) => p.problems);
      const total = plan.reduce((a, p) => a + p.entries.length, 0);
      const extra = S.rows.length - S.studentIds.length;
      const dirty = isDirty();
      const m = modal({ title: 'Post marks to the course', wide: true, body: html`
        <p>Marks that differ from the course will be saved as <b>voice</b> entries. Students are notified, and performance and risk are recalculated. Blank and absent cells are skipped and never delete a mark already in the course.</p>
        <div class="table-wrap"><table class="table"><thead><tr><th>Assessment</th><th class="num">Out of</th><th class="num">New</th><th class="num">Changed</th><th class="num">Same as course</th><th class="num">Blank / absent (skipped)</th><th class="num">Problems</th></tr></thead>
          <tbody>${plan.map((p) => html`<tr><td><b>${p.col.header}</b>${p.col.title && p.col.title !== p.col.header ? html` <span class="small muted">${p.col.title}</span>` : ''}</td><td class="num">${colMax(p.col)}</td>
            <td class="num"><b>${current ? p.fresh : '—'}</b></td><td class="num"><b>${current ? p.changed : p.entries.length}</b></td><td class="num">${current ? p.same : '—'}</td><td class="num">${p.blank} / ${p.absent}</td>
            <td class="num">${p.problems.length ? html`<span class="badge high">${p.problems.length}</span>` : '0'}</td></tr>`)}</tbody></table></div>
        ${!current ? html`<p class="small muted">The current course marks could not be loaded, so every filled cell will be sent; unchanged marks are left as they are.</p>` : ''}
        ${extra > 0 ? html`<p class="small muted">${extra} row${extra === 1 ? '' : 's'} added on this sheet ${extra === 1 ? 'is' : 'are'} not linked to a student and will be ignored.</p>` : ''}
        ${problems.length ? html`<div class="alert critical" style="margin-top:10px"><div class="ico">!</div><div><b>Fix these cells before posting:</b><ul class="small sh-issues">${problems.slice(0, 10).map((x) => html`<li>${x}</li>`)}${problems.length > 10 ? html`<li>…and ${problems.length - 10} more</li>` : ''}</ul></div></div>` : ''}
        ${!total && !problems.length ? html`<div class="alert success" style="margin-top:10px"><div class="ico">✓</div><div>Every mark on this sheet already matches the course. There is nothing to post.</div></div>` : ''}
        ${dirty && !problems.length && total ? html`<p class="small" style="margin-top:10px">The sheet has unsaved changes; it will be saved first.</p>` : ''}`,
      foot: html`<button class="btn" data-close>${total ? 'Cancel' : 'Close'}</button><button class="btn primary" id="pm-ok" ${problems.length || !total ? 'disabled' : ''}>${dirty ? 'Save sheet and post' : 'Post'} ${total} mark${total === 1 ? '' : 's'}</button>` });
      $('#pm-ok', m.el).onclick = async () => {
        const btn = $('#pm-ok', m.el); btn.disabled = true; btn.textContent = 'Posting…';
        if (dirty && !(await save())) { m.close(); return; }
        let created = 0, updated = 0; const failed = [];
        for (const p of plan) {
          if (!p.entries.length) continue;
          try { const r = await api.post('/api/marks', { assessmentId: p.col.assessmentId, entries: p.entries, method: 'voice' }); created += r.created || 0; updated += r.updated || 0; }
          catch (e) { failed.push(`${p.col.header}: ${e.message}`); }
        }
        m.close();
        if (failed.length) { toast(failed.join(' '), 'error', 'Some marks were not posted'); log('', false, `Posting failed for ${failed.join('; ')}`, 'typed'); }
        if (!failed.length || created || updated) { toast(`${created} new and ${updated} updated mark${created + updated === 1 ? '' : 's'} saved to the course.`, 'success', 'Marks posted'); ok('', `Posted to course: ${created} new, ${updated} updated`, 'typed'); }
      };
    }

    // ---------- toolbar handlers ----------
    bind(v, {
      save: () => save(),
      undo: () => { undo(); table.focus(); },
      mic: () => toggleVoice(),
      dir: () => { S.dir = S.dir === 'right' ? 'down' : 'right'; updateDir(); say(`Next entry moves ${S.dir}.`); },
      addRow, addCol: addColumnModal, colSettings: colSettingsModal, fillDown,
      importCsv: () => { const fi = $('#sh-file', v); fi.value = ''; fi.click(); },
      exportCsv, post: postMarks,
      help: () => { const h = $('#sh-help', v); h.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); h.classList.remove('hl'); void h.offsetWidth; h.classList.add('hl'); h.focus({ preventScroll: true }); },
      hideBanner: () => $('#sh-banner', v).classList.add('hidden'),
      cmd: (f) => { const t = f.elements.cmd.value; f.elements.cmd.value = ''; handle(t, 'typed'); },
      title: (el) => {
        const t = el.value.trim();
        if (!t) { el.value = S.title; toast('The title cannot be empty.', 'error'); return; }
        if (t !== S.title) { snapshot('rename sheet'); S.title = t; table.setAttribute('aria-label', t); updateDirty(); }
      },
      delSheet: async () => {
        if (!(await confirmBox('Delete this sheet?', `“${S.title}” will be removed permanently. Marks already posted to a course are not affected.`, 'Delete sheet', true))) return;
        try { await api.del(`/api/sheets/${S.id}`); S.discard = true; toast('Sheet deleted.', 'success'); go(`${base}/sheets`); } catch (e) { toast(e.message, 'error'); }
      },
    });
    $('#sh-title', v).addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } });
    $('#sh-file', v).addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0]; if (!file) return;
      if (file.size > 2 * 1024 * 1024) { toast('The file is larger than 2 MB.', 'error'); return; }
      const rd = new FileReader(); rd.onload = () => importCsv(String(rd.result || '')); rd.onerror = () => toast('The file could not be read.', 'error'); rd.readAsText(file);
    });

    updateDir(); renderGrid(); updateDirty();
    if (SR) $('#sh-vg', v).appendChild(VoiceGate.controls(S.gate, { onChange: (st) => { const k = $('#sh-mic kbd', v); if (k) k.textContent = st.mode === 'hold' ? 'Hold Ctrl+Alt' : 'Ctrl+Alt'; } }));
    if (SR && VoiceGate.settings.mode === 'hold') { const k = $('#sh-mic kbd', v); if (k) k.textContent = 'Hold Ctrl+Alt'; }
    log('', true, SR ? 'Sheet opened. Press Ctrl+Alt to start voice input.' : 'Sheet opened. Speech recognition is not available in this browser; type phrases in the command box.', '');
    table.focus({ preventScroll: true });
  }

  route('/staff/sheets', (p, q) => listView(q), STAFF);
  route('/admin/sheets', (p, q) => listView(q), ADMIN);
  route('/staff/sheet/:id', (p) => sheetView(p.id), STAFF);
  route('/admin/sheet/:id', (p) => sheetView(p.id), ADMIN);

  window.VoiceSheets = { parseUtterance, normalize, makeEngine, colName, colIndex };
})();
