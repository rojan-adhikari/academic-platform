/* Campus guide administration (KPR Compass staff workspace): edit a local draft of the guide data, then publish it.
   Routes: #/admin/campus (college picker or redirect) and #/admin/campus/:cid. */
(function () {
  'use strict';
  const { html, raw, $, $$, api, route, state, bind, formData, fmt, icon, shell, loading, errorBox, toast, modal, confirmBox } = App;
  const R = { roles: ['super_admin', 'university_admin', 'college_admin', 'department_admin'] };
  const ANCHORS = ['admin', 'mechanical', 'kalaiarangam'];
  const DEFAULT_MAP = '/assets/compass/kpriet-campus-layout.webp';
  const TABS = [['overview', 'Overview', 'home'], ['events', 'Events', 'calendar'], ['directory', 'Departments & cabins', 'building'], ['map', 'Map & paths', 'map'],
    ['facilities', 'Facilities', 'pin'], ['alerts', 'Alerts', 'alert'], ['visitors', 'Visitor check-in', 'users'], ['data', 'Import & QR', 'qr']];
  const NODE_KINDS = ['place', 'building', 'venue', 'entrance', 'start', 'junction', 'landmark', 'food', 'parking', 'restroom', 'library', 'hostel', 'sports', 'medical', 'help'];
  const FACILITY_KINDS = ['food', 'parking', 'restroom', 'library', 'medical', 'water', 'atm', 'help', 'place'];
  const STATUS = [['registered', 'Registered'], ['checked_in', 'Checked in'], ['cancelled', 'Cancelled']];
  const MODE_HINT = { select: 'Click a pin to select it.', add: 'Click anywhere on the map to add a point there.', move: 'Click the map to move the selected point.' };

  const can = () => (state.me.permissions || []).includes('manage_campus_guide');
  const multiCollege = () => ['super_admin', 'university_admin'].includes(state.me.role);
  const clone = (o) => (typeof structuredClone === 'function' ? structuredClone(o) : JSON.parse(JSON.stringify(o)));
  const hex = (n) => { const a = new Uint8Array(Math.ceil(n / 2)); crypto.getRandomValues(a); return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('').slice(0, n); };
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}`);
  const slug = (s) => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  const sel = (a, b) => (String(a) === String(b) ? 'selected' : '');
  const chk = (v) => (v ? 'checked' : '');
  const cssId = (v) => (window.CSS && CSS.escape ? CSS.escape(v) : String(v).replace(/["\\]/g, '\\$&'));
  const localInput = (iso) => { if (!iso) return ''; const d = new Date(iso); if (Number.isNaN(d.getTime())) return ''; return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
  function timeLabel(start, end) {
    if (!start) return '';
    const s = new Date(start), e = end ? new Date(end) : null;
    const day = s.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    const t = (d) => d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
    if (!e) return `${day}, ${t(s)}`;
    return e.toDateString() === s.toDateString() ? `${day}, ${t(s)} – ${t(e)}` : `${day}, ${t(s)} – ${e.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}, ${t(e)}`;
  }
  function download(name, blob) { const u = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 1500); }

  // ---------- module state: the draft survives navigation within the app ----------
  let S = null;
  const isDirty = () => !!S && !!S.base && !!S.draft && JSON.stringify(S.draft) !== JSON.stringify(S.base);
  window.addEventListener('beforeunload', (e) => { if (isDirty()) { e.preventDefault(); e.returnValue = ''; } });
  window.addEventListener('hashchange', () => { if (!/^#\/admin\/campus\//.test(location.hash)) stopScan(); });

  // ---------- data checks (mirror CompassData.validCampus with readable messages) ----------
  function problems(d) {
    const out = [];
    if (!d || typeof d !== 'object' || Array.isArray(d)) return ['The file is not a campus guide dataset.'];
    for (const k of ['nodes', 'edges', 'events', 'facilities', 'alerts']) if (!Array.isArray(d[k])) out.push(`The dataset needs a "${k}" list.`);
    if (out.length) return out;
    if (typeof d.mapName !== 'string') out.push('The map needs a name.');
    if (typeof d.verified !== 'boolean') out.push('The "verified" flag must be true or false.');
    if (!d.nodes.length) out.push('Add at least one map point.');
    const ids = new Set(); const node = new Set(d.nodes.map((n) => n && n.id));
    for (const n of d.nodes) {
      const label = n.name || n.id || 'A map point';
      if (!n.id || typeof n.id !== 'string') out.push(`${label} has no ID.`); else if (ids.has(n.id)) out.push(`Map point ID "${n.id}" is used twice.`); ids.add(n.id);
      if (typeof n.name !== 'string') out.push(`${label} needs a name.`);
      if (!Number.isFinite(n.x) || n.x < 0 || n.x > 100 || !Number.isFinite(n.y) || n.y < 0 || n.y > 100) out.push(`${label}: X and Y must be between 0 and 100.`);
      if (!Number.isInteger(n.floor)) out.push(`${label}: floor must be a whole number.`);
      if ((n.lat !== undefined && !Number.isFinite(n.lat)) || (n.lon !== undefined && !Number.isFinite(n.lon))) out.push(`${label}: latitude and longitude must be numbers.`);
      if (n.aliases !== undefined && !(Array.isArray(n.aliases) && n.aliases.every((a) => typeof a === 'string'))) out.push(`${label}: aliases must be a list of words.`);
    }
    const name = (id) => d.nodes.find((n) => n.id === id)?.name || id;
    for (const e of d.edges) {
      if (typeof e.id !== 'string') out.push('A path has no ID.');
      if (!node.has(e.from) || !node.has(e.to)) out.push(`Path ${name(e.from)} → ${name(e.to)} links a point that does not exist.`);
      if (!Number.isFinite(e.meters) || e.meters <= 0) out.push(`Path ${name(e.from)} → ${name(e.to)} needs a length above 0 m.`);
    }
    if (d.rooms !== undefined && !Array.isArray(d.rooms)) out.push('"rooms" must be a list.');
    const rooms = Array.isArray(d.rooms) ? d.rooms : [];
    const rid = new Set();
    for (const r of rooms) {
      const label = r.name || 'A room';
      if (rid.has(r.id)) out.push(`Room ID "${r.id}" is used twice.`); rid.add(r.id);
      if (node.has(r.id)) out.push(`${label}: its ID clashes with a map point.`);
      if (['id', 'name', 'department', 'roomNumber', 'directions'].some((k) => typeof r[k] !== 'string')) out.push(`${label}: fill in the name, department, room number and directions fields.`);
      if (!(r.floor === null || Number.isInteger(r.floor))) out.push(`${label}: floor must be a whole number or blank.`);
      if (typeof r.verified !== 'boolean') out.push(`${label}: the verified flag must be true or false.`);
      if (!node.has(r.building)) out.push(`${label}: choose the building it is in.`);
      if (r.checkpoint !== undefined && !node.has(r.checkpoint)) out.push(`${label}: its QR checkpoint no longer exists.`);
    }
    const evIds = new Set();
    for (const e of d.events) {
      const label = e.title ? `Event “${e.title}”` : 'An event';
      if (evIds.has(e.id)) out.push(`Event ID "${e.id}" is used twice.`); evIds.add(e.id);
      if (typeof e.title !== 'string' || !e.title.trim()) out.push(`${label} needs a name.`);
      if (typeof e.time !== 'string' || typeof e.instructions !== 'string') out.push(`${label}: time and entry instructions must be text.`);
      if (!node.has(e.venue) && !rooms.some((r) => r.id === e.venue && r.verified)) out.push(`${label} needs a venue (a map point or a verified room).`);
      if (e.startsAt !== undefined && !Number.isFinite(Date.parse(e.startsAt))) out.push(`${label}: the start time is not a valid date.`);
      if (e.endsAt !== undefined && !Number.isFinite(Date.parse(e.endsAt))) out.push(`${label}: the end time is not a valid date.`);
      if (e.startsAt && e.endsAt && Date.parse(e.endsAt) <= Date.parse(e.startsAt)) out.push(`${label} ends before it starts.`);
      if (e.description !== undefined && (typeof e.description !== 'string' || e.description.length > 1000)) out.push(`${label}: the description must be under 1000 characters.`);
      if (['titleTa', 'descriptionTa', 'instructionsTa', 'timeTa'].some((k) => e[k] !== undefined && (typeof e[k] !== 'string' || e[k].length > 1000))) out.push(`${label}: Tamil text fields must be under 1000 characters.`);
      if (e.posterUrl !== undefined && !/^\/api\/campus\/files\/[a-f0-9-]{36}$/.test(e.posterUrl)) out.push(`${label}: upload the poster again.`);
    }
    for (const f of d.facilities) if (typeof f.id !== 'string' || typeof f.name !== 'string' || !node.has(f.node)) out.push(`Facility “${f.name || f.id}” needs a map point.`);
    for (const a of d.alerts) if (typeof a.id !== 'string' || typeof a.message !== 'string') out.push('Every alert needs a message.');
    if (!out.length && !CompassData.validCampus(d)) out.push('The map data failed validation. Check points, paths, venues and the required lists.');
    return [...new Set(out)];
  }

  // ---------- images ----------
  async function resizeImage(file, max) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Choose a JPEG, PNG or WebP image.');
    if (file.size > 25_000_000) throw new Error('That image is too large. Use one under 25 MB.');
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Could not read that image.')); i.src = url; });
      const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
      let data = c.toDataURL('image/webp', 0.86);
      if (!data.startsWith('data:image/webp')) data = c.toDataURL('image/jpeg', 0.86);
      return data;
    } finally { URL.revokeObjectURL(url); }
  }
  async function uploadImage(file, kind) {
    const image = await resizeImage(file, kind === 'map' ? 2400 : 1600);
    return (await api.post(`/api/campus/${S.cid}/upload`, { kind, image })).url;
  }

  // ---------- QR ----------
  function qrCanvas(text, title, sub) {
    const q = qrcode(0, 'M'); q.addData(text); q.make();
    const n = q.getModuleCount(), quiet = 4, cell = Math.max(6, Math.floor(600 / (n + quiet * 2)));
    const size = (n + quiet * 2) * cell, foot = 116;
    const c = document.createElement('canvas'); c.width = size; c.height = size + foot;
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#000';
    for (let r = 0; r < n; r++) for (let col = 0; col < n; col++) if (q.isDark(r, col)) g.fillRect((col + quiet) * cell, (r + quiet) * cell, cell, cell);
    g.fillStyle = '#14234a'; g.textAlign = 'center';
    let fs = 30; g.font = `700 ${fs}px Inter, Arial, sans-serif`;
    while (g.measureText(title).width > size - 40 && fs > 16) { fs -= 2; g.font = `700 ${fs}px Inter, Arial, sans-serif`; }
    g.fillText(title, size / 2, size + 30);
    g.fillStyle = '#3c4a58'; g.font = '500 20px Inter, Arial, sans-serif'; g.fillText(sub, size / 2, size + 66);
    g.fillStyle = '#f2b33d'; g.fillRect(size / 2 - 40, size + 88, 80, 6);
    return c;
  }
  const qrLink = (id, kind) => `${location.origin}/#/campus/${S.cid}?${kind}=${encodeURIComponent(id)}`;
  const qrFor = (node, kind) => qrCanvas(qrLink(node.id, kind), node.name, kind === 'checkpoint' ? `You are here · code ${node.id}` : `Scan for directions · ${S.info.college.short_name}`);
  function downloadQr(node, kind) {
    qrFor(node, kind).toBlob((b) => { if (b) download(`qr-${kind === 'to' ? 'directions' : 'checkpoint'}-${node.id}.png`, b); else toast('Could not create the QR image.', 'error'); }, 'image/png');
  }

  // ---------- scanner (BarcodeDetector, or ZXing loaded on demand) ----------
  let scanStop = null;
  function stopScan() {
    if (scanStop) { try { scanStop(); } catch { /* already stopped */ } scanStop = null; }
    const v = $('#ca-video'); if (v) v.classList.add('hidden');
    const b = $('[data-click="scan"]'); if (b) b.innerHTML = html`${icon('camera', 16)} Scan`.s;
  }
  function loadZXing() {
    if (window.ZXing) return Promise.resolve();
    return new Promise((res, rej) => { const s = document.createElement('script'); s.src = '/js/vendor/zxing.min.js'; s.onload = () => res(); s.onerror = () => rej(new Error('Could not load the scanner. Enter the code manually.')); document.head.appendChild(s); });
  }
  async function startScan(video, onCode) {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera unavailable on this device. Enter the badge code manually.');
    const constraints = { video: { facingMode: { ideal: 'environment' } }, audio: false };
    if ('BarcodeDetector' in window) {
      let formats; try { formats = await window.BarcodeDetector.getSupportedFormats(); } catch { formats = null; }
      const det = new window.BarcodeDetector(formats && formats.length ? { formats } : undefined);
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      let alive = true;
      scanStop = () => { alive = false; stream.getTracks().forEach((t) => t.stop()); video.srcObject = null; };
      video.srcObject = stream; await video.play();
      const tick = async () => {
        if (!alive) return;
        try { const r = await det.detect(video); if (r && r[0] && r[0].rawValue) { onCode(r[0].rawValue); stopScan(); return; } } catch { /* frame not ready */ }
        setTimeout(tick, 220);
      };
      tick();
    } else {
      await loadZXing();
      const reader = new window.ZXing.BrowserMultiFormatReader();
      scanStop = () => reader.reset();
      await reader.decodeFromConstraints(constraints, video, (res) => { if (res) { onCode(res.getText()); stopScan(); } });
    }
  }

  const noPermission = () => html`<div class="card error-state"><b>Campus guide management is not part of your role.</b><p class="muted">Ask your college administrator for the campus guide permission.</p></div>`;

  // ================= college picker =================
  route('/admin/campus', async () => {
    const v = shell('#/admin/campus');
    if (!can()) { v.innerHTML = noPermission().s; return; }
    if (!multiCollege()) { location.replace(`#/admin/campus/${state.me.college.id}`); return; }
    try {
      const scope = await api.get('/api/admin/scope');
      const flags = new Map();
      await Promise.all(scope.universities.map(async (u) => {
        try { const r = await api.get(`/api/public/universities/${u.id}`); r.colleges.forEach((c) => flags.set(c.id, !!c.campus_guide)); } catch { /* unknown */ }
      }));
      const groups = new Map();
      for (const c of scope.colleges) { if (!groups.has(c.university)) groups.set(c.university, []); groups.get(c.university).push(c); }
      const live = scope.colleges.filter((c) => flags.get(c.id)).length;
      v.innerHTML = html`<div class="page-head"><div><h1>Campus guide</h1><p>Pick a college to edit its map, events and venues. ${live} of ${scope.colleges.length} colleges have a guide.</p></div></div>
        ${[...groups].map(([u, list]) => html`<section class="ca-pick-group"><h4>${u}</h4><div class="ca-pick-grid">${list.map((c) => html`
          <a class="card ca-pick" href="#/admin/campus/${c.id}"><span class="ca-pick-ico ${flags.get(c.id) ? 'on' : ''}">${icon('compass', 20)}</span>
            <span class="grow"><b>${c.short_name}</b><small>${c.name}</small></span>
            ${flags.get(c.id) ? html`<span class="badge safe">Guide live</span>` : html`<span class="badge plain">Not set up</span>`}</a>`)}</div></section>`)}`.s;
    } catch (e) { errorBox(v, e, () => App.render()); }
  }, R);

  // ================= editor =================
  route('/admin/campus/:cid', async (p, q) => {
    const v = shell('#/admin/campus');
    if (!can()) { v.innerHTML = noPermission().s; return; }
    const cid = Number(p.cid);
    const keep = S && S.cid === cid && S.uid === state.me.id && S.base;
    if (!keep) { stopScan(); S = { cid, uid: state.me.id, tab: 'overview', floor: 0, mode: 'select', selNode: null, rosterEvent: '', nodeQ: '', edgeQ: '', qrQ: '' }; }
    if (q.tab && TABS.some((t) => t[0] === q.tab)) S.tab = q.tab;
    v.innerHTML = loading(5).s;
    try {
      const info = await api.get(`/api/campus/${cid}/admin`);
      S.info = info;
      if (!info.enabled) { renderEnable(v); return; }
      const dirty = keep && isDirty();
      S.stale = dirty && S.base.version !== info.data.version ? info.data.version : null;
      if (!dirty) { S.base = info.data; S.draft = clone(info.data); }
      S.roster = null; S.visitors = null; S.ids = null;
      renderEditor(v);
    } catch (e) { errorBox(v, e, () => App.render()); }
  }, R);

  function renderEnable(v) {
    const c = S.info.college;
    v.innerHTML = html`<div class="page-head"><div><h1>Campus guide · ${c.short_name}</h1><p>${c.name}</p></div>${multiCollege() ? html`<a class="btn" href="#/admin/campus">${icon('back', 16)} All colleges</a>` : ''}</div>
      <div class="card ca-enable"><div class="ca-enable-ico">${icon('compass', 34)}</div><div>
        <h2>This college has no campus guide yet</h2>
        <p class="muted">The campus guide gives visitors a searchable campus map with walking directions, event listings with registration, a facility finder, venue alerts, QR checkpoints and self check-in.</p>
        <ul class="ca-enable-list"><li>Enabling creates a starter dataset with the same structure as the KPRIET guide.</li><li>Replace its map points, paths and floor plans with your own survey before announcing it.</li><li>You can then edit everything here and publish new versions at any time.</li></ul>
        <button class="btn primary" data-click="enable">${icon('plus', 16)} Enable campus guide</button></div></div>`.s;
    bind(v, {
      enable: async (b) => {
        b.disabled = true;
        try { await api.post(`/api/campus/${S.cid}/enable`); toast('Campus guide enabled. Review the starter data before announcing it.', 'success'); S.tab = 'overview'; App.render(); }
        catch (e) { b.disabled = false; toast(e.message, 'error'); }
      },
    });
  }

  function renderEditor(v) {
    const c = S.info.college;
    v.innerHTML = html`<div class="ca">
      <div class="page-head ca-head"><div>
          <span class="ca-kicker">${icon('compass', 14)} Campus guide · ${c.short_name}</span>
          <h1>${S.info.guideName}</h1>
          <p>Published version <b id="ca-ver">${S.base.version}</b> · last published <span id="ca-upd">${fmt.dateTime(S.info.updatedAt)}</span></p></div>
        <div class="btn-row">${multiCollege() ? html`<a class="btn" href="#/admin/campus">${icon('back', 16)} All colleges</a>` : ''}
          <a class="btn" href="#/campus/${S.cid}" target="_blank" rel="noopener">${icon('external', 16)} Open visitor guide</a></div></div>
      <div class="grid g4 ca-kpis" id="ca-kpis"></div>
      <div class="ca-bar" id="ca-bar"></div>
      <div id="ca-msg"></div>
      <nav class="tabs ca-tabs" role="tablist">${TABS.map(([k, l, i]) => html`<button role="tab" data-click="tab" data-tab="${k}" class="${S.tab === k ? 'active' : ''}" aria-selected="${S.tab === k}">${icon(i, 15)}<span>${l}</span></button>`)}</nav>
      <div id="ca-body"></div></div>`.s;
    bind(v, HANDLERS);
    renderKpis(); renderBar(); renderMsg(); renderTab();
  }
  function renderKpis() {
    const k = $('#ca-kpis'); if (!k) return;
    const n = S.info.counts;
    const kpi = (label, value, sub, tab, cls = '') => html`<button class="card kpi ca-kpi ${cls}" data-click="tab" data-tab="${tab}"><span class="label">${label}</span><span class="value">${fmt.num(value)}</span><span class="sub">${sub}</span></button>`;
    k.innerHTML = html`${kpi('Events', S.base.events.length, `${S.base.events.filter((e) => e.registrationOpen).length} open for registration`, 'events')}
      ${kpi('Participants', n.participants, 'Event registrations', 'events')}
      ${kpi('Visitors', n.visitors, 'Badge desk check-ins', 'visitors')}
      ${kpi('Pending ID check-ins', n.idPending, n.idPending ? 'Waiting for review' : 'All reviewed', 'visitors', n.idPending ? 'warn' : '')}`.s;
  }
  function renderBar() {
    const b = $('#ca-bar'); if (!b) return;
    const dirty = isDirty();
    b.className = `ca-bar ${dirty ? 'dirty' : ''}`;
    b.innerHTML = html`<span class="ca-dot"></span><div class="grow"><b>${dirty ? 'Unsaved changes' : 'Draft matches the published guide'}</b>
        <small>${dirty ? 'Edits stay in this draft until you publish them to visitors.' : `Version ${S.base.version} is live for visitors.`}</small></div>
      <div class="btn-row"><button class="btn" data-click="discard" ${dirty ? '' : 'disabled'}>${icon('undo', 16)} Discard</button>
        <button class="btn primary" data-click="publish" ${dirty ? '' : 'disabled'}>${icon('upload', 16)} Publish</button></div>`.s;
  }
  function renderMsg() {
    const m = $('#ca-msg'); if (!m) return;
    m.innerHTML = html`${S.stale ? html`<div class="alert warning ca-alert"><div class="ico">!</div><div class="grow"><b>Version ${S.stale} was published while you were editing.</b><p>Your draft is based on version ${S.base.version}. Download it, then reload to start from the latest data.</p></div><div class="btn-row"><button class="btn sm" data-click="exportJson">Download draft</button><button class="btn sm" data-click="reloadLatest">Reload latest</button></div></div>` : ''}
      ${S.error ? html`<div class="alert critical ca-alert"><div class="ico">!</div><div class="grow"><b>Publishing failed</b>${S.error.slice(0, 10).map((x) => html`<p>${x}</p>`)}${S.error.length > 10 ? html`<p>…and ${S.error.length - 10} more.</p>` : ''}</div><button class="btn sm ghost" data-click="dismissError">Dismiss</button></div>` : ''}`.s;
  }
  // Apply a change to the draft; re-render the current tab unless the caller updates the DOM itself.
  function edit(fn, rerender = true) {
    fn(S.draft);
    renderBar();
    if (rerender) renderTab();
  }
  function renderTab() {
    stopScan();
    $$('.ca-tabs [data-tab]').forEach((b) => { b.classList.toggle('active', b.dataset.tab === S.tab); b.setAttribute('aria-selected', b.dataset.tab === S.tab); });
    const body = $('#ca-body'); if (!body) return;
    const y = window.scrollY;
    body.innerHTML = (VIEWS[S.tab] || VIEWS.overview)().s;
    if (S.tab === 'events' || S.tab === 'visitors') { loadRoster(S.rosterStale); S.rosterStale = false; }
    if (S.tab === 'visitors') { loadVisitors(); loadIds(); }
    window.scrollTo(0, y);
  }

  const nodeName = (id) => S.draft.nodes.find((n) => n.id === id)?.name || id || '—';
  const places = () => S.draft.nodes.filter((n) => n.kind !== 'junction');
  const nodeOptions = (value, list = S.draft.nodes) => list.map((n) => html`<option value="${n.id}" ${sel(n.id, value)}>${n.name}${n.floor ? ` · floor ${n.floor}` : ''}</option>`);
  const findNode = (id) => S.draft.nodes.find((n) => n.id === id);

  // ================= views =================
  const VIEWS = {};

  VIEWS.overview = () => {
    const d = S.draft, issues = problems(d);
    const upcoming = d.events.filter((e) => !e.endsAt || Date.parse(e.endsAt) > Date.now()).sort((a, b) => (Date.parse(a.startsAt) || 0) - (Date.parse(b.startsAt) || 0)).slice(0, 4);
    const metric = (label, value, tab) => html`<button class="ca-metric" data-click="tab" data-tab="${tab}"><span>${label}</span><strong>${value}</strong></button>`;
    const callout = (ok, title, text, tab) => html`<div class="ca-check ${ok ? 'ok' : ''}"><span class="ca-check-ico">${icon(ok ? 'check' : 'info', 15)}</span><div class="grow"><b>${title}</b><small>${text}</small></div>${ok ? '' : html`<button class="btn sm" data-click="tab" data-tab="${tab}">Review</button>`}</div>`;
    return html`<div class="ca-metrics">${metric('Campus places', places().length, 'map')}${metric('Map points', d.nodes.length, 'map')}${metric('Walking paths', d.edges.length, 'map')}${metric('Closed paths', d.edges.filter((e) => e.closed).length, 'map')}${metric('Events', d.events.length, 'events')}${metric('Verified rooms', (d.rooms || []).filter((r) => r.verified).length, 'directory')}${metric('Facilities', d.facilities.length, 'facilities')}${metric('Active alerts', d.alerts.filter((a) => a.active !== false).length, 'alerts')}</div>
      <div class="grid g-2-1 ca-gap">
        <div class="card"><div class="card-head"><h3>Ready for visitors</h3>${issues.length ? html`<span class="badge critical">${issues.length} to fix</span>` : html`<span class="badge safe">Draft is valid</span>`}</div>
          <div class="card-body stack-sm">
            ${issues.length ? html`<div class="alert critical"><div class="ico">!</div><div><b>Fix these before publishing</b>${issues.slice(0, 8).map((x) => html`<p>${x}</p>`)}${issues.length > 8 ? html`<p>…and ${issues.length - 8} more.</p>` : ''}</div></div>` : ''}
            ${callout(d.verified, 'Destination labels checked', 'Point names match the published campus layout.', 'map')}
            ${callout(!!d.gpsCalibrated, 'GPS calibrated', d.gpsCalibrated ? 'Three anchors were surveyed on campus.' : 'Outdoor GPS is approximate. Capture three on-campus anchors in Map & paths.', 'map')}
            ${callout(!!d.distanceVerified, 'Path lengths measured', d.distanceVerified ? 'Walking times use measured distances.' : 'Walking times are estimates until lengths are measured on site.', 'map')}
            ${callout(!!d.accessibilityVerified, 'Step-free routes surveyed', d.accessibilityVerified ? 'Ramps, lifts and stairs are recorded.' : 'Step-free routes need surveyed ramps, lifts and path details.', 'map')}
            <p class="small muted ca-note">Changes stay in this draft until you select Publish. Visitors keep seeing version ${S.base.version} until then.</p>
            <div class="btn-row"><button class="btn" data-click="tab" data-tab="events">${icon('calendar', 16)} Manage events</button><button class="btn" data-click="tab" data-tab="directory">${icon('building', 16)} Add a cabin</button><button class="btn" data-click="tab" data-tab="map">${icon('map', 16)} Review paths</button></div>
          </div></div>
        <div class="card"><div class="card-head"><h3>Upcoming events</h3><button class="btn sm" data-click="addEvent">${icon('plus', 14)} Add</button></div>
          <div class="card-body stack-sm">${upcoming.length ? upcoming.map((e) => html`<button class="ca-mini-ev" data-click="editEvent" data-id="${e.id}">${e.posterUrl ? html`<img src="${e.posterUrl}" alt="">` : html`<span class="ca-mini-ph">${icon('calendar', 18)}</span>`}<span><b>${e.title || 'Untitled event'}</b><small>${e.time || timeLabel(e.startsAt, e.endsAt) || 'Time not set'} · ${CompassData.venueName(d, e.venue)}</small></span></button>`)
    : html`<div class="empty"><b>No upcoming events</b>Add an event to show it in the visitor guide.</div>`}</div></div>
      </div>`;
  };

  // ---------- events ----------
  VIEWS.events = () => {
    const d = S.draft;
    const counts = {}; (S.roster || []).forEach((r) => { if (r.status !== 'cancelled') counts[r.eventId] = (counts[r.eventId] || 0) + 1; });
    const status = (e) => { const now = Date.now(); if (e.endsAt && Date.parse(e.endsAt) < now) return html`<span class="badge plain">Past</span>`; if (e.startsAt && Date.parse(e.startsAt) <= now) return html`<span class="badge safe">Happening now</span>`; return html`<span class="badge info">Upcoming</span>`; };
    return html`<div class="card"><div class="card-head"><div><h3>Events & venues</h3><p class="small muted ca-sub">Publish verified event details and venue. Turn on registration when it is ready.</p></div><button class="btn primary" data-click="addEvent">${icon('plus', 16)} Add event</button></div>
      ${d.events.length ? html`<div class="ca-list">${d.events.map((e) => html`<div class="ca-ev">
          ${e.posterUrl ? html`<img class="ca-ev-poster" src="${e.posterUrl}" alt="Poster for ${e.title}">` : html`<div class="ca-ev-poster ph">${icon('calendar', 22)}</div>`}
          <div class="ca-ev-main"><div class="ca-ev-title"><b>${e.title || 'Untitled event'}</b>${status(e)}${e.registrationOpen ? html`<span class="badge safe plain">Registration open</span>` : ''}</div>
            ${e.titleTa ? html`<div class="small muted" lang="ta">${e.titleTa}</div>` : ''}
            <div class="small ca-ev-meta"><span>${icon('clock', 13)} ${e.time || timeLabel(e.startsAt, e.endsAt) || 'Time not set'}</span><span>${icon('pin', 13)} ${CompassData.venueName(d, e.venue)}</span></div></div>
          <div class="ca-ev-side"><button class="btn sm ghost" data-click="rosterFor" data-id="${e.id}" title="Participants">${icon('users', 14)} ${counts[e.id] || 0}</button>
            <button class="btn sm" data-click="editEvent" data-id="${e.id}">${icon('edit', 14)} Edit</button>
            <button class="btn sm ghost danger" data-click="delEvent" data-id="${e.id}" aria-label="Delete ${e.title}">${icon('trash', 15)}</button></div></div>`)}</div>`
    : html`<div class="empty"><b>No events yet</b>Add the first event to list it in the visitor guide.</div>`}</div>
      <div class="card ca-gap" id="ca-roster">${rosterCard()}</div>`;
  };
  function rosterCard() {
    const rows = (S.roster || []).filter((r) => !S.rosterEvent || r.eventId === S.rosterEvent);
    const evs = new Map(S.draft.events.map((e) => [e.id, e.title])); (S.roster || []).forEach((r) => { if (!evs.has(r.eventId)) evs.set(r.eventId, r.eventTitle); });
    const csv = `/api/campus/${S.cid}/participations?format=csv${S.rosterEvent ? `&event=${encodeURIComponent(S.rosterEvent)}` : ''}`;
    return html`<div class="card-head"><div><h3>Participants <span class="tag">${rows.length}</span></h3><p class="small muted ca-sub">Private staff view. A badge code is the first 8 characters of the registration reference.</p></div>
      <div class="btn-row"><select class="input ca-auto" data-change="rosterEvent" aria-label="Filter by event"><option value="">All events</option>${[...evs].map(([id, t]) => html`<option value="${id}" ${sel(id, S.rosterEvent)}>${t || id}</option>`)}</select>
        <button class="btn" data-click="refreshRoster">${icon('refresh', 15)} Refresh</button><a class="btn" href="${csv}" download>${icon('download', 15)} Export CSV</a></div></div>
      ${S.roster === null ? html`<div class="card-body">${loading(3)}</div>` : rows.length ? html`<div class="table-wrap"><table class="table stack-sm ca-table"><thead><tr><th>Participant</th><th>Event</th><th>Reference</th><th>Registered</th><th>Status</th><th></th></tr></thead><tbody>
        ${rows.map((r) => html`<tr><td data-label="Participant"><div class="ca-cell"><b>${r.name}</b><div class="small muted">${r.institution} · ${r.email}</div></div></td><td data-label="Event">${r.eventTitle}</td>
          <td data-label="Reference"><code class="ca-code">${r.id.slice(0, 8)}</code></td><td data-label="Registered" class="small">${fmt.dateTime(r.createdAt)}</td>
          <td data-label="Status"><select class="input ca-status s-${r.status}" data-change="pStatus" data-id="${r.id}" aria-label="Status for ${r.name}">${STATUS.map(([k, l]) => html`<option value="${k}" ${sel(k, r.status)}>${l}</option>`)}</select></td>
          <td class="right"><button class="btn sm ghost danger" data-click="delParticipant" data-id="${r.id}" aria-label="Remove ${r.name}">${icon('trash', 15)}</button></td></tr>`)}</tbody></table></div>`
    : html`<div class="empty"><b>No registrations yet</b>${S.rosterEvent ? 'Nobody has registered for this event.' : 'Registrations appear here when visitors sign up for an event.'}</div>`}`;
  }
  async function loadRoster(force) {
    if (S.roster && !force) return;
    try { S.roster = await api.get(`/api/campus/${S.cid}/participations`); if (S.roster.length < 1000) { S.info.counts.participants = S.roster.length; renderKpis(); } }
    catch (e) { S.roster = []; toast(e.message, 'error'); }
    if (S.tab === 'events') { const r = $('#ca-roster'); if (r) r.innerHTML = rosterCard().s; $$('[data-click="rosterFor"]').forEach((b) => { const n = S.roster.filter((x) => x.eventId === b.dataset.id && x.status !== 'cancelled').length; b.innerHTML = html`${icon('users', 14)} ${n}`.s; }); }
  }
  function eventForm(e) {
    const rooms = (S.draft.rooms || []).filter((r) => r.verified);
    return html`<form data-submit="saveEvent" class="ca-form">
      <div class="form-grid">
        <div class="field full"><label for="ev-title">Event name</label><input class="input" id="ev-title" name="title" required maxlength="160" value="${e.title}"></div>
        <div class="field full"><label for="ev-titleTa">Tamil name <span class="muted">(optional)</span></label><input class="input" id="ev-titleTa" name="titleTa" lang="ta" maxlength="300" value="${e.titleTa || ''}"></div>
        <div class="field full"><label for="ev-venue">Venue</label><select class="input" id="ev-venue" name="venue" required>
          <optgroup label="Campus places">${nodeOptions(e.venue, places())}</optgroup>
          ${rooms.length ? html`<optgroup label="Verified rooms & halls">${rooms.map((r) => html`<option value="${r.id}" ${sel(r.id, e.venue)}>${r.name} · ${nodeName(r.building)}</option>`)}</optgroup>` : ''}</select>
          <div class="hint">Only verified rooms are listed. Add halls under Departments & cabins.</div></div>
        <div class="field"><label for="ev-start">Starts</label><input class="input" type="datetime-local" id="ev-start" name="startsAt" value="${localInput(e.startsAt)}"></div>
        <div class="field"><label for="ev-end">Ends</label><input class="input" type="datetime-local" id="ev-end" name="endsAt" value="${localInput(e.endsAt)}"></div>
        <div class="field"><label for="ev-time">Time shown to visitors</label><input class="input" id="ev-time" name="time" maxlength="160" value="${e.time}" placeholder="Filled in from start and end"></div>
        <div class="field"><label for="ev-timeTa">Tamil time <span class="muted">(optional)</span></label><input class="input" id="ev-timeTa" name="timeTa" lang="ta" maxlength="300" value="${e.timeTa || ''}"></div>
        <div class="field full"><label for="ev-desc">Description</label><textarea class="input" id="ev-desc" name="description" maxlength="1000">${e.description || ''}</textarea></div>
        <div class="field full"><label for="ev-descTa">Tamil description <span class="muted">(optional)</span></label><textarea class="input" id="ev-descTa" name="descriptionTa" lang="ta" maxlength="1000">${e.descriptionTa || ''}</textarea></div>
        <div class="field"><label for="ev-ins">Entry instructions</label><textarea class="input" id="ev-ins" name="instructions" maxlength="1000">${e.instructions}</textarea></div>
        <div class="field"><label for="ev-insTa">Tamil entry instructions</label><textarea class="input" id="ev-insTa" name="instructionsTa" lang="ta" maxlength="1000">${e.instructionsTa || ''}</textarea></div>
        <div class="field full"><label>Event poster</label><div class="ca-poster-edit"><div class="ca-poster-prev" id="ev-poster">${e.posterUrl ? html`<img src="${e.posterUrl}" alt="Poster preview">` : html`<span>${icon('upload', 20)}<small>No poster</small></span>`}</div>
          <div class="stack-sm"><label class="btn ca-file">${icon('upload', 15)} Upload poster<input type="file" accept="image/jpeg,image/png,image/webp" data-change="posterFile" class="sr-only" id="ev-file"></label>
            <button type="button" class="btn ghost danger ${e.posterUrl ? '' : 'hidden'}" data-click="posterRemove" id="ev-poster-rm">Remove poster</button>
            <div class="hint">JPEG, PNG or WebP. Resized to 1600 px before upload.</div></div></div></div>
        <div class="field full"><label class="checkbox"><input type="checkbox" name="registrationOpen" ${chk(e.registrationOpen)}> Accept visitor registrations</label></div>
      </div>
      <div class="ca-form-err hidden" id="ev-err" role="alert"></div>
      <div class="ca-form-foot"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary" id="ev-save">${icon('check', 16)} Save to draft</button></div></form>`;
  }
  function openEvent(id) {
    const existing = S.draft.events.find((e) => e.id === id);
    const e = existing ? clone(existing) : { id: uid(), title: '', venue: places()[0]?.id || S.draft.nodes[0].id, time: '', instructions: '', registrationOpen: false };
    let poster = e.posterUrl, uploading = false;
    const m = modal({ title: existing ? 'Edit event' : 'Add event', wide: true, body: eventForm(e) });
    const err = (msg) => { const b = $('#ev-err', m.el); b.textContent = msg || ''; b.classList.toggle('hidden', !msg); };
    const noPoster = () => html`<span>${icon('upload', 20)}<small>No poster</small></span>`.s;
    bind(m.el, {
      posterFile: async (input) => {
        const file = input.files[0]; if (!file) return;
        const prev = $('#ev-poster', m.el), save = $('#ev-save', m.el);
        uploading = true; save.disabled = true; err('');
        prev.innerHTML = '<span class="ca-spin"></span>';
        try {
          poster = await uploadImage(file, 'poster');
          prev.innerHTML = html`<img src="${poster}" alt="Poster preview">`.s;
          $('#ev-poster-rm', m.el).classList.remove('hidden');
        } catch (x) { err(x.message); prev.innerHTML = poster ? html`<img src="${poster}" alt="Poster preview">`.s : noPoster(); }
        uploading = false; save.disabled = false; input.value = '';
      },
      posterRemove: (b) => { poster = undefined; $('#ev-poster', m.el).innerHTML = noPoster(); b.classList.add('hidden'); },
      saveEvent: (form) => {
        if (uploading) return;
        const f = formData(form);
        const next = { ...e, title: f.title.trim(), venue: f.venue, time: f.time.trim(), instructions: f.instructions.trim(), registrationOpen: f.registrationOpen };
        for (const k of ['titleTa', 'timeTa', 'description', 'descriptionTa', 'instructionsTa']) { const val = f[k].trim(); if (val) next[k] = val; else delete next[k]; }
        if (f.startsAt) next.startsAt = new Date(f.startsAt).toISOString(); else delete next.startsAt;
        if (f.endsAt) next.endsAt = new Date(f.endsAt).toISOString(); else delete next.endsAt;
        if (poster) next.posterUrl = poster; else delete next.posterUrl;
        if (!next.title) return err('Enter the event name.');
        if (next.startsAt && next.endsAt && Date.parse(next.endsAt) <= Date.parse(next.startsAt)) return err('The event must end after it starts.');
        if (!next.time) next.time = timeLabel(next.startsAt, next.endsAt);
        edit((d) => { const i = d.events.findIndex((x) => x.id === next.id); if (i >= 0) d.events[i] = next; else d.events.push(next); });
        m.close(); toast(existing ? 'Event updated in the draft.' : 'Event added to the draft. Publish to show visitors.', 'success');
      },
    });
  }

  // ---------- departments & cabins ----------
  VIEWS.directory = () => {
    const rooms = S.draft.rooms || [];
    return html`<div class="card"><div class="card-head"><div><h3>Departments & cabins</h3><p class="small muted ca-sub">Add only rooms checked in person. A room appears in visitor search once it is verified. Link a QR checkpoint for indoor guidance; otherwise directions end at the building.</p></div>
      <button class="btn primary" data-click="addRoom">${icon('plus', 16)} Add room</button></div>
      ${rooms.length ? html`<div class="table-wrap"><table class="table stack-sm ca-table"><thead><tr><th>Cabin / room</th><th>Department</th><th>Building</th><th>Floor</th><th>Room no.</th><th>Checkpoint</th><th>Status</th><th></th></tr></thead><tbody>
        ${rooms.map((r) => html`<tr><td data-label="Room"><div class="ca-cell"><b>${r.name || 'Untitled room'}</b>${r.aliases && r.aliases.length ? html`<div class="small muted">${r.aliases.join(', ')}</div>` : ''}</div></td><td data-label="Department">${r.department || '—'}</td><td data-label="Building">${nodeName(r.building)}</td>
          <td data-label="Floor">${r.floor === null || r.floor === undefined ? html`<span class="muted">Unknown</span>` : r.floor === 0 ? 'Ground' : r.floor}</td><td data-label="Room no.">${r.roomNumber || '—'}</td><td data-label="Checkpoint" class="small">${r.checkpoint ? nodeName(r.checkpoint) : html`<span class="muted">Entrance only</span>`}</td>
          <td data-label="Status">${r.verified ? html`<span class="badge safe">Verified</span>` : html`<span class="badge attention">Hidden</span>`}</td>
          <td class="right nowrap"><button class="btn sm" data-click="editRoom" data-id="${r.id}">${icon('edit', 14)} Edit</button> <button class="btn sm ghost danger" data-click="delRoom" data-id="${r.id}" aria-label="Remove ${r.name}">${icon('trash', 15)}</button></td></tr>`)}</tbody></table></div>`
    : html`<div class="empty"><b>No rooms yet</b>Add department offices, faculty cabins and halls so visitors can search for them.</div>`}</div>`;
  };
  function openRoom(id) {
    const existing = (S.draft.rooms || []).find((r) => r.id === id);
    const buildings = S.draft.nodes.filter((n) => n.floor === 0 && n.kind !== 'junction');
    const r = existing ? clone(existing) : { id: 'room-' + hex(8), name: '', department: '', building: S.draft.nodes.find((n) => n.kind === 'building')?.id || S.draft.nodes[0].id, floor: 0, roomNumber: '', directions: '', verified: false };
    const m = modal({ title: existing ? 'Edit room' : 'Add room', body: html`<form data-submit="saveRoom" class="ca-form"><div class="form-grid">
      <div class="field"><label for="rm-name">Cabin / room name</label><input class="input" id="rm-name" name="name" required maxlength="160" value="${r.name}"></div>
      <div class="field"><label for="rm-dept">Department</label><input class="input" id="rm-dept" name="department" maxlength="160" value="${r.department}"></div>
      <div class="field full"><label for="rm-alias">Search aliases <span class="muted">(comma separated)</span></label><input class="input" id="rm-alias" name="aliases" value="${(r.aliases || []).join(', ')}" placeholder="HOD cabin, CSE office"></div>
      <div class="field"><label for="rm-bld">Building</label><select class="input" id="rm-bld" name="building">${nodeOptions(r.building, buildings)}</select></div>
      <div class="field"><label for="rm-floor">Floor <span class="muted">(blank if unknown)</span></label><input class="input" type="number" step="1" id="rm-floor" name="floor" value="${r.floor ?? ''}"></div>
      <div class="field"><label for="rm-no">Room / cabin number</label><input class="input" id="rm-no" name="roomNumber" maxlength="60" value="${r.roomNumber}"></div>
      <div class="field"><label for="rm-cp">QR checkpoint</label><select class="input" id="rm-cp" name="checkpoint"><option value="">None — building entrance only</option>${nodeOptions(r.checkpoint)}</select></div>
      <div class="field full"><label for="rm-dir">Indoor directions</label><textarea class="input" id="rm-dir" name="directions" maxlength="1000">${r.directions}</textarea></div>
      <div class="field full"><label class="checkbox"><input type="checkbox" name="verified" ${chk(r.verified)}> Verified on site and visible to visitors</label></div></div>
      <div class="ca-form-err hidden" id="rm-err" role="alert"></div>
      <div class="ca-form-foot"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">${icon('check', 16)} Save to draft</button></div></form>` });
    bind(m.el, {
      saveRoom: (form) => {
        const f = formData(form);
        const next = { ...r, name: f.name.trim(), department: f.department.trim(), building: f.building, floor: f.floor === '' ? null : Math.trunc(Number(f.floor)), roomNumber: f.roomNumber.trim(), directions: f.directions.trim(), verified: f.verified };
        const aliases = f.aliases.split(',').map((x) => x.trim()).filter(Boolean); if (aliases.length) next.aliases = aliases; else delete next.aliases;
        if (f.checkpoint) next.checkpoint = f.checkpoint; else delete next.checkpoint;
        const errBox = $('#rm-err', m.el);
        const fail = (msg) => { errBox.textContent = msg; errBox.classList.remove('hidden'); };
        if (!next.name) return fail('Enter the room name.');
        if (!next.verified && S.draft.events.some((e) => e.venue === next.id)) return fail('An event uses this room as its venue, so it must stay verified.');
        edit((d) => { d.rooms = d.rooms || []; const i = d.rooms.findIndex((x) => x.id === next.id); if (i >= 0) d.rooms[i] = next; else d.rooms.push(next); });
        m.close(); toast('Room saved to the draft.', 'success');
      },
    });
  }

  // ---------- map & paths ----------
  const floors = () => [...new Set([0, ...S.draft.nodes.map((n) => n.floor), ...Object.keys(S.draft.mapImages || {}).map(Number)])].filter(Number.isInteger).sort((a, b) => a - b);
  const floorName = (f) => (f === 0 ? 'Ground floor' : f < 0 ? `Basement ${-f}` : `Floor ${f}`);
  function mapCanvas() {
    const d = S.draft, f = S.floor, img = (d.mapImages || {})[String(f)];
    const on = new Map(d.nodes.filter((n) => n.floor === f).map((n) => [n.id, n]));
    const lines = d.edges.filter((e) => on.has(e.from) && on.has(e.to)).map((e) => { const a = on.get(e.from), b = on.get(e.to); return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" class="${e.closed ? 'closed' : e.stairs ? 'stairs' : ''}" vector-effect="non-scaling-stroke"/>`; }).join('');
    return html`<div class="ca-map mode-${S.mode}" data-click="mapClick" id="ca-map">
      ${img ? html`<img src="${img}" alt="${floorName(f)} map" draggable="false" style="${img === DEFAULT_MAP ? 'aspect-ratio:1090/2125' : ''}">` : html`<div class="ca-map-blank"><span>${icon('map', 26)}</span><b>Schematic only</b><small>Upload a floor plan below to place points over it.</small></div>`}
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${raw(lines)}</svg>
      ${[...on.values()].map((n) => html`<button type="button" class="ca-pin k-${n.kind || 'place'} ${S.selNode === n.id ? 'sel' : ''} ${n.verified === false ? 'unv' : ''}" style="left:${n.x}%;top:${n.y}%" data-click="pin" data-id="${n.id}" title="${n.name}" aria-label="${n.name}"></button>`)}
    </div>`;
  }
  function nodePanel() {
    const n = findNode(S.selNode);
    if (!n) return html`<div class="ca-panel-empty">${icon('pin', 22)}<b>Select a point</b><small>Click a pin to edit it, or choose “Add point” and click the map to place a new one.</small></div>`;
    const f = (k, label, type = 'text', extra = '') => html`<div class="field"><label>${label}</label><input class="input" type="${type}" ${raw(extra)} value="${n[k] ?? ''}" data-change="nodeField" data-id="${n.id}" data-k="${k}"></div>`;
    return html`<div class="ca-panel-head"><div><b>${n.name}</b><code class="ca-code">${n.id}</code></div><button class="icon-btn" data-click="pinClose" aria-label="Close">${icon('x', 16)}</button></div>
      ${f('name', 'Name')}
      <div class="field"><label>Search aliases</label><input class="input" value="${(n.aliases || []).join(', ')}" placeholder="Comma separated" data-change="nodeField" data-id="${n.id}" data-k="aliases"></div>
      <div class="ca-3">${f('x', 'X %', 'number', 'min="0" max="100" step="0.1"')}${f('y', 'Y %', 'number', 'min="0" max="100" step="0.1"')}${f('floor', 'Floor', 'number', 'step="1"')}</div>
      <div class="field"><label>Kind</label><select class="input" data-change="nodeField" data-id="${n.id}" data-k="kind">${NODE_KINDS.concat(NODE_KINDS.includes(n.kind) ? [] : [n.kind || 'place']).map((k) => html`<option value="${k}" ${sel(k, n.kind)}>${k}</option>`)}</select></div>
      ${f('detail', 'Detail shown to visitors')}
      <label class="checkbox ca-mb"><input type="checkbox" ${chk(n.verified !== false)} data-change="nodeField" data-id="${n.id}" data-k="verified"> Position verified on site</label>
      <div class="btn-row"><button class="btn sm ${S.mode === 'move' ? 'primary' : ''}" data-click="mode" data-mode="move">${icon('target', 14)} Move on map</button><button class="btn sm ghost danger" data-click="delNode" data-id="${n.id}">${icon('trash', 14)} Delete point</button></div>`;
  }
  function refreshMap() {
    const m = $('#ca-map'); if (m) m.outerHTML = mapCanvas().s;
    const p = $('#ca-node-panel'); if (p) p.innerHTML = nodePanel().s;
    $$('.ca-seg [data-mode]').forEach((b) => b.classList.toggle('active', b.dataset.mode === S.mode));
    const h = $('#ca-map-hint'); if (h) h.textContent = MODE_HINT[S.mode];
  }
  function nodeRows() {
    const q = S.nodeQ.trim().toLowerCase();
    const list = S.draft.nodes.filter((n) => !q || n.name.toLowerCase().includes(q) || n.id.includes(q) || (n.aliases || []).some((a) => a.toLowerCase().includes(q)));
    return html`${list.map((n) => html`<div class="ca-node ${S.selNode === n.id ? 'sel' : ''}" data-node="${n.id}">
      <div class="ca-node-name"><input class="input" aria-label="Name" value="${n.name}" data-change="nodeField" data-id="${n.id}" data-k="name"><code class="ca-code">${n.id}</code></div>
      <input class="input ca-node-alias" aria-label="Aliases for ${n.name}" placeholder="Aliases, comma separated" value="${(n.aliases || []).join(', ')}" data-change="nodeField" data-id="${n.id}" data-k="aliases">
      <label class="ca-num">X<input class="input" type="number" min="0" max="100" step="0.1" value="${n.x}" data-change="nodeField" data-id="${n.id}" data-k="x"></label>
      <label class="ca-num">Y<input class="input" type="number" min="0" max="100" step="0.1" value="${n.y}" data-change="nodeField" data-id="${n.id}" data-k="y"></label>
      <label class="ca-num">Floor<input class="input" type="number" step="1" value="${n.floor}" data-change="nodeField" data-id="${n.id}" data-k="floor"></label>
      <label class="checkbox small" title="Position verified on site"><input type="checkbox" ${chk(n.verified !== false)} data-change="nodeField" data-id="${n.id}" data-k="verified"> Verified</label>
      <div class="ca-node-act"><button class="btn sm ghost" data-click="locate" data-id="${n.id}" aria-label="Show ${n.name} on map" title="Show on map">${icon('locate', 15)}</button><button class="btn sm ghost danger" data-click="delNode" data-id="${n.id}" aria-label="Delete ${n.name}">${icon('trash', 15)}</button></div></div>`)}
      ${list.length ? '' : html`<div class="empty"><b>No points match.</b></div>`}`;
  }
  function edgeRows() {
    const q = S.edgeQ.trim().toLowerCase();
    const list = S.draft.edges.filter((e) => !q || nodeName(e.from).toLowerCase().includes(q) || nodeName(e.to).toLowerCase().includes(q) || (q === 'closed' && e.closed));
    return html`${list.map((e) => html`<div class="ca-edge ${e.closed ? 'closed' : ''}" data-edge="${e.id}">
      <div class="ca-edge-name"><b>${nodeName(e.from)} <span class="muted">→</span> ${nodeName(e.to)}</b><input class="input ca-edge-note" placeholder="Direction note (optional)" value="${e.note || ''}" data-change="edgeField" data-id="${e.id}" data-k="note" aria-label="Direction note"></div>
      <label class="ca-num">Metres<input class="input" type="number" min="1" step="1" value="${e.meters}" data-change="edgeField" data-id="${e.id}" data-k="meters"></label>
      <label class="checkbox small"><input type="checkbox" ${chk(e.stairs)} data-change="edgeField" data-id="${e.id}" data-k="stairs"> Stairs</label>
      <label class="ca-switch"><input type="checkbox" ${chk(e.closed)} data-change="edgeField" data-id="${e.id}" data-k="closed"><span></span><em>${e.closed ? 'Closed' : 'Open'}</em></label>
      <button class="btn sm ghost danger" data-click="delEdge" data-id="${e.id}" aria-label="Remove path">${icon('trash', 15)}</button></div>`)}
      ${list.length ? '' : html`<div class="empty"><b>No paths match.</b></div>`}`;
  }
  VIEWS.map = () => {
    const d = S.draft, fl = floors();
    if (!fl.includes(S.floor)) S.floor = 0;
    return html`<div class="card"><div class="card-head"><h3>Map status</h3><span class="small muted">${d.nodes.length} points · ${d.edges.length} paths · ${d.edges.filter((e) => e.closed).length} closed</span></div>
      <div class="card-body"><div class="form-grid"><div class="field"><label for="ca-mapname">Map name</label><input class="input" id="ca-mapname" value="${d.mapName}" data-change="flag" data-k="mapName"></div>
        <div class="field"><label for="ca-src">Source layout link <span class="muted">(optional)</span></label><input class="input" id="ca-src" type="url" value="${d.sourceUrl || ''}" data-change="flag" data-k="sourceUrl"></div></div>
        <div class="ca-flags"><label class="checkbox"><input type="checkbox" ${chk(d.verified)} data-change="flag" data-k="verified"> Destination labels checked against the published layout</label>
          <label class="checkbox"><input type="checkbox" ${chk(d.distanceVerified)} data-change="flag" data-k="distanceVerified"> Path lengths measured on site</label>
          <label class="checkbox"><input type="checkbox" ${chk(d.accessibilityVerified)} data-change="flag" data-k="accessibilityVerified"> Ramps, lifts and step-free paths surveyed</label></div>
        <p class="small muted ca-note">Only enable measured distances or step-free routing after a physical survey.</p></div></div>

      <div class="card ca-gap"><div class="card-head"><h3>Map editor</h3><div class="btn-row">
          <select class="input ca-auto" data-change="floor" aria-label="Floor">${fl.map((f) => html`<option value="${f}" ${sel(f, S.floor)}>${floorName(f)}</option>`)}</select>
          <div class="seg ca-seg">${[['select', 'Select'], ['add', 'Add point'], ['move', 'Move selected']].map(([k, l]) => html`<button data-click="mode" data-mode="${k}" class="${S.mode === k ? 'active' : ''}">${l}</button>`)}</div></div></div>
        <div class="ca-mapwrap"><div class="ca-mapcol"><p class="small muted ca-maphint" id="ca-map-hint">${MODE_HINT[S.mode]}</p>${mapCanvas()}
          <div class="ca-legend small"><span><i class="lg-pin"></i>Place</span><span><i class="lg-pin j"></i>Junction</span><span><i class="lg-line"></i>Path</span><span><i class="lg-line st"></i>Stairs</span><span><i class="lg-line cl"></i>Closed</span></div></div>
          <aside class="ca-panel" id="ca-node-panel">${nodePanel()}</aside></div></div>

      <div class="card ca-gap"><div class="card-head"><div><h3>Map points <span class="tag">${d.nodes.length}</span></h3><p class="small muted ca-sub">Points locate entrances, buildings, junctions and checkpoints. X and Y are percentages over the floor image.</p></div>
        <div class="btn-row"><div class="search-input ca-search">${icon('search', 15)}<input class="input" placeholder="Filter points" value="${S.nodeQ}" data-input="nodeQ" aria-label="Filter points"></div><button class="btn" data-click="mode" data-mode="add" data-scroll="1">${icon('plus', 15)} Add point</button></div></div>
        <div class="ca-nodes" id="ca-nodes">${nodeRows()}</div></div>

      <div class="card ca-gap"><div class="card-head"><div><h3>Paths and closures</h3><p class="small muted ca-sub">Connected paths power walking directions. A closed path is skipped by route finding once published.</p></div>
        <div class="search-input ca-search">${icon('search', 15)}<input class="input" placeholder="Filter by place, or type closed" value="${S.edgeQ}" data-input="edgeQ" aria-label="Filter paths"></div></div>
        <form class="ca-addedge" data-submit="addEdge"><select class="input" name="from" aria-label="From">${nodeOptions(d.nodes[0]?.id)}</select><span class="muted ca-arrow">→</span><select class="input" name="to" aria-label="To">${nodeOptions(d.nodes[1]?.id)}</select>
          <input class="input ca-m" type="number" name="meters" min="1" value="50" aria-label="Metres"><label class="checkbox small"><input type="checkbox" name="stairs"> Stairs</label><button class="btn">${icon('plus', 15)} Add path</button></form>
        <div class="ca-edges" id="ca-edges">${edgeRows()}</div></div>

      <div class="grid g2 ca-gap">
        <div class="card"><div class="card-head"><div><h3>Floor map images</h3><p class="small muted ca-sub">Upload an approved PNG, JPEG or WebP plan for each floor.</p></div></div><div class="card-body stack-sm">
          ${fl.map((f) => { const url = (d.mapImages || {})[String(f)]; return html`<div class="ca-floor"><div class="grow"><b>${floorName(f)}</b><small class="muted">${url ? (url === DEFAULT_MAP ? 'Published campus layout' : 'Uploaded plan') : 'Schematic only'} · ${d.nodes.filter((n) => n.floor === f).length} points</small></div>
            <label class="btn sm ca-file">${icon('upload', 14)} ${url ? 'Replace' : 'Upload'}<input type="file" class="sr-only" accept="image/png,image/jpeg,image/webp" data-change="floorFile" data-floor="${f}"></label>
            ${url ? html`<button class="btn sm ghost danger" data-click="floorRemove" data-floor="${f}" aria-label="Remove ${floorName(f)} image">${icon('trash', 14)}</button>` : ''}</div>`; })}
          <form class="ca-floor-add" data-submit="floorAdd"><input class="input" type="number" step="1" name="floor" placeholder="Floor number, e.g. 1" aria-label="New floor number" required><button class="btn sm">${icon('plus', 14)} Add floor plan</button></form></div></div>
        <div class="card"><div class="card-head"><div><h3>GPS calibration</h3><p class="small muted ca-sub">Stand outside each anchor building and capture a fix to align live guidance.</p></div></div><div class="card-body stack-sm">
          ${ANCHORS.map((id) => { const n = findNode(id); if (!n) return html`<div class="ca-anchor"><b>${id}</b><small class="muted">Add a map point with ID “${id}” to use it as an anchor.</small></div>`;
    return html`<div class="ca-anchor"><b>${n.name}</b><div class="ca-anchor-row"><label class="ca-num">Latitude<input class="input" type="number" step="0.000001" value="${n.lat ?? ''}" data-change="nodeField" data-id="${id}" data-k="lat"></label>
              <label class="ca-num">Longitude<input class="input" type="number" step="0.000001" value="${n.lon ?? ''}" data-change="nodeField" data-id="${id}" data-k="lon"></label>
              <button class="btn sm" data-click="gps" data-id="${id}">${icon('locate', 14)} Use my location</button></div></div>`; })}
          <label class="checkbox"><input type="checkbox" ${chk(d.gpsCalibrated)} data-change="flag" data-k="gpsCalibrated"> Three GPS anchors surveyed on campus</label></div></div>
      </div>`;
  };
  function addNodeAt(x, y) {
    const m = modal({ title: 'Add map point', body: html`<form data-submit="saveNode" class="ca-form"><div class="form-grid">
      <div class="field full"><label for="nd-name">Name</label><input class="input" id="nd-name" name="name" required maxlength="160" placeholder="e.g. CSE Block entrance"></div>
      <div class="field"><label for="nd-id">Point ID <span class="muted">(used in QR codes)</span></label><input class="input" id="nd-id" name="id" pattern="[a-z0-9][a-z0-9\\-]{1,39}" placeholder="Generated from the name"></div>
      <div class="field"><label for="nd-kind">Kind</label><select class="input" id="nd-kind" name="kind">${NODE_KINDS.map((k) => html`<option value="${k}" ${sel(k, 'landmark')}>${k}</option>`)}</select></div>
      <div class="field"><label for="nd-x">X %</label><input class="input" type="number" id="nd-x" name="x" min="0" max="100" step="0.1" value="${x}" required></div>
      <div class="field"><label for="nd-y">Y %</label><input class="input" type="number" id="nd-y" name="y" min="0" max="100" step="0.1" value="${y}" required></div>
      <div class="field"><label for="nd-floor">Floor</label><input class="input" type="number" id="nd-floor" name="floor" step="1" value="${S.floor}" required></div>
      <div class="field"><label for="nd-link">Connect to <span class="muted">(optional path)</span></label><select class="input" id="nd-link" name="link"><option value="">No path yet</option>${nodeOptions('', S.draft.nodes.filter((n) => n.floor === S.floor))}</select></div></div>
      <div class="ca-form-err hidden" id="nd-err" role="alert"></div>
      <div class="ca-form-foot"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">${icon('plus', 16)} Add point</button></div></form>` });
    bind(m.el, {
      saveNode: (form) => {
        const f = formData(form);
        const errBox = $('#nd-err', m.el);
        const taken = (id) => S.draft.nodes.some((n) => n.id === id) || (S.draft.rooms || []).some((r) => r.id === id);
        let id = (f.id.trim() || slug(f.name) || 'point').toLowerCase();
        if (!f.id.trim()) { const b = id; let i = 2; while (taken(id)) id = `${b}-${i++}`; }
        if (taken(id)) { errBox.textContent = `The ID “${id}” is already used.`; errBox.classList.remove('hidden'); return; }
        const n = { id, name: f.name.trim(), x: Math.round(Number(f.x) * 10) / 10, y: Math.round(Number(f.y) * 10) / 10, floor: Math.trunc(Number(f.floor)), kind: f.kind, detail: '' };
        edit((d) => {
          d.nodes.push(n);
          if (f.link) { const a = d.nodes.find((x) => x.id === f.link); d.edges.push({ id: 'path-' + hex(8), from: f.link, to: id, meters: Math.max(5, Math.round(Math.hypot(a.x - n.x, a.y - n.y) * 6)) }); }
        }, false);
        S.selNode = id; S.mode = 'select'; S.floor = n.floor;
        m.close(); renderTab(); toast(`Added ${n.name}. Publish to show visitors.`, 'success');
      },
    });
  }
  function nodeRefs(id) {
    const d = S.draft, out = [];
    const e = d.edges.filter((x) => x.from === id || x.to === id).length; if (e) out.push(`${e} path${e === 1 ? '' : 's'}`);
    const ev = d.events.filter((x) => x.venue === id).length; if (ev) out.push(`${ev} event${ev === 1 ? '' : 's'}`);
    const r = (d.rooms || []).filter((x) => x.building === id || x.checkpoint === id).length; if (r) out.push(`${r} room${r === 1 ? '' : 's'}`);
    const f = d.facilities.filter((x) => x.node === id).length; if (f) out.push(`${f} facilit${f === 1 ? 'y' : 'ies'}`);
    return out;
  }

  // ---------- facilities ----------
  VIEWS.facilities = () => {
    const d = S.draft;
    return html`<div class="card"><div class="card-head"><div><h3>Facilities</h3><p class="small muted ca-sub">Link each facility to a map point so visitors can route to it.</p></div><button class="btn primary" data-click="addFacility">${icon('plus', 16)} Add facility</button></div>
      ${d.facilities.length ? html`<div class="ca-rows">${d.facilities.map((f) => html`<div class="ca-fac">
        <div class="field"><label>Name</label><input class="input" value="${f.name}" data-change="facField" data-id="${f.id}" data-k="name"></div>
        <div class="field"><label>Kind</label><select class="input" data-change="facField" data-id="${f.id}" data-k="kind">${FACILITY_KINDS.concat(FACILITY_KINDS.includes(f.kind) ? [] : [f.kind || 'place']).map((k) => html`<option value="${k}" ${sel(k, f.kind)}>${k}</option>`)}</select></div>
        <div class="field"><label>Map point</label><select class="input" data-change="facField" data-id="${f.id}" data-k="node">${nodeOptions(f.node)}</select></div>
        <button class="btn sm ghost danger" data-click="delFacility" data-id="${f.id}" aria-label="Remove ${f.name}">${icon('trash', 15)}</button></div>`)}</div>`
    : html`<div class="empty"><b>No facilities</b>Add restrooms, food, parking and help desks.</div>`}</div>`;
  };

  // ---------- alerts ----------
  VIEWS.alerts = () => {
    const d = S.draft;
    return html`<div class="card"><div class="card-head"><div><h3>Venue alerts</h3><p class="small muted ca-sub">Publish a short alert when a venue or route changes. Edit the event venue too so its Navigate button points to the new location.</p></div><button class="btn primary" data-click="addAlert">${icon('plus', 16)} Add alert</button></div>
      ${d.alerts.length ? html`<div class="ca-rows">${d.alerts.map((a) => html`<div class="ca-alertrow lv-${a.level || 'info'} ${a.active === false ? 'off' : ''}">
        <div class="form-grid">
          <div class="field full"><label>Message</label><input class="input" value="${a.message}" maxlength="300" data-change="alertField" data-id="${a.id}" data-k="message"></div>
          <div class="field full"><label>Tamil message <span class="muted">(optional)</span></label><input class="input" lang="ta" value="${a.messageTa || ''}" maxlength="600" data-change="alertField" data-id="${a.id}" data-k="messageTa"></div>
          <div class="field"><label>Level</label><select class="input" data-change="alertField" data-id="${a.id}" data-k="level">${[['info', 'Information'], ['warning', 'Warning'], ['critical', 'Urgent']].map(([k, l]) => html`<option value="${k}" ${sel(k, a.level || 'info')}>${l}</option>`)}</select></div>
          <div class="field"><label>Related event</label><select class="input" data-change="alertField" data-id="${a.id}" data-k="eventId"><option value="">Campus-wide</option>${d.events.map((e) => html`<option value="${e.id}" ${sel(e.id, a.eventId)}>${e.title || 'Untitled event'}</option>`)}</select></div></div>
        <div class="ca-alert-foot"><label class="ca-switch on-green"><input type="checkbox" ${chk(a.active !== false)} data-change="alertField" data-id="${a.id}" data-k="active"><span></span><em>${a.active === false ? 'Hidden from visitors' : 'Shown to visitors'}</em></label>
          <button class="btn sm ghost danger" data-click="delAlert" data-id="${a.id}">${icon('trash', 14)} Remove alert</button></div></div>`)}</div>`
    : html`<div class="empty"><b>No alerts</b>Visitors see no banner until you add and publish one.</div>`}</div>`;
  };

  // ---------- visitor check-in ----------
  VIEWS.visitors = () => html`<div class="grid g2 ca-vis">
    <div class="card"><div class="card-head"><div><h3>Badge desk</h3><p class="small muted ca-sub">Scan an event badge barcode or QR code, or type the code. A registration reference checks that participant in. Do not scan government identity documents.</p></div></div>
      <form class="card-body ca-form" data-submit="addVisitor" id="ca-badge" autocomplete="off">
        <div class="field"><label for="bd-code">Event badge code</label><div class="ca-code-row"><input class="input" id="bd-code" name="badgeCode" required maxlength="160" data-input="badgeCode" placeholder="e.g. 3f9a1c2b"><button type="button" class="btn" data-click="scan">${icon('camera', 16)} Scan</button></div>
          <div class="hint" id="bd-match"></div></div>
        <video id="ca-video" class="ca-video hidden" autoplay muted playsinline></video>
        <div class="form-grid"><div class="field"><label for="bd-name">Visitor name</label><input class="input" id="bd-name" name="name" required maxlength="160"></div>
          <div class="field"><label for="bd-inst">College / organisation</label><input class="input" id="bd-inst" name="institution" maxlength="160"></div></div>
        <div class="field"><label for="bd-ev">Event</label><select class="input" id="bd-ev" name="eventName"><option value="">General visit</option>${S.draft.events.map((e) => html`<option value="${e.title}">${e.title}</option>`)}</select></div>
        <button class="btn primary">${icon('plus', 16)} Check in visitor</button></form>
      <div class="card-head ca-subhead"><h3>Recent badge check-ins</h3><span class="small muted" id="bd-count"></span></div>
      <div id="ca-visitors" class="ca-records">${loading(2)}</div></div>
    <div class="card"><div class="card-head"><div><h3>Submitted college IDs</h3><p class="small muted ca-sub">Front and back images are private to administrators. Delete them when check-in is complete.</p></div><button class="btn sm" data-click="refreshIds">${icon('refresh', 14)} Refresh</button></div>
      <div id="ca-ids" class="card-body">${loading(2)}</div></div></div>`;
  async function loadVisitors() {
    try { S.visitors = await api.get(`/api/campus/${S.cid}/visitors`); if (S.visitors.length < 300) { S.info.counts.visitors = S.visitors.length; renderKpis(); } } catch (e) { S.visitors = []; toast(e.message, 'error'); }
    drawVisitors();
  }
  function drawVisitors() {
    const box = $('#ca-visitors'); if (!box) return;
    $('#bd-count').textContent = `${S.visitors.length} record${S.visitors.length === 1 ? '' : 's'}`;
    box.innerHTML = (S.visitors.length ? html`${S.visitors.map((r) => html`<div class="ca-record"><div class="grow"><b>${r.name}</b><small>${r.institution || 'Visitor'} · ${r.eventName || 'General visit'} · ${fmt.dateTime(r.createdAt)}</small></div><code class="ca-code">${r.badgeCode}</code>
      <button class="btn sm ghost danger" data-click="delVisitor" data-id="${r.id}" aria-label="Remove ${r.name}">${icon('trash', 15)}</button></div>`)}`
      : html`<div class="empty"><b>No visitors checked in yet.</b></div>`).s;
  }
  async function loadIds() {
    try { S.ids = await api.get(`/api/campus/${S.cid}/id-checkins`); if (S.ids.length < 200) { S.info.counts.idPending = S.ids.filter((r) => r.status === 'new').length; renderKpis(); } } catch (e) { S.ids = []; toast(e.message, 'error'); }
    drawIds();
  }
  function drawIds() {
    const box = $('#ca-ids'); if (!box) return;
    box.innerHTML = (S.ids.length ? html`<div class="stack-sm">${S.ids.map((r) => html`<article class="ca-idcard ${r.status}"><div class="ca-idhead"><div><b>${r.name}</b><small>${r.institution || 'Visitor'} · ${r.eventName || 'General visit'} · ${fmt.dateTime(r.createdAt)}</small></div>
        <span class="badge ${r.status === 'reviewed' ? 'safe' : 'attention'}">${r.status === 'reviewed' ? 'Reviewed' : 'New'}</span></div>
      <div class="ca-idimgs"><a href="${r.front}" target="_blank" rel="noopener"><img src="${r.front}" alt="Front of ${r.name}'s ID" loading="lazy"><span>Front · open</span></a><a href="${r.back}" target="_blank" rel="noopener"><img src="${r.back}" alt="Back of ${r.name}'s ID" loading="lazy"><span>Back · open</span></a></div>
      <div class="btn-row"><button class="btn sm" data-click="reviewId" data-id="${r.id}">${icon(r.status === 'new' ? 'check' : 'undo', 14)} ${r.status === 'new' ? 'Mark reviewed' : 'Mark new'}</button><button class="btn sm ghost danger" data-click="delId" data-id="${r.id}">${icon('trash', 14)} Delete photos</button></div></article>`)}</div>`
      : html`<div class="empty"><b>No ID photos submitted.</b>Visitors can submit their college ID from the visitor guide.</div>`).s;
  }
  function badgeMatch(code) {
    const c = String(code || '').trim().toLowerCase();
    if (!/^[a-f0-9]{8}$/.test(c) || !S.roster) return null;
    return S.roster.find((r) => r.id.slice(0, 8) === c) || null;
  }
  function applyBadge(code) {
    const form = $('#ca-badge'); if (!form) return;
    const hint = $('#bd-match'), r = badgeMatch(code);
    if (r) {
      if (!form.elements.name.value) form.elements.name.value = r.name;
      if (!form.elements.institution.value) form.elements.institution.value = r.institution;
      if ([...form.elements.eventName.options].some((o) => o.value === r.eventTitle)) form.elements.eventName.value = r.eventTitle;
      hint.innerHTML = html`<span class="ca-ok">${icon('check', 13)} Matches registration: ${r.name} · ${r.eventTitle} (${STATUS.find((s) => s[0] === r.status)?.[1] || r.status})</span>`.s;
    } else if (/^[a-f0-9]{8}$/i.test(String(code).trim()) && S.roster) {
      hint.textContent = 'No registration with this reference. It will be recorded as a visitor badge.';
      // the roster may predate a new registration: refresh once per code
      if (S.lastLookup !== code) { S.lastLookup = code; loadRoster(true).then(() => { const i = $('#bd-code'); if (i && i.value === code && badgeMatch(code)) applyBadge(code); }); }
    } else hint.textContent = '';
  }

  // ---------- import & QR ----------
  const qrList = () => { const q = S.qrQ.trim().toLowerCase(); return S.draft.nodes.filter((n) => n.kind !== 'junction' || q).filter((n) => !q || n.name.toLowerCase().includes(q) || n.id.includes(q)); };
  VIEWS.data = () => {
    const list = qrList();
    return html`<div class="grid g2 ca-data">
      <div class="card"><div class="card-head"><h3>Campus dataset</h3></div><div class="card-body">
        <p class="small">Each point is a node with a unique ID, name, X/Y map coordinates (0–100), floor and kind. Paths connect points with metres and stairs status; events, rooms and facilities link to point IDs. Export the draft to edit it offline, import it back, check every route and closure, then publish.</p>
        <div class="btn-row"><button class="btn" data-click="exportJson">${icon('download', 16)} Export draft JSON</button>
          <label class="btn ca-file">${icon('upload', 16)} Import JSON<input type="file" class="sr-only" accept="application/json,.json" data-change="importJson" id="ca-import"></label></div>
        <p class="small muted ca-note">Importing replaces the draft only. Nothing reaches visitors until you publish.</p></div></div>
      <div class="card"><div class="card-head"><h3>How checkpoint QR codes work</h3></div><div class="card-body small">
        <p><b>Checkpoint</b> codes go on posts at surveyed points. Scanning one opens the guide with “You are here” set to that point.</p>
        <p><b>Directions</b> codes go on posters and invitations. Scanning one opens walking directions to that place.</p>
        <p class="muted">The printed point code also works when a phone cannot scan: visitors can type it into the guide search.</p></div></div></div>
      <div class="card ca-gap"><div class="card-head"><div><h3>Checkpoint links</h3><p class="small muted ca-sub" id="ca-qrcount">${list.length} points${S.qrQ ? ' match' : ' (junctions hidden; search to include them)'}</p></div>
        <div class="search-input ca-search">${icon('search', 15)}<input class="input" placeholder="Filter points" value="${S.qrQ}" data-input="qrQ" aria-label="Filter points"></div></div>
        <div class="ca-qrlist" id="ca-qrlist">${qrRows(list)}</div></div>`;
  };
  function qrRows(list) {
    return html`${list.map((n) => html`<div class="ca-qr"><div class="grow"><b>${n.name}</b><small class="muted">Code <code class="ca-code">${n.id}</code> · ${floorName(n.floor)}</small><span class="ca-link">${qrLink(n.id, 'checkpoint')}</span></div>
      <div class="btn-row"><button class="btn sm" data-click="qrPreview" data-id="${n.id}">${icon('qr', 14)} Preview</button>
        <button class="btn sm" data-click="qrDownload" data-id="${n.id}" data-kind="checkpoint">${icon('download', 14)} Checkpoint PNG</button>
        <button class="btn sm" data-click="qrDownload" data-id="${n.id}" data-kind="to">${icon('download', 14)} Directions PNG</button>
        <button class="btn sm ghost" data-click="copyLink" data-id="${n.id}" title="Copy checkpoint link">${icon('clipboard', 14)} Copy link</button></div></div>`)}${list.length ? '' : html`<div class="empty"><b>No points match.</b></div>`}`;
  }

  // ================= publishing =================
  async function doPublish(btn) {
    const issues = problems(S.draft);
    if (issues.length) { S.error = issues; renderMsg(); $('#ca-msg').scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
    btn.disabled = true; btn.innerHTML = '<span class="ca-spin sm"></span> Publishing…';
    const data = clone(S.draft); delete data.version;
    try {
      const res = await api.put(`/api/campus/${S.cid}`, { data, baseVersion: S.base.version });
      S.error = null; S.stale = null; S.base = res; S.draft = clone(res);
      try { const info = await api.get(`/api/campus/${S.cid}/admin`); S.info = info; S.base = info.data; S.draft = clone(info.data); } catch { /* keep the PUT response */ }
      $('#ca-ver').textContent = S.base.version; $('#ca-upd').textContent = fmt.dateTime(S.info.updatedAt);
      renderKpis(); renderBar(); renderMsg(); renderTab();
      toast(`Version ${S.base.version} is now live for visitors.`, 'success', 'Campus guide published');
    } catch (e) {
      renderBar();
      if (e.status === 409) { conflict(e.message); return; }
      S.error = [e.message]; renderMsg(); toast(e.message, 'error', 'Publish failed');
    }
  }
  function conflict(message) {
    const m = modal({ title: 'A newer version was published', body: html`<p>${message}</p><p class="muted">Download your draft first if you want to keep your edits, then reload to continue from the latest published data.</p>`,
      foot: html`<button class="btn" data-close>Cancel</button><button class="btn" id="cf-dl">${icon('download', 16)} Download my draft</button><button class="btn primary" id="cf-reload">${icon('refresh', 16)} Reload latest</button>` });
    $('#cf-dl', m.el).onclick = () => exportJson();
    $('#cf-reload', m.el).onclick = () => { m.close(); reloadLatest(); };
  }
  async function reloadLatest() {
    try {
      const info = await api.get(`/api/campus/${S.cid}/admin`);
      S.info = info; S.base = info.data; S.draft = clone(info.data); S.stale = null; S.error = null;
      renderEditor($('#view')); toast(`Loaded version ${S.base.version}.`, 'success');
    } catch (e) { toast(e.message, 'error'); }
  }
  function exportJson() {
    download(`${slug(S.info.college.short_name)}-campus-guide-v${S.base.version}${isDirty() ? '-draft' : ''}.json`, new Blob([JSON.stringify(S.draft, null, 2)], { type: 'application/json' }));
  }

  // ================= handlers =================
  const syncInputs = (sel2, v, except) => $$(sel2).forEach((i) => { if (i === except) return; if (i.type === 'checkbox') i.checked = !!v; else i.value = Array.isArray(v) ? v.join(', ') : v ?? ''; });
  const HANDLERS = {
    tab: (el) => {
      S.tab = el.dataset.tab; S.rosterStale = true;
      history.replaceState(null, '', `#/admin/campus/${S.cid}?tab=${S.tab}`);
      renderTab();
      if (el.closest('#ca-kpis') || el.closest('#ca-body')) $('.ca-tabs').scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    publish: (b) => doPublish(b),
    discard: async () => {
      if (!(await confirmBox('Discard unsaved changes?', `Your draft goes back to published version ${S.base.version}. This cannot be undone.`, 'Discard changes', true))) return;
      S.draft = clone(S.base); S.error = null; S.selNode = null; renderBar(); renderMsg(); renderTab(); toast('Draft reset to the published guide.');
    },
    dismissError: () => { S.error = null; renderMsg(); },
    reloadLatest: async () => { if (await confirmBox('Reload the latest version?', 'Your unsaved draft will be replaced.', 'Reload', true)) reloadLatest(); },
    exportJson: () => exportJson(),

    // events
    addEvent: () => openEvent(null),
    editEvent: (el) => openEvent(el.dataset.id),
    delEvent: async (el) => {
      const e = S.draft.events.find((x) => x.id === el.dataset.id);
      if (!(await confirmBox('Delete this event?', `“${e.title || 'Untitled event'}” will be removed from the draft. Existing registrations stay in the participant list.`, 'Delete event', true))) return;
      edit((d) => { d.events = d.events.filter((x) => x.id !== e.id); d.alerts.forEach((a) => { if (a.eventId === e.id) delete a.eventId; }); });
    },
    rosterFor: (el) => { S.rosterEvent = el.dataset.id; $('#ca-roster').innerHTML = rosterCard().s; $('#ca-roster').scrollIntoView({ behavior: 'smooth', block: 'start' }); },
    rosterEvent: (el) => { S.rosterEvent = el.value; $('#ca-roster').innerHTML = rosterCard().s; },
    refreshRoster: () => { S.roster = null; $('#ca-roster').innerHTML = rosterCard().s; loadRoster(true); },
    pStatus: async (el) => {
      const r = S.roster.find((x) => x.id === el.dataset.id); const prev = r.status;
      try { await api.put(`/api/campus/${S.cid}/participations/${r.id}`, { name: r.name, institution: r.institution, email: r.email, status: el.value }); r.status = el.value; el.className = `input ca-status s-${r.status}`; toast(`${r.name}: ${STATUS.find((s) => s[0] === r.status)[1].toLowerCase()}.`, 'success'); }
      catch (e) { el.value = prev; toast(e.message, 'error'); }
    },
    delParticipant: async (el) => {
      const r = S.roster.find((x) => x.id === el.dataset.id);
      if (!(await confirmBox('Remove participant?', `Remove ${r.name} from the ${r.eventTitle} roster? This cannot be undone.`, 'Remove', true))) return;
      try { await api.del(`/api/campus/${S.cid}/participations/${r.id}`); S.roster = S.roster.filter((x) => x.id !== r.id); S.info.counts.participants--; renderKpis(); $('#ca-roster').innerHTML = rosterCard().s; toast('Participant removed.'); }
      catch (e) { toast(e.message, 'error'); }
    },

    // rooms
    addRoom: () => openRoom(null),
    editRoom: (el) => openRoom(el.dataset.id),
    delRoom: async (el) => {
      const r = S.draft.rooms.find((x) => x.id === el.dataset.id);
      if (S.draft.events.some((e) => e.venue === r.id)) { toast('Move events from this room to another venue before removing it.', 'error'); return; }
      if (!(await confirmBox('Remove room?', `“${r.name || 'Untitled room'}” will be removed from the draft.`, 'Remove room', true))) return;
      edit((d) => { d.rooms = d.rooms.filter((x) => x.id !== r.id); });
    },

    // map
    flag: (el) => edit((d) => {
      const k = el.dataset.k;
      if (el.type === 'checkbox') d[k] = el.checked;
      else if (k === 'sourceUrl') { if (el.value.trim()) d[k] = el.value.trim(); else delete d[k]; }
      else d[k] = el.value;
    }, false),
    floor: (el) => { S.floor = Number(el.value); if (S.selNode && findNode(S.selNode)?.floor !== S.floor) { S.selNode = null; if (S.mode === 'move') S.mode = 'select'; } refreshMap(); },
    mode: (el) => {
      const m = el.dataset.mode;
      if (m === 'move' && !S.selNode) { toast('Select a point first, then move it.'); return; }
      S.mode = m; refreshMap();
      if (el.dataset.scroll) $('#ca-map').scrollIntoView({ behavior: 'smooth', block: 'center' });
    },
    pin: (el, ev) => {
      if (S.mode !== 'select') { HANDLERS.mapClick($('#ca-map'), ev); return; }
      S.selNode = el.dataset.id;
      refreshMap();
      $$('.ca-node').forEach((r) => r.classList.toggle('sel', r.dataset.node === S.selNode));
    },
    pinClose: () => { S.selNode = null; S.mode = 'select'; refreshMap(); $$('.ca-node.sel').forEach((r) => r.classList.remove('sel')); },
    locate: (el) => {
      const n = findNode(el.dataset.id); S.selNode = n.id; S.floor = n.floor; S.mode = 'select';
      const fs = $('[data-change="floor"]'); if (fs) fs.value = String(n.floor);
      refreshMap(); $$('.ca-node').forEach((r) => r.classList.toggle('sel', r.dataset.node === n.id));
      $('#ca-map').scrollIntoView({ behavior: 'smooth', block: 'center' });
    },
    mapClick: (el, ev) => {
      if (S.mode === 'select') return;
      const r = el.getBoundingClientRect();
      const x = Math.round(Math.min(100, Math.max(0, ((ev.clientX - r.left) / r.width) * 100)) * 10) / 10;
      const y = Math.round(Math.min(100, Math.max(0, ((ev.clientY - r.top) / r.height) * 100)) * 10) / 10;
      if (S.mode === 'add') { addNodeAt(x, y); return; }
      const n = findNode(S.selNode); if (!n) return;
      edit((d) => { const t = d.nodes.find((q) => q.id === n.id); t.x = x; t.y = y; t.floor = S.floor; }, false);
      refreshMap();
      for (const [k, v] of [['x', x], ['y', y], ['floor', S.floor]]) syncInputs(`#ca-nodes [data-id="${cssId(n.id)}"][data-k="${k}"]`, v);
    },
    nodeField: (el) => {
      const n = findNode(el.dataset.id), k = el.dataset.k;
      let v;
      if (k === 'verified') v = el.checked;
      else if (k === 'aliases') v = el.value.split(',').map((x) => x.trim()).filter(Boolean);
      else if (k === 'x' || k === 'y') { v = Number(el.value); if (el.value === '' || !Number.isFinite(v) || v < 0 || v > 100) { el.value = n[k]; toast('X and Y must be between 0 and 100.', 'error'); return; } }
      else if (k === 'floor') { v = Math.trunc(Number(el.value)); if (el.value === '' || !Number.isFinite(v)) { el.value = n.floor; return; } }
      else if (k === 'lat' || k === 'lon') { v = el.value === '' ? undefined : Number(el.value); if (v !== undefined && !Number.isFinite(v)) { el.value = n[k] ?? ''; return; } }
      else if (k === 'name') { v = el.value.trim(); if (!v) { el.value = n.name; toast('A point needs a name.', 'error'); return; } }
      else v = el.value;
      edit((d) => { const t = d.nodes.find((q) => q.id === n.id); if (k === 'aliases' && !v.length) delete t.aliases; else if (v === undefined) delete t[k]; else t[k] = v; }, false);
      syncInputs(`[data-change="nodeField"][data-id="${cssId(n.id)}"][data-k="${k}"]`, v, el);
      if (['x', 'y', 'floor', 'name', 'kind', 'verified'].includes(k)) {
        if (k === 'floor' && S.selNode === n.id) { S.floor = v; const fs = $('[data-change="floor"]'); if (fs && floors().length !== fs.options.length) renderTab(); else if (fs) fs.value = String(v); }
        const m = $('#ca-map'); if (m) m.outerHTML = mapCanvas().s;
        if (k === 'name' && S.selNode === n.id) { const h = $('#ca-node-panel .ca-panel-head b'); if (h) h.textContent = v; }
      }
    },
    nodeQ: (el) => { S.nodeQ = el.value; $('#ca-nodes').innerHTML = nodeRows().s; },
    delNode: async (el) => {
      const n = findNode(el.dataset.id), refs = nodeRefs(n.id);
      if (refs.length) { toast(`${n.name} is used by ${refs.join(', ')}. Remove or relink those first.`, 'error'); return; }
      if (!(await confirmBox('Delete map point?', `“${n.name}” (${n.id}) will be removed from the draft. Printed QR codes for it stop working once you publish.`, 'Delete point', true))) return;
      if (S.selNode === n.id) { S.selNode = null; S.mode = 'select'; }
      edit((d) => { d.nodes = d.nodes.filter((x) => x.id !== n.id); });
    },
    edgeQ: (el) => { S.edgeQ = el.value; $('#ca-edges').innerHTML = edgeRows().s; },
    edgeField: (el) => {
      const k = el.dataset.k, id = el.dataset.id, e = S.draft.edges.find((x) => x.id === id);
      let v;
      if (k === 'closed' || k === 'stairs') v = el.checked;
      else if (k === 'meters') { v = Number(el.value); if (!Number.isFinite(v) || v <= 0) { el.value = e.meters; toast('Path length must be above 0 m.', 'error'); return; } }
      else v = el.value.trim();
      edit((d) => { const t = d.edges.find((x) => x.id === id); if (v === false || v === '') delete t[k]; else t[k] = v; }, false);
      if (k === 'closed') { el.closest('.ca-edge').classList.toggle('closed', v); $('em', el.parentElement).textContent = v ? 'Closed' : 'Open'; }
      if (k === 'closed' || k === 'stairs') { const m = $('#ca-map'); if (m) m.outerHTML = mapCanvas().s; }
    },
    addEdge: (form) => {
      const f = formData(form);
      if (f.from === f.to) { toast('Choose two different points.', 'error'); return; }
      if (S.draft.edges.some((e) => (e.from === f.from && e.to === f.to) || (e.from === f.to && e.to === f.from))) { toast('These points are already connected.', 'error'); return; }
      const meters = Number(f.meters); if (!(meters > 0)) { toast('Path length must be above 0 m.', 'error'); return; }
      const e = { id: 'path-' + hex(8), from: f.from, to: f.to, meters }; if (f.stairs) e.stairs = true;
      edit((d) => d.edges.push(e)); toast(`Path added: ${nodeName(f.from)} → ${nodeName(f.to)}.`, 'success');
    },
    delEdge: async (el) => {
      const e = S.draft.edges.find((x) => x.id === el.dataset.id);
      if (!(await confirmBox('Remove path?', `${nodeName(e.from)} → ${nodeName(e.to)} will no longer be used for directions. To block it temporarily, mark it closed instead.`, 'Remove path', true))) return;
      edit((d) => { d.edges = d.edges.filter((x) => x.id !== e.id); });
    },
    floorFile: async (input) => {
      const file = input.files[0]; if (!file) return;
      const f = input.dataset.floor, lbl = input.parentElement; lbl.classList.add('busy');
      try { const url = await uploadImage(file, 'map'); S.floor = Number(f); edit((d) => { d.mapImages = { ...(d.mapImages || {}), [f]: url }; }); toast(`${floorName(Number(f))} plan uploaded. Publish to show visitors.`, 'success'); }
      catch (e) { lbl.classList.remove('busy'); toast(e.message, 'error'); }
      input.value = '';
    },
    floorRemove: async (el) => {
      const f = el.dataset.floor;
      if (!(await confirmBox('Remove floor image?', `${floorName(Number(f))} will show as a schematic. The uploaded file is deleted when you publish.`, 'Remove image', true))) return;
      edit((d) => { const m = { ...(d.mapImages || {}) }; delete m[f]; d.mapImages = m; });
    },
    floorAdd: (form) => {
      const f = Math.trunc(Number(form.elements.floor.value)); if (!Number.isFinite(f)) return;
      if (floors().includes(f)) { S.floor = f; renderTab(); return; }
      const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/png,image/jpeg,image/webp';
      input.onchange = async () => { const file = input.files[0]; if (!file) return; try { const url = await uploadImage(file, 'map'); S.floor = f; edit((d) => { d.mapImages = { ...(d.mapImages || {}), [String(f)]: url }; }); toast(`${floorName(f)} plan uploaded. Add points on it, then publish.`, 'success'); } catch (e) { toast(e.message, 'error'); } };
      input.click();
    },
    gps: (el) => {
      const id = el.dataset.id, n = findNode(id);
      if (!navigator.geolocation) { toast('Location is not available on this device.', 'error'); return; }
      el.disabled = true; el.innerHTML = '<span class="ca-spin sm"></span> Locating…';
      const done = () => { el.disabled = false; el.innerHTML = html`${icon('locate', 14)} Use my location`.s; };
      navigator.geolocation.getCurrentPosition((p) => {
        done();
        if (p.coords.accuracy > 20) { toast(`GPS accuracy is ±${Math.round(p.coords.accuracy)} m, which is too low. Move outdoors and try again.`, 'error'); return; }
        const lat = Math.round(p.coords.latitude * 1e6) / 1e6, lon = Math.round(p.coords.longitude * 1e6) / 1e6;
        edit((d) => { const t = d.nodes.find((x) => x.id === id); t.lat = lat; t.lon = lon; }, false);
        syncInputs(`[data-change="nodeField"][data-id="${cssId(id)}"][data-k="lat"]`, lat);
        syncInputs(`[data-change="nodeField"][data-id="${cssId(id)}"][data-k="lon"]`, lon);
        toast(`Captured ${n.name} at ±${Math.round(p.coords.accuracy)} m. Review before publishing.`, 'success');
      }, () => { done(); toast('Location unavailable. Allow location access and try again.', 'error'); }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
    },

    // facilities & alerts
    facField: (el) => edit((d) => { const f = d.facilities.find((x) => x.id === el.dataset.id); if (el.dataset.k === 'name') { if (el.value.trim()) f.name = el.value.trim(); else el.value = f.name; } else f[el.dataset.k] = el.value; }, false),
    addFacility: () => edit((d) => d.facilities.push({ id: 'fac-' + hex(8), name: 'New facility', kind: 'help', node: places()[0]?.id || d.nodes[0].id })),
    delFacility: async (el) => {
      const f = S.draft.facilities.find((x) => x.id === el.dataset.id);
      if (!(await confirmBox('Remove facility?', `“${f.name}” will be removed from the draft.`, 'Remove', true))) return;
      edit((d) => { d.facilities = d.facilities.filter((x) => x.id !== f.id); });
    },
    alertField: (el) => {
      const k = el.dataset.k;
      edit((d) => {
        const a = d.alerts.find((x) => x.id === el.dataset.id);
        if (k === 'active') a.active = el.checked;
        else if (k === 'eventId' || k === 'messageTa') { if (el.value.trim()) a[k] = el.value.trim(); else delete a[k]; }
        else a[k] = k === 'message' ? el.value.trim() : el.value;
      }, false);
      const row = el.closest('.ca-alertrow');
      if (k === 'level') row.className = row.className.replace(/lv-\w+/, `lv-${el.value}`);
      if (k === 'active') { row.classList.toggle('off', !el.checked); $('em', el.parentElement).textContent = el.checked ? 'Shown to visitors' : 'Hidden from visitors'; }
    },
    addAlert: () => edit((d) => d.alerts.unshift({ id: 'alert-' + hex(8), message: 'Venue changed — check updated directions.', level: 'warning', active: true })),
    delAlert: async (el) => {
      const a = S.draft.alerts.find((x) => x.id === el.dataset.id);
      if (!(await confirmBox('Remove alert?', `“${a.message}” will be removed from the draft.`, 'Remove alert', true))) return;
      edit((d) => { d.alerts = d.alerts.filter((x) => x.id !== a.id); });
    },

    // visitor check-in
    badgeCode: (el) => applyBadge(el.value),
    scan: async (btn) => {
      if (scanStop) { stopScan(); return; }
      const video = $('#ca-video');
      video.classList.remove('hidden'); btn.innerHTML = html`${icon('x', 16)} Stop`.s;
      try {
        await startScan(video, (text) => { const input = $('#bd-code'); if (!input) return; input.value = String(text).trim().slice(0, 160); applyBadge(input.value); toast('Badge scanned.', 'success'); });
      } catch (e) {
        stopScan();
        toast(e && e.name === 'NotAllowedError' ? 'Camera permission denied. Allow it in your browser settings, or type the code.' : (e && e.message) || 'Could not open the camera.', 'error');
      }
    },
    addVisitor: async (form) => {
      const f = formData(form);
      const match = badgeMatch(f.badgeCode);
      try {
        const rec = await api.post(`/api/campus/${S.cid}/visitors`, { name: f.name.trim(), institution: f.institution.trim(), badgeCode: f.badgeCode.trim(), eventName: f.eventName });
        S.visitors = [rec, ...(S.visitors || [])]; S.info.counts.visitors++;
        stopScan(); form.reset(); $('#bd-match').textContent = ''; drawVisitors(); renderKpis();
        if (match && match.status === 'registered') { match.status = 'checked_in'; toast(`${rec.name} checked in and marked present for ${match.eventTitle}.`, 'success'); }
        else toast(`${rec.name} checked in.`, 'success');
        $('#bd-code').focus();
      } catch (e) { toast(e.message, 'error'); }
    },
    delVisitor: async (el) => {
      const r = S.visitors.find((x) => x.id === el.dataset.id);
      if (!(await confirmBox('Remove visitor record?', `Remove the badge check-in for ${r.name}? This cannot be undone.`, 'Remove', true))) return;
      try { await api.del(`/api/campus/${S.cid}/visitors/${r.id}`); S.visitors = S.visitors.filter((x) => x.id !== r.id); S.info.counts.visitors--; drawVisitors(); renderKpis(); }
      catch (e) { toast(e.message, 'error'); }
    },
    refreshIds: () => { $('#ca-ids').innerHTML = loading(2).s; loadIds(); },
    reviewId: async (el) => {
      const r = S.ids.find((x) => x.id === el.dataset.id), status = r.status === 'new' ? 'reviewed' : 'new';
      try { await api.put(`/api/campus/${S.cid}/id-checkins/${r.id}`, { status }); r.status = status; S.info.counts.idPending += status === 'new' ? 1 : -1; drawIds(); renderKpis(); }
      catch (e) { toast(e.message, 'error'); }
    },
    delId: async (el) => {
      const r = S.ids.find((x) => x.id === el.dataset.id);
      if (!(await confirmBox('Delete ID photos?', `Both ID photos for ${r.name} will be permanently deleted. This cannot be undone.`, 'Delete photos', true))) return;
      try { await api.del(`/api/campus/${S.cid}/id-checkins/${r.id}`); if (r.status === 'new') S.info.counts.idPending--; S.ids = S.ids.filter((x) => x.id !== r.id); drawIds(); renderKpis(); toast('ID photos deleted.'); }
      catch (e) { toast(e.message, 'error'); }
    },

    // import & QR
    importJson: async (input) => {
      const file = input.files[0]; input.value = ''; if (!file) return;
      let obj;
      try { obj = JSON.parse(await file.text()); } catch { toast('That file is not valid JSON.', 'error'); return; }
      const issues = problems(obj);
      if (issues.length || !CompassData.validCampus(obj)) {
        const list = issues.length ? issues : ['The map data failed validation.'];
        modal({ title: 'This file cannot be imported', body: html`<p>${file.name} has ${list.length} problem${list.length === 1 ? '' : 's'}. Fix ${list.length === 1 ? 'it' : 'them'} and import again.</p><ul class="ca-issues">${list.slice(0, 20).map((x) => html`<li>${x}</li>`)}</ul>`, foot: html`<button class="btn primary" data-close>OK</button>` });
        return;
      }
      const summary = `${obj.nodes.length} points, ${obj.edges.length} paths, ${obj.events.length} events, ${(obj.rooms || []).length} rooms`;
      if (!(await confirmBox('Replace the draft with this file?', `${file.name}: ${summary}. Your current draft${isDirty() ? ', including unsaved changes,' : ''} will be replaced. Nothing is published until you select Publish.`, 'Import', true))) return;
      obj.version = S.base.version;
      S.draft = obj; S.selNode = null; S.mode = 'select'; renderBar(); renderTab();
      toast('Draft imported. Review it, then publish.', 'success');
    },
    qrQ: (el) => {
      S.qrQ = el.value; const list = qrList();
      $('#ca-qrlist').innerHTML = qrRows(list).s;
      $('#ca-qrcount').textContent = `${list.length} points${S.qrQ ? ' match' : ' (junctions hidden; search to include them)'}`;
    },
    qrDownload: (el) => downloadQr(findNode(el.dataset.id), el.dataset.kind),
    copyLink: async (el) => {
      const link = qrLink(el.dataset.id, 'checkpoint');
      try { await navigator.clipboard.writeText(link); toast('Checkpoint link copied.', 'success'); } catch { window.prompt('Copy this link', link); }
    },
    qrPreview: (el) => {
      const n = findNode(el.dataset.id);
      const m = modal({ title: n.name, wide: true, body: html`<div class="ca-qrprev">${['checkpoint', 'to'].map((k) => html`<figure><div class="ca-qrimg" data-kind="${k}"></div><figcaption><b>${k === 'checkpoint' ? 'Checkpoint · You are here' : 'Directions to this place'}</b><span class="ca-link">${qrLink(n.id, k)}</span>
        <button class="btn sm" data-click="dl" data-kind="${k}">${icon('download', 14)} Download PNG</button></figcaption></figure>`)}</div>` });
      $$('.ca-qrimg', m.el).forEach((box) => { const c = qrFor(n, box.dataset.kind); c.setAttribute('role', 'img'); c.setAttribute('aria-label', `QR code for ${n.name}`); box.appendChild(c); });
      bind(m.el, { dl: (b) => downloadQr(n, b.dataset.kind) });
    },
  };
})();
