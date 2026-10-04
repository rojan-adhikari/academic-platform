/* Staff portal and the course workspace shared with administrators. */
(function () {
  'use strict';
  const { html, raw, $, $$, api, qs, route, go, state, store, bind, formData, fmt, riskBadge, attBadge, meter, table, icon, shell, loading, errorBox, notificationsView, dashNotifications, dashNotificationHandlers, toast, modal, confirmBox } = App;
  const R = { roles: ['staff'] };
  const TEACH = ['staff', 'super_admin', 'university_admin', 'college_admin', 'department_admin'];
  const TABS = [['students', 'Students'], ['attendance', 'Attendance'], ['marks', 'Marks'], ['assessments', 'Assessments & Assignments'], ['voice', '🎙 Voice Entry'], ['analytics', 'Analytics']];
  const today = () => new Date().toISOString().slice(0, 10);

  // ================= dashboard =================
  route('/staff', async () => {
    const v = shell('#/staff');
    async function load() {
      try {
        const [d, tt] = await Promise.all([api.get('/api/staff/dashboard'), api.get('/api/timetable').catch(() => null)]);
        const me = state.me; const t = d.totals;
        v.innerHTML = html`
          ${App.dashHead({ name: me.name, first: me.name, meta: `${d.staff?.designation || 'Faculty'} · ${me.employeeCode} · ${me.department?.name || ''}`,
    actions: html`<a class="btn" href="#/staff/profile">${icon('user', 16)} Profile</a>` })}
          <div class="grid g4 stat-row">
            ${App.stat({ label: 'My courses', value: t.courses, ico: 'book', href: '#/staff/courses', sub: 'This semester' })}
            ${App.stat({ label: 'Students taught', value: t.students, ico: 'users', href: '#/staff/go/students', sub: `Across ${d.offerings.length} section${d.offerings.length === 1 ? '' : 's'}` })}
            ${App.stat({ label: 'High-risk enrolments', value: t.highRisk, tone: t.highRisk ? 'crit' : 'safe', ico: 'shield', href: '#/staff/risk', sub: 'Review and reach out' })}
            ${App.stat({ label: 'Needing attention', value: t.attention, tone: t.attention ? 'warn' : 'safe', ico: 'alert', href: '#/staff/risk', sub: 'Close to a threshold' })}
          </div>
          <div class="grid g-2-1 dash-grid">
            <div class="stack-lg">
              <div class="card"><div class="card-head"><h2>My courses</h2><a class="small" href="#/staff/courses">All courses →</a></div>
                ${table([{ label: 'Course', render: (o) => html`<b>${o.name}</b><div class="small muted"><span class="mono">${o.code}</span> · ${o.course_type}</div>` },
    { label: 'Section', render: (o) => html`${o.batch}${o.section ? html`<div class="small muted">Section ${o.section}</div>` : ''}` }, { label: 'Students', key: 'students', num: true },
    { label: 'Avg attendance', render: (o) => html`<div style="min-width:110px"><b>${fmt.pct(o.avg_attendance)}</b>${meter(o.avg_attendance, 75, o.avg_attendance < 75 ? 'Critical' : o.avg_attendance < 80 ? 'Attention' : 'Safe')}</div>` },
    { label: 'Risk', render: (o) => html`${o.high_risk ? html`<span class="badge high">${o.high_risk} high</span> ` : ''}${o.attention ? html`<span class="badge attention">${o.attention} attention</span>` : ''}${!o.high_risk && !o.attention ? html`<span class="badge normal">None</span>` : ''}` }],
  d.offerings, { empty: 'No courses are assigned to you.', rowAttrs: (o) => `class="clickable" data-click="openCourse" data-id="${o.id}"` })}</div>
              <div class="card"><div class="card-head"><h2>High-risk students</h2><a class="small" href="#/staff/risk">All →</a></div>${table([{ label: 'Student', render: (s) => html`<b>${s.name}</b><div class="small muted">${s.roll_no} · ${s.course}</div>` },
    { label: 'Main reason', render: (s) => html`<span class="small">${s.top || '—'}</span>` }], d.atRisk, { empty: 'No high-risk students right now.', rowAttrs: (s) => `class="clickable" data-click="openStudent" data-o="${s.offering_id}" data-s="${s.id}"` })}</div>
            </div>
            <div class="stack-lg">
              ${tt ? App.todaySchedule(tt, '#/staff/timetable') : ''}
              <div class="card"><div class="card-head"><h2>Marks still to enter</h2>${d.pendingMarks.length ? html`<span class="badge attention">${d.pendingMarks.length}</span>` : ''}</div>
                <div class="feed">${d.pendingMarks.length ? d.pendingMarks.map((m) => html`<div class="feed-row"><div class="grow"><b>${m.name}</b><div class="small muted">${m.course}${m.section ? ` · Section ${m.section}` : ''} · ${m.missing} missing</div></div><a class="btn sm" href="#/staff/course/${m.offering_id}/marks?a=${m.id}">Enter</a></div>`)
    : html`<div class="feed-row muted small">All marks are entered.</div>`}</div></div>
              ${dashNotifications(d.notifications, d.unread, '#/staff/notifications')}
            </div>
          </div>`.s;
      } catch (e) { errorBox(v, e, load); }
    }
    bind(v, { openStudent: (el) => go(`#/staff/course/${el.dataset.o}/student/${el.dataset.s}`), openCourse: (el) => go(`#/staff/course/${el.dataset.id}`), ...dashNotificationHandlers(() => load()) });
    state.view.onLive = () => load();
    load();
  }, R);

  // ================= course list & picker =================
  async function courseList(v, { base, heading, sub, pickTab = null }) {
    const r = await api.get('/api/offerings?pageSize=200');
    v.innerHTML = html`<div class="page-head"><div><h1>${heading}</h1>${sub ? html`<p>${sub}</p>` : raw('')}</div></div>
      <div class="card">${table([
    { label: 'Course', render: (o) => html`<b>${o.name}</b><div class="small muted mono">${o.code}</div>` }, { label: 'Batch / section', render: (o) => `${o.batch}${o.section ? ` · ${o.section}` : ''}` },
    ...(state.me.role === 'staff' ? [] : [{ label: 'Faculty', render: (o) => (o.faculty_code ? `${o.faculty_code} - ${o.faculty_name}` : 'Unassigned') }, { label: 'College', key: 'college' }]),
    { label: 'Students', key: 'students', num: true }, { label: 'Avg attendance', render: (o) => fmt.pct(o.avg_attendance), num: true },
    { label: 'Risk', render: (o) => html`${o.high_risk ? html`<span class="badge high">${o.high_risk}</span> ` : ''}${o.attention ? html`<span class="badge attention">${o.attention}</span>` : ''}${!o.high_risk && !o.attention ? html`<span class="badge normal">0</span>` : ''}` },
  ], r.rows, { empty: 'No courses are assigned to you.', rowAttrs: (o) => `class="clickable" data-click="open" data-id="${o.id}"` })}${App.pager(r)}</div>`.s;
    bind(v, { open: (el) => { store.set('lastCourse', el.dataset.id); go(`${base}/course/${el.dataset.id}${pickTab ? '/' + pickTab : ''}`); } });
  }
  route('/staff/courses', async () => { const v = shell('#/staff/courses'); try { await courseList(v, { base: '#/staff', heading: 'My Courses', sub: '' }); } catch (e) { errorBox(v, e, () => App.render()); } }, R);
  route('/staff/go/:tab', async (p) => {
    const last = store.get('lastCourse');
    const v = shell(`#/staff/go/${p.tab}`);
    const label = (TABS.find((t) => t[0] === p.tab) || [, 'Course'])[1];
    try {
      if (last) {
        const r = await api.get('/api/offerings?pageSize=200');
        if (r.rows.some((o) => String(o.id) === String(last))) { location.replace(`#/staff/course/${last}/${p.tab}`); return; }
      }
      await courseList(v, { base: '#/staff', heading: label.replace('🎙 ', ''), sub: 'Choose a course to continue.', pickTab: p.tab });
    } catch (e) { errorBox(v, e, () => App.render()); }
  }, R);

  // ================= course workspace =================
  async function workspace(v, offeringId, tab, base, query) {
    let detail;
    try { detail = await api.get(`/api/offerings/${offeringId}`); } catch (e) { return errorBox(v, e, () => App.render()); }
    store.set('lastCourse', offeringId);
    const o = detail.offering;
    const T = TABS.filter(([k]) => !(k === 'voice' && !detail.canEditMarks));
    v.innerHTML = html`<div class="page-head"><div><div class="small muted mono">${o.code} · ${o.course_type} · ${o.credits} credits</div><h1>${o.name}</h1>
        <p>Batch ${o.batch}${o.section ? ` · Section ${o.section}` : ''} · ${o.semester} · ${o.faculty_code ? `${o.faculty_code} - ${o.faculty_name}` : 'Faculty unassigned'}${state.me.role !== 'staff' ? ` · ${o.college}` : ''}</p></div>
        <div class="btn-row">${state.me.role === 'staff' ? html`<a class="btn" href="#/staff/courses">All my courses</a>` : html`<a class="btn" href="#/admin/teaching">All courses</a>`}<button class="btn" data-click="announce">${icon('bell', 16)} Announce</button></div></div>
      <nav class="tabs">${T.map(([k, l]) => html`<a href="${base}/course/${o.id}/${k}" class="${k === tab ? 'active' : ''}">${l}</a>`)}</nav>
      <div id="tab"></div>`.s;
    bind(v, {
      announce: () => {
        const m = modal({ title: `Announcement to ${o.name}`, body: html`<form id="an-f"><div class="field"><label>Title</label><input class="input" name="title" maxlength="120" required></div><div class="field"><label>Message</label><textarea class="input" name="body" maxlength="2000" required></textarea></div></form>`,
          foot: html`<button class="btn" data-close>Cancel</button><button class="btn primary" id="an-send">Send to ${detail.students.length} students</button>` });
        $('#an-send', m.el).onclick = async () => { try { const r = await api.post(`/api/offerings/${o.id}/announce`, formData($('#an-f'))); m.close(); toast(`Sent to ${r.recipients} students.`, 'success'); } catch (e) { toast(e.message, 'error'); } };
      },
    });
    const box = $('#tab', v);
    const ctx = { o, detail, box, base, query, reload: () => App.render() };
    ({ students: tabStudents, attendance: tabAttendance, marks: tabMarks, assessments: tabAssessments, voice: tabVoice, analytics: tabAnalytics }[tab] || tabStudents)(ctx);
  }

  function tabStudents({ o, detail, box, base }) {
    let q = '', risk = '';
    const draw = () => {
      const rows = detail.students.filter((s) => (!risk || s.risk === risk) && (!q || s.name.toLowerCase().includes(q) || s.roll_no.toLowerCase().includes(q)));
      $('#st-table', box).innerHTML = table([
        { label: 'Roll no.', render: (s) => html`<span class="mono">${s.roll_no}</span>` }, { label: 'Name', render: (s) => html`<b>${s.name}</b>` },
        { label: 'Attendance', render: (s) => html`<div style="min-width:110px">${fmt.pct(s.attendancePct)} <span class="small muted">${s.attended}/${s.conducted}</span>${meter(s.attendancePct, detail.threshold, s.attendanceStatus)}</div>` },
        { label: 'Status', render: (s) => attBadge(s.attendanceStatus) }, { label: 'Performance', render: (s) => fmt.pct(s.performancePct), num: true },
        { label: 'Risk', render: (s) => riskBadge(s.risk) }, { label: 'Main factor', render: (s) => html`<span class="small">${s.topFactor || '—'}</span>` },
      ], rows, { rowAttrs: (s) => `class="clickable" data-click="open" data-id="${s.id}"` }).s;
    };
    box.innerHTML = html`<div class="card"><div class="card-head"><div class="row wrap"><div class="search-input" style="width:240px">${icon('search', 16)}<input class="input" placeholder="Search name or roll no." data-input="q"></div>
      <div class="seg">${[['', 'All'], ['High', 'High risk'], ['Attention', 'Attention'], ['Normal', 'Normal']].map(([k, l]) => html`<button data-click="risk" data-r="${k}" class="${k === '' ? 'active' : ''}">${l}</button>`)}</div></div>
      <span class="small muted">${detail.students.length} registered students · threshold ${detail.threshold}%</span></div><div id="st-table"></div></div>`.s;
    bind(box, { q: (el) => { q = el.value.toLowerCase(); draw(); }, risk: (el) => { risk = el.dataset.r; $$('[data-r]', box).forEach((b) => b.classList.toggle('active', b === el)); draw(); }, open: (el) => go(`${base}/course/${o.id}/student/${el.dataset.id}`) });
    draw();
  }

  async function tabAttendance({ o, detail, box }) {
    if (!detail.canEditAttendance) { box.innerHTML = html`<div class="card empty"><b>Your role cannot record attendance.</b></div>`.s; return; }
    let data; let absent = new Set(); let editing = null;
    async function load() { data = await api.get(`/api/offerings/${o.id}/attendance`); draw(); }
    function draw() {
      box.innerHTML = html`<div class="grid g-2-1">
        <div class="card"><div class="card-head"><h2>${editing ? 'Correct attendance' : 'Take attendance'}</h2><span class="small muted">${data.students.length - absent.size} present · ${absent.size} absent</span></div><div class="card-body">
          <form id="att-f" class="row wrap" style="margin-bottom:12px"><div><label>Date</label><input class="input" type="date" name="date" max="${today()}" value="${editing?.held_on || today()}"></div>
            <div><label>Period</label><select class="input" name="period">${[1, 2, 3, 4, 5, 6, 7, 8].map((n) => html`<option ${String(editing?.period || 1) === String(n) ? 'selected' : ''}>${n}</option>`)}</select></div>
            <div class="grow"><label>Topic (optional)</label><input class="input" name="topic" maxlength="200" value="${editing?.topic || ''}"></div></form>
          <div class="row between" style="margin-bottom:8px"><span class="small muted">Tap a student to mark absent.</span><div class="btn-row"><button class="btn sm" data-click="allPresent">Mark all present</button></div></div>
          <div class="att-list">${data.students.map((s) => html`<div class="att-item ${absent.has(s.id) ? 'absent' : ''}" data-click="toggle" data-id="${s.id}" role="checkbox" aria-checked="${!absent.has(s.id)}" tabindex="0">
            <div><b class="small">${s.name}</b><div class="small muted mono">${s.roll_no} · ${fmt.pct(s.attendancePct)}</div></div><span class="st">${absent.has(s.id) ? 'ABSENT' : 'PRESENT'}</span></div>`)}</div>
          <div class="btn-row" style="margin-top:14px"><button class="btn primary" data-click="save">${icon('check', 16)} Save attendance</button>${editing ? html`<button class="btn" data-click="cancelEdit">Cancel correction</button>` : ''}</div>
        </div></div>
        <div class="card"><div class="card-head"><h2>Recorded classes</h2><span class="small muted">${data.sessions.length}</span></div>
          <div style="max-height:620px;overflow:auto">${table([{ label: 'Date', render: (s) => html`<b>${fmt.date(s.held_on)}</b><div class="small muted">Period ${s.period}${s.topic ? ' · ' + s.topic : ''}</div>` },
    { label: 'Present', render: (s) => `${s.present}/${s.total}`, num: true }], data.sessions, { cls: '', rowAttrs: (s) => `class="clickable ${editing && editing.id === s.id ? 'selected' : ''}" data-click="edit" data-id="${s.id}" tabindex="0" title="Open this class"` })}</div></div></div>`.s;
    }
    bind(box, {
      toggle: (el) => { const id = Number(el.dataset.id); if (absent.has(id)) absent.delete(id); else absent.add(id); draw(); },
      allPresent: () => { absent = new Set(); draw(); },
      cancelEdit: () => { editing = null; absent = new Set(); draw(); },
      edit: async (el) => { const r = await api.get(`/api/attendance-sessions/${el.dataset.id}`); editing = r.session; absent = new Set(r.records.filter((x) => !x.present).map((x) => x.student_id)); draw(); },
      save: async () => {
        const f = formData($('#att-f', box));
        try {
          const r = await api.post(`/api/offerings/${o.id}/attendance`, { date: f.date, period: Number(f.period), topic: f.topic, absent: [...absent] });
          toast(`${r.changed} record${r.changed === 1 ? '' : 's'} saved. Predictions and alerts are being updated.`, 'success', 'Attendance saved');
          editing = null; absent = new Set(); setTimeout(load, 400);
        } catch (e) { toast(e.message, 'error', 'Unable to save attendance'); }
      },
    });
    box.innerHTML = loading(); try { await load(); } catch (e) { errorBox(box, e, load); }
  }

  async function tabMarks({ o, detail, box, query }) {
    let data; let aid = query.a ? Number(query.a) : null;
    async function load() {
      data = await api.get(`/api/offerings/${o.id}/marks`);
      if (!aid || !data.assessments.some((a) => a.id === aid)) aid = (data.assessments.find((a) => data.students.some((s) => s.marks[a.id] === null)) || data.assessments[0] || {}).id;
      draw();
    }
    function draw() {
      const a = data.assessments.find((x) => x.id === aid);
      if (!a) { box.innerHTML = html`<div class="card empty"><b>No assessments yet.</b>Create one in the Assessments tab.</div>`.s; return; }
      const editable = detail.canEditMarks;
      box.innerHTML = html`<div class="card"><div class="card-head"><div class="row wrap"><label style="margin:0">Assessment</label><select class="input" style="width:auto" data-change="pick">${data.assessments.map((x) => html`<option value="${x.id}" ${x.id === aid ? 'selected' : ''}>${x.name} (${x.kind}, out of ${fmt.marks(x.max_marks)})</option>`)}</select></div>
        <div class="btn-row"><span class="small muted" id="mk-status"></span>${editable ? html`<button class="btn primary" data-click="save">${icon('check', 16)} Save changes</button>` : ''}</div></div>
        ${table([{ label: 'Roll no.', render: (s) => html`<span class="mono">${s.roll_no}</span>` }, { label: 'Name', render: (s) => html`<b>${s.name}</b>` },
    { label: `Marks / ${fmt.marks(a.max_marks)}`, render: (s) => (editable ? html`<input class="input" type="number" step="0.5" min="0" max="${a.max_marks}" value="${s.marks[a.id] ?? ''}" data-input="edit" data-sid="${s.id}" data-orig="${s.marks[a.id] ?? ''}" aria-label="Marks for ${s.name}">` : fmt.marks(s.marks[a.id])) },
    { label: 'Risk', render: (s) => riskBadge(s.risk) }, { label: '', render: (s) => html`<span class="small" id="mk-${s.id}"></span>` }], data.students)}</div>`.s;
    }
    const changed = () => $$('input[data-sid]', box).filter((i) => i.value !== i.dataset.orig);
    bind(box, {
      pick: (el) => { aid = Number(el.value); draw(); },
      edit: (el) => {
        const a = data.assessments.find((x) => x.id === aid);
        const v = el.value === '' ? null : Number(el.value);
        const bad = v !== null && (v < 0 || v > a.max_marks || Number.isNaN(v));
        el.classList.toggle('invalid', bad);
        $(`#mk-${el.dataset.sid}`, box).innerHTML = bad ? html`<span style="color:var(--crit)">Must be 0–${fmt.marks(a.max_marks)}</span>`.s : el.value !== el.dataset.orig ? html`<span class="badge info plain">${el.dataset.orig === '' ? 'new' : `was ${el.dataset.orig}`}</span>`.s : '';
        $('#mk-status', box).textContent = changed().length ? `${changed().length} unsaved change${changed().length === 1 ? '' : 's'}` : '';
      },
      save: async () => {
        const list = changed();
        if (!list.length) return toast('No changes to save.');
        if ($$('input.invalid', box).length) return toast('Fix the highlighted marks first.', 'error');
        if (list.some((i) => i.value === '') && !(await confirmBox('Remove marks?', 'Some marks were cleared. Saving will delete them.', 'Delete and save', true))) return;
        try {
          const r = await api.post('/api/marks', { assessmentId: aid, entries: list.map((i) => ({ studentId: Number(i.dataset.sid), marks: i.value === '' ? null : Number(i.value) })), method: state.me.role === 'staff' ? 'manual' : 'admin' });
          toast(`${r.created} new, ${r.updated} updated. Students have been notified.`, 'success', 'Marks saved');
          await load();
        } catch (e) { toast(e.message, 'error', 'Marks not saved'); }
      },
    });
    box.innerHTML = loading(); try { await load(); } catch (e) { errorBox(box, e, load); }
  }

  function assessmentForm(a = {}) {
    return html`<form id="as-f" class="form-grid">
      <div class="field"><label>Name</label><input class="input" name="name" required maxlength="80" value="${a.name || ''}" placeholder="Internal Assessment 2"></div>
      <div class="field"><label>Short name</label><input class="input" name="short_name" maxlength="12" value="${a.short_name || ''}" placeholder="IA2"></div>
      <div class="field"><label>Type</label><select class="input" name="kind">${['internal', 'quiz', 'assignment', 'lab', 'exam'].map((k) => html`<option ${a.kind === k ? 'selected' : ''}>${k}</option>`)}</select></div>
      <div class="field"><label>Maximum marks</label><input class="input" type="number" name="max_marks" min="1" max="1000" step="0.5" required value="${a.max_marks ?? 25}"></div>
      <div class="field"><label>Weight</label><input class="input" type="number" name="weight" min="0" max="100" step="0.1" value="${a.weight ?? 1}"><div class="hint">Relative weight inside the course</div></div>
      <div class="field"><label>Order</label><input class="input" type="number" name="sequence" min="1" max="100" value="${a.sequence ?? 1}"></div>
      <div class="field"><label>Held on</label><input class="input" type="date" name="held_on" value="${a.held_on || ''}"></div>
      <div class="field"><label>Due on (assignments)</label><input class="input" type="date" name="due_on" value="${a.due_on || ''}"></div>
      <div class="field full"><label>Description</label><textarea class="input" name="description" maxlength="1000">${a.description || ''}</textarea></div>
      <label class="checkbox full"><input type="checkbox" name="published" ${a.published === 0 ? '' : 'checked'}> Published to students</label></form>`;
  }
  function tabAssessments({ o, detail, box }) {
    const draw = () => {
      box.innerHTML = html`<div class="card"><div class="card-head"><h2>Assessments and assignments</h2>${detail.canManageAssessments ? html`<button class="btn primary" data-click="create">${icon('plus', 16)} New assessment / assignment</button>` : ''}</div>
        ${table([{ label: 'Order', key: 'sequence', num: true }, { label: 'Name', render: (a) => html`<b>${a.name}</b> ${a.short_name ? html`<span class="tag">${a.short_name}</span>` : ''}` }, { label: 'Type', key: 'kind' },
    { label: 'Max', render: (a) => fmt.marks(a.max_marks), num: true }, { label: 'Weight', key: 'weight', num: true }, { label: 'Date', render: (a) => fmt.date(a.held_on || a.due_on) },
    { label: 'Entered', render: (a) => `${a.entered}/${detail.students.length}`, num: true }, { label: 'Average', render: (a) => (a.avg === null ? '—' : fmt.marks(a.avg)), num: true },
    { label: 'Published', render: (a) => (a.published ? 'Yes' : 'No') },
    { label: '', render: (a) => (detail.canManageAssessments ? html`<div class="btn-row"><button class="btn sm" data-click="edit" data-id="${a.id}">Edit</button>${a.entered ? '' : html`<button class="btn sm danger" data-click="del" data-id="${a.id}">Delete</button>`}</div>` : '') }],
  detail.assessments, { empty: 'No assessments yet.' })}</div>
        <p class="small muted" style="margin-top:10px">Weights decide how much each assessment counts.</p>`.s;
    };
    const open = (a) => {
      const m = modal({ title: a ? `Edit ${a.name}` : 'New assessment / assignment', body: assessmentForm(a || {}), wide: true, foot: html`<button class="btn" data-close>Cancel</button><button class="btn primary" id="as-save">Save</button>` });
      $('#as-save', m.el).onclick = async () => {
        const d = formData($('#as-f'));
        try {
          if (a) await api.put(`/api/assessments/${a.id}`, d); else await api.post(`/api/offerings/${o.id}/assessments`, d);
          m.close(); toast('Saved.', 'success'); App.render();
        } catch (e) { toast(e.message, 'error'); }
      };
    };
    bind(box, {
      create: () => open(null),
      edit: (el) => open(detail.assessments.find((a) => a.id === Number(el.dataset.id))),
      del: async (el) => { if (await confirmBox('Delete assessment?', 'This assessment has no marks yet and will be removed.', 'Delete', true)) { try { await api.del(`/api/assessments/${el.dataset.id}`); toast('Deleted.', 'success'); App.render(); } catch (e) { toast(e.message, 'error'); } } },
    });
    draw();
  }

  // ================= voice mark entry =================
  function tabVoice({ o, detail, box }) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    let rec = null; let listening = false; let entries = []; let roster = detail.students; let defaultA = '';
    const gate = window.VoiceGate ? VoiceGate.create() : null; let gateOff = null; let holding = false;
    const assessments = detail.assessments;

    function draw() {
      box.innerHTML = html`<div class="grid g-2-1">
        <div class="stack">
          <div class="card card-pad">
            <div class="voice-hero">
              <button class="mic ${listening ? 'listening' : ''}" data-click="mic" aria-label="${listening ? 'Stop listening' : 'Start voice entry'}" ${SR ? '' : 'disabled title="Speech recognition is not available in this browser"'}>${icon('mic', 32)}</button>
              <div class="grow"><h2>🎙 Voice Entry</h2><div class="muted small" id="v-status">${SR ? (listening ? 'Listening… say the student and the mark.' : 'Tap the microphone and say the student’s name and mark.') : 'Speech recognition is not available in this browser. Type what you would say below.'}</div>
                <div class="transcript interim" id="v-live"></div></div>
            </div>
            ${SR && gate ? html`<div class="v-gate" id="v-gate"></div>` : ''}
            <form class="row wrap" data-submit="typed" style="margin-top:12px"><input class="input grow" name="t" id="v-text" placeholder="Or type it: Give Anjali 18 marks in internal 1" autocomplete="off" aria-label="Typed voice command"><button class="btn">Interpret</button></form>
            <div class="row wrap" style="margin-top:12px"><label style="margin:0" for="v-def">If no assessment is said, use</label><select class="input" id="v-def" style="width:auto" data-change="def"><option value="">Auto-detect (missing marks first)</option>${assessments.map((a) => html`<option value="${a.id}" ${String(a.id) === String(defaultA) ? 'selected' : ''}>${a.name} (out of ${fmt.marks(a.max_marks)})</option>`)}</select></div>
          </div>
          <div id="v-results">${entries.map((e, i) => entryCard(e, i))}</div>
        </div>
        <div class="card"><div class="card-head"><h3>How voice entry stays safe</h3></div><div class="card-body small stack-sm">
          <div>${icon('check', 15)} Nothing is saved until you press <b>Confirm &amp; Save</b>.</div>
          <div>${icon('check', 15)} Only students registered in <b>${o.name}</b> can be matched.</div>
          <div>${icon('check', 15)} Marks above the maximum are rejected.</div>
          <div>${icon('check', 15)} Ambiguous names ask you to choose.</div>
          <div>${icon('check', 15)} Saving notifies the student, recalculates performance and risk, and writes the audit log.</div>
          <div class="divider"></div><div class="muted">Recognition runs in your browser (Web Speech API). Typed input uses the same parser.</div></div></div></div>`.s;
    }
    function entryCard(e, i) {
      const a = assessments.find((x) => x.id === Number(e.sel.assessmentId));
      const st = roster.find((s) => s.id === Number(e.sel.studentId));
      const marksBad = e.sel.marks !== '' && a && (Number(e.sel.marks) > a.max_marks || Number(e.sel.marks) < 0);
      const prev = st && a ? st.marks?.[a.id] : null;
      const ready = st && a && e.sel.marks !== '' && !marksBad;
      const confClass = e.confidence === 'high' ? 'safe' : e.confidence === 'medium' ? 'attention' : 'critical';
      const lock = !e.editing;
      const issues = e.issues.filter((x) => !/maximum/i.test(x.text)).filter((x) => !(x.level === 'question' && ((/student/i.test(x.text) && st) || (/assessment/i.test(x.text) && a))));
      return html`<div class="detect ${e.saved ? 'saved' : ready ? 'ready' : 'blocked'}" style="margin-bottom:12px">
        <div class="row between wrap"><h3>${e.saved ? 'Saved' : 'Detected'}</h3>${e.saved ? html`<span class="badge safe">Saved to database</span>` : html`<span class="badge ${confClass}">${e.confidence} confidence</span>`}</div>
        <div class="small muted">Heard: “${e.heard}”</div>
        <dl>
          <dt>Student</dt><dd>${lock && st ? html`${st.name} <span class="small muted mono">${st.roll_no}</span>` : html`<select class="input" data-change="sel" data-i="${i}" data-k="studentId" ${e.saved ? 'disabled' : ''}><option value="">Select student…</option>
            ${e.student.candidates.length ? html`<optgroup label="Best matches">${e.student.candidates.map((c) => html`<option value="${c.id}" ${String(c.id) === String(e.sel.studentId) ? 'selected' : ''}>${c.name} (${c.roll_no})</option>`)}</optgroup>` : ''}
            <optgroup label="${e.student.candidates.length ? 'Other students in this course' : 'All students in this course'}">${roster.filter((s) => !e.student.candidates.some((c) => c.id === s.id)).map((s) => html`<option value="${s.id}" ${String(s.id) === String(e.sel.studentId) ? 'selected' : ''}>${s.name} (${s.roll_no})</option>`)}</optgroup></select>`}</dd>
          <dt>Assessment</dt><dd>${lock && a ? html`${a.name}${e.assessment.inferred ? html` <span class="badge attention plain">inferred</span>` : ''}` : html`<select class="input" data-change="sel" data-i="${i}" data-k="assessmentId" ${e.saved ? 'disabled' : ''}><option value="">Select assessment…</option>${assessments.map((x) => html`<option value="${x.id}" ${String(x.id) === String(e.sel.assessmentId) ? 'selected' : ''}>${x.name} (out of ${fmt.marks(x.max_marks)})</option>`)}</select>`}</dd>
          <dt>Marks</dt><dd>${lock && e.sel.marks !== '' && !marksBad ? html`<span style="font-size:20px">${e.sel.marks}</span> / ${a ? fmt.marks(a.max_marks) : '?'}` : html`<div class="row"><input class="input ${marksBad ? 'invalid' : ''}" type="number" step="0.5" min="0" style="max-width:110px" value="${e.sel.marks}" data-input="sel" data-i="${i}" data-k="marks" ${e.saved ? 'disabled' : ''} aria-label="Marks"><span>/ ${a ? fmt.marks(a.max_marks) : '?'}</span></div>`}
            ${prev !== null && prev !== undefined && !e.saved ? html`<div class="small muted">Current mark ${fmt.marks(prev)} will be updated.</div>` : ''}</dd>
        </dl>
        ${marksBad ? html`<div class="alert critical" style="margin-bottom:8px"><div class="ico">!</div><div>${e.sel.marks} / ${fmt.marks(a.max_marks)} is not valid. Marks cannot exceed the maximum.</div></div>` : ''}
        ${!e.saved ? issues.map((x) => html`<div class="alert ${x.level === 'error' ? 'critical' : x.level === 'info' ? 'info' : 'warning'}" style="margin-bottom:8px"><div class="ico">${x.level === 'info' ? 'i' : '!'}</div><div>${x.text}</div></div>`) : html`<div class="alert success"><div class="ico">✓</div><div><b>${st?.name} — ${a?.name}: ${e.sel.marks} / ${a ? fmt.marks(a.max_marks) : ''}</b><p>The student has been notified. Performance and risk are being recalculated.</p></div></div>`}
        ${!e.saved ? html`<div class="btn-row" style="margin-top:8px"><button class="btn" data-click="editE" data-i="${i}">${icon('edit', 15)} ${e.editing ? 'Done editing' : 'Edit'}</button>
          <button class="btn primary" data-click="saveE" data-i="${i}" ${ready ? '' : 'disabled'}>${icon('check', 15)} Confirm &amp; Save</button><button class="btn ghost" data-click="discard" data-i="${i}">Discard</button></div>` : ''}
      </div>`;
    }
    async function interpret(text) {
      const t = String(text || '').trim();
      if (!t) return;
      $('#v-live', box).textContent = `“${t}”`;
      try {
        const r = await api.post(`/api/offerings/${o.id}/voice/parse`, { transcript: t, defaultAssessmentId: defaultA || null });
        if (r.error || !r.entries.length) { toast(r.error || 'Voice could not be understood. Please try again.', 'error'); return; }
        const fresh = r.entries.map((e) => ({ ...e, editing: !e.readyToConfirm, saved: false,
          sel: { studentId: e.student.selectedId || '', assessmentId: e.assessment.selectedId || '', marks: e.marks.value ?? '' } }));
        entries = [...fresh, ...entries.filter((e) => !e.saved)].slice(0, 8);
        draw();
      } catch (e) { toast(e.message, 'error', 'Voice could not be processed'); }
    }
    function startMic() {
      if (!SR) return;
      if (listening && rec) { rec.stop(); return; }
      rec = new SR(); rec.lang = 'en-IN'; rec.interimResults = true; rec.maxAlternatives = 3; rec.continuous = false;
      let finalText = ''; let rejected = ''; let segStart = performance.now();
      clearTimeout(gateOff);
      if (gate) gate.start();
      rec.onstart = () => { listening = true; draw(); };
      rec.onresult = (ev) => {
        let interim = '';
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          const r = ev.results[i];
          if (!r.isFinal) { interim += r[0].transcript; continue; }
          // Only the person at the microphone counts: check the level while this phrase was spoken, and its confidence.
          const from = segStart; segStart = performance.now();
          const j = gate ? gate.judge(from) : { ok: true };
          const p = gate ? gate.pick(r, (t) => /\d|one|two|three|four|five|six|seven|eight|nine|ten|twenty|thirty|forty|fifty/i.test(t)) : { ok: true, transcript: r[0].transcript };
          if (!j.ok) rejected = VoiceGate.reason(j);
          else if (!p.ok) rejected = `${p.reason} Please say it again, closer to the microphone.`;
          else finalText += p.transcript;
        }
        const live = $('#v-live', box); if (live) { live.textContent = finalText || interim; live.classList.toggle('interim', !finalText); }
      };
      rec.onerror = (ev) => {
        listening = false; draw();
        const msg = ev.error === 'not-allowed' || ev.error === 'service-not-allowed' ? 'Microphone permission was denied. Allow microphone access or type the entry instead.'
          : ev.error === 'no-speech' ? 'No speech was detected. Please try again.' : 'Voice could not be understood. Please try again.';
        toast(msg, 'error');
      };
      rec.onend = () => {
        listening = false;
        gateOff = setTimeout(() => { if (!listening && gate) gate.stop(); }, 1500);
        if (finalText) { interpret(finalText); return; }
        draw();
        if (rejected) { toast(rejected, 'error', 'Nothing was taken'); const live = $('#v-live', box); if (live) live.textContent = rejected; }
      };
      try { rec.start(); } catch { toast('Voice could not be started. Please try again.', 'error'); }
    }
    const _draw = draw;
    draw = function () { _draw(); const slot = $('#v-gate', box); if (slot && gate) slot.appendChild(VoiceGate.controls(gate, { holdLabel: 'Hold Ctrl+Alt' })); };
    const onKey = (e) => {
      if (!box.isConnected) { document.removeEventListener('keydown', onKey); document.removeEventListener('keyup', onKeyUp); if (gate) gate.stop(); return; }
      if (!(e.ctrlKey && e.altKey) || e.shiftKey || e.metaKey || e.repeat || (e.key !== 'Control' && e.key !== 'Alt')) return;
      if (e.target.closest && e.target.closest('input, textarea, select')) return;
      if ($('#modal-root') && $('#modal-root').children.length) return;
      e.preventDefault();
      if (VoiceGate.settings.mode === 'hold') { holding = true; if (!listening) startMic(); } else startMic();
    };
    const onKeyUp = (e) => { if (holding && (e.key === 'Control' || e.key === 'Alt')) { holding = false; if (listening && rec) rec.stop(); } };
    if (SR) { document.addEventListener('keydown', onKey); document.addEventListener('keyup', onKeyUp); }
    bind(box, {
      mic: startMic,
      typed: (f) => { interpret(f.elements.t.value); f.reset(); },
      example: (el) => interpret(el.dataset.t),
      def: (el) => { defaultA = el.value; },
      sel: (el) => { const e = entries[Number(el.dataset.i)]; e.sel[el.dataset.k] = el.value; const keep = document.activeElement === el && el.tagName === 'INPUT'; draw(); if (keep) { const n = $(`[data-i="${el.dataset.i}"][data-k="${el.dataset.k}"]`, box); if (n) { n.focus(); n.setSelectionRange?.(n.value.length, n.value.length); } } },
      editE: (el) => { const e = entries[Number(el.dataset.i)]; e.editing = !e.editing; draw(); },
      discard: (el) => { entries.splice(Number(el.dataset.i), 1); draw(); },
      saveE: async (el) => {
        const e = entries[Number(el.dataset.i)];
        try {
          await api.post('/api/marks', { assessmentId: Number(e.sel.assessmentId), entries: [{ studentId: Number(e.sel.studentId), marks: Number(e.sel.marks) }], method: 'voice' });
          e.saved = true; e.editing = false;
          const st = roster.find((s) => s.id === Number(e.sel.studentId)); if (st) { st.marks = st.marks || {}; st.marks[e.sel.assessmentId] = Number(e.sel.marks); }
          draw(); toast(`${st ? st.name : 'Student'} has been notified.`, 'success', 'Mark saved');
        } catch (err) { toast(err.message, 'error', 'Mark not saved'); }
      },
    });
    draw();
  }

  // ================= analytics =================
  async function tabAnalytics({ o, box }) {
    const f = { risk: '', performance: '', assessmentId: '' };
    async function load() {
      const d = await api.get(`/api/offerings/${o.id}/analytics` + qs(f));
      box.innerHTML = html`<div class="card card-pad" style="margin-bottom:16px"><div class="row wrap">
          <div><label>Risk level</label><select class="input" data-change="f" data-k="risk">${[['', 'All'], ['High', 'High'], ['Attention', 'Attention'], ['Normal', 'Normal']].map(([k, l]) => html`<option value="${k}" ${f.risk === k ? 'selected' : ''}>${l}</option>`)}</select></div>
          <div><label>Performance level</label><select class="input" data-change="f" data-k="performance">${[['', 'All'], ['low', 'Below 50%'], ['mid', '50–75%'], ['high', '75% and above']].map(([k, l]) => html`<option value="${k}" ${f.performance === k ? 'selected' : ''}>${l}</option>`)}</select></div>
          <div><label>Assessment (mark distribution)</label><select class="input" data-change="f" data-k="assessmentId"><option value="">Latest test</option>${d.assessments.map((a) => html`<option value="${a.id}" ${String(f.assessmentId) === String(a.id) ? 'selected' : ''}>${a.name}</option>`)}</select></div>
          <div class="grow small muted" style="align-self:flex-end">Section ${o.section || '—'} · ${o.semester}</div></div></div>
        <div class="grid g4">
          <div class="card kpi"><div class="label">Students in view</div><div class="value">${d.count}</div></div>
          <div class="card kpi"><div class="label">Class average</div><div class="value">${fmt.pct(d.classAverage)}</div></div>
          <div class="card kpi"><div class="label">Average attendance</div><div class="value">${fmt.pct(d.avgAttendance)}</div></div>
          <div class="card kpi ${d.belowThreshold ? 'crit' : 'safe'}"><div class="label">Below ${d.threshold}%</div><div class="value">${d.belowThreshold}</div></div>
        </div>
        <div class="grid g2" style="margin-top:16px">
          <div class="card"><div class="card-head"><h3>Attendance distribution</h3></div><div class="card-body">${Charts.bars(d.attendanceDistribution.map((b, i) => ({ label: `${b.label}%`, value: b.count, color: i < 3 ? (i === 2 ? Charts.C.warn : Charts.C.crit) : Charts.C.safe })))}</div></div>
          <div class="card"><div class="card-head"><h3>Mark distribution</h3><span class="small muted">${d.markDistribution.assessment || ''}</span></div><div class="card-body">${Charts.bars(d.markDistribution.bins.map((b) => ({ label: `${b.label}%`, value: b.count })))}</div></div>
          <div class="card"><div class="card-head"><h3>Performance trend</h3><span class="small muted">Average % by assessment</span></div><div class="card-body">${Charts.line([{ label: 'Class average', points: d.assessmentTrend.filter((a) => a.avgPct !== null).map((a) => ({ x: a.name.replace('Internal Assessment', 'IA').replace('Assignment', 'Asg'), y: a.avgPct })) }], { yMin: 0 })}</div></div>
          <div class="card"><div class="card-head"><h3>Attendance trend</h3><span class="small muted">Weekly</span></div><div class="card-body">${Charts.line([{ label: 'Attendance', points: d.attendanceTrend.map((w) => ({ x: w.week, y: w.pct })), color: Charts.C.accent }], { threshold: d.threshold, yMin: 40, dateX: true })}</div></div>
          <div class="card"><div class="card-head"><h3>Assignment performance</h3></div><div class="card-body">${Charts.hbars(d.assignmentPerformance.map((a) => ({ label: a.name, value: a.avgPct ?? 0, title: `${a.entered} submissions` })), { max: 100, unit: '%' })}</div></div>
          <div class="card"><div class="card-head"><h3>Risk distribution</h3></div><div class="card-body">${Charts.dist(Charts.riskSegments(d.riskDistribution))}</div></div>
        </div>
        <div class="card" style="margin-top:16px"><div class="card-head"><h2>Students at risk</h2><span class="small muted">${d.atRisk.length}</span></div>
          ${table([{ label: 'Student', render: (s) => html`<b>${s.name}</b><div class="small muted mono">${s.roll_no}</div>` }, { label: 'Attendance', render: (s) => fmt.pct(s.attendancePct), num: true }, { label: 'Performance', render: (s) => fmt.pct(s.performancePct), num: true },
    { label: 'Risk', render: (s) => riskBadge(s.risk) }, { label: 'Main factor', render: (s) => html`<span class="small">${s.topFactor || '—'}</span>` }], d.atRisk, { empty: 'No students at risk in this view.' })}</div>`.s;
    }
    bind(box, { f: (el) => { f[el.dataset.k] = el.value; load().catch((e) => errorBox(box, e, load)); } });
    box.innerHTML = loading(); try { await load(); } catch (e) { errorBox(box, e, load); }
  }

  // ================= student detail (course context) =================
  async function studentDetail(v, offeringId, sid, base) {
    try {
      const d = await api.get(`/api/offerings/${offeringId}/students/${sid}`);
      const a = d.course.attendance; const p = d.course.performance; const r = d.course.risk;
      v.innerHTML = html`<div class="page-head"><div><a href="${base}/course/${offeringId}" class="small">← Back to course</a><h1>${d.profile.name}</h1><p>${d.profile.roll_no} · ${d.profile.programme} · Batch ${d.profile.batch}${d.profile.section ? ` · Section ${d.profile.section}` : ''} · Semester ${d.profile.semester}</p></div>
        <div class="row wrap"><span class="tag">Overall attendance ${fmt.pct(d.overall.attendance)}</span><span class="tag">Previous SGPA ${d.overall.previousSgpa ?? '—'}</span>${riskBadge(d.overall.risk)}${state.me.role !== 'staff' ? html`<a class="btn sm" href="#/admin/student/${sid}">Full profile</a>` : ''}</div></div>
        <div class="grid g2">
          <div class="card"><div class="card-head"><h2>Attendance in ${p?.name || 'this course'}</h2>${a ? attBadge(a.status) : ''}</div><div class="card-body">${a ? html`
            <div class="row wrap" style="gap:18px">${Charts.donut(a.percentage, { threshold: a.threshold, status: a.status, label: `${a.attended}/${a.conducted}` })}<div class="grow"><b>${a.message}</b>${a.guidance.map((g) => html`<div class="muted small">${g}</div>`)}</div></div>
            <div style="margin-top:10px">${Charts.line([{ label: 'Cumulative attendance', points: a.series.map((y, i) => ({ x: `#${i + 1}`, y })) }], { threshold: a.threshold, yMin: 40, height: 180 })}</div>` : 'No attendance yet.'}</div></div>
          ${r ? StudentViews.riskCard(r) : ''}
        </div>
        ${r ? html`<p class="small muted" style="margin-top:8px">Model ${r.modelVersion} · probability ${r.probability} · trigger ${r.trigger} · dataset ${r.datasetVersion}</p>` : ''}
        <div class="card" style="margin-top:16px"><div class="card-head"><h2>Marks</h2>${p ? html`<span class="badge ${p.trend === 'Declining' ? 'attention' : 'plain'}">${p.trend}</span>` : ''}</div>
          ${p ? table([{ label: 'Assessment', key: 'name' }, { label: 'Type', key: 'kind' }, { label: 'Marks', render: (x) => (x.marks === null ? '—' : `${fmt.marks(x.marks)} / ${fmt.marks(x.max_marks)}`) }, { label: '%', render: (x) => fmt.pct(x.pct), num: true }, { label: 'Class avg', render: (x) => (x.class_avg === null ? '—' : fmt.marks(x.class_avg)), num: true }], p.assessments) : ''}</div>`.s;
      RiskViz.wire(v);
    } catch (e) { errorBox(v, e, () => App.render()); }
  }

  route('/staff/course/:id', async (p, q) => { const v = shell('#/staff/courses'); await workspace(v, p.id, 'students', '#/staff', q); }, R);
  route('/staff/course/:id/student/:sid', async (p) => { const v = shell('#/staff/go/students'); await studentDetail(v, p.id, p.sid, '#/staff'); }, R);
  route('/staff/course/:id/:tab', async (p, q) => { const nav = { students: '#/staff/go/students', attendance: '#/staff/go/attendance', marks: '#/staff/go/marks', voice: '#/staff/go/voice', analytics: '#/staff/go/analytics' }[p.tab] || '#/staff/courses'; const v = shell(nav); await workspace(v, p.id, p.tab, '#/staff', q); }, R);

  route('/staff/risk', async () => {
    const v = shell('#/staff/risk');
    let level = '';
    async function load() {
      try {
        const d = await api.get('/api/staff/risk' + qs({ level }));
        $('#rk', v).innerHTML = table([{ label: 'Student', render: (s) => html`<b>${s.name}</b><div class="small muted mono">${s.roll_no}</div>` }, { label: 'Course', render: (s) => html`${s.course}${s.section ? html` <span class="tag">Sec ${s.section}</span>` : ''}` },
          { label: 'Risk', render: (s) => riskBadge(s.level) }, { label: 'Why (hover for detail)', render: (s) => RiskViz.chips(s.chips, s.level) }],
        d.rows, { empty: 'No students match this risk level.', rowAttrs: (s) => `class="clickable" data-click="open" data-o="${s.offering_id}" data-s="${s.id}"` }).s;
      } catch (e) { errorBox($('#rk', v), e, load); }
    }
    v.innerHTML = html`<div class="page-head"><div><h1>Risk Monitoring</h1></div>
      <div class="seg">${[['', 'Attention + High'], ['High', 'High'], ['Attention', 'Attention']].map(([k, l]) => html`<button data-click="lv" data-l="${k}" class="${k === '' ? 'active' : ''}">${l}</button>`)}</div></div><div class="card" id="rk">${loading()}</div>`.s;
    bind(v, { lv: (el) => { level = el.dataset.l; $$('[data-l]', v).forEach((b) => b.classList.toggle('active', b === el)); load(); }, open: (el) => go(`#/staff/course/${el.dataset.o}/student/${el.dataset.s}`) });
    load();
  }, R);

  route('/staff/notifications', async () => { const v = shell('#/staff/notifications'); notificationsView(v); }, R);
  route('/staff/profile', async () => {
    const v = shell('#/staff/profile');
    try {
      const [d, tt] = await Promise.all([api.get('/api/staff/dashboard'), api.get('/api/timetable').catch(() => null)]);
      const me = state.me; const designation = d.staff?.designation || me.designation || 'Faculty';
      const periods = tt ? tt.slots.length : null;
      v.innerHTML = html`
        ${App.profileHero({ name: me.name, title: `${designation} · ${me.department?.name || ''}`, institution: `${me.college?.name || ''} · ${me.university?.name || ''}`, logoSrc: me.college?.logo || '',
    chips: [html`<span class="mono">${me.employeeCode}</span>`, me.department?.code ? `Dept. ${me.department.code}` : '', html`<span class="ph-live">Active</span>`],
    actions: html`<a class="btn" href="#/account/password">Change password</a><a class="btn primary" href="#/staff/timetable">${icon('grid', 16)} Timetable</a>`,
    stats: [['Courses', d.totals.courses, 'This semester'], ['Students', d.totals.students, `${d.offerings.length} section${d.offerings.length === 1 ? '' : 's'}`], ['Teaching load', periods ?? '—', 'Periods per week'], ['At risk', d.totals.highRisk, `${d.totals.attention} need attention`]] })}
        <div class="grid prof-grid">
          <div class="stack-lg">
            ${App.detailCard('Employment', [['Employee code', html`<span class="mono">${me.employeeCode}</span>`], ['Designation', designation], ['Department', me.department?.name]])}
            ${App.detailCard('Institution', [['College', me.college?.name], ['University', me.university?.name]])}
            ${App.detailCard('Contact', [['Email', me.email], ['Login ID', me.loginId]])}
          </div>
          <div class="stack-lg">
            <div class="card"><div class="card-head"><h2>Assigned courses</h2><a class="small" href="#/staff/courses">My courses →</a></div>
              ${table([{ label: 'Code', render: (o) => html`<b class="mono">${o.code}</b>` }, { label: 'Course', render: (o) => html`${o.name}<div class="small muted">${o.course_type} · ${o.credits} credits</div>` },
    { label: 'Section', render: (o) => `${o.batch}${o.section ? ' · ' + o.section : ''}` }, { label: 'Students', key: 'students', num: true }, { label: 'Avg attendance', render: (o) => fmt.pct(o.avg_attendance), num: true }], d.offerings, { empty: 'No courses assigned.' })}
              ${d.offerings.length ? html`<div class="table-foot"><span>${d.offerings.length} sections</span><b>${d.totals.students} students</b></div>` : ''}</div>
            <div class="card"><div class="card-head"><h2>Permissions</h2><span class="small muted">Granted by your institution</span></div>
              <div class="card-body ph-perms">${(me.permissions || []).map((x) => html`<span class="ph-chip">${icon('check', 13)} ${x.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())}</span>`)}</div></div>
          </div>
        </div>`.s;
    } catch (e) { errorBox(v, e, () => App.render()); }
  }, R);

  window.StaffViews = { workspace, studentDetail, courseList, TEACH };
})();
