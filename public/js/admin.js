/* Administrator portal */
(function () {
  'use strict';
  const { html, raw, $, $$, api, qs, route, go, state, store, bind, formData, fmt, riskBadge, attBadge, meter, table, pager, icon, shell, loading, errorBox, notificationsView, toast, modal, confirmBox } = App;
  const ADMINS = ['super_admin', 'university_admin', 'college_admin', 'department_admin'];
  const R = { roles: ADMINS };
  const multiCollege = () => ['super_admin', 'university_admin'].includes(state.me.role);
  let scopeCache = null;
  async function scopeInfo() { if (!scopeCache || scopeCache.uid !== state.me.id) scopeCache = { uid: state.me.id, ...(await api.get('/api/admin/scope')) }; return scopeCache; }
  const can = (p) => state.me.permissions.includes(p);
  const pctCls = (v, warn, crit) => (v >= crit ? 'crit' : v >= warn ? 'warn' : 'safe');

  async function collegePicker(selected, name = 'collegeId', allLabel = 'All colleges in scope') {
    if (!multiCollege()) return '';
    const s = await scopeInfo();
    return html`<select class="input" style="width:auto" data-change="college" name="${name}" aria-label="College"><option value="">${allLabel}</option>${s.colleges.map((c) => html`<option value="${c.id}" ${String(c.id) === String(selected) ? 'selected' : ''}>${c.university} · ${c.short_name}</option>`)}</select>`;
  }

  // ================= dashboard: people, portals, requests (no teaching data) =================
  route('/admin', async (p, q) => {
    const v = shell('#/admin');
    const st = { collegeId: q.collegeId || '' };
    async function load() {
      try {
        const [d, picker] = [await api.get('/api/admin/overview' + qs(st)), await collegePicker(st.collegeId)];
        const t = d.totals, me = state.me, A = d.accounts;
        const scopeName = me.role === 'super_admin' ? 'All institutions' : me.role === 'university_admin' ? me.university.name : me.role === 'department_admin' ? `${me.department.name}, ${me.college.short_name}` : me.college.name;
        const portalCard = (pt) => { const a = pt.role === 'student' ? A.students : A.staff; const name = pt.role === 'student' ? 'Student portal' : 'Teacher portal';
          return html`<a class="card portal-tile" href="#/admin/portals${st.collegeId ? `?collegeId=${st.collegeId}` : ''}"><div class="pt-top"><b>${name}</b><span class="badge ${pt.open ? 'safe' : 'critical'} plain">${pt.open ? 'Open' : 'Closed'}</span></div>
            <div class="pt-nums"><div><b>${fmt.num(a.active || 0)}</b><span>accounts</span></div><div><b>${fmt.num(a.recent || 0)}</b><span>active this week</span></div><div><b>${pt.on}/${pt.total}</b><span>features on</span></div></div></a>`; };
        const todo = [
          d.requests ? { n: d.requests, text: d.requests === 1 ? 'course request to review' : 'course requests to review', href: '#/admin/registrations' } : null,
          (A.students.inactive || 0) + (A.staff.inactive || 0) ? { n: (A.students.inactive || 0) + (A.staff.inactive || 0), text: 'inactive accounts', href: '#/admin/records/students' } : null,
          A.students.never ? { n: A.students.never, text: 'students yet to sign in', href: '#/admin/records/students' } : null,
        ].filter(Boolean);
        v.innerHTML = html`<div class="page-head"><div><h1>Dashboard</h1><p>${scopeName}</p></div><div class="btn-row">${picker}</div></div>
          <div class="grid g4">
            ${multiCollege() && !st.collegeId ? App.stat({ label: me.role === 'super_admin' ? 'Universities' : 'Colleges', value: fmt.num(me.role === 'super_admin' ? t.universities : t.colleges), sub: me.role === 'super_admin' ? `${t.colleges} colleges` : `${t.departments} departments`, ico: 'building' })
              : App.stat({ label: 'Departments', value: fmt.num(t.departments), ico: 'building', href: '#/admin/records/departments' })}
            ${App.stat({ label: 'Students', value: fmt.num(t.students), ico: 'grad', href: '#/admin/records/students' })}
            ${App.stat({ label: 'Teachers', value: fmt.num(t.staff), ico: 'users', href: '#/admin/records/staff' })}
            ${App.stat({ label: 'Course requests', value: fmt.num(d.requests), sub: d.requests ? 'Waiting for you' : 'All clear', tone: d.requests ? 'warn' : '', ico: 'clipboard', href: '#/admin/registrations' })}
          </div>
          <div class="grid g2" style="margin-top:16px">${d.portals.map(portalCard)}</div>
          <div class="grid g-2-1" style="margin-top:16px">
            <div class="card"><div class="card-head"><h2>${d.breakdown.by === 'College' ? 'Colleges' : 'Departments'}</h2></div>
              ${table([{ label: d.breakdown.by, render: (r) => html`<b>${r.label}</b><div class="small muted">${r.sub}</div>` }, { label: 'Students', render: (r) => fmt.num(r.students), num: true }, { label: 'Teachers', render: (r) => fmt.num(r.staff), num: true },
                ...(d.breakdown.by === 'College' ? [{ label: 'Departments', key: 'departments', num: true }] : [])], d.breakdown.rows,
              { empty: 'Nothing here yet.', rowAttrs: (r) => (d.breakdown.by === 'College' ? `class="clickable" data-click="college" data-id="${r.id}"` : '') })}</div>
            <div class="stack">
              <div class="card"><div class="card-head"><h2>To do</h2></div><div class="card-body">${todo.length ? html`<ul class="todo-list">${todo.map((x) => html`<li><a href="${x.href}"><b>${fmt.num(x.n)}</b> ${x.text}</a></li>`)}</ul>` : html`<span class="muted">Nothing needs you right now.</span>`}</div></div>
              <div class="card"><div class="card-head"><h2>Recent changes</h2><a class="small" href="#/admin/audit">All</a></div><div class="card-body stack-sm">${d.activity.length ? d.activity.map((a) => html`<div><b class="small">${a.summary}</b><div class="small muted">${a.user_name} · ${fmt.ago(a.created_at)}</div></div>`) : html`<span class="muted">No changes yet.</span>`}</div></div>
            </div>
          </div>`.s;
      } catch (e) { errorBox(v, e, load); }
    }
    bind(v, {
      college: (el) => { st.collegeId = el.value; load(); },
    });
    v.addEventListener('click', (e) => { const r = e.target.closest('[data-click="college"]'); if (r) { st.collegeId = r.dataset.id; load(); } });
    load();
  }, R);

  // ================= portals: what students and teachers get =================
  route('/admin/portals', async (p, q) => {
    const v = shell('#/admin/portals');
    const st = { collegeId: q.collegeId || '' };
    async function load() {
      try {
        const d = await api.get('/api/admin/portals' + qs(st));
        const picker = multiCollege() ? await collegePicker(st.collegeId, 'collegeId', state.me.role === 'super_admin' ? 'Platform default (all colleges)' : 'University default') : '';
        v.innerHTML = html`<div class="page-head"><div><h1>Student & teacher portals</h1><p>Turn features on or off for students and teachers.</p></div><div class="btn-row">${picker}</div></div>
          <div class="grid g2">${d.portals.map((pt) => html`<div class="card"><div class="card-head"><h2>${pt.role === 'student' ? 'Student portal' : 'Teacher portal'}</h2>
              <a class="small" href="#/admin/records/${pt.role === 'student' ? 'students' : 'staff'}">Manage accounts</a></div>
            <div class="card-body portal-toggles">${pt.items.map((it) => html`<label class="switch-row ${it.key.endsWith('_open') ? 'is-main' : ''}"><span>${it.label}${it.key.endsWith('_open') ? html`<small>${it.on ? 'People can sign in' : 'Sign-in is blocked'}</small>` : ''}</span>
              <input type="checkbox" class="switch" data-change="toggle" data-k="${it.key}" ${it.on ? 'checked' : ''} ${d.editable ? '' : 'disabled'}></label>`)}</div></div>`)}</div>`.s;
      } catch (e) { errorBox(v, e, load); }
    }
    bind(v, {
      college: (el) => { st.collegeId = el.value; load(); },
      toggle: async (el) => {
        try { await api.put('/api/admin/portals', { collegeId: st.collegeId || undefined, key: el.dataset.k, on: el.checked }); toast(el.checked ? 'Turned on.' : 'Turned off.'); load(); }
        catch (e) { el.checked = !el.checked; toast(e.message, 'error'); }
      },
    });
    load();
  }, R);

  // ================= generic records (CRUD) =================
  let metaCache = null;
  async function meta() { if (!metaCache || metaCache.uid !== state.me.id) metaCache = { uid: state.me.id, data: await api.get('/api/admin/entities') }; return metaCache.data; }
  const TITLES = { universities: 'Universities', colleges: 'Colleges', campuses: 'Campuses', faculties: 'Faculties / schools', departments: 'Departments', programmes: 'Programmes', regulations: 'Regulations', batches: 'Batches',
    academic_years: 'Academic years', semesters: 'Semesters / terms', sections: 'Sections', courses: 'Courses / subjects', offerings: 'Faculty assignment (course offerings)', registrations: 'Course registrations',
    students: 'Students', staff: 'Staff', assessments: 'Assessments & assignments', admins: 'Administrators' };
  const DESCR = { offerings: 'Who teaches which course.', registrations: 'Which students take which course.', students: 'Add, edit or import students.', staff: 'Add, edit or import teachers.', courses: 'The course catalogue.' };

  async function lookupOptions(ref, params = {}) { try { return (await api.get(`/api/admin/lookup/${ref}` + qs(params))).rows; } catch { return []; } }

  route('/admin/records/:entity', async (p, q) => {
    const navHref = p.entity === 'faculties' ? '#/admin/records/campuses' : `#/admin/records/${p.entity}`;
    const v = shell(navHref);
    const all = await meta();
    const M = all[p.entity];
    if (!M) { v.innerHTML = html`<div class="card empty"><b>Unknown record type.</b></div>`.s; return; }
    const st = { q: q.q || '', page: 1, status: '', sort: '', dir: 'asc' };
    const filterRefs = M.filters.map((k) => M.fields.find((f) => f.key === k)).filter((f) => f && (f.type === 'ref' || f.type === 'enum') && f.key !== 'university_id');
    const showCollege = multiCollege() && M.level === 'college';
    v.innerHTML = html`<div class="page-head"><div><h1>${TITLES[p.entity]}</h1>${DESCR[p.entity] ? html`<p>${DESCR[p.entity]}</p>` : ''}</div>
      <div class="btn-row">${p.entity === 'registrations' && M.canEdit ? html`<button class="btn" data-click="bulk">Bulk register a section</button>` : ''}
        ${['students', 'staff', 'courses', 'registrations'].includes(p.entity) && can('import_export') ? html`<a class="btn" href="#/admin/data?type=${p.entity}">${icon('upload', 16)} Import CSV</a>` : ''}
        ${p.entity === 'campuses' ? html`<a class="btn" href="#/admin/records/faculties">Faculties / schools</a>` : p.entity === 'faculties' ? html`<a class="btn" href="#/admin/records/campuses">Campuses</a>` : ''}
        ${M.canEdit ? html`<button class="btn primary" data-click="create">${icon('plus', 16)} Add ${M.label.toLowerCase()}</button>` : ''}</div></div>
      <div class="card"><div class="card-head"><div class="row wrap">
        <div class="search-input" style="width:260px">${icon('search', 16)}<input class="input" placeholder="Search" value="${st.q}" data-input="q" aria-label="Search"></div>
        ${showCollege ? raw((await collegePicker('', 'college_id')).s) : ''}
        <span id="flt"></span>
        ${M.soft || M.dropStatus ? html`<select class="input" style="width:auto" data-change="status"><option value="">Any status</option><option value="active">${M.dropStatus ? 'Registered' : 'Active'}</option><option value="inactive">${M.dropStatus ? 'Dropped' : 'Inactive'}</option></select>` : ''}
      </div></div><div id="rec">${loading()}</div></div>`.s;
    // Filter dropdowns for reference fields
    const flt = $('#flt', v);
    const fparts = [];
    for (const f of filterRefs.slice(0, 3)) {
      if (f.type === 'enum') fparts.push(html`<select class="input" style="width:auto" data-change="flt" data-k="${f.key}" aria-label="${f.label}"><option value="">All ${f.label.toLowerCase()}</option>${f.options.map((o) => html`<option>${o}</option>`)}</select>`);
      else if (f.key !== 'college_id') { const opts = await lookupOptions(f.ref); fparts.push(html`<select class="input" style="width:auto;max-width:220px" data-change="flt" data-k="${f.key}" aria-label="${f.label}"><option value="">All ${f.label.toLowerCase()}</option>${opts.map((o) => html`<option value="${o.id}">${o.label}</option>`)}</select>`); }
    }
    flt.innerHTML = html`${fparts}`.s;
    const filters = {};
    async function load() {
      const box = $('#rec', v);
      try {
        const r = await api.get(`/api/admin/entities/${p.entity}` + qs({ ...st, ...filters, pageSize: 25 }));
        const cols = M.columns.map((c) => ({ label: c.label, key: c.key, render: (row) => {
          const val = row[c.key];
          if (c.key === 'active') return val ? html`<span class="badge safe">Active</span>` : html`<span class="badge plain">Inactive</span>`;
          if (c.key === 'published' || c.key === 'is_current') return val ? 'Yes' : 'No';
          if (c.key === 'risk') return val ? riskBadge(val) : '—';
          if (c.key === 'status') return html`<span class="badge ${val === 'Registered' ? 'safe' : val === 'Dropped' ? 'plain' : 'attention'}">${val}</span>`;
          if (c.key === 'role') return String(val).replace('_', ' ');
          if (/(_at)$/.test(c.key)) return fmt.dateTime(val);
          if (/(date|_on)$/.test(c.key)) return fmt.date(val);
          return val ?? '—';
        } }));
        cols.push({ label: '', render: (row) => html`<div class="btn-row" style="justify-content:flex-end">
          ${p.entity === 'students' ? html`<a class="btn sm" href="#/admin/student/${row.id}">Profile</a>` : ''}${p.entity === 'offerings' ? html`<a class="btn sm" href="#/admin/course/${row.id}">Open</a>` : ''}
          ${M.canEdit ? html`<button class="btn sm" data-click="edit" data-id="${row.id}">Edit</button>` : ''}
          ${M.canEdit && M.soft && row.active ? html`<button class="btn sm danger" data-click="remove" data-id="${row.id}">Deactivate</button>` : ''}
          ${M.canEdit && M.dropStatus && row.status !== 'Dropped' ? html`<button class="btn sm danger" data-click="remove" data-id="${row.id}">Drop</button>` : ''}
          ${M.canEdit && M.hard ? html`<button class="btn sm danger" data-click="remove" data-id="${row.id}">Delete</button>` : ''}</div>` });
        box.innerHTML = html`${table(cols, r.rows, { empty: 'No records match.' })}${pager(r, 'page')}`.s;
      } catch (e) { errorBox(box, e, load); }
    }
    let t;
    bind(v, {
      q: (el) => { clearTimeout(t); t = setTimeout(() => { st.q = el.value; st.page = 1; load(); }, 250); },
      status: (el) => { st.status = el.value; st.page = 1; load(); },
      college: (el) => { filters.college_id = el.value; st.page = 1; load(); },
      flt: (el) => { filters[el.dataset.k] = el.value; st.page = 1; load(); },
      page: (el) => { st.page = Number(el.dataset.page); load(); },
      create: () => recordForm(p.entity, M, null, load),
      edit: async (el) => { try { recordForm(p.entity, M, await api.get(`/api/admin/entities/${p.entity}/${el.dataset.id}`), load); } catch (e) { toast(e.message, 'error'); } },
      remove: async (el) => {
        const verb = M.soft ? 'Deactivate' : M.dropStatus ? 'Drop' : 'Delete';
        if (!(await confirmBox(`${verb} ${M.label.toLowerCase()}?`, M.soft ? 'The record is kept for history but hidden from portals and sign-in.' : M.dropStatus ? 'The student will no longer see this course; history is kept.' : 'This cannot be undone.', verb, true))) return;
        try { await api.del(`/api/admin/entities/${p.entity}/${el.dataset.id}`); toast(`${M.label} ${verb.toLowerCase()}${verb.endsWith('e') ? 'd' : 'ped'}.`, 'success'); load(); } catch (e) { toast(e.message, 'error'); }
      },
      bulk: async () => {
        const offs = await lookupOptions('offerings');
        const m = modal({ title: 'Bulk register a section', body: html`<p class="muted">Registers every active student of the offering's batch and section.</p><div class="field"><label>Course offering</label><select class="input" id="bk-o">${offs.map((o) => html`<option value="${o.id}">${o.label}</option>`)}</select></div>`,
          foot: html`<button class="btn" data-close>Cancel</button><button class="btn primary" id="bk-go">Register</button>` });
        $('#bk-go', m.el).onclick = async () => { try { const r = await api.post('/api/admin/registrations/bulk', { offeringId: Number($('#bk-o').value) }); m.close(); toast(`${r.added} students registered.`, 'success'); load(); } catch (e) { toast(e.message, 'error'); } };
      },
    });
    load();
  }, R);

  async function recordForm(entity, M, row, onDone) {
    const editing = !!row;
    const s = multiCollege() ? await scopeInfo() : null;
    let collegeId = row?.college_id || (state.me.college_id ?? state.me.college?.id) || '';
    const fieldHtml = async (f) => {
      const val = row ? row[f.key] : f.type === 'bool' ? 1 : '';
      const id = `fld-${f.key}`;
      const req = f.required ? 'required' : '';
      if (f.key === 'college_id') {
        if (!s) return '';
        return html`<div class="field"><label for="${id}">College</label><select class="input" id="${id}" name="college_id" ${editing ? 'disabled' : ''} data-change="collegeChange" required><option value="">Select…</option>${s.colleges.map((c) => html`<option value="${c.id}" ${String(c.id) === String(collegeId) ? 'selected' : ''}>${c.university} · ${c.short_name}</option>`)}</select>${editing ? html`<div class="hint">A record cannot move between institutions.</div>` : ''}</div>`;
      }
      if (f.key === 'university_id' && entity === 'colleges') {
        const unis = s ? s.universities : [];
        return html`<div class="field"><label for="${id}">University</label><select class="input" id="${id}" name="university_id" ${editing ? 'disabled' : ''}>${unis.map((u) => html`<option value="${u.id}" ${String(u.id) === String(val) ? 'selected' : ''}>${u.name}</option>`)}</select></div>`;
      }
      if (f.type === 'ref') {
        if (state.me.role === 'department_admin' && f.key === 'department_id') return '';
        const opts = await lookupOptions(f.ref, M.level === 'college' && collegeId ? { collegeId } : {});
        return html`<div class="field"><label for="${id}">${f.label}${f.required ? ' *' : ''}</label><select class="input" id="${id}" name="${f.key}" ${req} data-ref="${f.ref}"><option value="">${f.required ? 'Select…' : 'None'}</option>${opts.map((o) => html`<option value="${o.id}" ${String(o.id) === String(val) ? 'selected' : ''}>${o.label}</option>`)}</select></div>`;
      }
      if (f.type === 'enum') return html`<div class="field"><label for="${id}">${f.label}${f.required ? ' *' : ''}</label><select class="input" id="${id}" name="${f.key}" ${req}>${f.required ? '' : html`<option value="">—</option>`}${f.options.map((o) => html`<option ${o === val ? 'selected' : ''}>${o}</option>`)}</select></div>`;
      if (f.type === 'bool') return html`<div class="field"><label class="checkbox"><input type="checkbox" name="${f.key}" ${val ? 'checked' : ''}> ${f.label}</label></div>`;
      const type = { int: 'number', number: 'number', date: 'date', email: 'email', color: 'color' }[f.type] || 'text';
      return html`<div class="field"><label for="${id}">${f.label}${f.required ? ' *' : ''}</label><input class="input" id="${id}" type="${type}" name="${f.key}" value="${val ?? (f.type === 'color' ? '#1f4e79' : '')}" ${req} ${f.max && type === 'text' ? `maxlength="${f.max}"` : ''} ${f.min !== undefined ? `min="${f.min}"` : ''} ${f.max !== undefined && type === 'number' ? `max="${f.max}"` : ''} ${f.type === 'number' ? 'step="0.5"' : ''}></div>`;
    };
    async function body() {
      const parts = [];
      for (const f of M.fields) parts.push(await fieldHtml(f));
      if (!editing && ['students', 'staff', 'admins'].includes(entity)) parts.push(html`<div class="field full"><label>Initial password</label><input class="input" type="password" name="password" minlength="8" autocomplete="new-password"><div class="hint">Leave empty to generate a temporary password.</div></div>`);
      return html`<form id="rec-f" class="form-grid" novalidate>${parts}</form><div id="rec-err" class="alert critical hidden"><div class="ico">!</div><div id="rec-err-t"></div></div>`;
    }
    const m = modal({ title: `${editing ? 'Edit' : 'Add'} ${M.label.toLowerCase()}`, wide: true, body: await body(), foot: html`<button class="btn" data-close>Cancel</button><button class="btn primary" id="rec-save">${editing ? 'Save changes' : 'Create'}</button>` });
    m.el.addEventListener('change', async (e) => {
      if (e.target.name === 'college_id') { collegeId = e.target.value; const keep = formData($('#rec-f')); $('.modal-body', m.el).innerHTML = (await body()).s; for (const [k, val] of Object.entries(keep)) { const el = $(`[name="${k}"]`, m.el); if (el && el.type !== 'checkbox' && !el.dataset.ref) el.value = val; } }
    });
    $('#rec-save', m.el).onclick = async () => {
      const d = formData($('#rec-f'));
      for (const f of M.fields) if (f.type === 'bool') d[f.key] = d[f.key] ? 1 : 0;
      if (!d.password) delete d.password;
      try {
        const r = editing ? await api.put(`/api/admin/entities/${entity}/${row.id}`, d) : await api.post(`/api/admin/entities/${entity}`, d);
        m.close();
        toast(editing ? 'Changes saved and recorded in the audit log.' : `${M.label} created.`, 'success');
        if (r.temporaryPassword) modal({ title: 'Temporary password', body: html`<p>Share this one-time password securely. The user should change it after signing in.</p><p class="mono" style="font-size:18px">${r.temporaryPassword}</p>`, foot: html`<button class="btn primary" data-close>Done</button>` });
        onDone();
      } catch (e) { $('#rec-err-t').textContent = e.message; $('#rec-err').classList.remove('hidden'); }
    };
  }

  // ================= student account (profile only; academics live in the teacher portal) =================
  route('/admin/student/:id', async (p) => {
    const v = shell('#/admin/records/students');
    async function load() {
      try {
        const d = await api.get(`/api/admin/students/${p.id}`);
        const pr = d.profile;
        v.innerHTML = html`<div class="page-head"><div><a class="small" href="#/admin/records/students">← Students</a><h1>${pr.name}</h1><p>${pr.roll_no} · ${pr.programme}${pr.section ? ` · Section ${pr.section}` : ''}</p></div>
          <div class="btn-row"><span class="badge ${pr.active ? 'safe' : 'plain'}">${pr.active ? 'Active' : 'Inactive'}</span>${can('manage_students') ? html`<button class="btn" data-click="edit">${icon('edit', 16)} Edit</button>` : ''}</div></div>
          <div class="card card-pad">${StudentViews.profileGrid(pr)}</div>
          <div class="card" style="margin-top:16px"><div class="card-head"><h2>Account history</h2></div>${auditTable(d.audit)}</div>`.s;
        bind(v, { edit: async () => { const M = (await meta()).students; recordForm('students', M, await api.get(`/api/admin/entities/students/${pr.id}`), load); } });
      } catch (e) { errorBox(v, e, load); }
    }
    load();
  }, R);

  function auditTable(rows) {
    const val = (s) => { if (!s) return '—'; try { const o = JSON.parse(s); return Object.entries(o).map(([k, x]) => `${k}: ${typeof x === 'object' && x !== null ? JSON.stringify(x) : x}`).join(', '); } catch { return s; } };
    return table([{ label: 'Time', render: (a) => html`<span class="nowrap">${fmt.dateTime(a.created_at)}</span>` }, { label: 'Changed by', render: (a) => html`<b>${a.user_name}</b><div class="small muted">${String(a.role).replace('_', ' ')}</div>` },
      { label: 'Action', render: (a) => html`<span class="tag">${a.action}</span>` }, { label: 'Summary', render: (a) => html`${a.summary}${a.college ? html`<div class="small muted">${a.college}</div>` : ''}` },
      { label: 'Previous', render: (a) => html`<span class="small mono">${val(a.previous_value)}</span>` }, { label: 'New', render: (a) => html`<span class="small mono">${val(a.new_value)}</span>` }, { label: 'IP / device', render: (a) => html`<span class="small muted">${a.ip || '—'}</span>` }], rows, { empty: 'No audit entries.' });
  }

  // Teaching, risk and analytics pages moved to the teacher portal; old links land on the dashboard.
  ['/admin/teaching', '/admin/risk', '/admin/analytics', '/admin/drill', '/admin/drill/:level', '/admin/drill/:level/:id', '/admin/course/:id', '/admin/course/:id/:tab', '/admin/course/:id/student/:sid', '/admin/people']
    .forEach((path) => route(path, () => go('#/admin'), R));

  // ================= notifications & announcements =================
  route('/admin/notifications', async () => {
    const v = shell('#/admin/notifications');
    const ann = await api.get('/api/admin/announcements').catch(() => ({ rows: [] }));
    const picker = await collegePicker('', 'collegeId', 'Whole university / scope');
    notificationsView(v, {
      extra: html`<div class="grid g2" style="margin-bottom:16px">
        ${can('send_announcements') ? html`<form class="card card-pad" data-submit="announce"><h2 style="margin-bottom:10px">Send an announcement</h2>
          <div class="row wrap" style="margin-bottom:10px">${picker}<select class="input" name="audience" style="width:auto"><option value="all">Students and staff</option><option value="students">Students only</option><option value="staff">Staff only</option></select></div>
          <div class="field"><label>Title</label><input class="input" name="title" maxlength="120" required></div><div class="field"><label>Message</label><textarea class="input" name="body" maxlength="2000" required></textarea></div>
          <button class="btn primary">${icon('bell', 16)} Send announcement</button></form>` : ''}
        <div class="card"><div class="card-head"><h2>Recent announcements</h2></div><div class="card-body stack-sm" style="max-height:360px;overflow:auto">${ann.rows.length ? ann.rows.slice(0, 12).map((a) => html`<div><b>${a.title}</b> <span class="tag">${a.course || a.college || 'University-wide'}</span> <span class="tag">${a.audience}</span><div class="small muted">${a.author || 'System'} · ${fmt.dateTime(a.created_at)}</div><p class="small">${a.body}</p></div>`) : html`<span class="muted">No announcements yet.</span>`}</div></div></div>`,
      handlers: { announce: async (f) => { try { const r = await api.post('/api/admin/announcements', formData(f)); toast(`Announcement sent to ${r.recipients} users.`, 'success'); f.reset(); } catch (e) { toast(e.message, 'error'); } }, college: () => {} },
    });
  }, R);

  // ================= course registration approvals =================
  route('/admin/registrations', async (p, q) => {
    const v = shell('#/admin/registrations');
    const st = { collegeId: q.collegeId || '' };
    const picker = await collegePicker(st.collegeId);
    async function load() {
      try {
        const d = await api.get('/api/admin/registrations' + qs({ collegeId: st.collegeId }));
        $('#reg-list', v).innerHTML = (d.rows.length ? table([
          { label: 'Student', render: (r) => html`<b>${r.student}</b><div class="small muted mono">${r.roll_no}${r.section ? ` · Sec ${r.section}` : ''}</div>` },
          ...(multiCollege() ? [{ label: 'College', key: 'college' }] : []),
          { label: 'Department', key: 'department' },
          { label: 'Course', render: (r) => html`<b class="mono">${r.code}</b> ${r.course}<div class="small muted">${r.credits} credits</div>` },
          { label: 'Requested', render: (r) => html`<span class="small muted">${fmt.ago(r.registered_at)}</span>` },
          { label: '', render: (r) => (can('manage_registrations') ? html`<div class="btn-row"><button class="btn sm primary" data-click="approve" data-id="${r.id}">${icon('check', 14)} Approve</button><button class="btn sm ghost danger" data-click="reject" data-id="${r.id}">Decline</button></div>` : '') },
        ], d.rows) : html`<div class="empty"><b>No course requests are waiting.</b><p class="muted">Student registration requests will appear here for approval.</p></div>`).s || '';
      } catch (e) { errorBox($('#reg-list', v), e, load); }
    }
    v.innerHTML = html`<div class="page-head"><div><h1>Course approvals</h1></div></div>
      <div class="card"><div class="card-head"><div class="row wrap">${raw(picker.s || '')}</div></div><div id="reg-list">${loading()}</div></div>`.s;
    bind(v, {
      college: (el) => { st.collegeId = el.value; load(); },
      approve: async (el) => { el.disabled = true; try { await api.post(`/api/admin/registrations/${el.dataset.id}/approve`, {}); toast('Registration approved.', 'success'); load(); } catch (e) { toast(e.message, 'error'); el.disabled = false; } },
      reject: async (el) => { if (!await confirmBox('Decline request?', 'The student will be notified that the course was not approved.', 'Decline', true)) return; try { await api.post(`/api/admin/registrations/${el.dataset.id}/reject`, {}); toast('Request declined.', 'success'); load(); } catch (e) { toast(e.message, 'error'); } },
    });
    state.view.onLive = (k, n) => { if (k === 'notification' && n.type === 'registration') load(); };
    load();
  }, R);

  // ================= audit =================
  route('/admin/audit', async (p, q) => {
    const v = shell('#/admin/audit');
    const st = { q: '', entity: q.entity || '', action: '', page: 1 };
    v.innerHTML = html`<div class="page-head"><div><h1>Audit Logs</h1></div></div>
      <div class="card"><div class="card-head"><div class="row wrap"><div class="search-input" style="width:260px">${icon('search', 16)}<input class="input" placeholder="Search summary or user" data-input="q"></div>
        <select class="input" style="width:auto" data-change="entity" id="au-ent"><option value="">All entities</option></select>
        <select class="input" style="width:auto" data-change="action"><option value="">All actions</option>${['create', 'update', 'delete', 'import', 'login', 'run'].map((a) => html`<option>${a}</option>`)}</select></div></div><div id="al">${loading()}</div></div>`.s;
    async function load() {
      try {
        const r = await api.get('/api/admin/audit' + qs({ ...st, pageSize: 30 }));
        const sel = $('#au-ent', v);
        if (sel.options.length === 1) r.entities.forEach((e) => sel.add(new Option(e, e, false, e === st.entity)));
        $('#al', v).innerHTML = html`${auditTable(r.rows)}${pager(r, 'page')}`.s;
      } catch (e) { errorBox($('#al', v), e, load); }
    }
    let t;
    bind(v, { q: (el) => { clearTimeout(t); t = setTimeout(() => { st.q = el.value; st.page = 1; load(); }, 250); }, entity: (el) => { st.entity = el.value; st.page = 1; load(); }, action: (el) => { st.action = el.value; st.page = 1; load(); }, page: (el) => { st.page = Number(el.dataset.page); load(); } });
    load();
  }, R);

  // ================= settings & permissions =================
  route('/admin/settings', async () => {
    const v = shell('#/admin/settings');
    const st = { collegeId: '' };
    const crest = (inst) => inst.logo ? html`<span class="logo-mark lg has-img"><img src="${inst.logo}" alt=""></span>`
      : html`<span class="logo-mark lg" style="background:${inst.accent || '#14234a'}">${String(inst.short_name || inst.code || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toUpperCase()}</span>`;
    const brandingRow = (level, inst) => html`<div class="row between brand-row"><div class="row" style="gap:12px;align-items:center">${crest(inst)}<div><b>${inst.name}</b><div class="small muted">${level === 'university' ? 'University' : 'College'} · ${inst.logo ? 'official logo in use' : 'generated crest'}</div></div></div>
      <div class="btn-row"><label class="btn sm">${icon('upload', 15)} ${inst.logo ? 'Replace' : 'Upload logo'}<input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" data-change="logo" data-level="${level}" data-id="${inst.id}" hidden></label>${inst.logo ? html`<button class="btn sm ghost" data-click="rmlogo" data-level="${level}" data-id="${inst.id}">Remove</button>` : ''}</div></div>`;
    const brandingCard = () => {
      const rows = [];
      if (state.me.college) rows.push(brandingRow('college', state.me.college));
      if ((state.me.role === 'university_admin' || state.me.role === 'super_admin') && state.me.university) rows.push(brandingRow('university', state.me.university));
      if (!rows.length) return '';
      return html`<div class="card" style="margin-top:16px"><div class="card-head"><h2>Institution logo</h2><span class="small muted">Shown across the portal, sign-in and directory</span></div>
        <div class="card-body stack-sm">${rows}<p class="small muted">A square PNG, SVG, WebP or JPEG, up to 2 MB.</p></div></div>`;
    };
    async function load() {
      try {
        const [s, perms] = [await api.get('/api/admin/settings' + qs(st)).catch((e) => ({ error: e })), await api.get('/api/admin/permissions')];
        const picker = await collegePicker(st.collegeId, 'collegeId', state.me.role === 'super_admin' ? 'Platform defaults' : 'University defaults');
        const editable = can('manage_settings') && !s.error;
        v.innerHTML = html`<div class="page-head"><div><h1>Settings</h1><p>Anything you leave unchanged follows the university default.</p></div><div class="btn-row">${picker}</div></div>
          ${s.error ? html`<div class="alert info"><div class="ico">i</div><div>Institution settings are managed by your college administrator.</div></div>` : html`<form class="card" data-submit="save"><div class="card-head"><h2>Attendance and risk rules</h2><span class="small muted">Scope: ${s.scope.type}</span></div><div class="card-body">
            <div class="form-grid">${s.settings.map((x) => html`<div class="field"><label>${x.key.replace(/_/g, ' ')}${x.overridden ? html` <span class="tag">set here</span>` : html` <span class="tag">inherited</span>`}</label>
              <input class="input" type="number" name="${x.key}" value="${x.value}" min="${x.limits[0]}" max="${x.limits[1]}" step="${x.limits[1] <= 1 ? '0.01' : '1'}" ${editable ? '' : 'disabled'}><div class="hint">${x.description}</div></div>`)}</div>
            ${editable ? html`<button class="btn primary">Save settings</button> <span class="small muted">Saving recalculates predictions and risk for affected students.</span>` : ''}</div></form>`}
          <div class="card" style="margin-top:16px"><div class="card-head"><h2>Role permissions</h2><span class="small muted">${perms.editable ? 'Platform super administrators can change these.' : 'Read only'}</span></div>
            <div class="table-wrap"><table class="table"><thead><tr><th>Permission</th>${perms.roles.map((r) => html`<th class="center">${r.label}</th>`)}</tr></thead><tbody>
            ${perms.permissions.map((p) => html`<tr><td>${p.label}</td>${perms.roles.map((r) => html`<td class="center"><input type="checkbox" ${perms.grants[r.role].includes(p.key) ? 'checked' : ''} ${perms.editable ? '' : 'disabled'} data-change="perm" data-role="${r.role}" data-p="${p.key}" aria-label="${r.label}: ${p.label}"></td>`)}</tr>`)}</tbody></table></div></div>
          ${brandingCard()}`.s;
      } catch (e) { errorBox(v, e, load); }
    }
    bind(v, {
      college: (el) => { st.collegeId = el.value; load(); },
      save: async (f) => {
        const values = {}; for (const el of f.elements) if (el.name) values[el.name] = Number(el.value);
        try { const r = await api.put('/api/admin/settings', { collegeId: st.collegeId || undefined, values }); toast(`Saved. Recalculating ${r.recomputing} students.`, 'success'); load(); } catch (e) { toast(e.message, 'error'); }
      },
      perm: async (el) => { try { await api.put('/api/admin/permissions', { role: el.dataset.role, permission: el.dataset.p, allowed: el.checked }); toast('Permission updated.', 'success'); } catch (e) { el.checked = !el.checked; toast(e.message, 'error'); } },
      logo: async (el) => {
        const f = el.files[0]; if (!f) return;
        if (f.size > 2e6) return toast('The logo must be under 2 MB.', 'error');
        const reader = new FileReader();
        reader.onload = async () => {
          try { await api.post('/api/admin/institution-logo', { level: el.dataset.level, id: Number(el.dataset.id), image: String(reader.result) });
            toast('Logo updated.', 'success'); if (App.loadMe) await App.loadMe(); load();
          } catch (e) { toast(e.message, 'error'); }
        };
        reader.readAsDataURL(f);
      },
      rmlogo: async (el) => {
        try { await api.del(`/api/admin/institution-logo?level=${el.dataset.level}&id=${el.dataset.id}`); toast('Logo removed.'); if (App.loadMe) await App.loadMe(); load(); } catch (e) { toast(e.message, 'error'); }
      },
    });
    load();
  }, R);

  // ================= import / export =================
  route('/admin/data', async (p, q) => {
    const v = shell('#/admin/data');
    const TYPES = [['students', 'Students'], ['staff', 'Staff'], ['courses', 'Courses / subjects'], ['registrations', 'Course registrations'], ['attendance', 'Attendance'], ['marks', 'Marks']];
    let type = TYPES.some((t) => t[0] === q.type) ? q.type : 'students';
    let csv = ''; let result = null;
    const picker = await collegePicker('', 'collegeId', 'Select college…');
    function draw() {
      v.innerHTML = html`<div class="page-head"><div><h1>Import / Export</h1><p>Every file is checked before anything is saved.</p></div></div>
        <div class="grid g-2-1"><div class="card"><div class="card-head"><h2>Import</h2><div class="seg">${TYPES.map(([k, l]) => html`<button data-click="type" data-k="${k}" class="${k === type ? 'active' : ''}">${l}</button>`)}</div></div><div class="card-body">
          <div class="row wrap" style="margin-bottom:12px"><a class="btn" href="/api/admin/templates/${type}">${icon('download', 16)} Download ${type} template</a>${picker}</div>
          <div class="field"><label for="csv-file">CSV file</label><input type="file" id="csv-file" accept=".csv,text/csv" class="input" data-change="file"></div>
          <div class="field"><label for="csv-text">…or paste CSV</label><textarea class="input mono" id="csv-text" rows="6" data-input="text" placeholder="Paste rows including the header line">${csv}</textarea></div>
          <div class="btn-row"><button class="btn" data-click="run" data-mode="validate">Validate</button><button class="btn primary" data-click="run" data-mode="import">Import (all or nothing)</button><button class="btn" data-click="run" data-mode="import_valid">Import valid rows only</button></div>
          ${result ? html`<div class="alert ${result.errors.length ? (result.committed ? 'warning' : 'critical') : 'success'}" style="margin-top:14px"><div class="ico">${result.errors.length ? '!' : '✓'}</div><div>
            <b>${result.committed ? `Imported ${result.imported} of ${result.total} rows.` : result.mode === 'validate' ? `${result.valid} of ${result.total} rows are valid. Nothing was written.` : `Nothing was imported: ${result.errors.length} row${result.errors.length === 1 ? '' : 's'} failed validation.`}</b>
            ${result.errors.length ? html`<ul class="small" style="margin:6px 0 0;padding-left:18px">${result.errors.slice(0, 30).map((e) => html`<li>Row ${e.row}: ${e.error}</li>`)}</ul>` : ''}</div></div>` : ''}
        </div></div>
        <div class="card"><div class="card-head"><h2>Export</h2></div><div class="card-body stack-sm">
          ${[['students', 'Student list'], ['attendance', 'Attendance report'], ['marks', 'Mark report'], ['risk', 'Risk report'], ['departments', 'Department report'], ['colleges', 'College report']].map(([k, l]) => html`<div class="row between"><span>${l}</span><a class="btn sm" href="/api/admin/export/${k}">${icon('download', 14)} CSV</a></div>`)}
          <div class="divider"></div><p class="small muted">Exports respect your organisational scope. </p></div></div></div>`.s;
    }
    bind(v, {
      type: (el) => { type = el.dataset.k; result = null; draw(); },
      text: (el) => { csv = el.value; },
      file: (el) => { const f = el.files[0]; if (!f) return; if (f.size > 5e6) return toast('File is larger than 5 MB.', 'error'); const r = new FileReader(); r.onload = () => { csv = String(r.result); $('#csv-text', v).value = csv; }; r.readAsText(f); },
      college: () => {},
      run: async (el) => {
        csv = $('#csv-text', v).value;
        if (!csv.trim()) return toast('Choose a CSV file or paste rows first.', 'error');
        const cid = $('select[name="collegeId"]', v)?.value;
        if (multiCollege() && !cid) return toast('Select the college to import into.', 'error');
        try { result = await api.post(`/api/admin/import/${type}`, { csv, mode: el.dataset.mode, collegeId: cid || undefined }); draw(); $('#csv-text', v).value = csv; if (result.committed) toast(`Imported ${result.imported} rows.`, 'success'); }
        catch (e) { toast(e.message, 'error', 'Import failed'); }
      },
    });
    draw();
  }, R);

  // ================= printable reports =================
  const kv = (pairs) => html`<div class="kv">${pairs.map(([k, val]) => html`<div><span>${k}</span><b>${val ?? '—'}</b></div>`)}</div>`;
  const reportHead = (title, sub) => html`<div class="row between no-print" style="margin-bottom:12px"><button class="btn" data-click="back">← Back</button><button class="btn primary" data-click="print">${icon('print', 16)} Print / save as PDF</button></div>
    <div class="row between"><div><div class="small muted">Academic Intelligence Platform</div><h1>${title}</h1><div class="muted">${sub}</div></div><span class="badge demo plain">Demo data</span></div>`;
  route('/report/student/:id', async (p) => {
    const v = shell(state.me.role === 'student' ? '#/student/profile' : '#/admin/records/students');
    try {
      const d = await api.get(`/api/reports/student/${p.id === 'me' ? 0 : p.id}`);
      const pr = d.profile;
      v.innerHTML = html`<div class="report card">${reportHead('Student Academic Report', `Generated ${fmt.dateTime(d.generatedAt)}`)}
        <section><h3>Student information</h3>${kv([['Name', pr.name], ['Roll number', pr.roll_no], ['Email', pr.email], ['Gender', pr.gender]])}</section>
        <section><h3>Academic information</h3>${kv([['University', pr.university], ['College', pr.college], ['Department', pr.department], ['Programme', pr.programme], ['Regulation', pr.regulation], ['Batch', pr.batch], ['Academic year', pr.academic_year], ['Semester', `${pr.current_semester} (${pr.term})`], ['Section', pr.section]])}</section>
        <section><h3>Course registration</h3>${table([{ label: 'Code', key: 'code' }, { label: 'Course', key: 'name' }, { label: 'Category', key: 'category' }, { label: 'Type', key: 'course_type' }, { label: 'Credits', key: 'credits', num: true }, { label: 'Faculty', render: (c) => (c.faculty_code ? `${c.faculty_code} - ${c.faculty_name}` : '—') }], d.courses, { cls: '' })}</section>
        <section><h3>Attendance (threshold ${d.attendance.threshold}%) · overall ${fmt.pct(d.attendance.overall.percentage)}</h3>${table([{ label: 'Course', key: 'name' }, { label: 'Attended', render: (c) => `${c.attended}/${c.conducted}` }, { label: '%', render: (c) => fmt.pct(c.percentage), num: true }, { label: 'Status', key: 'status' }, { label: 'Prediction', key: 'message' }], d.attendance.courses, { cls: '' })}</section>
        <section><h3>Marks and assignments</h3>${d.performance.courses.map((c) => html`<div style="margin-bottom:10px"><b>${c.code} ${c.name}</b> · ${fmt.pct(c.overallPct)} · ${c.trend}<div class="small">${c.assessments.map((a) => `${a.name}: ${a.marks === null ? '—' : `${fmt.marks(a.marks)}/${fmt.marks(a.max_marks)}`}`).join(' · ')}</div></div>`)}</section>
        <section><h3>Performance</h3>${kv([['Current semester', fmt.pct(d.performance.currentPct)], ['Previous SGPA', d.performance.previousSgpa], ['CGPA', d.performance.cgpa]])}
          <div class="small" style="margin-top:6px">History: ${d.performance.history.map((h) => `Sem ${h.semester_number}: ${h.sgpa}`).join(' · ') || '—'}</div></section>
        <section><h3>Risk analysis · overall ${d.risk.overall?.level || 'Normal'}</h3>${d.risk.courses.map((c) => html`<div style="margin-bottom:8px"><b>${c.name}: ${c.level}</b>${c.factors.length ? html`<ul class="small" style="margin:2px 0 0;padding-left:18px">${c.factors.map((f) => html`<li>${f.text}</li>`)}</ul>` : html`<div class="small muted">No risk factors.</div>`}</div>`)}</section>
      </div>`.s;
      bind(v, { print: () => window.print(), back: () => history.back() });
    } catch (e) { errorBox(v, e, () => App.render()); }
  }, { roles: ['student', ...ADMINS] });

  function groupReportBody(d) {
    return html`<section><h3>Overview</h3>${kv([['Students', d.studentCount], ['Below threshold (avg)', d.belowThreshold], ['Attendance threshold', `${d.threshold}%`]])}</section>
      <section><h3>Attendance trend</h3>${Charts.line([{ label: 'Attendance', points: d.attendanceTrend.map((w) => ({ x: w.week, y: w.pct })) }], { threshold: d.threshold, yMin: 40, dateX: true, height: 180 })}</section>
      <section><h3>Attendance distribution</h3>${Charts.bars(d.attendanceDistribution.map((b) => ({ label: b.label, value: b.count })), { height: 170 })}</section>
      <section><h3>Performance trend</h3>${Charts.line([{ label: 'Average %', points: d.performanceTrend.map((x) => ({ x: x.name.replace('Internal Assessment', 'IA'), y: x.pct })) }], { height: 170 })}</section>
      <section><h3>Risk distribution</h3>${Charts.dist(Charts.riskSegments(d.riskDistribution))}</section>
      <section><h3>Subject performance</h3>${table([{ label: 'Subject', render: (s) => `${s.code} ${s.name}${s.section ? ` (${s.section})` : ''}` }, { label: 'Avg marks', render: (s) => fmt.pct(s.avg_pct), num: true }, { label: 'Attendance', render: (s) => fmt.pct(s.att), num: true }, { label: 'High risk', key: 'high', num: true }], d.subjects, { cls: '' })}</section>`;
  }
  route('/report/department/:id', async (p) => {
    const v = shell('#/admin/analytics');
    try {
      const d = await api.get(`/api/reports/department/${p.id}`);
      v.innerHTML = html`<div class="report card">${reportHead(`Department Report: ${d.department.name}`, `${d.department.college} · ${d.department.university} · generated ${fmt.dateTime(d.generatedAt)}`)}
        <section><h3>Batches</h3>${table([{ label: 'Batch', key: 'name' }, { label: 'Current semester', key: 'current_semester', num: true }, { label: 'Students', key: 'students', num: true }], d.batches, { cls: '' })}</section>${groupReportBody(d)}</div>`.s;
      bind(v, { print: () => window.print(), back: () => history.back() });
    } catch (e) { errorBox(v, e, () => App.render()); }
  }, R);
  route('/report/college/:id', async (p) => {
    const v = shell('#/admin/analytics');
    try {
      const d = await api.get(`/api/reports/college/${p.id}`);
      v.innerHTML = html`<div class="report card">${reportHead(`College Report: ${d.college.name}`, `${d.college.university} · generated ${fmt.dateTime(d.generatedAt)}`)}
        <section><h3>Department comparison</h3>${table([{ label: 'Department', render: (x) => `${x.code} · ${x.name}` }, { label: 'Students', key: 'students', num: true }, { label: 'Avg attendance', render: (x) => fmt.pct(x.avgAttendance), num: true }, { label: 'High risk', key: 'high', num: true }, { label: 'Attention', key: 'attention', num: true }], d.departments, { cls: '' })}</section>${groupReportBody(d)}</div>`.s;
      bind(v, { print: () => window.print(), back: () => history.back() });
    } catch (e) { errorBox(v, e, () => App.render()); }
  }, R);
})();
