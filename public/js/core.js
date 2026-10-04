/* Core: templating, API client, router, shell, UI helpers. No build step, no dependencies. */
(function () {
  'use strict';
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
  class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
  const raw = (s) => new Raw(String(s ?? ''));
  const renderVal = (v) => (v === null || v === undefined || v === false ? '' : Array.isArray(v) ? v.map(renderVal).join('') : v instanceof Raw ? v.s : esc(v));
  function html(strings, ...vals) { let out = ''; strings.forEach((s, i) => { out += s; if (i < vals.length) out += renderVal(vals[i]); }); return new Raw(out); }
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // ---------- state ----------
  const store = {
    get(k, d = null) { try { const v = localStorage.getItem('aip.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('aip.' + k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
  };
  const state = { me: null, platform: null, view: null };

  // ---------- API ----------
  class ApiError extends Error { constructor(status, message, details) { super(message); this.status = status; this.details = details; } }
  async function api(method, url, body) {
    let res;
    try {
      res = await fetch(url, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...(state.me ? { 'X-CSRF-Token': state.me.csrf } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch { throw new ApiError(0, 'Unable to reach the server. Check your connection and try again.'); }
    let data = null;
    try { data = await res.json(); } catch { /* non-JSON */ }
    if (!res.ok) {
      if (res.status === 401 && state.me && !url.startsWith('/api/auth/login')) { state.me = null; toast('Your session has ended. Please sign in again.', 'error'); go(loginHref()); }
      throw new ApiError(res.status, (data && data.error) || 'Something went wrong. Please try again.', data && data.details);
    }
    return data;
  }
  api.get = (u) => api('GET', u); api.post = (u, b) => api('POST', u, b || {}); api.put = (u, b) => api('PUT', u, b || {}); api.del = (u) => api('DELETE', u);
  const qs = (o) => { const p = Object.entries(o || {}).filter(([, v]) => v !== '' && v !== null && v !== undefined); return p.length ? '?' + p.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&') : ''; };

  function loginHref() {
    const c = store.get('college');
    return c ? `#/college/${c.id}/login` : '#/universities';
  }

  // ---------- router ----------
  const routes = [];
  function route(pattern, handler, opts = {}) {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    routes.push({ re, keys, handler, opts });
  }
  function go(hash) { if (location.hash === hash) render(); else location.hash = hash; }
  function parseHash() {
    const h = location.hash.replace(/^#/, '') || '/';
    const [path, query] = h.split('?');
    return { path, query: Object.fromEntries(new URLSearchParams(query || '')) };
  }
  let renderSeq = 0;
  async function render() {
    const seq = ++renderSeq;
    const { path, query } = parseHash();
    closeMenus();
    for (const r of routes) {
      const m = path.match(r.re);
      if (!m) continue;
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      if (r.opts.roles) {
        if (!state.me) await loadMe();
        if (seq !== renderSeq) return;
        if (!state.me) { go(loginHref()); return; }
        if (!r.opts.roles.includes(state.me.role)) { go(state.me.home); return; }
      }
      state.view = { path, params, query, onLive: null };
      try { await r.handler(params, query); }
      catch (e) { console.error(e); if (seq === renderSeq) showFatal(e); }
      window.scrollTo(0, 0);
      return;
    }
    go('#/');
  }
  function showFatal(e) {
    const target = $('#view') || $('#app');
    target.innerHTML = html`<div class="card error-state"><b>${e.status === 403 ? 'You do not have permission to access this record.' : 'Unable to load this page.'}</b>
      <p class="muted">${e.status === 403 ? 'This information belongs to another institution or is outside your role.' : e.message}</p>
      <button class="btn primary" id="retry-btn">Retry</button></div>`;
    $('#retry-btn').onclick = () => render();
  }
  async function loadMe() {
    try { state.me = await api.get('/api/auth/me'); connectEvents(); } catch { state.me = null; }
    return state.me;
  }

  // ---------- event delegation (CSP blocks inline handlers) ----------
  // Handlers merge per root element, so re-binding after a re-render never stacks listeners.
  function bind(root, newHandlers) {
    root._aipHandlers = { ...(root._aipHandlers || {}), ...newHandlers };
    if (root._aipBound) return;
    root._aipBound = true;
    const handlers = new Proxy({}, { get: (_, k) => root._aipHandlers[k] });
    const find = (ev, attr) => { const el = ev.target.closest(`[${attr}]`); return el && root.contains(el) ? el : null; };
    root.addEventListener('click', (ev) => { const el = find(ev, 'data-click'); if (el && handlers[el.dataset.click]) { ev.preventDefault(); handlers[el.dataset.click](el, ev); } });
    root.addEventListener('submit', (ev) => { const el = ev.target.closest('form[data-submit]'); if (el && handlers[el.dataset.submit]) { ev.preventDefault(); handlers[el.dataset.submit](el, ev); } });
    root.addEventListener('change', (ev) => { const el = find(ev, 'data-change'); if (el && handlers[el.dataset.change]) handlers[el.dataset.change](el, ev); });
    root.addEventListener('input', (ev) => { const el = find(ev, 'data-input'); if (el && handlers[el.dataset.input]) handlers[el.dataset.input](el, ev); });
  }
  const formData = (form) => {
    const out = {};
    for (const el of form.elements) {
      if (!el.name) continue;
      if (el.type === 'checkbox') out[el.name] = el.checked;
      else if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; }
      else out[el.name] = el.value;
    }
    return out;
  };

  // ---------- UI helpers ----------
  function toast(message, kind = 'info', title) {
    const t = document.createElement('div');
    t.className = `toast ${kind}`;
    t.innerHTML = html`<div>${title ? html`<b>${title}</b>` : ''}${message}</div>`.s;
    $('#toasts').appendChild(t);
    setTimeout(() => t.remove(), kind === 'error' ? 6500 : 4200);
  }
  function modal({ title, body, wide = false, foot = null, onMount = null }) {
    const root = $('#modal-root');
    root.innerHTML = html`<div class="modal-wrap" id="mw"><div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${title}">
      <div class="modal-head"><h2>${title}</h2><button class="icon-btn" data-close aria-label="Close">${icon('x')}</button></div>
      <div class="modal-body">${body}</div>${foot ? html`<div class="modal-foot">${foot}</div>` : ''}</div></div>`.s;
    const close = () => { root.innerHTML = ''; document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    $('#mw').addEventListener('click', (e) => { if (e.target.id === 'mw' || e.target.closest('[data-close]')) close(); });
    const el = $('.modal', root);
    if (onMount) onMount(el, close);
    const first = $('input, select, textarea', el); if (first) first.focus();
    return { el, close };
  }
  function confirmBox(title, message, okLabel = 'Confirm', danger = false) {
    return new Promise((resolve) => {
      const m = modal({ title, body: html`<p>${message}</p>`, foot: html`<button class="btn" data-close>Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" id="cf-ok">${okLabel}</button>` });
      $('#cf-ok', m.el).onclick = () => { m.close(); resolve(true); };
      $('#mw').addEventListener('click', (e) => { if (e.target.id === 'mw' || e.target.closest('[data-close]')) resolve(false); });
    });
  }
  const loading = (rows = 4) => html`<div class="card card-pad stack-sm">${Array.from({ length: rows }, (_, i) => html`<div class="skeleton" style="width:${90 - i * 12}%"></div>`)}</div>`;
  function errorBox(target, e, retry) {
    target.innerHTML = html`<div class="card error-state"><b>${e.status === 403 ? 'You do not have permission to access this record.' : e.message || 'Unable to load data.'}</b>
      <button class="btn primary" data-retry>Retry</button></div>`.s;
    $('[data-retry]', target).onclick = retry;
  }

  const fmt = {
    date: (d) => { if (!d) return '—'; const x = new Date(String(d).replace(' ', 'T') + (String(d).length <= 10 ? 'T00:00:00' : 'Z')); return Number.isNaN(x.getTime()) ? d : x.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); },
    dateTime: (d) => { if (!d) return '—'; const x = new Date(String(d).replace(' ', 'T') + (/[zZ+]/.test(String(d).slice(-6)) ? '' : 'Z')); return Number.isNaN(x.getTime()) ? d : x.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }); },
    ago: (d) => { const x = new Date(String(d).replace(' ', 'T') + (/[zZ]$/.test(d) ? '' : 'Z')); const s = (Date.now() - x.getTime()) / 1000; if (s < 60) return 'just now'; if (s < 3600) return `${Math.floor(s / 60)} min ago`; if (s < 86400) return `${Math.floor(s / 3600)} h ago`; if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`; return fmt.date(d); },
    pct: (v) => (v === null || v === undefined ? '—' : `${Number(v).toFixed(1).replace(/\.0$/, '')}%`),
    num: (v) => (v === null || v === undefined ? '—' : Number(v).toLocaleString('en-IN')),
    marks: (v) => (v === null || v === undefined ? '—' : String(Number(v)).replace(/\.0+$/, '')),
  };
  const levelClass = (l) => ({ High: 'high', Attention: 'attention', Normal: 'normal', Critical: 'critical', Safe: 'safe' }[l] || 'info');
  const riskBadge = (l) => html`<span class="badge ${levelClass(l)}">${l === 'High' ? 'High Risk' : l || 'Normal'}</span>`;
  const attBadge = (s) => html`<span class="badge ${levelClass(s)}">${s}</span>`;
  function meter(pct, threshold, status) {
    const p = Math.max(0, Math.min(100, pct || 0));
    return html`<div class="meter ${status === 'Critical' ? 'critical' : status === 'Attention' ? 'attention' : ''}" title="${fmt.pct(pct)}"><span style="width:${p}%"></span>${threshold ? html`<i class="mark" style="left:${threshold}%"></i>` : ''}</div>`;
  }
  const initials = (n) => String(n || '?').replace(/^(Dr|Prof|Mr|Ms|Mrs)\.\s*/i, '').split(/\s+/).map((x) => x[0]).slice(0, 2).join('').toUpperCase();

  // Table renderer with mobile stacking (data-label on each cell)
  function table(columns, rows, { empty = 'No records found.', rowAttrs = null, cls = 'stack-sm' } = {}) {
    if (!rows.length) return html`<div class="empty"><b>${empty}</b></div>`;
    return html`<div class="table-wrap"><table class="table ${cls}"><thead><tr>${columns.map((c) => html`<th class="${c.num ? 'num' : ''}">${c.label}</th>`)}</tr></thead>
      <tbody>${rows.map((r, i) => html`<tr ${rowAttrs ? raw(rowAttrs(r, i)) : ''}>${columns.map((c) => html`<td data-label="${c.label}" class="${c.num ? 'num' : ''} ${c.cls || ''}">${c.render ? c.render(r, i) : r[c.key] ?? '—'}</td>`)}</tr>`)}</tbody></table></div>`;
  }
  function pager(res, handlerName) {
    if (!res || res.pages <= 1) return res ? html`<div class="pager"><span>${fmt.num(res.total)} record${res.total === 1 ? '' : 's'}</span></div>` : '';
    return html`<div class="pager"><span>${fmt.num(res.total)} records · page ${res.page} of ${res.pages}</span><div class="btn-row">
      <button class="btn sm" data-click="${handlerName}" data-page="${res.page - 1}" ${res.page <= 1 ? 'disabled' : ''}>Previous</button>
      <button class="btn sm" data-click="${handlerName}" data-page="${res.page + 1}" ${res.page >= res.pages ? 'disabled' : ''}>Next</button></div></div>`;
  }

  // ---------- icons ----------
  const ICONS = {
    home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    book: '<path d="M4 4h11a3 3 0 0 1 3 3v13H7a3 3 0 0 1-3-3z"/><path d="M4 17a3 3 0 0 1 3-3h11"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v4M12 17.5v.5"/>',
    bell: '<path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 4 6"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
    check: '<path d="M5 12l5 5 9-10"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    building: '<path d="M4 21V5l8-3 8 3v16"/><path d="M9 21v-4h6v4M8 8h2M14 8h2M8 12h2M14 12h2"/>',
    layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
    shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z"/>',
    log: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 12h7M9 16h7"/>',
    upload: '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>',
    download: '<path d="M12 4v12M7 11l5 5 5-5M4 20h16"/>',
    clipboard: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M9 10h6M9 14h6"/>',
    target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r=".8"/>',
    grad: '<path d="M2 9l10-5 10 5-10 5z"/><path d="M6 11v5c3 2.5 9 2.5 12 0v-5M22 9v6"/>',
    logout: '<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>',
    pin: '<path d="M12 21s-7-6.5-7-12a7 7 0 0 1 14 0c0 5.5-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/>',
    print: '<path d="M7 9V3h10v6M7 17H4v-7h16v7h-3M7 14h10v7H7z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    compass: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
    map: '<path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>',
    grid: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M3 14h18M9 4v16M15 4v16"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    eyeoff: '<path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6C3.9 8.3 2 12 2 12s3.5 7 10 7a9.8 9.8 0 0 0 4.4-1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
    qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3"/>',
    nav: '<path d="M3 11l18-8-8 18-2-8z"/>',
    locate: '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
    heart: '<path d="M12 20s-7-4.4-9-9a5 5 0 0 1 9-3 5 5 0 0 1 9 3c-2 4.6-9 9-9 9z"/>',
    share: '<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="M8.2 10.9l7.6-4.6M8.2 13.1l7.6 4.6"/>',
    external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    zoomin: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4M8 11h6M11 8v6"/>',
    zoomout: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4M8 11h6"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/>',
    back: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
    flag: '<path d="M5 21V4h11l-1.5 4L16 12H5"/>',
    undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
    save: '<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/>',
    sigma: '<path d="M18 5H7l6 7-6 7h11"/>',
  };
  // nerd brand mark: a pair of round lenses with a gold spark, drawn inline so it scales crisply everywhere.
  const logo = (size = 32, onDark = false) => {
    const bg = onDark ? '#ffffff' : '#14234a', fg = onDark ? '#14234a' : '#ffffff';
    return raw(`<svg class="nerd-mark" width="${size}" height="${size}" viewBox="0 0 40 40" aria-hidden="true"><rect width="40" height="40" rx="11" fill="${bg}"/><circle cx="13.2" cy="21.5" r="5.7" fill="none" stroke="${fg}" stroke-width="2.6"/><circle cx="26.8" cy="21.5" r="5.7" fill="none" stroke="${fg}" stroke-width="2.6"/><path d="M18.4 20.4q1.6-1.5 3.2 0" fill="none" stroke="${fg}" stroke-width="2.4" stroke-linecap="round"/><path d="M7.6 19.6 5.4 16.8M32.4 19.6l2.2-2.8" stroke="${fg}" stroke-width="2.4" stroke-linecap="round"/><circle cx="31.2" cy="9.4" r="2.6" fill="#f2b33d"/></svg>`);
  };
  const wordmark = (size = 30, sub = '', onDark = false) => html`<span class="nerd-brand">${logo(size, onDark)}<span class="nerd-word"><b>nerd</b>${sub ? html`<small>${sub}</small>` : ''}</span></span>`;
  const icon = (name, size = 18) => raw(`<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`);

  // ---------- live events ----------
  let es = null, helloTimer = null, poll = null;
  function connectEvents() {
    if (es || poll || !window.EventSource) return;
    es = new EventSource('/api/events');
    // Some hosts (Cloudflare quick links) cannot stream events; then check for new notifications every 30 s.
    helloTimer = setTimeout(() => { disconnectEvents(); pollEvents(); }, 15000);
    es.addEventListener('hello', () => { clearTimeout(helloTimer); helloTimer = null; });
    es.addEventListener('notification', (e) => {
      const n = JSON.parse(e.data);
      if (state.me) state.me.unread = (state.me.unread || 0) + 1;
      updateBell();
      toast(n.body, n.severity === 'critical' ? 'error' : 'info', n.title);
      if (state.view && state.view.onLive) state.view.onLive('notification', n);
    });
    es.addEventListener('refresh', (e) => { if (state.view && state.view.onLive) state.view.onLive('refresh', JSON.parse(e.data)); });
    es.onerror = () => { /* the browser reconnects automatically */ };
  }
  function pollEvents() {
    poll = setInterval(async () => {
      if (!state.me) return;
      try {
        const me = await api.get('/api/auth/me'); const before = state.me.unread || 0;
        state.me.unread = me.unread || 0; updateBell();
        if (state.me.unread > before) toast('Open the bell to read them.', 'info', `${state.me.unread - before} new notification${state.me.unread - before === 1 ? '' : 's'}`);
      } catch { /* try again next time */ }
    }, 30000);
  }
  function disconnectEvents() { clearTimeout(helloTimer); helloTimer = null; clearInterval(poll); poll = null; if (es) { es.close(); es = null; } }
  function updateBell() { const d = $('#bell-dot'); if (!d) return; const n = state.me?.unread || 0; d.textContent = n > 99 ? '99+' : n; d.classList.toggle('hidden', !n); }

  // ---------- app shell ----------
  const NAV = {
    student: [['Dashboard', '#/student', 'home'], ['Attendance', '#/student/attendance', 'calendar'], ['My Courses', '#/student/courses', 'book'], ['Timetable', '#/student/timetable', 'grid'],
      ['Classroom', '#/student/classroom', 'book'], ['Performance', '#/student/performance', 'chart'], ['Clubs', '#/student/clubs', 'users'],
      ['Notifications', '#/student/notifications', 'bell'], ['Campus Guide', '#/campus', 'compass'], ['Profile', '#/student/profile', 'user']],
    staff: [['Dashboard', '#/staff', 'home'], ['My Courses', '#/staff/courses', 'book'], ['Timetable', '#/staff/timetable', 'grid'], ['Classroom', '#/staff/classroom', 'book'], ['Students', '#/staff/go/students', 'users'], ['Attendance', '#/staff/go/attendance', 'calendar'],
      ['Marks', '#/staff/go/marks', 'clipboard'], ['Voice Entry', '#/staff/go/voice', 'mic'], ['Voice Sheets', '#/staff/sheets', 'grid'], ['Analytics & Risk', '#/staff/risk', 'chart'], ['Clubs', '#/staff/clubs', 'users'],
      ['Notifications', '#/staff/notifications', 'bell'], ['Campus Guide', '#/campus', 'compass'], ['Profile', '#/staff/profile', 'user']],
    // Admins run the institution and the portals; teaching data stays in the teacher portal.
    admin: [
      ['Dashboard', '#/admin', 'home'],
      ['People'], ['Students', '#/admin/records/students', 'grad'], ['Teachers', '#/admin/records/staff', 'users'],
      ['Administrators', '#/admin/records/admins', 'shield', ['super_admin', 'university_admin', 'college_admin']],
      ['Portals'], ['Student & teacher portals', '#/admin/portals', 'layers'], ['Course requests', '#/admin/registrations', 'clipboard'], ['Notifications', '#/admin/notifications', 'bell'],
      ['Institution'], ['Universities', '#/admin/records/universities', 'building', ['super_admin']], ['Colleges', '#/admin/records/colleges', 'building', ['super_admin', 'university_admin']],
      ['Departments', '#/admin/records/departments', 'building'], ['Campuses', '#/admin/records/campuses', 'pin'], ['Campus Guide', '#/admin/campus', 'compass'],
      ['System'], ['Import / Export', '#/admin/data', 'upload'], ['Audit Logs', '#/admin/audit', 'log'], ['Settings', '#/admin/settings', 'settings']],
  };
  // Nav entries an admin can switch off per portal (see Admin → Student & teacher portals).
  const FEATURE_OF = { '#/student/timetable': 'timetable', '#/staff/timetable': 'timetable', '#/student/classroom': 'classroom', '#/staff/classroom': 'classroom',
    '#/student/clubs': 'clubs', '#/staff/clubs': 'clubs', '#/staff/go/voice': 'voice', '#/staff/sheets': 'voice', '#/campus': 'campus' };
  const featureOn = (me, href) => !me.features || !FEATURE_OF[href] || me.features[FEATURE_OF[href]] !== false;
  const featureOnName = (name) => { const me = state.me; return !me || !me.features || me.features[name] !== false; };
  function navFor(role) { return role === 'student' ? NAV.student : role === 'staff' ? NAV.staff : NAV.admin; }

  function shell(activeHref, inner) {
    const me = state.me;
    const items = navFor(me.role).filter((n) => (!n[3] || n[3].includes(me.role)) && featureOn(me, n[1]) && (n[1] !== '#/campus' || me.campusGuide) && (n[1] !== '#/admin/campus' || me.permissions.includes('manage_campus_guide')));
    const path = location.hash.split('?')[0];
    const isActive = (href) => activeHref ? activeHref === href : path === href;
    const crestFor = (text, accent, logo) => {
      if (logo) return html`<span class="logo-mark sm has-img"><img src="${logo}" alt="" loading="lazy"></span>`;
      const t = String(text || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toUpperCase();
      return html`<span class="logo-mark sm ${t.length > 4 ? 'long' : ''}" style="background:${accent || '#14234a'}">${t}</span>`;
    };
    const inst = me.college ? html`<div class="inst">${crestFor(me.college.short_name || me.college.code, me.college.accent, me.college.logo)}<span class="inst-text"><b>${me.college.name}</b>${me.university ? me.university.name : ''}${me.department ? html` · ${me.department.code}` : ''}</span></div>`
      : me.university ? html`<div class="inst">${crestFor(me.university.short_name || me.university.code, me.university.accent, me.university.logo)}<span class="inst-text"><b>${me.university.name}</b>University administration</span></div>`
      : html`<div class="inst">${crestFor('nerd', '#14234a')}<span class="inst-text"><b>All institutions</b>Platform administration</span></div>`;
    $('#app').innerHTML = html`
      <div class="shell" id="shell">
        <aside class="sidebar" aria-label="Main navigation">
          <a class="brand" href="${me.home}">${wordmark(30, me.roleLabel, true)}</a>
          ${inst}
          <nav class="nav">${items.map((n) => (n.length === 1 ? html`<div class="group">${n[0]}</div>` : html`<a href="${n[1]}" class="${isActive(n[1]) ? 'active' : ''}">${icon(n[2])}<span>${n[0]}</span>${n[2] === 'bell' && me.unread ? html`<span class="count">${me.unread}</span>` : ''}</a>`))}</nav>
        </aside>
        <div class="backdrop" id="backdrop"></div>
        <div class="main">
          <header class="topbar">
            <button class="icon-btn menu-btn" id="menu-btn" aria-label="Open menu">${icon('menu')}</button>
            <div class="gsearch search-input"><span>${icon('search', 16)}</span><input class="input" id="gsearch" placeholder="${me.role === 'student' ? 'Search your courses and notifications' : me.role === 'staff' ? 'Search your courses and students' : 'Search students, staff, courses, departments'}" autocomplete="off" aria-label="Search"><div class="results hidden" id="gresults"></div></div>
            <div class="top-actions">
              <button class="icon-btn" id="lang-btn" aria-label="Change language" title="Language">${icon('globe')}</button>
              <button class="icon-btn" id="bell-btn" aria-label="Notifications">${icon('bell')}<span class="dot hidden" id="bell-dot"></span></button>
              <button class="user-chip" id="user-btn"><span class="avatar">${initials(me.name)}</span><span class="who"><b>${me.name}</b><small>${me.rollNo || me.employeeCode || me.loginId}</small></span></button>
            </div>
          </header>
          <main class="content" id="view">${inner || loading()}</main>
        </div>
      </div>`.s;
    updateBell();
    const sh = $('#shell');
    $('#menu-btn').onclick = () => sh.classList.add('nav-open');
    $('#backdrop').onclick = () => sh.classList.remove('nav-open');
    const lb = $('#lang-btn'); if (lb) lb.onclick = (e) => { if (window.App.i18n) App.i18n.menu(e); };
    $('#bell-btn').onclick = () => go(me.role === 'student' ? '#/student/notifications' : me.role === 'staff' ? '#/staff/notifications' : '#/admin/notifications');
    $('#user-btn').onclick = (e) => { e.stopPropagation(); toggleUserMenu(); };
    setupSearch();
    return $('#view');
  }
  function closeMenus() { const d = $('#user-dd'); if (d) d.remove(); const r = $('#gresults'); if (r) r.classList.add('hidden'); const sh = $('#shell'); if (sh) sh.classList.remove('nav-open'); }
  document.addEventListener('click', (e) => { if (!e.target.closest('#user-dd') && !e.target.closest('#user-btn')) { const d = $('#user-dd'); if (d) d.remove(); } if (!e.target.closest('.gsearch')) { const r = $('#gresults'); if (r) r.classList.add('hidden'); } });
  function toggleUserMenu() {
    if ($('#user-dd')) { $('#user-dd').remove(); return; }
    const me = state.me;
    const d = document.createElement('div');
    d.className = 'dropdown'; d.id = 'user-dd';
    d.innerHTML = html`<div style="padding:8px 10px"><b>${me.name}</b><div class="small muted">${me.roleLabel}</div><div class="small muted">${me.email}</div></div><div class="divider" style="margin:4px 0"></div>
      <a href="${me.role === 'student' ? '#/student/profile' : me.role === 'staff' ? '#/staff/profile' : '#/admin/settings'}">${me.role === 'student' || me.role === 'staff' ? 'Profile & password' : 'Settings'}</a>
      <a href="#/account/password">Change password</a><button id="logout-btn">Sign out</button>`.s;
    document.body.appendChild(d);
    $('#logout-btn').onclick = logout;
  }
  async function logout() {
    try { await api.post('/api/auth/logout'); } catch { /* ignore */ }
    state.me = null; disconnectEvents();
    go(loginHref());
  }
  function setupSearch() {
    const input = $('#gsearch'); const box = $('#gresults');
    let t = null; let sel = -1;
    input.addEventListener('input', () => {
      clearTimeout(t);
      const q = input.value.trim();
      if (q.length < 2) { box.classList.add('hidden'); return; }
      t = setTimeout(async () => {
        try {
          const r = await api.get('/api/search' + qs({ q }));
          sel = -1;
          box.innerHTML = r.groups.length ? r.groups.map((g) => html`<h4>${g.label}</h4>${g.items.map((i) => html`<a href="${i.link}">${i.title}<small>${i.sub}</small></a>`)}`.s).join('') : '<div class="empty">No matches</div>';
          box.classList.remove('hidden');
        } catch { /* ignore */ }
      }, 200);
    });
    input.addEventListener('keydown', (e) => {
      const links = $$('a', box);
      if (e.key === 'ArrowDown') { sel = Math.min(links.length - 1, sel + 1); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); e.preventDefault(); }
      else if (e.key === 'Enter' && links[sel]) { location.hash = links[sel].getAttribute('href'); input.value = ''; box.classList.add('hidden'); return; }
      else if (e.key === 'Escape') { box.classList.add('hidden'); return; }
      links.forEach((l, i) => l.classList.toggle('sel', i === sel));
    });
    box.addEventListener('click', () => { input.value = ''; box.classList.add('hidden'); });
  }

  // Notification centre used by every role.
  // "New" holds unread items; once read they move to "Read", filed by category, where they can be deleted.
  const NOTIF_TYPES = [['marks', 'Marks'], ['attendance', 'Attendance'], ['risk', 'Academic risk'], ['course', 'Courses'], ['registration', 'Registration'], ['admin', 'Announcements'], ['system', 'System']];
  const notifLabel = (t) => (NOTIF_TYPES.find(([k]) => k === t) || [t, t])[1];
  const notifClass = (n) => (n.severity === 'critical' ? 'critical' : n.severity === 'warning' ? 'warning' : n.type === 'marks' ? 'success' : 'info');
  async function markNotificationRead(id) {
    await api.post(`/api/notifications/${id}/read`, {});
    if (state.me && state.me.unread) { state.me.unread -= 1; updateBell(); }
  }
  async function notificationsView(target, opts = {}) {
    const st = { status: 'new', type: '', q: '', page: 1 };
    const selected = new Set();
    let counts = [];
    const total = (k, type) => counts.filter((c) => !type || c.type === type).reduce((s, c) => s + (c[k] || 0), 0);
    function drawNav() {
      $('#n-tab-new', target).innerHTML = html`New <span class="ncount">${total('unread')}</span>`.s;
      $('#n-tab-read', target).innerHTML = html`Read <span class="ncount">${total('read')}</span>`.s;
      const k = st.status === 'new' ? 'unread' : 'read';
      $('#n-cats', target).innerHTML = html`<button data-click="type" data-type="" class="${st.type === '' ? 'active' : ''}"><span>All categories</span><span class="ncount">${total(k)}</span></button>
        ${NOTIF_TYPES.map(([t, l]) => html`<button data-click="type" data-type="${t}" class="${st.type === t ? 'active' : ''}"><span>${l}</span><span class="ncount">${total(k, t)}</span></button>`)}`.s;
      $('#n-read-tools', target).classList.toggle('hidden', st.status !== 'read');
      const del = $('#n-del-sel', target); del.disabled = !selected.size; del.textContent = selected.size ? `Delete selected (${selected.size})` : 'Delete selected';
      $('#n-del-all', target).textContent = st.type ? `Delete all read in ${notifLabel(st.type)}` : 'Delete all read';
      $('#n-del-all', target).disabled = !total('read', st.type);
    }
    const item = (n) => html`<div class="alert ${notifClass(n)} notif ${n.is_read ? 'is-read' : 'is-new'}" data-nid="${n.id}">
      ${n.is_read ? html`<label class="checkbox notif-sel" aria-label="Select"><input type="checkbox" data-change="sel" data-id="${n.id}" ${selected.has(n.id) ? 'checked' : ''}></label>` : ''}
      <div class="ico">${n.type === 'marks' ? '✓' : n.severity === 'critical' ? '!' : 'i'}</div>
      <div class="grow"><b>${n.title}</b><p>${n.body}</p><div class="small muted" style="margin-top:4px">${fmt.ago(n.created_at)} · ${notifLabel(n.type)}</div></div>
      <div class="btn-row">${n.link ? html`<button class="btn sm" data-click="open" data-id="${n.id}" data-link="${n.link}" data-read="${n.is_read}">Open</button>` : ''}
        ${n.is_read ? html`<button class="btn sm ghost" data-click="toggle" data-id="${n.id}" data-read="1">Mark unread</button>`
    : html`<button class="btn sm ghost" data-click="toggle" data-id="${n.id}" data-read="0">${icon('check', 14)} Mark as read</button>`}
        <button class="btn sm ghost danger" data-click="del" data-id="${n.id}" aria-label="Delete notification" title="Delete">${icon('trash', 15)}</button></div></div>`;
    async function load() {
      const box = $('#nlist', target);
      try {
        const r = await api.get('/api/notifications' + qs({ status: st.status, type: st.type, q: st.q, page: st.page, pageSize: 15 }));
        counts = r.counts || [];
        state.me.unread = r.unread; updateBell();
        for (const id of [...selected]) if (!r.rows.some((n) => n.id === id)) selected.delete(id);
        let body;
        if (!r.rows.length) {
          body = st.status === 'new'
            ? html`<div class="empty"><b>You're all caught up.</b><div class="small">Notifications you have read are filed under Read, by category.</div></div>`
            : html`<div class="empty"><b>No read notifications${st.type ? ` in ${notifLabel(st.type)}` : ''}.</b></div>`;
        } else if (st.status === 'read' && !st.type) {
          // Group the read archive by category
          const groups = NOTIF_TYPES.map(([t, l]) => [l, r.rows.filter((n) => n.type === t)]).filter(([, rows]) => rows.length);
          body = html`${groups.map(([l, rows]) => html`<div class="notif-group"><h3>${l}</h3>${rows.map(item)}</div>`)}`;
        } else body = html`${r.rows.map(item)}`;
        box.innerHTML = html`${body}${pager(r, 'page')}`.s;
        drawNav();
      } catch (e) { errorBox(box, e, load); }
    }
    target.innerHTML = html`<div class="page-head"><div><h1>Notifications</h1><p>New ones stay here until you read them.</p></div>
      <button class="btn" data-click="readAll">${icon('check', 16)} Mark all as read</button></div>
      ${opts.extra || ''}
      <nav class="tabs" role="tablist"><button id="n-tab-new" class="active" data-click="status" data-status="new">New</button><button id="n-tab-read" data-click="status" data-status="read">Read</button></nav>
      <div class="notif-layout">
        <div class="card notif-cats" id="n-cats" aria-label="Categories"></div>
        <div class="card"><div class="card-head"><div class="search-input" style="width:240px;max-width:100%">${icon('search', 16)}<input class="input" placeholder="Search notifications" data-input="search"></div>
          <div class="btn-row hidden" id="n-read-tools"><button class="btn sm" data-click="selAll">Select all on page</button>
            <button class="btn sm danger" id="n-del-sel" data-click="delSel" disabled>Delete selected</button><button class="btn sm danger" id="n-del-all" data-click="delAll">Delete all read</button></div></div>
          <div class="card-body" id="nlist">${loading(3)}</div></div></div>`.s;
    let t;
    bind(target, {
      status: (el) => { $$('[data-status]', target).forEach((b) => b.classList.toggle('active', b === el)); st.status = el.dataset.status; st.page = 1; selected.clear(); load(); },
      type: (el) => { st.type = el.dataset.type; st.page = 1; selected.clear(); load(); },
      search: (el) => { clearTimeout(t); t = setTimeout(() => { st.q = el.value; st.page = 1; load(); }, 250); },
      page: (el) => { st.page = Number(el.dataset.page); load(); },
      toggle: async (el) => {
        const toUnread = el.dataset.read === '1';
        await api.post(`/api/notifications/${el.dataset.id}/read`, { unread: toUnread });
        if (!toUnread) toast('Moved to Read.', 'success');
        load();
      },
      open: async (el) => { if (el.dataset.read !== '1') await markNotificationRead(el.dataset.id); go(el.dataset.link); },
      del: async (el) => {
        if (!(await confirmBox('Delete notification', 'This notification will be removed permanently.', 'Delete', true))) return;
        await api.del(`/api/notifications/${el.dataset.id}`); selected.delete(Number(el.dataset.id)); toast('Notification deleted.', 'success'); load();
      },
      sel: (el) => { const id = Number(el.dataset.id); if (el.checked) selected.add(id); else selected.delete(id); drawNav(); },
      selAll: () => { const boxes = $$('[data-change="sel"]', target); const all = boxes.every((b) => b.checked); boxes.forEach((b) => { b.checked = !all; const id = Number(b.dataset.id); if (b.checked) selected.add(id); else selected.delete(id); }); drawNav(); },
      delSel: async () => {
        if (!selected.size || !(await confirmBox('Delete notifications', `Delete ${selected.size} selected notification${selected.size === 1 ? '' : 's'} permanently?`, 'Delete', true))) return;
        const r = await api.post('/api/notifications/delete', { ids: [...selected] }); selected.clear(); toast(`${r.deleted} notification${r.deleted === 1 ? '' : 's'} deleted.`, 'success'); load();
      },
      delAll: async () => {
        const n = total('read', st.type); const where = st.type ? ` in ${notifLabel(st.type)}` : '';
        if (!n || !(await confirmBox('Delete read notifications', `Delete all ${n} read notification${n === 1 ? '' : 's'}${where} permanently? New notifications are kept.`, 'Delete', true))) return;
        const r = await api.post('/api/notifications/delete', { allRead: true, type: st.type }); selected.clear(); toast(`${r.deleted} notification${r.deleted === 1 ? '' : 's'} deleted.`, 'success'); load();
      },
      readAll: async () => { await api.post('/api/notifications/read-all'); toast('All notifications moved to Read.', 'success'); load(); },
      ...(opts.handlers || {}),
    });
    state.view.onLive = (kind) => { if (kind === 'notification') load(); };
    load();
  }

  // Dashboard card: new (unread) notifications only. Reading one removes it from the dashboard.
  function dashNotifications(list, unread, href) {
    return html`<div class="card"><div class="card-head"><h2>New notifications${unread ? html` <span class="badge info plain">${unread}</span>` : ''}</h2><a href="${href}" class="small">All →</a></div>
      <div class="card-body stack-sm" id="dash-notifs">${list.length ? list.map((n) => html`<div class="notif-dash" data-nid="${n.id}">
        <div class="grow"${n.link ? raw(` data-click="dnOpen" data-id="${n.id}" data-link="${esc(n.link)}" role="link" tabindex="0" style="cursor:pointer"`) : ''}><b>${n.title}</b><div class="small muted clamp2">${n.body}</div><div class="small muted">${fmt.ago(n.created_at)} · ${notifLabel(n.type)}</div></div>
        <button class="icon-btn sm" data-click="dnRead" data-id="${n.id}" aria-label="Mark as read" title="Mark as read">${icon('check', 16)}</button></div>`)
    : html`<div class="muted small">You're all caught up. Read notifications are in the <a href="${href}">notification centre</a>, filed by category.</div>`}</div></div>`;
  }
  // Handlers for dashNotifications; reload is the dashboard's own refresh.
  const dashNotificationHandlers = (reload) => ({
    dnRead: async (el) => { await markNotificationRead(el.dataset.id); toast('Moved to Read in the notification centre.', 'success'); reload(); },
    dnOpen: async (el) => { await markNotificationRead(el.dataset.id); go(el.dataset.link); },
  });

  // ---------- dashboard & profile building blocks ----------
  const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };
  const longToday = () => new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  // Dashboard header: avatar, date line, greeting, one meta line, actions.
  function dashHead({ name, first, meta, context = '', actions = '' }) {
    return html`<div class="dash-head"><div class="dash-id"><span class="avatar dash-av">${initials(name)}</span><div>
      <div class="dash-date">${longToday()}${context ? ` · ${context}` : ''}</div><h1>${greeting()}, ${first}</h1><p>${meta}</p></div></div>
      ${actions ? html`<div class="btn-row">${actions}</div>` : ''}</div>`;
  }
  // Stat tile: label + icon, big value, one supporting line. tone = safe | warn | crit.
  function stat({ label, value, sub = '', tone = '', ico = 'chart', href = '', extra = '' }) {
    const inner = html`<div class="stat-top"><span class="stat-label">${label}</span><span class="stat-ico">${icon(ico, 16)}</span></div>
      <div class="stat-value">${value}</div>${extra}${sub ? html`<div class="stat-sub">${sub}</div>` : ''}`;
    return href ? html`<a class="card stat ${tone} is-link" href="${href}">${inner}</a>` : html`<div class="card stat ${tone}">${inner}</div>`;
  }
  // Profile header: accent band with the institution crest, identity, chips, actions, summary strip.
  function profileHero({ name, title, chips = [], logoSrc = '', institution = '', stats = [], actions = '' }) {
    return html`<div class="card prof-hero"><div class="ph-band">${logoSrc ? html`<span class="ph-crest"><img src="${logoSrc}" alt=""></span>` : ''}<span class="ph-inst">${institution}</span></div>
      <div class="ph-main"><span class="avatar ph-av">${initials(name)}</span><div class="ph-id"><h1>${name}</h1><div class="ph-title">${title}</div>
        <div class="ph-chips">${chips.filter(Boolean).map((c) => html`<span class="ph-chip">${c}</span>`)}</div></div>
        ${actions ? html`<div class="btn-row ph-actions">${actions}</div>` : ''}</div>
      ${stats.length ? html`<div class="ph-stats">${stats.map(([k, v, s]) => html`<div><span>${k}</span><b>${v}</b>${s ? html`<small>${s}</small>` : ''}</div>`)}</div>` : ''}</div>`;
  }
  // Labelled detail list inside a card.
  const detailCard = (title, rows) => html`<div class="card"><div class="card-head"><h3>${title}</h3></div><dl class="dl">${rows.map(([k, v]) => html`<div><dt>${k}</dt><dd>${v || '—'}</dd></div>`)}</dl></div>`;
  // Date tile used for events and announcements.
  function dateTile(d) {
    const sd = String(d || '');
    const x = d ? new Date(sd.replace(' ', 'T') + (sd.length <= 10 ? 'T00:00:00' : /[zZ]$|[+-]\d\d:?\d\d$/.test(sd) ? '' : 'Z')) : null;
    if (!x || Number.isNaN(x.getTime())) return html`<span class="date-tile"><b>—</b><span>TBA</span></span>`;
    return html`<span class="date-tile"><b>${x.getDate()}</b><span>${x.toLocaleDateString('en-GB', { month: 'short' })}</span></span>`;
  }
  // Today's classes from /api/timetable; after the last period (or on Sunday) it shows the next working day.
  function todaySchedule(tt, href) {
    const now = new Date(); const mins = now.getHours() * 60 + now.getMinutes();
    const toMin = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };
    const periods = tt?.periods || []; const slots = tt?.slots || [];
    const P = Object.fromEntries(periods.map((p) => [p.p, p]));
    const lastEnd = Math.max(0, ...periods.map((p) => toMin(p.end)));
    const hasDay = (d) => slots.some((s) => s.day === d);
    let day = now.getDay(); let live = true;
    if (day === 0 || mins > lastEnd || !hasDay(day)) {
      live = false; let d = day;
      for (let i = 0; i < 7; i++) { d = d >= 6 ? 1 : d + 1; if (hasDay(d)) break; }
      day = d;
    }
    const blocks = [];
    for (const s of slots.filter((x) => x.day === day).sort((a, b) => a.period - b.period)) {
      const key = s.course_code ? `${s.course_code}|${s.section || ''}` : `${s.kind}|${s.label}`;
      const prev = blocks[blocks.length - 1];
      if (prev && prev.key === key && prev.to === s.period - 1) { prev.to = s.period; continue; }
      blocks.push({ key, from: s.period, to: s.period, s });
    }
    const rows = blocks.map((b) => {
      const start = P[b.from]?.start || ''; const end = P[b.to]?.end || '';
      const st = !live || !start ? '' : mins >= toMin(end) ? 'done' : mins >= toMin(start) ? 'now' : '';
      const s = b.s; const title = s.course_name || s.label || s.kind;
      const sub = s.course_code ? [s.course_code, s.faculty_name || (s.section ? `${s.batch} · Section ${s.section}` : '')].filter(Boolean).join(' · ') : 'Activity';
      return html`<div class="sched-row ${st}"><div class="sched-time">${start}<span>${end}</span></div><div class="grow"><b>${title}</b><div class="small muted">${sub}</div></div>${st === 'now' ? html`<span class="badge info">Now</span>` : ''}</div>`;
    });
    const heading = live ? "Today's classes" : `Classes on ${tt?.days?.[day - 1] || 'the next day'}`;
    return html`<div class="card"><div class="card-head"><h2>${heading}</h2><a href="${href}" class="small">Timetable →</a></div>
      <div class="card-body sched">${rows.length ? rows : html`<div class="muted small">No classes scheduled.</div>`}</div></div>`;
  }

  window.App = { featureOn: featureOnName, logo, greeting, dashHead, stat, profileHero, detailCard, dateTile, todaySchedule, wordmark, esc, html, raw, $, $$, api, qs, ApiError, route, go, render, state, store, bind, formData, toast, modal, confirmBox, loading, errorBox, fmt, riskBadge, attBadge, levelClass, meter,
    table, pager, icon, shell, loadMe, connectEvents, disconnectEvents, updateBell, initials, notificationsView, dashNotifications, dashNotificationHandlers, loginHref, logout };
})();
