/* nerd AI — the in-app assistant.
   Two ways to answer:
   - Online: when the server has a model (Claude, a local Ollama model, or another endpoint), the
     conversation goes to /api/assistant/chat. With a local model, questions about the person's own
     records are still answered instantly here, and everything else goes to the model.
   - Offline (default): answers come from the person's own data (/api/assistant/facts) and the
     knowledge base in nerdai-data.js, with follow-up context, typo tolerance and clarifying questions.
   CSP-safe: external script, event listeners only, inline style attributes only. */
(function () {
  'use strict';
  var KB = window.NerdAIKB;
  if (!KB || !Array.isArray(KB.intents)) return; // data file missing — fail quietly
  var A = function () { return window.App || {}; };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var me = function () { var s = A().state; return s && s.me; };
  var cap = function (s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); };
  var pick = function (arr) { return arr[Math.floor(Math.random() * arr.length)]; };
  var classes = function (n) { return n === 1 ? '1 class' : n + ' classes'; };
  var students = function (n) { return n === 1 ? '1 student' : n + ' students'; };

  // ---------- language ----------
  var STOP = new Set(('a an the is are am was were be been do does did to of in on at for with my your our this that these those i me we you it its how what when where which who why can could would should will want need get see show tell about from and or not no yes please pls plz help hey hi hello there as if so just any some im ive u ur have has had many much we us our'.split(' ')));
  var SYN = {
    login: ['signin', 'sign', 'log', 'logon'], signin: ['login'], password: ['passcode', 'pwd', 'pass', 'forgot', 'reset'],
    marks: ['mark', 'grade', 'grades', 'score', 'scores', 'result', 'results'],
    attendance: ['attend', 'present', 'absent', 'absence', 'attended', 'bunk', 'skip', 'leave'],
    cgpa: ['gpa', 'sgpa', 'aggregate'], timetable: ['schedule', 'timings', 'periods', 'period', 'classes'],
    classroom: ['assignment', 'assignments', 'homework', 'submission', 'submit', 'deadline', 'deadlines', 'notes'],
    club: ['clubs', 'society', 'societies'], event: ['events', 'fest', 'symposium', 'programme'],
    notification: ['notifications', 'notify', 'alert', 'alerts', 'bell'], language: ['tamil', 'hindi', 'translate', 'translation'],
    risk: ['risky', 'danger', 'warning', 'flagged', 'fail', 'failing'],
    teacher: ['faculty', 'staff', 'professor', 'lecturer', 'teachers', 'sir', 'madam', 'mam'],
    admin: ['administrator', 'administration', 'office'], voice: ['speak', 'speech', 'microphone', 'mic', 'dictate'],
    logo: ['logos', 'crest', 'branding', 'emblem'], campus: ['guide', 'compass', 'map', 'directions', 'route', 'routes', 'gps', 'navigate'],
    college: ['institution', 'institute'], university: ['uni', 'universities'], register: ['registration', 'enrol', 'enroll', 'signup'],
    improve: ['raise', 'increase', 'boost', 'better', 'fix', 'recover'], exam: ['exams', 'test', 'tests', 'examination'],
    portal: ['portals', 'feature', 'features', 'switch', 'toggle', 'disable', 'enable']
  };
  function stem(w) { return w.length > 4 ? w.replace(/(ing|ed|ies|es|s)$/, '') : w; }
  function tokens(text) {
    var raw = String(text || '').toLowerCase().replace(/[^a-z0-9é]+/g, ' ').trim().split(/\s+/);
    var out = [];
    for (var i = 0; i < raw.length; i++) { var w = raw[i]; if (!w || STOP.has(w)) continue; out.push(stem(w)); }
    return out;
  }
  function expand(toks) {
    var set = new Set(toks);
    toks.forEach(function (t) { Object.keys(SYN).forEach(function (k) { if (t === k || t === stem(k)) SYN[k].forEach(function (s) { set.add(stem(s)); }); if (SYN[k].indexOf(t) >= 0 || SYN[k].map(stem).indexOf(t) >= 0) set.add(stem(k)); }); });
    return set;
  }

  // Typo tolerance: unknown words are snapped to the closest known word (same first letter).
  var VOCAB = new Set(), fixCache = {};
  function addVocab(text) { String(text || '').toLowerCase().replace(/[^a-z]+/g, ' ').split(' ').forEach(function (w) { if (w.length >= 3) VOCAB.add(w); }); }
  KB.intents.forEach(function (it) { it.q.forEach(addVocab); });
  Object.keys(SYN).forEach(function (k) { addVocab(k + ' ' + SYN[k].join(' ')); });
  addVocab('attendance marks timetable deadline deadlines assignment assignments risk next class classes today tomorrow subject subjects course courses teacher improve skip bunk overall performance safe critical attention monday tuesday wednesday thursday friday saturday sunday week weekly calculate joke stressed tips study students pending enter entered doing summary');
  function lev(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    var d = [], i, j;
    for (i = 0; i <= a.length; i++) d[i] = [i];
    for (j = 0; j <= b.length; j++) d[0][j] = j;
    for (i = 1; i <= a.length; i++) {
      var rowMin = Infinity;
      for (j = 1; j <= b.length; j++) {
        var v = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2][j - 2] + 1);
        d[i][j] = v; if (v < rowMin) rowMin = v;
      }
      if (rowMin > max) return max + 1;
    }
    return d[a.length][b.length];
  }
  function correctWord(w) {
    if (w.length < 4 || VOCAB.has(w)) return w;
    if (fixCache[w] !== undefined) return fixCache[w];
    var max = w.length >= 7 ? 2 : 1, best = w, bestD = max + 1;
    VOCAB.forEach(function (v) { if (v[0] !== w[0] || bestD === 1) return; var dd = lev(w, v, max); if (dd < bestD) { bestD = dd; best = v; } });
    return (fixCache[w] = best);
  }
  function correct(text) { return String(text || '').toLowerCase().replace(/[a-z]+/g, correctWord); }

  // ---------- knowledge base index ----------
  var byId = {}; KB.intents.forEach(function (it) { byId[it.id] = it; });
  var N = KB.intents.length, df = {};
  KB.intents.forEach(function (it) {
    var bag = new Set();
    it.q.forEach(function (q) { tokens(q).forEach(function (t) { bag.add(t); }); });
    tokens(it.a).forEach(function (t) { bag.add(t); });
    it._bag = bag; it._ql = it.q.map(function (q) { return q.toLowerCase(); });
    bag.forEach(function (t) { df[t] = (df[t] || 0) + 1; });
  });
  function idf(t) { return Math.log((N + 1) / ((df[t] || 0) + 1)) + 1; }
  function search(text) {
    var toks = tokens(text); if (!toks.length) return [];
    var q = expand(toks), ql = String(text || '').toLowerCase().trim();
    var denom = 0; q.forEach(function (t) { denom += idf(t); }); if (denom <= 0) return [];
    var scored = KB.intents.map(function (it) {
      var s = 0; q.forEach(function (t) { if (it._bag.has(t)) s += idf(t); });
      s = s / denom;
      for (var j = 0; j < it._ql.length; j++) { var p = it._ql[j]; if (p === ql) { s += 0.6; break; } if ((ql.length > 6 && p.indexOf(ql) >= 0) || (p.length > 6 && ql.indexOf(p) >= 0)) { s += 0.3; break; } }
      var hits = 0; toks.forEach(function (t) { if (it._bag.has(t)) hits++; }); s += hits * 0.04;
      return { it: it, s: s, cov: hits / toks.length };
    });
    scored.sort(function (a, b) { return b.s - a.s; });
    return scored.filter(function (x) { return x.s > 0; }).slice(0, 5);
  }

  // ---------- the person's own data ----------
  function uid() { var m = me(); return m ? (m.id || m.loginId) + ':' + m.role : 'guest'; }
  var facts = null, factsKey = null, factsAt = 0, factsReq = null;
  function loadFacts() {
    var m = me(), api = A().api; if (!m || !api) return Promise.resolve(null);
    var key = uid();
    if (facts && factsKey === key && Date.now() - factsAt < 60000) return Promise.resolve(facts);
    if (factsReq) return factsReq;
    factsReq = api.get('/api/assistant/facts').then(function (d) {
      factsReq = null; facts = d && d.facts; factsKey = key; factsAt = Date.now();
      if (facts && facts.courses) { facts.courses.forEach(function (c) { addVocab(c.name); }); fixCache = {}; }
      return facts;
    }, function () { factsReq = null; return factsKey === key ? facts : null; });
    return factsReq;
  }
  function myFacts() { return factsKey === uid() ? facts : null; }
  var mode = null, modeKey = null, modeAt = 0, provider = null;
  function loadMode() {
    var key = uid();
    if (!me()) return Promise.resolve('offline');
    if (mode && modeKey === key && Date.now() - modeAt < 60000) return Promise.resolve(mode);
    return fetch('/api/assistant/status', { credentials: 'same-origin' }).then(function (r) { return r.json(); })
      .then(function (d) { mode = d && d.mode && d.mode !== 'offline' ? 'online' : 'offline'; provider = mode === 'online' ? (d.provider || 'claude') : null; modeKey = key; modeAt = Date.now(); return mode; }, function () { return 'offline'; });
  }

  // Course lookup: code, full name, initials ("ds"), or a distinctive word ("structures").
  var COMMON = new Set('am an as at be by do go he if in is it me my no of on or so to up us we oh ok hi'.split(' '));
  function initials(name) { return String(name || '').replace(/[^A-Za-z ]+/g, ' ').split(/\s+/).filter(function (w) { return w && !/^(and|of|the|for|in|to|with)$/i.test(w); }).map(function (w) { return w[0]; }).join('').toLowerCase(); }
  function findCourse(t, f) {
    if (!f || !f.courses || !f.courses.length) return null;
    var words = ' ' + t.replace(/[^a-z0-9]+/g, ' ') + ' ', compact = words.replace(/([a-z]) (?=\d)/g, '$1'), best = null, bestS = 0;
    f.courses.forEach(function (c) {
      var s = 0, code = String(c.code || '').toLowerCase(), name = String(c.name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      if (code && compact.indexOf(' ' + code + ' ') >= 0) s = 10;
      else if (name && words.indexOf(' ' + name + ' ') >= 0) s = 9;
      else {
        var ac = initials(c.name);
        if (ac.length >= 2 && !COMMON.has(ac) && words.indexOf(' ' + ac + ' ') >= 0) s = 8;
        else {
          var sig = name.split(' ').filter(function (w) { return w.length >= 4 && !/^(with|engineering|introduction|principles|fundamentals|theory|laboratory|practice|lab)$/.test(w); });
          var hits = sig.filter(function (w) { return words.indexOf(' ' + w + ' ') >= 0; }).length;
          if (hits) s = 3 + 2 * hits;
        }
      }
      if (s > bestS) { bestS = s; best = c; }
    });
    return bestS >= 5 ? { c: best, s: bestS } : null;
  }

  // ---------- conversation state ----------
  var ctx = { topic: null, course: null };
  var convo = [];
  var open = false, mounted = false, greeted = false, busy = false, root, panel, log, inputEl, lastUser = null;

  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function scrollDown() { if (log) log.scrollTop = log.scrollHeight; }
  function inline(s) { return s.replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>'); }
  function md(text) {
    var out = '', list = false, code = null;
    var endList = function () { if (list) { out += '</ul>'; list = false; } };
    esc(text).split('\n').forEach(function (ln) {
      if (/^\s*```/.test(ln)) { if (code === null) { endList(); code = []; } else { out += '<pre><code>' + code.join('\n') + '</code></pre>'; code = null; } return; }
      if (code !== null) { code.push(ln); return; }
      var m = /^\s*[-•*]\s+(.*)$/.exec(ln);
      if (m) { if (!list) { out += '<ul>'; list = true; } out += '<li>' + inline(m[1]) + '</li>'; return; }
      endList();
      var h = /^\s*#{1,6}\s+(.*)$/.exec(ln);
      if (h) { out += '<p><b>' + inline(h[1]) + '</b></p>'; return; }
      if (ln.trim()) out += '<p>' + inline(ln) + '</p>';
    });
    if (code !== null) out += '<pre><code>' + code.join('\n') + '</code></pre>';
    endList();
    return out;
  }
  function chipRow(chips) {
    if (!chips || !chips.length) return '';
    return '<div class="nai-chips">' + chips.map(function (c) {
      var attr = c.id ? ' data-id="' + esc(c.id) + '"' : c.cat ? ' data-cat="' + esc(c.cat) + '"' : c.link ? ' data-link="' + esc(c.link) + '"' : c.act ? ' data-act="' + esc(c.act) + '"' : ' data-q="' + esc(c.q || c.label) + '"';
      return '<button type="button" class="nai-chip' + (c.link ? ' nai-chip-go' : '') + (c.act ? ' nai-chip-ghost' : '') + '"' + attr + '>' + esc(c.label) + '</button>';
    }).join('') + '</div>';
  }
  function botMsg(text, chips) {
    var row = el('div', 'nai-row nai-bot');
    row.innerHTML = '<div class="nai-bubble">' + md(text) + chipRow(chips) + '</div>';
    log.appendChild(row); scrollDown();
    convo.push({ role: 'assistant', content: String(text) });
  }
  function userMsg(text) {
    var row = el('div', 'nai-row nai-user');
    row.innerHTML = '<div class="nai-bubble">' + esc(text) + '</div>';
    log.appendChild(row); scrollDown();
    convo.push({ role: 'user', content: String(text) });
  }
  function typingOn() {
    var t = el('div', 'nai-row nai-bot nai-typing', '<div class="nai-bubble"><span class="nai-dot"></span><span class="nai-dot"></span><span class="nai-dot"></span></div>');
    log.appendChild(t); scrollDown();
    return function () { t.remove(); };
  }

  // ---------- starters, menu, knowledge-base answers ----------
  var qLabel = function (it) { return cap(it.q[0].replace(/\bi\b/g, 'I').replace(/\bpdf\b/g, 'PDF').replace(/\bcsv\b/g, 'CSV')); };
  function starters() {
    var m = me(), role = m ? (m.role === 'student' || m.role === 'staff' ? m.role : 'admin') : 'public';
    var list = {
      public: ['How do I sign in?', 'I forgot my password', 'Which colleges are on nerd?'],
      student: ["How's my attendance?", "What's my next class?", 'Any deadlines coming up?', 'Am I at risk anywhere?'],
      staff: ['My classes today', 'Marks still to enter', 'Students at risk', 'How does voice entry work?'],
      admin: ['How do I add a student?', 'Turn a portal feature off', 'Import students from CSV']
    }[role];
    return list.map(function (q) { return { label: q, q: q }; }).concat([{ label: 'More topics', act: 'menu' }]);
  }
  function showMenu() { botMsg('Pick a topic, or just type your question.', KB.categories.map(function (c) { return { label: c.label, cat: c.id }; })); }
  function showCategory(catId) {
    var cat = KB.categories.find(function (c) { return c.id === catId; });
    if (!cat) return showMenu();
    var chips = (cat.items || []).map(function (id) { var it = byId[id]; return it ? { label: qLabel(it), id: id } : null; }).filter(Boolean);
    botMsg('**' + cat.label + '**\n' + cat.intro, chips.concat([{ label: 'Topics', act: 'menu' }]));
  }
  function kbReply(it) {
    var chips = (it.chips || []).slice(0, 3).map(function (id) { var o = byId[id]; return o ? { label: qLabel(o), id: id } : null; }).filter(Boolean);
    if (it.link) chips.unshift({ label: (it.linkLabel || 'Open') + ' ↗', link: it.link });
    return { text: it.a, chips: chips };
  }
  function kbAnswer(it) { var x = kbReply(it); botMsg(x.text, x.chips); }

  // ---------- small talk and little helpers ----------
  var SMALLTALK = [
    { re: /^(hi+|hey+|hello+|helo|yo|hola|namaste|namaskar|vanakkam|good (morning|afternoon|evening))\b/i, a: function () { var f = myFacts(); return pick(['Hey' + (f && f.first ? ' ' + f.first : '') + '! What can I do for you?', 'Hi there! What do you need help with?', 'Hello! Ask me anything about your classes or the campus.']); }, starters: true },
    { re: /\b(how are you|how r u|how are u|what'?s up|wassup|sup|how'?s it going|how do you do)\b/i, a: function () { return pick(["I'm good, thanks! How's your day going?", "Doing well. What's on your mind?"]); } },
    { re: /\b(thanks|thank you|thx|ty|thank u|tysm)\b/i, a: function () { return pick(['Anytime!', 'Happy to help.', 'You got it. Anything else?']); } },
    { re: /^(ok|okay|okey|k|cool|nice|great|awesome|perfect|got it|alright|fine)[.! ]*$/i, a: function () { return pick(['Great. Anything else?', 'Cool. Shout if you need anything.']); } },
    { re: /\b(bye|goodbye|see ya|see you|cya|good night|gn|ttyl)\b/i, a: function () { return pick(['See you! Good luck with your day.', 'Bye for now. I am right here if you need me.']); } },
    { re: /\b(who are you|what are you|your name|are you (a )?(bot|robot|ai|human|real|chatgpt))\b/i, a: function () { return "I'm nerd AI, the helper built into nerd. I can look up your attendance, marks, timetable and deadlines, and answer questions about the platform."; }, starters: true },
    { re: /^(help|what can you do|options|menu|commands)\??$/i, a: function () { return 'I can check your attendance and marks, tell you your next class, list deadlines, explain risk, and help you find your way around nerd. What do you need?'; }, starters: true }
  ];
  function smalltalk(text) {
    var t = String(text || '').trim(); if (t.length > 48) return null;
    for (var i = 0; i < SMALLTALK.length; i++) if (SMALLTALK[i].re.test(t)) {
      // "hi, what's my attendance" is a real question: only treat it as small talk if nothing else is asked
      if ((i === 0 || i === 2) && t.replace(SMALLTALK[i].re, '').replace(/\b(there|nerd|ai|buddy|bro|friend|all|everyone|sir|madam|mam|so much|a lot|again)\b/gi, '').replace(/[^a-z]/gi, '').length > 4) return null;
      return SMALLTALK[i];
    }
    return null;
  }
  var MOOD = /\b(stressed|stress|anxious|anxiety|worried|worry|tired|sad|depressed|overwhelmed|scared|nervous|panic)\b/i;

  function calc(raw) {
    var t = raw.trim().toLowerCase().replace(/\?$/, '');
    var pc = /^(?:what(?:'s| is)\s+)?(\d+(?:\.\d+)?)\s*%\s*of\s*(\d+(?:\.\d+)?)$/.exec(t);
    if (pc) return round(+pc[1] * +pc[2] / 100);
    var m = /^(?:what(?:'s| is)|calculate|calc|compute|solve)?\s*([-+*/x×÷^%().\d\s]+)$/.exec(t);
    if (!m || !/\d\s*[-+*/x×÷^%]\s*\(?\s*-?\d/.test(m[1])) return null;
    var src = m[1].replace(/[x×]/g, '*').replace(/÷/g, '/'), i = 0;
    function peek() { while (src[i] === ' ') i++; return src[i]; }
    function num() {
      var c = peek();
      if (c === '(') { i++; var v = expr(); if (peek() !== ')') throw 0; i++; return v; }
      if (c === '-') { i++; return -num(); }
      var s = i; while (/[\d.]/.test(src[i] || '')) i++; if (s === i) throw 0; return parseFloat(src.slice(s, i));
    }
    function pow() { var b = num(); if (peek() === '^') { i++; return Math.pow(b, pow()); } return b; }
    function term() { var v = pow(); for (;;) { var c = peek(); if (c === '*') { i++; v *= pow(); } else if (c === '/') { i++; v /= pow(); } else if (c === '%') { i++; v %= pow(); } else return v; } }
    function expr() { var v = term(); for (;;) { var c = peek(); if (c === '+') { i++; v += term(); } else if (c === '-') { i++; v -= term(); } else return v; } }
    try { var v = expr(); return peek() === undefined && isFinite(v) ? round(v) : null; } catch (e) { return null; }
  }
  function round(v) { return Math.round(v * 1e6) / 1e6; }
  var JOKES = ['Why did the student bring a ladder to class? Because the marks were on a higher level.', 'I would tell you a UDP joke, but you might not get it.', 'Why was the maths book sad? It had too many problems.', 'Debugging: being the detective in a crime movie where you are also the murderer.'];
  function helpers(raw, t) {
    var v = calc(raw);
    if (v !== null) return { text: 'That comes to **' + v + '**.' };
    var now = new Date();
    if (/\b(what('?s| is) the (time|date)|time now|current time|today'?s date|what day is (it|today)|what('?s| is) today)\b/.test(t))
      return { text: "It's " + now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) + ', ' + now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) + '.' };
    if (/\b(joke|make me laugh|something funny)\b/.test(t)) return { text: pick(JOKES), chips: [{ label: 'Another one', q: 'Tell me another joke' }] };
    if (/\b(study tips?|how (to|do i|should i|can i) study|exam tips?|prepare for (the |my )?exams?|exam prep|concentrate|focus better|study plan|revision tips?)\b/.test(t)) {
      var f = myFacts(), weak = f && f.role === 'student' ? weakest(f) : null;
      return { text: 'A few things that work for most people:\n- Study in short blocks (25 to 40 minutes) with a 5 minute break.\n- Redo past questions instead of only re-reading notes.\n- Explain a topic out loud. If you get stuck, that is the part to revise.\n- Sleep properly before exams. It helps memory more than a late night.' + (weak ? '\nIf you want a place to start, **' + weak.name + '** needs the most attention right now.' : ''), chips: weak ? [{ label: 'How do I improve in ' + shortName(weak) + '?', q: 'How do I improve in ' + weak.name + '?' }] : null };
    }
    return null;
  }

  // ---------- understanding what is being asked ----------
  var TOPICS = [
    ['improve', /\b(improve|recover|raise|increase|boost|get better|bring (it )?up|catch up|pull up|tips for)\b/],
    ['due', /\b(deadlines?|due|assignments?|homework|submissions?|submit|pending work|coursework)\b/],
    ['time', /\b(next class|timetable|time table|schedule|class(es)? (today|tomorrow|now|on)|today'?s class(es)?|my classes|free period|tomorrow|when is|when do i have|what class|which class|monday|tuesday|wednesday|thursday|friday|saturday|my day)\b/],
    ['risk', /\b(risk|risky|danger|fail|failing|flagged|warning|in trouble)\b/],
    ['att', /\b(attendance|attend|bunk|skip|miss|absent|absence|present|leave|safe)\b/],
    ['marks', /\b(marks?|grades?|scores?|results?|cgpa|gpa|sgpa|internals?|cat ?\d?|exams?|average)\b/],
    ['courses', /\b(courses?|subjects?|who teaches|teacher for|faculty for|papers?)\b/],
    ['overview', /\b(how am i doing|how('?m| am) i doing|overall|summary|summari[sz]e|status|report|where do i stand|everything|how('?s| is) (it|everything) going)\b/]
  ];
  function detectTopic(t) { for (var i = 0; i < TOPICS.length; i++) if (TOPICS[i][1].test(t)) return TOPICS[i][0]; return null; }
  var isPersonal = function (t) { return /\b(my|mine|me|am i|i am|i'?m|can i|could i|should i|do i have|have i|will i|did i|i have|i need)\b/.test(t); };
  var isFollowUp = function (t) { return /^(and|what about|how about|also|then|same for|ok and|okay and|and for|for)\b/.test(t.trim()); };
  var isHowTo = function (t) { return /\b(how (do|can|to|does)|where (do|can|is)|add|enrol|enroll|change|reset|upload|create|delete|remove|edit|turn (on|off)|switch|import|export|forgot)\b/.test(t); };
  var isGeneral = function (t) { return /\b(rule|policy|minimum|required|calculated|what is|what does|mean|meaning|work|explain|definition)\b/.test(t); };
  var wordCount = function (t) { return t.trim().split(/\s+/).filter(Boolean).length; };

  // ---------- student answers ----------
  function shortName(c) { if (String(c.name).length <= 20) return c.name; var a = initials(c.name).toUpperCase(); return a.length >= 2 ? a : c.code; }
  function courseChips(list, fmt) { return list.slice(0, 3).map(function (c) { return { label: fmt(shortName(c)), q: fmt(c.name) }; }); }
  var RISK_ORDER = { High: 0, Attention: 1, Normal: 2 };
  function weakest(f) {
    var list = (f.courses || []).slice();
    list.sort(function (a, b) { return (RISK_ORDER[a.risk] - RISK_ORDER[b.risk]) || ((a.marks == null ? 101 : a.marks) - (b.marks == null ? 101 : b.marks)) || (a.attendance - b.attendance); });
    return list[0] || null;
  }
  function attAdvice(c, th) {
    if (c.safeMisses > 0) return 'You can miss ' + classes(c.safeMisses) + ' more and still stay at ' + th + '%.';
    if (c.classesToRecover) return 'Attend the next ' + classes(c.classesToRecover) + ' in a row to get back to ' + th + '%.';
    return "You're right at the line, so try not to miss the next one.";
  }
  function improveLines(c, th) {
    var out = [];
    if (c.status !== 'Safe') out.push(c.classesToRecover ? 'Attend the next ' + classes(c.classesToRecover) + ' without a break to get back above ' + th + '%.' : 'Avoid missing any more classes for a couple of weeks.');
    if (c.marks != null && (c.marks < 60 || c.marksTrend === 'Declining')) out.push('Revise the last few topics and ask ' + (c.faculty || 'your teacher') + ' about the parts that feel unclear.');
    if (c.nextStep && !(out.length && /miss|attend/i.test(c.nextStep))) out.push(c.nextStep);
    return out;
  }
  var dayIdx = function (name) { return ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(String(name || '').slice(0, 3).toLowerCase()); };
  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var startMin = function (time) { var m = /(\d{1,2}):(\d{2})/.exec(time || ''); return m ? (+m[1]) * 60 + (+m[2]) : 0; };
  var startOf = function (time) { return String(time || '').split(/[–-]/)[0]; };
  function slotsOn(f, d) { return (f.timetable || []).filter(function (s) { return dayIdx(s.day) === d; }).sort(function (a, b) { return a.period - b.period; }); }
  function slotLabel(s, staff) { return startOf(s.time) + ' ' + (s.code ? s.code + ' ' : '') + (s.name || 'Free period') + (staff && s.section ? ', Sec ' + s.section : ''); }
  function timeAnswer(t, course, f, staff) {
    var now = new Date(), today = now.getDay(), mins = now.getHours() * 60 + now.getMinutes();
    if (course) {
      var mine = (f.timetable || []).filter(function (s) { return s.code === course.code; });
      if (!mine.length) return { text: course.name + " isn't on your weekly timetable." };
      return { text: '**' + course.name + '** is on:\n' + mine.map(function (s) { return '- ' + s.day + ', period ' + s.period + ' (' + s.time + ')'; }).join('\n'), chips: [{ label: 'Open timetable', link: staff ? '#/staff/timetable' : '#/student/timetable' }] };
    }
    var d = today, named = null;
    if (/\btomorrow\b/.test(t)) d = (today + 1) % 7;
    DAYS.forEach(function (nm, i) { if (new RegExp('\\b' + nm.toLowerCase() + '\\b').test(t)) { d = i; named = nm; } });
    var list = slotsOn(f, d).filter(function (s) { return s.code || staff; });
    var link = [{ label: 'Open timetable', link: staff ? '#/staff/timetable' : '#/student/timetable' }];
    if (d !== today || named) {
      var label = d === (today + 1) % 7 && !named ? 'Tomorrow' : DAYS[d];
      if (!list.length) {
        var nx = (d + 1) % 7, j = 0; while (!slotsOn(f, nx).length && j++ < 6) nx = (nx + 1) % 7;
        var nf = slotsOn(f, nx)[0];
        return { text: 'No classes ' + (label === 'Tomorrow' ? 'tomorrow' : 'on ' + DAYS[d]) + '.' + (nf && nx !== d ? ' The next ones are on ' + DAYS[nx] + ', starting with ' + (nf.name || nf.code) + ' at ' + startOf(nf.time) + '.' : ''), chips: link };
      }
      return { text: '**' + label + '**:\n' + list.map(function (s) { return '- ' + slotLabel(s, staff); }).join('\n'), chips: link };
    }
    if (!list.length) {
      var nd = (today + 1) % 7, k = 0; while (!slotsOn(f, nd).length && k++ < 6) nd = (nd + 1) % 7;
      var first = slotsOn(f, nd)[0];
      return { text: 'No classes today.' + (first ? ' Next up is ' + (first.name || first.code) + ' on ' + DAYS[nd] + ' at ' + startOf(first.time) + '.' : ''), chips: link };
    }
    var next = list.filter(function (s) { return startMin(s.time) > mins; });
    if (!next.length) {
      var tom = slotsOn(f, (today + 1) % 7)[0];
      return { text: "You're done for today." + (tom ? ' Tomorrow starts with **' + (tom.name || tom.code) + '** at ' + startOf(tom.time) + '.' : ''), chips: link };
    }
    var n = next[0], who = !staff && n.faculty ? ' with ' + n.faculty : '';
    var rest = next.slice(1);
    return { text: 'Next is **' + (n.name || n.code) + '** at ' + startOf(n.time) + (staff && n.section ? ' (Sec ' + n.section + ')' : '') + who + '.' + (rest.length ? '\nLater today:\n' + rest.map(function (s) { return '- ' + slotLabel(s, staff); }).join('\n') : '\nThat is your last class today.'), chips: link };
  }
  function dueText(d) {
    var days = Math.round((new Date(d + 'T00:00:00') - new Date(new Date().toDateString())) / 86400000);
    var when = new Date(d + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
    return when + (days === 0 ? ', today' : days === 1 ? ', tomorrow' : days > 1 && days <= 7 ? ', in ' + days + ' days' : '');
  }

  function studentSkill(topic, t, course, f) {
    var th = f.threshold || 75, cs = f.courses || [];
    var c = course;
    if (topic === 'att') {
      if (c) {
        var lead = '';
        if (/\b(skip|bunk|miss|leave|absent|take (a )?(day )?off)\b/.test(t)) lead = c.safeMisses > 2 ? 'Yes, you have some room. ' : c.safeMisses > 0 ? 'You can, but only just. ' : 'Better not. ';
        return { text: lead + '**' + c.name + '** is at ' + c.attendance + '% (' + c.status + '). ' + attAdvice(c, th), chips: [{ label: 'Marks in ' + shortName(c), q: 'Marks in ' + c.name }, { label: 'Open attendance', link: '#/student/attendance' }] };
      }
      var watch = cs.filter(function (x) { return x.status !== 'Safe'; }).sort(function (a, b) { return a.attendance - b.attendance; });
      var text = 'Overall you are at **' + f.attendance.percentage + '%** (' + f.attendance.status + '), ' + f.attendance.attended + ' of ' + f.attendance.conducted + ' classes.';
      if (watch.length) text += '\nKeep an eye on:\n' + watch.slice(0, 4).map(function (x) { return '- ' + x.name + ': ' + x.attendance + '%, ' + (x.safeMisses > 0 ? classes(x.safeMisses) + ' to spare' : x.classesToRecover ? 'needs ' + classes(x.classesToRecover) + ' to recover' : 'no classes to spare'); }).join('\n') + '\nWant the details for one of these?';
      else text += ' Every subject is Safe. Which one do you want to check?';
      return { text: text, chips: courseChips(watch.length ? watch : cs, function (n) { return 'Attendance in ' + n; }).concat([{ label: 'Open attendance', link: '#/student/attendance' }]) };
    }
    if (topic === 'marks') {
      if (c) {
        if (c.marks == null) return { text: 'No marks have been entered for **' + c.name + '** yet.' };
        var trend = c.marksTrend === 'Declining' ? ' It has dipped recently.' : c.marksTrend === 'Improving' ? ' It is going up. Nice.' : '';
        return { text: '**' + c.name + '**: ' + c.marks + '% so far.' + trend, chips: [{ label: 'How do I improve?', q: 'How do I improve in ' + c.name + '?' }, { label: 'Attendance in ' + shortName(c), q: 'Attendance in ' + c.name }, { label: 'Open performance', link: '#/student/performance' }] };
      }
      var p = f.performance || {}, withMarks = cs.filter(function (x) { return x.marks != null; }).sort(function (a, b) { return a.marks - b.marks; });
      var out = p.currentPct != null ? 'Your average this semester is **' + p.currentPct + '%**.' : 'No marks are in for this semester yet.';
      if (p.cgpa) out += ' CGPA **' + p.cgpa + '**' + (p.previousSgpa ? ', last semester SGPA ' + p.previousSgpa : '') + '.';
      if (withMarks.length > 1) out += '\nLowest right now:\n' + withMarks.slice(0, 2).map(function (x) { return '- ' + x.name + ': ' + x.marks + '%'; }).join('\n') + '\nWhich subject do you want to look at?';
      return { text: out, chips: courseChips(withMarks, function (n) { return 'Marks in ' + n; }).concat([{ label: 'Open performance', link: '#/student/performance' }]) };
    }
    if (topic === 'risk') {
      if (c) {
        if (c.risk === 'Normal') return { text: '**' + c.name + '** looks fine. Nothing is flagged there.' };
        return { text: '**' + c.name + '** is at **' + c.risk + '** risk.' + (c.riskReason ? ' ' + c.riskReason + '.' : '') + (c.nextStep ? '\nNext step: ' + c.nextStep : ''), chips: [{ label: 'How do I improve?', q: 'How do I improve in ' + c.name + '?' }, { label: 'Open risk view', link: '#/student/risk' }] };
      }
      var flagged = cs.filter(function (x) { return x.risk !== 'Normal'; }).sort(function (a, b) { return RISK_ORDER[a.risk] - RISK_ORDER[b.risk]; });
      if (!flagged.length) return { text: "Good news: nothing is flagged. You're on track in every subject.", chips: [{ label: 'How am I doing overall?', q: 'How am I doing overall?' }] };
      return { text: (flagged.length === 1 ? 'One subject to watch:' : flagged.length + ' subjects to watch:') + '\n' + flagged.map(function (x) { return '- **' + x.name + '**: ' + x.risk + (x.riskReason ? '. ' + x.riskReason : ''); }).join('\n') + '\nWant tips for one of them?', chips: courseChips(flagged, function (n) { return 'How do I improve in ' + n + '?'; }) };
    }
    if (topic === 'improve') {
      if (!c) {
        if (/\b(attendance|attend)\b/.test(t)) {
          var low = cs.filter(function (x) { return x.status !== 'Safe'; });
          if (!low.length) return { text: 'Your attendance is Safe in every subject. Just keep turning up.' };
          return { text: 'Focus on these:\n' + low.map(function (x) { return '- **' + x.name + '**: ' + attAdvice(x, th); }).join('\n') };
        }
        c = weakest(f);
        if (!c) return null;
        var lines0 = improveLines(c, th);
        if (!lines0.length) return { text: "You're doing well everywhere. Keep the same routine and revise a little every week.", chips: [{ label: 'Study tips', q: 'Give me study tips' }] };
        return { text: 'Start with **' + c.name + '**:\n' + lines0.map(function (l) { return '- ' + l; }).join('\n') + '\nShould I check another subject?', chips: courseChips(cs.filter(function (x) { return x !== c; }), function (n) { return 'How do I improve in ' + n + '?'; }) };
      }
      var lines = improveLines(c, th);
      if (!lines.length) return { text: '**' + c.name + "** is going well. Keep doing what you're doing.", chips: [{ label: 'Study tips', q: 'Give me study tips' }] };
      return { text: 'For **' + c.name + '**:\n' + lines.map(function (l) { return '- ' + l; }).join('\n'), chips: [{ label: 'Study tips', q: 'Give me study tips' }] };
    }
    if (topic === 'time') return timeAnswer(t, c, f, false);
    if (topic === 'due') {
      var pend = (f.deadlines || []).filter(function (d) { return !d.submitted; }), done = (f.deadlines || []).length - pend.length;
      if (!pend.length) return { text: 'Nothing due right now.' + (done ? " You've already handed in " + (done === 1 ? 'the one that was open.' : 'all ' + done + ' open ones.') : ''), chips: [{ label: 'Open classroom', link: '#/student/classroom' }] };
      return { text: (pend.length === 1 ? 'One thing due:' : pend.length + ' things due:') + '\n' + pend.map(function (d) { return '- **' + d.title + '** (' + d.course + '), ' + dueText(d.due); }).join('\n'), chips: [{ label: 'Open classroom', link: '#/student/classroom' }] };
    }
    if (topic === 'courses') {
      if (c) return { text: '**' + c.code + ' ' + c.name + '** is taught by ' + (c.faculty || 'a teacher who is yet to be assigned') + '. Attendance ' + c.attendance + '% (' + c.status + ')' + (c.marks != null ? ', marks ' + c.marks + '%' : '') + '.', chips: [{ label: 'When is it?', q: 'When is ' + c.name + '?' }, { label: 'Can I skip it?', q: 'Can I skip ' + c.name + '?' }] };
      return { text: 'You have ' + cs.length + ' subjects this semester:\n' + cs.map(function (x) { return '- ' + x.code + ' ' + x.name + (x.faculty ? ', ' + x.faculty : ''); }).join('\n') + '\nAsk me about any of them.' };
    }
    if (topic === 'overview') {
      var fl = cs.filter(function (x) { return x.risk !== 'Normal'; }).length, dueN = (f.deadlines || []).filter(function (d) { return !d.submitted; }).length;
      return { text: "Here's where you stand, " + f.first + ':\n- Attendance: ' + f.attendance.percentage + '% (' + f.attendance.status + ')\n- Marks: ' + (f.performance && f.performance.currentPct != null ? f.performance.currentPct + '% average' : 'none yet') + (f.performance && f.performance.cgpa ? ', CGPA ' + f.performance.cgpa : '') + '\n- Risk: ' + (fl ? fl + ' subject' + (fl === 1 ? '' : 's') + ' flagged' : 'nothing flagged') + '\n- Deadlines: ' + (dueN ? dueN + ' due' : 'none') + '\nWhat do you want to look at first?', chips: [{ label: 'Attendance', q: "How's my attendance?" }, { label: 'Marks', q: 'How are my marks?' }, { label: fl ? 'What is flagged?' : 'Next class', q: fl ? 'Am I at risk anywhere?' : "What's my next class?" }] };
    }
    return null;
  }

  // ---------- teacher answers ----------
  function staffSkill(topic, t, course, f) {
    var cs = f.courses || [];
    if (course && topic !== 'time') {
      var c = course;
      return { text: '**' + c.code + ' ' + c.name + '**' + (c.section ? ' (Sec ' + c.section + ')' : '') + ': ' + students(c.students) + (c.avg_attendance != null ? ', average attendance ' + c.avg_attendance + '%' : '') + '. ' + (c.high_risk || c.attention ? c.high_risk + ' high risk, ' + c.attention + ' to watch.' : 'Nobody is flagged.'), chips: [{ label: 'When do I teach it?', q: 'When is ' + c.name + '?' }, { label: 'Open Analytics & Risk', link: '#/staff/risk' }] };
    }
    if (topic === 'time') return timeAnswer(t, course, f, true);
    if (topic === 'marks' || topic === 'due') {
      var p = f.pendingMarks || [];
      if (!p.length) return { text: 'All marks are in. Nice work.', chips: [{ label: 'Open marks', link: '#/staff/go/marks' }] };
      return { text: 'Still to enter:\n' + p.slice(0, 6).map(function (x) { return '- ' + x.assessment + ' in ' + x.course + ': ' + students(x.missing); }).join('\n') + (p.length > 6 ? '\nand ' + (p.length - 6) + ' more.' : ''), chips: [{ label: 'Open marks', link: '#/staff/go/marks' }, { label: 'How does voice entry work?', q: 'How does voice entry work?' }] };
    }
    if (topic === 'risk' || topic === 'improve') {
      var fl = cs.filter(function (c) { return c.high_risk || c.attention; });
      if (!fl.length) return { text: 'No students are flagged in your classes right now.' };
      return { text: 'Flagged students by class:\n' + fl.map(function (c) { return '- ' + c.code + (c.section ? ' Sec ' + c.section : '') + ': ' + c.high_risk + ' high risk, ' + c.attention + ' to watch'; }).join('\n'), chips: [{ label: 'Open Analytics & Risk', link: '#/staff/risk' }] };
    }
    if (topic === 'att') return { text: 'Average attendance by class:\n' + cs.map(function (c) { return '- ' + c.code + (c.section ? ' Sec ' + c.section : '') + ': ' + (c.avg_attendance != null ? c.avg_attendance + '%' : 'no classes yet'); }).join('\n'), chips: [{ label: 'Take attendance', link: '#/staff/go/attendance' }] };
    if (topic === 'courses' || topic === 'overview') {
      var today = slotsOn(f, new Date().getDay()).length, pend = (f.pendingMarks || []).length, flagged = cs.reduce(function (n, c) { return n + (c.high_risk || 0); }, 0);
      return { text: 'You teach ' + cs.length + ' class' + (cs.length === 1 ? '' : 'es') + ':\n' + cs.map(function (c) { return '- ' + c.code + ' ' + c.name + (c.section ? ', Sec ' + c.section : '') + ' (' + students(c.students) + ')'; }).join('\n') + (topic === 'overview' ? '\nToday: ' + classes(today) + '. ' + (pend ? pend + ' mark sheet' + (pend === 1 ? '' : 's') + ' to finish. ' : '') + (flagged ? flagged + ' high-risk student' + (flagged === 1 ? '' : 's') + '.' : '') : '') };
    }
    return null;
  }
  function adminSkill(topic, t, f) {
    if (/\b(how many|number of|count|total)\b.*\b(students?|teachers?|staff|faculty|people)\b/.test(t) || topic === 'overview') return { text: 'You look after **' + f.students + '** students and **' + f.staff + '** teachers.', chips: [{ label: 'Open dashboard', link: '#/admin' }] };
    return null;
  }

  // ---------- the offline brain ----------
  // Returns { text, chips }. In strict mode (used when an online model is available) it returns null
  // unless it has a confident answer, so open-ended questions go to the model.
  function offlineReply(raw, strict) {
    var st = smalltalk(raw);
    if (st) return { text: st.a(), chips: st.starters && convo.length < 4 ? starters() : null };
    var t = correct(raw), h = helpers(raw, t);
    if (h) return h;
    var f = myFacts(), m = me(), role = m ? m.role : null;
    if (f && f.role === 'admin') { var adm = adminSkill(detectTopic(t), t, f); if (adm) return adm; }
    var topic = detectTopic(t), hit = f && f.role !== 'admin' ? findCourse(t, f) : null;
    var course = hit ? hit.c : null, follow = isFollowUp(t), personal = isPersonal(t);
    if (!topic && course && (ctx.topic || hit.s >= 8 || wordCount(t) <= 4)) topic = ctx.topic || 'courses';
    if (topic && !course && ctx.course && (follow || wordCount(t) <= 3)) course = ctx.course;
    if (!topic && follow && ctx.topic) topic = ctx.topic;
    var mood = MOOD.test(t) ? pick(["That sounds stressful. Let's look at it together.", "Don't worry, it's fixable. Here's the picture."]) + '\n' : '';
    if (strict && mood) return null; // feelings deserve a real conversation, so the model takes these
    var sure = function (r) { return r.length && r[0].s >= (strict ? 0.5 : 0.34) && (!strict || r[0].cov >= 0.75); };
    var res = null;
    if ((isHowTo(t) && !(personal && topic && topic !== 'courses')) || (isGeneral(t) && !personal)) {
      res = search(t);
      if (sure(res)) { ctx.topic = null; return kbReply(res[0].it); }
    }
    if (f && topic && (personal || course || follow || wordCount(t) <= 5 || mood)) {
      var ans = role === 'student' ? studentSkill(topic, t, course, f) : role === 'staff' ? staffSkill(topic, t, course, f) : null;
      if (ans) { ctx = { topic: topic, course: course }; return { text: mood + ans.text, chips: ans.chips }; }
    }
    res = res || search(t);
    if (strict) return sure(res) ? kbReply(res[0].it) : null;
    if (mood) return { text: "That sounds like a lot. Take a breath, you don't have to sort everything out today. Want me to check what needs attention first?", chips: [{ label: 'Yes, check for me', q: 'How am I doing overall?' }, { label: 'Study tips', q: 'Give me study tips' }] };
    if (sure(res)) return kbReply(res[0].it);
    if (res.length && res[0].s >= 0.16 && res[0].cov >= 0.5) return { text: 'Do you mean one of these?', chips: res.slice(0, 3).map(function (r) { return { label: qLabel(r.it), id: r.it.id }; }).concat([{ label: 'Something else', act: 'menu' }]) };
    if (course) return { text: 'What do you want to know about **' + course.name + '**?', chips: [{ label: 'Attendance', q: 'Attendance in ' + course.name }, { label: 'Marks', q: 'Marks in ' + course.name }, { label: 'When is it?', q: 'When is ' + course.name + '?' }] };
    var opts = (role === 'student' ? [['Attendance', "How's my attendance?"], ['Marks', 'How are my marks?'], ['Timetable', "What's my next class?"], ['Deadlines', 'Any deadlines coming up?']]
      : role === 'staff' ? [['My classes', 'My classes today'], ['Marks to enter', 'Marks still to enter'], ['Students at risk', 'Students at risk']]
      : m ? [['Students', 'How do I add a student?'], ['Portals', 'Turn a portal feature off'], ['Import', 'Import students from CSV']]
      : [['Signing in', 'How do I sign in?'], ['Colleges', 'Which colleges are on nerd?'], ['Password', 'I forgot my password']])
      .map(function (o) { return { label: o[0], q: o[1] }; }).concat([{ label: 'Something else', act: 'menu' }]);
    // A general-knowledge question with no online model: say so plainly instead of guessing.
    if (wordCount(t) >= 3 && /^(explain|tell me|what|who|why|how|when|where|which|can you|could you|define|write|give me|solve)\b/.test(t.trim()))
      return { text: "That one's outside what I can answer here. I'm best with your classes, attendance, marks, deadlines and anything on nerd.", chips: opts };
    return { text: pick(["I didn't quite get that. What is it about?", "Hmm, I'm not sure what you mean. Is it one of these?"]), chips: opts };
  }
  function offlineAnswer(raw) { var x = offlineReply(raw, false); botMsg(x.text, x.chips); }

  // ---------- asking ----------
  function ask(text) {
    text = String(text || '').trim(); if (!text || busy) return;
    busy = true; userMsg(text);
    var stop = typingOn();
    var done = function () { busy = false; };
    var later = function (x) { setTimeout(function () { stop(); botMsg(x.text, x.chips); done(); }, 260 + Math.min(500, text.length * 5)); };
    Promise.all([loadMode(), loadFacts()]).then(function (r) {
      if (r[0] !== 'online' || smalltalk(text)) return later(offlineReply(text, false));
      // A local or free model is slower and less exact, so the person's own numbers are answered here first.
      var local = provider !== 'claude' ? offlineReply(text, true) : null;
      if (local) return later(local);
      var timeout = new Promise(function (ok, no) { setTimeout(function () { no(new Error('timeout')); }, 100000); });
      return Promise.race([A().api.post('/api/assistant/chat', { messages: convo.slice(-16), page: location.hash }), timeout]).then(function (d) {
        stop(); botMsg(d.reply, (d.suggestions || []).slice(0, 3).map(function (q) { return { label: q, q: q }; })); done();
      });
    }).catch(function () { modeAt = 0; stop(); offlineAnswer(text); done(); });
  }

  function onChip(ev) {
    var b = ev.target.closest('button.nai-chip'); if (!b || !panel.contains(b)) return;
    if (b.dataset.q) ask(b.dataset.q);
    else if (b.dataset.cat) showCategory(b.dataset.cat);
    else if (b.dataset.id) { var it = byId[b.dataset.id]; if (it && !busy) { userMsg(qLabel(it)); var stop = typingOn(); setTimeout(function () { stop(); kbAnswer(it); }, 280); } }
    else if (b.dataset.link) { if (A().go) A().go(b.dataset.link); else location.hash = b.dataset.link; closePanel(); }
    else if (b.dataset.act === 'menu') showMenu();
  }
  function submit() { var v = (inputEl.value || '').trim(); if (!v || busy) return; inputEl.value = ''; ask(v); }

  // ---------- panel ----------
  function markSvg() {
    return '<svg viewBox="0 0 40 40" width="20" height="20" aria-hidden="true"><rect width="40" height="40" rx="11" fill="#14234a"/><circle cx="13.2" cy="21.5" r="5.7" fill="none" stroke="#fff" stroke-width="2.6"/><circle cx="26.8" cy="21.5" r="5.7" fill="none" stroke="#fff" stroke-width="2.6"/><path d="M18.4 20.4q1.6-1.5 3.2 0" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/><path d="M7.6 19.6 5.4 16.8M32.4 19.6l2.2-2.8" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/><circle cx="31.2" cy="9.4" r="2.6" fill="#f2b33d"/></svg>';
  }
  function greet() {
    greeted = true;
    loadFacts().then(function (f) {
      var m = me(), first = m && (m.role === 'student' || m.role === 'staff') ? (f && f.first) || String(m.name || '').replace(/^(Dr|Prof|Mr|Ms|Mrs)\.?\s+/i, '').split(/\s+/)[0] : '';
      botMsg('Hi' + (first ? ' ' + first : '') + '! What can I help you with?', starters());
    });
  }
  function reset() { if (log) log.innerHTML = ''; convo = []; ctx = { topic: null, course: null }; greeted = false; if (open) greet(); }
  function openPanel() {
    sync();
    open = true; root.classList.add('nai-open'); panel.setAttribute('aria-hidden', 'false');
    if (!greeted) greet();
    setTimeout(function () { if (inputEl) inputEl.focus(); }, 60);
  }
  function closePanel() { open = false; root.classList.remove('nai-open'); panel.setAttribute('aria-hidden', 'true'); }
  function toggle() { if (open) closePanel(); else openPanel(); }
  function sync() {
    if (!root) return;
    var on = !A().featureOn || A().featureOn('assistant');
    root.classList.toggle('hidden', !on);
    if (!on && open) closePanel();
    var key = uid();
    if (key !== lastUser) { lastUser = key; reset(); }
  }

  function mount() {
    if (mounted) return; mounted = true;
    root = el('div', 'nai-root');
    root.innerHTML =
      '<button type="button" class="nai-launch" id="nai-launch" aria-label="Open nerd AI">' + markSvg() + '<span>Ask nerd</span></button>' +
      '<section class="nai-panel" id="nai-panel" role="dialog" aria-label="nerd AI" aria-hidden="true">' +
      '  <header class="nai-head"><span class="nai-head-id">' + markSvg() + '<span><b>nerd AI</b><small>Usually replies instantly</small></span></span>' +
      '    <button type="button" class="nai-x" id="nai-x" aria-label="Close">✕</button></header>' +
      '  <div class="nai-log" id="nai-log" aria-live="polite"></div>' +
      '  <form class="nai-input" id="nai-form"><input id="nai-text" type="text" autocomplete="off" placeholder="Type a message…" aria-label="Message nerd AI"><button type="submit" class="nai-send" aria-label="Send">' +
      '    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h14M12 5l7 7-7 7"/></svg></button></form>' +
      '</section>';
    document.body.appendChild(root);
    panel = root.querySelector('#nai-panel'); log = root.querySelector('#nai-log'); inputEl = root.querySelector('#nai-text');
    root.querySelector('#nai-launch').addEventListener('click', toggle);
    root.querySelector('#nai-x').addEventListener('click', closePanel);
    panel.addEventListener('click', onChip);
    root.querySelector('#nai-form').addEventListener('submit', function (e) { e.preventDefault(); submit(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && open) closePanel(); });
    window.addEventListener('hashchange', function () { setTimeout(sync, 50); });
    setTimeout(sync, 400);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();
