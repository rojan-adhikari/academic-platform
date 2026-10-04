// Academic risk at a glance: signal meters, factor chips, course tiles and a what-if attendance slider.
// Shared by the student, faculty and admin risk views so a reader gets the picture without reading paragraphs.
(() => {
  const { html, raw, $, $$, icon, riskBadge, fmt } = App;
  const ORDER = { High: 0, Attention: 1, Normal: 2 };
  const LVL = { High: 'high', Attention: 'attention', Normal: 'normal' };
  const SHORT = { High: 'High', Attention: 'Watch', Normal: 'On track' };

  // Factor key -> icon and a short label built from the first number in the explanation text.
  const FACTOR = {
    att_gap: ['calendar', (n) => `Attendance ${n ?? ''}`], att_decline: ['calendar', () => 'Attendance falling'],
    assess_low: ['clipboard', (n) => `Tests ${n ?? 'low'}`], assess_drop: ['clipboard', () => 'Tests dropping'],
    assign_low: ['book', (n) => `Assignments ${n ?? 'low'}`], assign_drop: ['book', () => 'Assignments dropping'],
    prev_low: ['grad', (n) => `SGPA ${n ?? 'low'}`], prev_drop: ['grad', () => 'SGPA falling'],
  };
  // The student's own figure: the number in brackets when there is one, so "close to the 75% threshold (76.1%)" reads 76%.
  const firstNum = (t) => { const src = (/\(([^)]*\d[^)]*)\)/.exec(t || '') || [])[1] || t || ''; const m = /(\d+(?:\.\d+)?)(%?)/.exec(src); return m ? (m[2] ? Math.round(+m[1]) + '%' : m[1]) : null; };
  const down = (k) => /decline|drop/.test(k);
  function chip(f, level = 'High') {
    if (level === 'Normal') level = 'minor';
    const [ic, label] = FACTOR[f.key] || ['alert', () => (f.text || '').split(/[(:]/)[0]];
    const text = f.n ? (down(f.key || '') ? label(null) : label(null).replace(/ (low|)$/, '').trim() + ' low') : label(firstNum(f.text));
    return html`<span class="rv-chip ${LVL[level] || level}" title="${f.text}">${icon(ic, 13)}${text}${down(f.key || '') ? raw('<b class="rv-down">↓</b>') : ''}${f.n ? html`<b class="rv-n">${f.n} courses</b>` : ''}</span>`;
  }
  // Same signal in several courses (the overall view) becomes one chip with a course count.
  function chips(list, level) {
    const groups = new Map();
    for (const f of list || []) { const k = /^[^:]+: /.test(f.text) ? f.key : `${f.key}|${f.text}`; const g = groups.get(k); if (g) g.push(f); else groups.set(k, [f]); }
    return html`<span class="rv-chips">${[...groups.values()].map((g) => (g.length === 1 ? chip(g[0], level)
      : chip({ key: g[0].key, text: g.map((f) => f.text).join('\n'), n: g.length }, level)))}</span>`;
  }

  const tone = (v, good, warn) => (v === null ? 'none' : v >= good ? 'safe' : v >= warn ? 'warn' : 'crit');
  const arrow = (t, step) => (t === null || t === undefined || Math.abs(t) < step ? '' : t > 0 ? html`<span class="rv-tr up" title="Improving">▲</span>` : html`<span class="rv-tr dn" title="Falling">▼</span>`);

  // One horizontal meter: value fill, optional threshold tick, number on the right.
  function bar(label, ic, v, { tick = null, cls, trend = '', hint = '' } = {}) {
    const w = v === null ? 0 : Math.max(2, Math.min(100, v));
    return html`<div class="rv-bar ${cls}" title="${hint}"><span class="rv-bl">${icon(ic, 14)}${label}</span>
      <span class="rv-track"><span class="rv-fill" style="width:${w}%"></span>${tick !== null ? raw(`<span class="rv-tick" style="left:${tick}%"></span>`) : ''}</span>
      <span class="rv-val">${v === null ? html`<span class="muted">—</span>` : `${Math.round(v)}%`}${trend}</span></div>`;
  }
  function signalBars(s) {
    if (!s) return '';
    const T = s.threshold ?? 75;
    return html`<div class="rv-bars">
      ${bar('Attend.', 'calendar', s.attendance, { tick: T, cls: s.attendance === null ? 'none' : s.attendance < T ? 'crit' : s.attendance < T + 5 ? 'warn' : 'safe', trend: arrow(s.attendanceRecent !== null && s.attendance !== null ? s.attendanceRecent - s.attendance : null, 5), hint: `Required ${T}%` })}
      ${bar('Tests', 'clipboard', s.tests, { cls: tone(s.tests, 65, 55), trend: arrow(s.testsTrend, 5), hint: s.tests === null ? 'No marks yet' : 'Weighted test average' })}
      ${bar('Assign.', 'book', s.assignments, { cls: tone(s.assignments, 65, 55), trend: arrow(s.assignmentsTrend, 10), hint: s.assignments === null ? 'No marks yet' : 'Assignment average' })}</div>`;
  }

  // The single most useful attendance number: how many classes you can miss, or must attend.
  function attendanceCall(s) {
    if (!s || !s.conducted) return '';
    if (s.attendance < s.threshold) {
      const n = s.classesToRecover;
      return html`<div class="rv-call crit">${icon('alert', 16)}<span>Attend the next <b>${n ?? '?'}</b> class${n === 1 ? '' : 'es'} in a row to get back to ${s.threshold}%</span></div>`;
    }
    const n = s.safeMisses ?? 0;
    return n === 0 ? html`<div class="rv-call warn">${icon('alert', 16)}<span><b>Do not miss</b> the next class. One absence drops you below ${s.threshold}%</span></div>`
      : html`<div class="rv-call ${n <= 2 ? 'warn' : 'safe'}">${icon('check', 16)}<span>You can miss <b>${n}</b> more class${n === 1 ? '' : 'es'} and stay at ${s.threshold}% or above</span></div>`;
  }

  // Drag to see attendance after the next N classes.
  function whatIf(s) {
    if (!s || !s.conducted || s.attended === null) return '';
    const N = 10;
    return html`<div class="rv-whatif" data-a="${s.attended}" data-c="${s.conducted}" data-t="${s.threshold}" data-n="${N}">
      <div class="row between"><b class="small">What if, over the next ${N} classes, I attend</b><span class="rv-wi-out"></span></div>
      <input type="range" min="0" max="${N}" value="${N}" aria-label="Classes attended out of the next ${N}"></div>`;
  }
  function syncWhatIf(box) {
    const a = +box.dataset.a, c = +box.dataset.c, t = +box.dataset.t, n = +box.dataset.n;
    const k = +$('input', box).value; const p = ((a + k) / (c + n)) * 100; const ok = p >= t;
    $('.rv-wi-out', box).innerHTML = html`<b>${k}</b> of ${n} → <b class="${ok ? 'ok' : 'bad'}">${p.toFixed(1)}%</b> ${ok ? '✓ safe' : `✗ below ${t}%`}`.s;
  }
  document.addEventListener('input', (ev) => { const box = ev.target.closest && ev.target.closest('.rv-whatif'); if (box) syncWhatIf(box); });
  const wire = (root) => $$('.rv-whatif', root).forEach(syncWhatIf);

  // Attendance guidance is shown as one computed line, so the text recommendations skip it.
  const otherRecs = (c) => (c.recommendations || []).filter((r) => !(c.signals && c.signals.conducted && /class/i.test(r)));
  const ATT = new Set(['att_gap', 'att_decline']);
  // Short imperative actions for a course, most urgent first.
  function actions(c) {
    const s = c.signals; const out = [];
    if (s && s.conducted && c.factors.some((f) => ATT.has(f.key))) {
      if (s.attendance < s.threshold) out.push(`Attend the next ${s.classesToRecover ?? 'few'} classes without a break`);
      else if (!s.safeMisses) out.push('Do not miss the next class');
      else out.push(`Miss no more than ${s.safeMisses} class${s.safeMisses === 1 ? '' : 'es'}`);
    }
    return out.concat(otherRecs(c));
  }

  // A course as one tap-to-open row: name, level, meters and chips up front; details on expand.
  function courseRow(c, { open = false } = {}) {
    const s = c.signals;
    return html`<details class="rv-course ${LVL[c.level]}" id="rv-${c.offering_id}" data-level="${c.level}" ${open ? 'open' : ''}>
      <summary><span class="rv-dot"></span><span class="rv-name"><b>${c.name}</b><span class="small muted mono">${c.code}</span></span>
        ${signalBars(s)}<span class="rv-side">${c.factors.length ? chips(c.factors.slice(0, 2), c.level) : html`<span class="rv-chip normal">${icon('check', 13)}No issues</span>`}${riskBadge(c.level)}</span>
        <span class="rv-caret">${icon('arrow', 14)}</span></summary>
      <div class="rv-body">
        ${attendanceCall(s)}
        ${otherRecs(c).length ? html`<div class="rv-sec"><h4>Also do</h4>${otherRecs(c).map((r, i) => html`<div class="rv-step"><span>${i + 1}</span>${r}</div>`)}</div>` : ''}
        ${c.factors.length ? html`<div class="rv-sec"><h4>Why</h4><div class="rv-why">${c.factors.map((f) => html`<div>${chip(f, c.level)}<span class="small">${f.text}</span></div>`)}</div></div>` : ''}
        ${c.positives && c.positives.length ? html`<div class="rv-sec"><h4>Going well</h4><span class="rv-chips">${c.positives.map((p) => html`<span class="rv-chip normal" title="${p}">${icon('check', 13)}${p.replace(/\s*\(.*\)$/, '')}</span>`)}</span></div>` : ''}
        ${whatIf(s)}
        ${c.rules && c.rules.length ? html`<div class="small muted">Rule applied: ${c.rules.join('; ')}</div>` : ''}
        <div class="small muted">Assessed ${fmt.ago(c.assessedAt)}</div></div></details>`;
  }

  // Coloured tile per course; tapping one opens its row.
  const tiles = (courses) => html`<div class="rv-tiles">${courses.map((c) => html`<button class="rv-tile ${LVL[c.level]}" data-click="rvjump" data-id="${c.offering_id}" title="${c.name}: ${c.level}">
    <b>${c.code}</b><span>${SHORT[c.level]}</span></button>`)}</div>`;

  // Level counts that double as filter buttons.
  function counts(list, key = 'level', active = '') {
    const n = { High: 0, Attention: 0, Normal: 0 }; list.forEach((x) => { n[x[key]] = (n[x[key]] || 0) + 1; });
    return html`<div class="rv-counts">${[['', 'All', list.length], ['High', 'High risk', n.High], ['Attention', 'Watch', n.Attention], ['Normal', 'On track', n.Normal]]
      .map(([k, l, v]) => html`<button class="rv-count ${k ? LVL[k] : 'all'} ${active === k ? 'active' : ''}" data-click="rvfilter" data-l="${k}"><b>${v}</b><span>${l}</span></button>`)}</div>`;
  }
  function jump(root, id) {
    const d = $(`#rv-${id}`, root); if (!d) return;
    $$('.rv-course', root).forEach((x) => { if (x.hidden) x.hidden = false; });
    d.open = true; d.scrollIntoView({ behavior: 'smooth', block: 'center' }); d.classList.add('flash'); setTimeout(() => d.classList.remove('flash'), 1200);
  }
  function filter(root, el) {
    const l = el.dataset.l; $$('.rv-count', root).forEach((b) => b.classList.toggle('active', b === el));
    $$('.rv-course', root).forEach((d) => { d.hidden = !!l && d.dataset.level !== l; });
  }

  window.RiskViz = { ORDER, actions, chip, chips, signalBars, attendanceCall, whatIf, courseRow, tiles, counts, jump, filter, wire };
})();
