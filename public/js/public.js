/* Public pages: landing, about, support, university and college directory, and the sign-in experience. */
(function () {
  'use strict';
  const { html, raw, esc, $, $$, api, qs, route, go, state, store, bind, formData, toast, fmt, icon, loading, errorBox, wordmark } = App;

  const monogram = (text, accent, cls = '', logo = null) => {
    if (logo) return html`<span class="logo-mark ${cls} has-img"><img src="${logo}" alt="" loading="lazy"></span>`;
    const t = String(text).replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toUpperCase();
    return html`<span class="logo-mark ${cls} ${t.length > 4 ? 'long' : ''}" style="background:${accent || '#14234a'}">${t}</span>`;
  };

  // Map paths and state names from @svg-maps/india (CC BY 4.0).
  // India map: one dot inside every state and union territory, linked into a network. Tap a dot or a state to see its name.
  const HUB_STATES = new Set(['tn', 'ka', 'mh', 'dl', 'wb', 'kl', 'rj', 'tg', 'ga']); // states with institutions on nerd
  const indiaMap = () => {
    const m = window.IndiaMap;
    if (!m || !Array.isArray(m.paths) || !Array.isArray(m.states)) return raw('');
    const S = m.states;
    const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    // Spanning tree (Prim) keeps every state connected; each state also links to its nearest neighbour.
    const edges = new Set(), key = (i, j) => (i < j ? `${i}-${j}` : `${j}-${i}`);
    const inTree = new Set([0]);
    while (inTree.size < S.length) {
      let best = null;
      for (const i of inTree) S.forEach((q, j) => { if (!inTree.has(j)) { const v = d(S[i], q); if (!best || v < best[2]) best = [i, j, v]; } });
      edges.add(key(best[0], best[1])); inTree.add(best[1]);
    }
    S.forEach((p, i) => { const near = S.map((q, j) => [j, d(p, q)]).filter(([j]) => j !== i).sort((x, y) => x[1] - y[1]); near.slice(0, 2).forEach(([j, v]) => { if (v < 95) edges.add(key(i, j)); }); });
    const lines = [...edges].map((e) => { const [a, b] = e.split('-').map(Number); return `<line x1="${S[a].x}" y1="${S[a].y}" x2="${S[b].x}" y2="${S[b].y}" style="animation-delay:${((a % 7) * 0.4).toFixed(1)}s"/>`; }).join('');
    const states = m.paths.map((path, i) => `<path d="${path}" data-st="${i}"><title>${esc(S[i].name)}</title></path>`).join('');
    const dots = S.map((st, i) => { const hub = HUB_STATES.has(st.id);
      return `<g class="im-dot${hub ? ' hub' : ''}" data-st="${i}" tabindex="0" role="button" aria-label="${esc(st.name)}"><circle class="im-hit" cx="${st.x}" cy="${st.y}" r="13"/><circle class="im-core" cx="${st.x}" cy="${st.y}" r="${hub ? 5.5 : 3.6}" style="animation-delay:${((i % 9) * 0.3).toFixed(1)}s"/></g>`; }).join('');
    return raw(`<div class="im-wrap"><svg class="india-map" viewBox="${m.viewBox}" role="img" aria-label="Map of India with every state connected" preserveAspectRatio="xMidYMid meet">
      <g class="im-states">${states}</g><g class="im-net" stroke-linecap="round">${lines}</g><g class="im-dots">${dots}</g></svg>
      <div class="im-tip hidden" role="status"></div></div>`);
  };
  function wireIndiaMap(root) {
    const wrap = $('.im-wrap', root); if (!wrap || !window.IndiaMap) return;
    const tip = $('.im-tip', wrap), S = window.IndiaMap.states;
    let timer;
    const show = (i) => {
      const dot = $(`.im-dot[data-st="${i}"] .im-core`, wrap); if (!dot) return;
      $$('.im-on', wrap).forEach((n) => n.classList.remove('im-on'));
      $(`.im-states path[data-st="${i}"]`, wrap)?.classList.add('im-on'); dot.parentNode.classList.add('im-on');
      const r = dot.getBoundingClientRect(), w = wrap.getBoundingClientRect();
      tip.textContent = S[i].name;
      tip.style.left = `${r.left + r.width / 2 - w.left}px`; tip.style.top = `${r.top - w.top}px`;
      tip.classList.remove('hidden');
      clearTimeout(timer); timer = setTimeout(() => { tip.classList.add('hidden'); $$('.im-on', wrap).forEach((n) => n.classList.remove('im-on')); }, 2600);
    };
    wrap.addEventListener('click', (e) => { const t = e.target.closest('[data-st]'); if (t) show(t.dataset.st); });
    wrap.addEventListener('keydown', (e) => { const t = e.target.closest('.im-dot'); if (t && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); show(t.dataset.st); } });
  }

  function pubShell(inner, { flush = false } = {}) {
    $('#app').innerHTML = html`
      <header class="pub-top"><div class="inner">
        <a class="logo" href="#/" aria-label="nerd home">${wordmark(30)}</a>
        <nav aria-label="Site"><a href="#/universities">Institutions</a><a href="#/about" class="hide-sm">Platform</a><a href="#/contact" class="hide-sm">Support</a>
          ${state.me ? html`<a class="btn primary" href="${state.me.home}">Open my portal</a>` : html`<a class="btn primary" href="#/login">Sign in</a>`}</nav>
      </div></header>
      <div id="pub" class="${flush ? 'flush' : ''}">${inner}</div>
      <footer class="pub-foot"><div class="wrap row between wrap"><span class="row" style="gap:10px">${wordmark(22)}<span class="muted">Made for colleges across India</span></span>
        <span><a href="#/about">Platform</a> · <a href="#/contact">Support</a> · <a href="#/universities">Institutions</a> · <span class="muted">© ${new Date().getFullYear()} nerd</span></span></div></footer>`.s;
    return $('#pub');
  }

  route('/', async () => {
    const p = state.platform || {};
    const el = pubShell(html`
      <section class="hero hero-map"><div class="wrap hero-grid2">
        <div class="hero-copy">
          <h1>Your college, all in one place.</h1>
          <p class="hero-lead">Attendance, marks, timetables and campus life for students, teachers and college offices.</p>
          <div class="btn-row"><a class="btn primary lg" href="#/login">Sign in ${icon('arrow', 16)}</a><a class="btn lg" href="#/universities">Find your institution</a></div>
          <div class="hero-stats">
            <div><b>${fmt.num(p.stats?.universities)}</b><span>universities</span></div>
            <div><b>${fmt.num(p.stats?.colleges)}</b><span>colleges</span></div>
            <div><b>${fmt.num(p.stats?.students)}</b><span>students</span></div>
            <div><b>${fmt.num(p.stats?.staff)}</b><span>faculty</span></div>
          </div>
        </div>
        <div class="hero-map-art">${indiaMap()}</div>
      </div></section>
      <section class="section alt"><div class="wrap">
        <div class="section-head"><span class="kicker">Institutions</span><h2>Find your institution</h2></div>
        <div id="inst-strip" class="inst-strip">${loading(1)}</div>
      </div></section>`);
    wireIndiaMap(el);
    try {
      const r = await api.get('/api/public/universities');
      $('#inst-strip', el).innerHTML = html`${r.rows.filter((u) => u.active).map((u) => html`<a class="inst-pill" href="#/university/${u.id}">${monogram(u.code, u.accent, 'sm', u.logo)}<span><b>${u.short_name}</b><small>${u.colleges} college${u.colleges === 1 ? '' : 's'} · ${u.location}</small></span></a>`)}`.s;
    } catch (e) { errorBox($('#inst-strip', el), e); }
  });

  route('/about', async () => {
    pubShell(html`<div class="wrap select-page narrow"><span class="kicker">Platform</span><h1>How nerd works</h1>
      <p class="lead muted" style="margin-top:8px">One place for students, teachers and the college office.</p>
      <div class="card card-pad stack" style="margin-top:18px">
        <div><h3>Your records stay yours</h3><p class="muted">Students see only their own records. Teachers see the classes they teach, and admins see their own college.</p></div>
        <div><h3>Early warnings</h3><p class="muted">When attendance or marks start slipping, nerd says why and what to do next.</p></div>
        <div><h3>Marks by voice</h3><p class="muted">Teachers can read marks out loud. Every value is shown before it is saved.</p></div>
        <div><h3>Campus guide</h3><p class="muted">Maps, walking routes, live GPS and events for each campus.</p></div>
        <div><h3>Sample data</h3><p class="muted">College names are real. Every person and record here is made up.</p></div>
      </div></div>`);
  });

  route('/contact', async () => {
    pubShell(html`<div class="wrap select-page narrow"><span class="kicker">Support</span><h1>How can we help?</h1>
      <p class="muted" style="margin-top:8px">Students and teachers, please contact your college office first.</p>
      <form class="card card-pad" data-submit="send" style="margin-top:18px">
        <div class="form-grid"><div class="field"><label for="c-name">Name</label><input class="input" id="c-name" name="name" required maxlength="80" autocomplete="name"></div>
        <div class="field"><label for="c-email">Email</label><input class="input" id="c-email" name="email" type="email" required autocomplete="email"></div>
        <div class="field full"><label for="c-inst">Institution</label><input class="input" id="c-inst" name="inst" maxlength="120"></div>
        <div class="field full"><label for="c-msg">Message</label><textarea class="input" id="c-msg" name="msg" required maxlength="2000"></textarea></div></div>
        <button class="btn primary">Send request</button>
      </form></div>`);
    bind($('#pub'), { send: async (f) => { try { const r = await api.post('/api/public/support', formData(f)); f.reset(); toast(`Request ${r.reference} received. The platform team will reply by email.`, 'success'); } catch (e) { toast(e.message, 'error'); } } });
  });

  // ---------- institution directory ----------
  route('/universities', async (p, q) => {
    const el = pubShell(html`<div class="wrap select-page">
      <div class="page-head"><div><span class="kicker">Institutions</span><h1>Find your university</h1><p>Choose the university your college belongs to.</p></div></div>
      <div class="row wrap filter-row"><div class="search-input grow" style="min-width:240px">${icon('search', 16)}<input class="input" id="u-q" value="${q.q || ''}" aria-label="Search universities by name, code or location"></div>
        <select class="input" id="u-type" style="width:auto" aria-label="University type"><option value="">All types</option></select></div>
      <div id="u-list">${loading(3)}</div></div>`);
    let t;
    async function load() {
      const box = $('#u-list', el);
      try {
        const r = await api.get('/api/public/universities' + qs({ q: $('#u-q').value, type: $('#u-type').value, status: 'active' }));
        const sel = $('#u-type');
        if (sel.options.length === 1) r.types.forEach((ty) => sel.add(new Option(ty, ty)));
        box.innerHTML = r.rows.length ? html`<div class="grid g2">${r.rows.map((u) => html`<button class="card inst-card" data-click="pick" data-id="${u.id}">
          ${monogram(u.code, u.accent, '', u.logo)}<div class="grow"><h3>${u.name}</h3>
          <div class="meta">${icon('pin', 13)} ${u.location}${u.established ? html` · Est. ${u.established}` : ''}</div><div class="meta">${u.affiliation || u.type || ''}</div>
          <div class="meta"><b>${u.colleges}</b> college${u.colleges === 1 ? '' : 's'} on nerd</div></div>${icon('arrow', 16)}</button>`)}</div>`.s : html`<div class="card empty"><b>No universities match your search.</b>Try a different name or clear the filter.</div>`.s;
      } catch (e) { errorBox(box, e, load); }
    }
    $('#u-q').addEventListener('input', () => { clearTimeout(t); t = setTimeout(load, 200); });
    $('#u-type').addEventListener('change', load);
    bind(el, { pick: (b) => go(`#/university/${b.dataset.id}`) });
    load();
  });

  route('/university/:id', async (p) => {
    const el = pubShell(html`<div class="wrap select-page" id="c-page">${loading(3)}</div>`);
    let t;
    const load = (qv = '') => api.get(`/api/public/universities/${p.id}` + qs({ q: qv }));
    try {
      const r = await load();
      const u = r.university;
      $('#c-page').innerHTML = html`<nav class="crumbs" aria-label="Breadcrumb"><a href="#/universities">Institutions</a> / <b>${u.short_name}</b></nav>
        <div class="card uni-head">${monogram(u.code, u.accent, 'lg', u.logo)}<div class="grow"><h1>${u.name}</h1><div class="muted">${u.location}${u.established ? ` · Established ${u.established}` : ''} · ${u.affiliation || u.type || ''}</div></div></div>
        <div class="page-head"><div><h2>Select your college</h2><p>${r.colleges.length} institution${r.colleges.length === 1 ? '' : 's'} of ${u.short_name} on nerd.</p></div></div>
        <div class="row wrap filter-row"><div class="search-input grow">${icon('search', 16)}<input class="input" id="c-q" aria-label="Search colleges by name, code or location"></div>
          <select class="input" id="c-prog" style="width:auto" aria-label="Department"><option value="">All departments</option></select></div>
        <div id="c-list"></div>`.s;
      [...new Set(r.colleges.flatMap((c) => c.departments))].sort().forEach((d) => $('#c-prog').add(new Option(d, d)));
      const draw = (cols) => {
        const pf = $('#c-prog').value;
        const list = pf ? cols.filter((c) => c.departments.includes(pf)) : cols;
        $('#c-list').innerHTML = list.length ? html`<div class="grid g2">${list.map((c) => html`<div class="card inst-card ${c.active ? '' : 'inactive'}">
          ${monogram(c.short_name, c.accent, '', c.logo)}<div class="grow"><h3>${c.name}</h3><div class="meta">${icon('pin', 13)} ${c.location}${c.established ? html` · Est. ${c.established}` : ''}</div>
          <div class="meta">${c.category || ''}</div>
          <div class="meta">${c.programmes.map((pp) => pp.name).join(' · ') || ''}</div>
          <div class="btn-row" style="margin-top:10px"><button class="btn primary sm" data-click="pick" data-id="${c.id}">Sign in</button>${c.campus_guide ? html`<a class="btn sm" href="#/campus/${c.id}">${icon('compass', 15)} Campus guide</a>` : ''}</div></div></div>`)}</div>`.s
          : html`<div class="card empty"><b>No colleges match.</b></div>`.s;
      };
      draw(r.colleges);
      $('#c-q').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(async () => draw((await load(e.target.value)).colleges), 200); });
      $('#c-prog').addEventListener('change', async () => draw((await load($('#c-q').value)).colleges));
      bind(el, { pick: (b) => go(`#/college/${b.dataset.id}/login`) });
    } catch (e) { errorBox($('#c-page'), e, () => App.render()); }
  });

  // ---------- sign in ----------
  const PORTALS = [
    { key: 'student', title: 'Student', sub: 'Attendance, marks and risk', icon: 'grad', label: 'Roll number or email', auto: 'username' },
    { key: 'staff', title: 'Faculty', sub: 'Courses, marks and analytics', icon: 'book', label: 'Employee ID or email', auto: 'username' },
    { key: 'admin', title: 'Administrator', sub: 'Institution management', icon: 'shield', label: 'Administrator ID or email', auto: 'username' },
  ];

  function authShell(c) {
    $('#app').innerHTML = html`<div class="auth">
      <aside class="auth-side">
        <a href="#/" class="auth-brand" aria-label="nerd home">${wordmark(38, 'For colleges across India', true)}</a>
        <div class="auth-copy">
          <h1>Every class, every mark,<br><em>every student understood.</em></h1>
          <p>Attendance prediction, explainable risk and voice-first mark entry for universities and colleges.</p>
          ${c ? html`<div class="auth-inst">${monogram(c.short_name, c.accent, '', c.logo)}<div><b>${c.name}</b><span>${c.university_name}${c.location ? ` · ${c.location}` : ''}</span></div></div>` : ''}
        </div>
        <div class="auth-steps">
          <div>${icon('calendar', 18)}<span><b>Monitor</b>Attendance and marks</span></div>
          <div>${icon('chart', 18)}<span><b>Predict</b>Shortfalls and risk</span></div>
          <div>${icon('users', 18)}<span><b>Support</b>Timely interventions</span></div>
        </div>
      </aside>
      <main class="auth-main">
        <div class="auth-top">
          ${c?.campusGuide ? html`<a class="btn pill" href="#/campus/${c.id}">${icon('compass', 16)} Campus guide</a>` : ''}
          <a class="btn pill" href="#/universities">${icon('building', 16)} Institutions</a>
        </div>
        <div class="auth-center">
          <div class="auth-card card" id="auth-card"></div>
          <p class="auth-foot">Sessions are encrypted and expire automatically. <a href="#/contact">Need help?</a></p>
        </div>
      </main></div>`.s;
    return $('#auth-card');
  }

  // Sign-in without a chosen institution: an institution finder that searches every college and university.
  route('/login', async () => {
    const card = authShell(store.get('college') ? null : null);
    const remembered = store.get('college');
    card.innerHTML = html`<span class="kicker">Sign in</span><h2 class="auth-title">Welcome to nerd</h2><p class="muted">Start by finding your institution.</p>
      ${remembered ? html`<button class="recent-inst" data-click="recent">${icon('clock', 16)}<span><small>Recently used</small><b>${remembered.name}</b></span>${icon('arrow', 16)}</button>` : ''}
      <div class="field" style="margin-top:14px"><label for="inst-q">Institution</label>
        <div class="search-input combo">${icon('search', 16)}<input class="input lg" id="inst-q" autocomplete="off" role="combobox" aria-expanded="false" aria-controls="inst-res" aria-autocomplete="list"></div>
        <div class="hint">Search by college, university, code or city.</div></div>
      <div id="inst-res" class="inst-results" role="listbox"></div>
      <a class="btn ghost block" href="#/universities" style="margin-top:6px">Browse all universities ${icon('arrow', 16)}</a>`.s;
    let t; let active = -1; let rows = [];
    const input = $('#inst-q');
    const draw = () => {
      $('#inst-res').innerHTML = html`${rows.map((c, i) => html`<button role="option" aria-selected="${i === active}" class="inst-opt ${i === active ? 'active' : ''}" data-click="choose" data-id="${c.id}">${monogram(c.short_name, c.accent, 'sm', c.logo)}<span><b>${c.name}</b><small>${c.university} · ${c.location}</small></span></button>`)}${input.value && !rows.length ? html`<div class="muted small" style="padding:10px">No institution matches “${input.value}”.</div>` : ''}`.s;
      input.setAttribute('aria-expanded', rows.length ? 'true' : 'false');
    };
    const search = async () => { rows = await api.get('/api/public/institutions' + qs({ q: input.value })); active = rows.length ? 0 : -1; draw(); };
    input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(search, 150); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(rows.length - 1, active + 1); draw(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); draw(); }
      if (e.key === 'Enter' && rows[active]) { e.preventDefault(); go(`#/college/${rows[active].id}/login`); }
    });
    bind(card, { choose: (b) => go(`#/college/${b.dataset.id}/login`), recent: () => go(`#/college/${remembered.id}/login`) });
    input.focus();
    search();
  });

  route('/college/:id/login', async (p, q) => {
    let c;
    const tmp = authShell(null);
    tmp.innerHTML = loading(3).s || '';
    try { c = await api.get(`/api/public/colleges/${p.id}`); } catch (e) { return errorBox(tmp, e, () => App.render()); }
    store.set('college', { id: c.id, name: c.name, university: c.university_name });
    const card = authShell(c);
    let type = PORTALS.some((x) => x.key === q.as) ? q.as : 'student';
    let mode = 'password'; // password | otp | forgot
    let showPw = false;
    let remember = false;
    const portal = () => PORTALS.find((x) => x.key === type);
    const draw = () => {
      const P = portal();
      card.innerHTML = html`
        <div class="auth-inst-chip">${monogram(c.short_name, c.accent, 'xs', c.logo)}<span>${c.short_name}</span><a href="#/login">Change</a></div>
        <span class="kicker">${mode === 'forgot' ? 'Account recovery' : `${P.title} access`}</span>
        <h2 class="auth-title">${mode === 'forgot' ? 'Reset your password' : 'Welcome back'}</h2>
        <p class="muted">${mode === 'forgot' ? 'We will send a verification code to the email registered with your account.' : 'Choose the portal you want to open.'}</p>
        <div class="portal-tabs" role="tablist" aria-label="Portal">${PORTALS.map((x) => html`<button type="button" role="tab" aria-selected="${x.key === type}" class="${x.key === type ? 'active' : ''}" data-click="type" data-type="${x.key}">
          <span class="pi">${icon(x.icon, 18)}</span><span><b>${x.title}</b></span></button>`)}</div>
        <form data-submit="submit" novalidate>
          <div class="field"><label for="l-id">${P.label}</label><input class="input lg" id="l-id" name="loginId" autocomplete="${P.auto}" required autocapitalize="none" spellcheck="false"></div>
          ${mode === 'password' ? html`
            <div class="field"><div class="row between"><label for="l-pw">Password</label><a href="#" data-click="mode" data-mode="forgot" class="small">Forgot password?</a></div>
              <div class="pw-wrap"><input class="input lg" id="l-pw" name="password" type="${showPw ? 'text' : 'password'}" autocomplete="current-password" required><button type="button" class="pw-toggle" data-click="togglePw" aria-label="${showPw ? 'Hide password' : 'Show password'}">${icon(showPw ? 'eyeoff' : 'eye', 18)}</button></div></div>
            <label class="checkbox" style="margin:2px 0 16px"><input type="checkbox" name="remember" data-change="remember" ${remember ? 'checked' : ''}> Keep me signed in on this device</label>
            <button class="btn primary block xl" id="l-submit">Continue as ${P.title.toLowerCase()} ${icon('arrow', 17)}</button>
            <div class="or-line"><span>or</span></div>
            <button type="button" class="btn block lg" data-click="mode" data-mode="otp">${icon('lock', 16)} Sign in with a one-time code</button>`
    : html`
            <div class="field"><label for="l-code">${mode === 'otp' ? 'One-time code' : 'Verification code'}</label><div class="row"><input class="input lg" id="l-code" name="code" inputmode="numeric" maxlength="6" autocomplete="one-time-code"><button type="button" class="btn lg" data-click="sendCode" data-purpose="${mode === 'otp' ? 'login' : 'reset'}">Send code</button></div><div class="hint" id="otp-hint"></div></div>
            ${mode === 'forgot' ? html`<div class="field"><label for="l-new">New password</label><input class="input lg" id="l-new" name="newPassword" type="password" autocomplete="new-password" minlength="8"><div class="hint">At least 8 characters with letters and numbers.</div></div>`
    : html`<label class="checkbox" style="margin:2px 0 16px"><input type="checkbox" name="remember" data-change="remember" ${remember ? 'checked' : ''}> Keep me signed in on this device</label>`}
            <button class="btn primary block xl">${mode === 'otp' ? 'Verify and sign in' : 'Reset password'} ${icon('arrow', 17)}</button>
            <button type="button" class="btn ghost block" style="margin-top:8px" data-click="mode" data-mode="password">${icon('back', 16)} Back to password sign-in</button>`}
          <div id="l-err" class="alert critical hidden" role="alert" style="margin-top:14px"><div class="ico">!</div><div id="l-err-t"></div></div>
        </form>`.s;
    };
    draw();
    $('#l-id').focus();
    const showErr = (m) => { $('#l-err-t').textContent = m; $('#l-err').classList.remove('hidden'); };
    const keep = (fn) => { const id = $('#l-id').value; fn(); draw(); $('#l-id').value = id; ($('#l-pw') || $('#l-code') || $('#l-id')).focus(); };
    bind(card, {
      type: (b) => keep(() => { type = b.dataset.type; }),
      mode: (b) => keep(() => { mode = b.dataset.mode; }),
      remember: (b) => { remember = b.checked; },
      togglePw: () => { const pw = $('#l-pw').value; keep(() => { showPw = !showPw; }); $('#l-pw').value = pw; $('#l-pw').focus(); },
      sendCode: async (b) => {
        const loginId = $('#l-id').value.trim();
        if (!loginId) return showErr('Enter your login ID first.');
        try {
          const r = await api.post('/api/auth/otp/request', { collegeId: c.id, type, loginId, purpose: b.dataset.purpose });
          // With SMTP configured the code is emailed; otherwise it is shown here, labelled dev mode.
          $('#otp-hint').innerHTML = html`${r.message}${r.devCode ? html` <span class="code-chip">Dev code: <b>${r.devCode}</b></span>` : ''}`.s;
          $('#l-code').focus();
        } catch (e) { showErr(e.message); }
      },
      submit: async (f) => {
        const d = formData(f);
        $('#l-err').classList.add('hidden');
        if (!d.loginId) return showErr(`Enter your ${portal().label.toLowerCase()}.`);
        const btn = $('button.primary', f); btn.disabled = true;
        try {
          let r;
          if (mode === 'password') { if (!d.password) { btn.disabled = false; return showErr('Enter your password.'); } r = await api.post('/api/auth/login', { collegeId: c.id, type, loginId: d.loginId, password: d.password, remember }); }
          else if (mode === 'otp') r = await api.post('/api/auth/otp/verify', { collegeId: c.id, type, loginId: d.loginId, code: d.code, remember });
          else { await api.post('/api/auth/reset', { collegeId: c.id, type, loginId: d.loginId, code: d.code, newPassword: d.newPassword }); toast('Password updated. Sign in with your new password.', 'success'); mode = 'password'; draw(); return; }
          await App.loadMe();
          go(r.home);
        } catch (e) { showErr(e.message); btn.disabled = false; }
      },
    });
  });

  route('/account/password', async () => {
    const v = App.shell(null, html`<div class="page-head"><div><h1>Change password</h1></div></div>
      <form class="card card-pad" style="max-width:460px" data-submit="save">
        <div class="field"><label>Current password</label><input class="input" type="password" name="currentPassword" required autocomplete="current-password"></div>
        <div class="field"><label>New password</label><input class="input" type="password" name="newPassword" required minlength="8" autocomplete="new-password"><div class="hint">At least 8 characters with letters and numbers.</div></div>
        <button class="btn primary">Update password</button></form>`);
    bind(v, { save: async (f) => { try { await api.post('/api/auth/change-password', formData(f)); toast('Password updated.', 'success'); f.reset(); } catch (e) { toast(e.message, 'error'); } } });
  }, { roles: ['student', 'staff', 'super_admin', 'university_admin', 'college_admin', 'department_admin'] });

  window.PublicViews = { monogram };
  void raw;
})();
