/* Student portal */
(function () {
  'use strict';
  const { html, $, $$, api, route, go, state, bind, fmt, riskBadge, attBadge, meter, table, icon, shell, loading, errorBox, notificationsView, dashNotifications, dashNotificationHandlers, toast, confirmBox } = App;
  const R = { roles: ['student'] };
  const sevClass = (s) => (s === 'critical' ? 'critical' : s === 'warning' ? 'warning' : 'info');

  function profileGrid(p) {
    const items = [['Roll number', p.roll_no], ['University', p.university], ['College', p.college], ['Department', p.department], ['Programme', p.programme], ['Regulation', p.regulation],
      ['Batch', p.batch], ['Academic year', p.academic_year], ['Semester', `${p.current_semester} (${p.term || '—'})`], ['Section', p.section || '—']];
    return html`<div class="grid g4" style="gap:10px 18px">${items.map(([k, v]) => html`<div><div class="small muted">${k}</div><b>${v || '—'}</b></div>`)}</div>`;
  }

  route('/student', async () => {
    const v = shell('#/student');
    async function load() {
      try {
        const [d, tt] = await Promise.all([api.get('/api/student/dashboard'), api.get('/api/timetable').catch(() => null)]);
        const p = d.profile; const o = d.attendance.overall; const risk = d.risk.overall; const perf = d.performance;
        const tone = (s) => (s === 'Critical' || s === 'High' ? 'crit' : s === 'Attention' ? 'warn' : 'safe');
        const riskByCode = Object.fromEntries(d.risk.courses.map((c) => [c.code, c]));
        v.innerHTML = html`
          ${App.dashHead({ name: p.name, first: p.first_name, context: p.semester_name, meta: `${p.roll_no} · ${p.programme} · Semester ${p.current_semester}${p.section ? `, Section ${p.section}` : ''}`,
    actions: html`<a class="btn" href="#/student/profile">${icon('user', 16)} Profile</a><a class="btn primary" href="#/report/student/me">${icon('print', 16)} Academic report</a>` })}
          <div class="grid g4 stat-row">
            ${App.stat({ label: 'Overall attendance', value: fmt.pct(o.percentage), tone: tone(o.status), ico: 'calendar', href: '#/student/attendance', extra: meter(o.percentage, d.attendance.threshold, o.status), sub: `${o.status} · minimum ${d.attendance.threshold}%` })}
            ${App.stat({ label: 'Internal marks', value: fmt.pct(perf.currentPct), ico: 'chart', href: '#/student/performance', sub: 'Average across this semester' })}
            ${App.stat({ label: 'CGPA', value: perf.cgpa ?? '—', ico: 'grad', href: '#/student/performance', sub: `Previous SGPA ${perf.previousSgpa ?? '—'}` })}
            ${App.stat({ label: 'Academic risk', value: risk ? risk.level : '—', tone: tone(risk?.level), ico: 'shield', href: '#/student/risk', sub: 'See what drives it' })}
          </div>
          <div class="grid g-2-1 dash-grid">
            <div class="stack-lg">
              ${d.alerts.length ? html`<div class="card"><div class="card-head"><h2>Needs your attention</h2><span class="badge ${d.alerts.some((a) => a.severity === 'critical') ? 'critical' : 'attention'}">${d.alerts.length} item${d.alerts.length === 1 ? '' : 's'}</span></div>
                <div class="need-list">${d.alerts.map((a) => html`<a class="need-item ${sevClass(a.severity)}" href="${a.link}"><span class="need-mark"></span><div class="grow"><b>${a.title}</b><span>${a.text}</span></div>${icon('arrow', 16)}</a>`)}</div></div>`
    : html`<div class="card ok-strip">${icon('check', 18)}<div><b>You are on track.</b> <span class="muted">No attendance or academic-risk concerns right now.</span></div></div>`}
              <div class="card"><div class="card-head"><h2>Your courses</h2><a href="#/student/attendance" class="small">Attendance & risk →</a></div>
                ${table([
    { label: 'Course', render: (c) => html`<b>${c.name}</b><div class="small muted">${c.code}</div>` },
    { label: 'Attendance', render: (c) => html`<div style="min-width:120px"><b>${fmt.pct(c.percentage)}</b> <span class="small muted">${c.attended}/${c.conducted}</span>${meter(c.percentage, d.attendance.threshold, c.status)}</div>` },
    { label: 'Status', render: (c) => attBadge(c.status) },
    { label: 'Risk', render: (c) => riskBadge(riskByCode[c.code]?.level || 'Normal') },
  ], d.attendance.courses)}
              </div>
              <div class="card"><div class="card-head"><h2>Attendance trend</h2><span class="small muted">Weekly, all courses</span></div><div class="card-body">${Charts.line([{ label: 'Weekly attendance', points: d.attendance.weekly.map((w) => ({ x: w.week, y: w.pct })) }], { threshold: d.attendance.threshold, yMin: 40, dateX: true })}</div></div>
              ${d.announcements.length ? html`<div class="card"><div class="card-head"><h2>Announcements</h2></div><div class="feed">${d.announcements.map((a) => html`<div class="feed-row">${App.dateTile(a.created_at)}<div class="grow"><b>${a.title}</b>${a.course ? html` <span class="tag">${a.course}</span>` : ''}<p>${a.body}</p></div></div>`)}</div></div>` : ''}
            </div>
            <div class="stack-lg">
              ${tt ? App.todaySchedule(tt, '#/student/timetable') : ''}
              ${dashNotifications(d.notifications, d.unread, '#/student/notifications')}
              ${(d.campusEvents && d.campusEvents.length) ? html`<div class="card"><div class="card-head"><h2>Campus events</h2><a href="#/campus/${d.collegeId}" class="small">Campus guide →</a></div>
                <div class="feed">${d.campusEvents.map((e) => html`<div class="feed-row ev-row">${App.dateTile(e.startsAt)}<div class="grow"><b>${e.title}</b><div class="small muted">${[e.startsAt ? fmt.dateTime(e.startsAt) : 'Date to be announced', e.venue].filter(Boolean).join(' · ')}</div>
                  <div class="ev-act">${e.registered ? html`<span class="tag ok">${icon('check', 13)} Registered</span> <button class="btn xs ghost" data-click="cancelEvent" data-id="${e.id}">Cancel</button>`
                    : e.registrationOpen ? html`<button class="btn sm primary" data-click="registerEvent" data-id="${e.id}">Register</button>`
                    : html`<span class="small muted">Registration closed</span>`}</div></div></div>`)}</div></div>` : ''}
            </div>
          </div>`.s;
      } catch (e) { errorBox(v, e, load); }
    }
    bind(v, { ...dashNotificationHandlers(() => load()),
      registerEvent: async (b) => { b.disabled = true; try { const r = await api.post('/api/student/events/register', { eventId: b.dataset.id }); toast(r.status === 'already_registered' ? 'You are already registered.' : 'Registered. See you there.', 'success'); load(); } catch (e) { toast(e.message, 'error'); b.disabled = false; } },
      cancelEvent: async (b) => { b.disabled = true; try { await api.post('/api/student/events/cancel', { eventId: b.dataset.id }); toast('Registration cancelled.'); load(); } catch (e) { toast(e.message, 'error'); b.disabled = false; } } });
    state.view.onLive = () => load();
    load();
  }, R);

  // ---------- attendance with prediction & what-if ----------
  route('/student/attendance', async () => {
    const v = shell('#/student/attendance');
    async function load() {
      try {
        const d = await api.get('/api/student/attendance');
        const o = d.overall;
        v.innerHTML = html`<div class="page-head"><div><h1>Attendance</h1><p>Required: <b>${d.threshold}%</b> per course.</p></div></div>
          <div class="grid g-2-1">
            <div class="card card-pad"><div class="row wrap" style="gap:22px">${Charts.donut(o.percentage, { threshold: d.threshold, status: o.status, label: 'Overall' })}
              <div class="grow"><div class="row" style="gap:8px">${attBadge(o.status)}<span class="muted small">${o.attended} attended · ${o.missed} missed · ${o.conducted} conducted</span></div>
                <h2 style="margin:8px 0 4px">${o.message}</h2>${o.guidance.map((g) => html`<div class="muted">${g}</div>`)}</div></div></div>
            <div class="card"><div class="card-head"><h3>How status is decided</h3></div><div class="card-body small stack-sm">
              <div>${attBadge('Safe')} At least ${d.threshold + 5}% and more than two classes of margin.</div>
              <div>${attBadge('Attention')} Close to ${d.threshold}%, or two absences would cross it.</div>
              <div>${attBadge('Critical')} Below ${d.threshold}%.</div></div></div>
          </div>
          <div class="card" style="margin-top:16px"><div class="card-head"><h2>Overall trend</h2></div><div class="card-body">${Charts.line([{ label: 'Weekly attendance', points: d.weekly.map((w) => ({ x: w.week, y: w.pct })) }], { threshold: d.threshold, yMin: 40, dateX: true })}</div></div>
          <h2 style="margin:22px 0 10px">Subject-wise attendance and prediction</h2>
          <div class="grid g2">${d.courses.map((c, i) => html`<div class="card"><div class="card-head"><div><h3>${c.name}</h3><div class="small muted">${c.code} · ${c.faculty || 'Faculty TBA'}</div></div>${attBadge(c.status)}</div>
            <div class="card-body">
              <div class="att-pie-row">
                ${Charts.pie([{ label: 'Attended', value: c.attended, color: c.status === 'Critical' ? Charts.C.crit : c.status === 'Attention' ? Charts.C.warn : Charts.C.safe }, { label: 'Missed', value: c.missed, color: '#d3dbe6' }], { size: 150, donut: 0.62, centerTop: fmt.pct(c.percentage), centerSub: 'present', unit: ' cls', ariaLabel: `${c.name}: ${fmt.pct(c.percentage)} present, ${c.attended} of ${c.conducted} classes attended` })}
                <div class="grow">
                  <div class="row" style="gap:8px;align-items:center;flex-wrap:wrap"><span class="muted small">${c.trend === 'Declining' ? '↓ declining' : c.trend === 'Improving' ? '↑ improving' : 'stable'}</span>${Charts.spark(c.series, { threshold: d.threshold, color: c.status === 'Critical' ? Charts.C.crit : Charts.C.primary })}</div>
                  ${meter(c.percentage, d.threshold, c.status)}
                  <div class="small muted" style="margin-top:8px">${c.conducted} classes conducted</div>
                </div>
              </div>
              <div class="alert ${c.status === 'Critical' ? 'critical' : c.status === 'Attention' ? 'warning' : 'info'}"><div class="ico">${c.status === 'Safe' ? 'i' : '!'}</div><div><b>${c.message}</b>${c.guidance.map((g) => html`<p>${g}</p>`)}
                ${c.scenarios ? html`<p class="small">If you miss the next 2 classes: <b>${c.scenarios.ifMissNext2}%</b> · If you attend the next 5: <b>${c.scenarios.ifAttendNext5}%</b></p>` : ''}</div></div>
              <div style="margin-top:12px"><div class="small muted" style="margin-bottom:4px">What if… (try it)</div>
                <div class="row wrap"><label class="small" style="margin:0">Attend <input class="input" type="number" min="0" max="60" value="0" data-input="whatif" data-i="${i}" data-k="attend" style="width:70px;display:inline-block"></label>
                <label class="small" style="margin:0">Miss <input class="input" type="number" min="0" max="60" value="0" data-input="whatif" data-i="${i}" data-k="miss" style="width:70px;display:inline-block"></label>
                <b id="wi-${i}" class="small"></b></div></div>
              <div style="margin-top:12px"><div class="small muted" style="margin-bottom:4px">Last ${c.history.length} classes (newest first)</div><div class="dots">${c.history.map((h) => html`<i class="${h.present ? '' : 'a'}" title="${fmt.date(h.date)}: ${h.present ? 'Present' : 'Absent'}"></i>`)}</div></div>
            </div></div>`)}</div>`.s;
        bind(v, {
          whatif: (el) => {
            const i = Number(el.dataset.i); const c = d.courses[i];
            const a = Number($(`[data-i="${i}"][data-k="attend"]`, v).value) || 0; const m = Number($(`[data-i="${i}"][data-k="miss"]`, v).value) || 0;
            const pct = ((c.attended + a) / (c.conducted + a + m)) * 100;
            $(`#wi-${i}`).innerHTML = html`→ ${pct.toFixed(1)}% ${pct < d.threshold ? html`<span class="badge critical">below ${d.threshold}%</span>` : html`<span class="badge safe">meets ${d.threshold}%</span>`}`.s;
          },
        });
      } catch (e) { errorBox(v, e, load); }
    }
    state.view.onLive = (k) => { if (k === 'refresh') load(); };
    load();
  }, R);

  // ---------- course registration (CAP-style academic profile) ----------
  route('/student/courses', async () => {
    const v = shell('#/student/courses');
    async function load() {
      try {
        const [prof, reg] = await Promise.all([api.get('/api/student/profile'), api.get('/api/student/registration')]);
        const p = prof.profile;
        const credits = reg.registered.reduce((s, c) => s + c.credits, 0);
        v.innerHTML = html`<div class="page-head"><div><h1>My Courses</h1>
            <div class="row wrap meta-tags">${[p.programme, `Semester ${p.current_semester}`, p.section ? `Section ${p.section}` : null, p.batch].filter(Boolean).map((t) => html`<span class="tag">${t}</span>`)}</div></div></div>

          <div class="card" style="margin-top:4px"><div class="card-head"><h2>Registered</h2><span class="muted small">${reg.registered.length} course${reg.registered.length === 1 ? '' : 's'} · ${credits} credits</span></div>
            ${table([
    { label: 'Code', render: (c) => html`<b class="mono">${c.code}</b>` }, { label: 'Course', key: 'name' }, { label: 'Credits', key: 'credits', num: true },
    { label: 'Faculty', render: (c) => (c.faculty_name ? c.faculty_name : 'To be announced') },
  ], reg.registered, { empty: 'No courses registered yet. Add one below.' })}</div>

          ${reg.pending.length ? html`<div class="card" style="margin-top:16px"><div class="card-head"><h2>Awaiting approval</h2><span class="muted small">${reg.pending.length} request${reg.pending.length === 1 ? '' : 's'}</span></div>
            ${table([
    { label: 'Code', render: (c) => html`<b class="mono">${c.code}</b>` }, { label: 'Course', key: 'name' }, { label: 'Credits', key: 'credits', num: true },
    { label: '', render: (c) => html`<button class="btn sm ghost danger" data-click="withdraw" data-o="${c.offering_id}">Withdraw</button>` },
  ], reg.pending)}</div>` : ''}

          <div class="card" style="margin-top:16px"><div class="card-head"><h2>Add a course</h2><span class="muted small">Requests are approved by your college office</span></div>
            ${reg.available.length ? table([
    { label: 'Code', render: (c) => html`<b class="mono">${c.code}</b>` }, { label: 'Course', render: (c) => html`${c.name}${c.section ? html` <span class="muted small">· Sec ${c.section}</span>` : ''}` },
    { label: 'Credits', key: 'credits', num: true }, { label: 'Faculty', render: (c) => (c.faculty_name ? c.faculty_name : 'To be announced') },
    { label: '', render: (c) => html`<button class="btn sm primary" data-click="add" data-o="${c.offering_id}">${icon('plus', 14)} Request</button>` },
  ], reg.available) : html`<div class="card-body muted">There are no more courses open for you to add right now.</div>`}</div>`.s;
        bind(v, {
          add: async (el) => { el.disabled = true; try { await api.post('/api/student/registration', { offeringId: Number(el.dataset.o) }); toast('Request sent for approval.', 'success'); load(); } catch (e) { toast(e.message, 'error'); el.disabled = false; } },
          withdraw: async (el) => { if (!await confirmBox('Withdraw request?', 'This will remove your pending course request.', 'Withdraw', true)) return; try { await api.del(`/api/student/registration/${el.dataset.o}`); toast('Request withdrawn.', 'success'); load(); } catch (e) { toast(e.message, 'error'); } },
        });
      } catch (e) { errorBox(v, e, load); }
    }
    state.view.onLive = (k, n) => { if (k === 'notification' && (n.type === 'course' || n.type === 'registration')) load(); };
    load();
  }, R);

  // ---------- performance ----------
  route('/student/performance', async () => {
    const v = shell('#/student/performance');
    async function load() {
      try {
        const d = await api.get('/api/student/performance');
        v.innerHTML = html`<div class="page-head"><div><h1>Performance</h1></div><div class="btn-row"><a class="btn sm primary" href="#/student/performance">Marks</a><a class="btn sm " href="#/student/risk">Risk</a></div></div>
          <div class="grid g4">
            <div class="card kpi"><div class="label">Current semester (credit-weighted)</div><div class="value">${fmt.pct(d.currentPct)}</div></div>
            <div class="card kpi"><div class="label">Previous SGPA</div><div class="value">${d.previousSgpa ?? '—'}</div></div>
            <div class="card kpi"><div class="label">CGPA (completed semesters)</div><div class="value">${d.cgpa ?? '—'}</div></div>
            <div class="card kpi"><div class="label">Courses declining</div><div class="value ${d.courses.some((c) => c.trend === 'Declining') ? '' : ''}">${d.courses.filter((c) => c.trend === 'Declining').length}</div></div>
          </div>
          <div class="grid g2" style="margin-top:16px">
            <div class="card"><div class="card-head"><h2>Subject performance</h2></div><div class="card-body">${Charts.hbars(d.courses.map((c) => ({ label: c.code, value: c.overallPct ?? 0, title: c.name, color: c.trend === 'Declining' ? Charts.C.warn : Charts.C.primary })), { max: 100, unit: '%' })}</div></div>
            <div class="card"><div class="card-head"><h2>Previous performance</h2><span class="small muted">SGPA by semester</span></div><div class="card-body">${Charts.bars(d.history.map((h) => ({ label: `Sem ${h.semester_number}`, value: h.sgpa })), { max: 10 })}</div></div>
          </div>
          <div class="stack" style="margin-top:16px">${d.courses.map((c) => html`<div class="card"><div class="card-head"><div><h3>${c.name}</h3><div class="small muted">${c.code} · ${c.course_type} · ${c.credits} credits</div></div>
            <div class="row wrap"><span class="tag">Internal ${fmt.pct(c.internalPct)}</span><span class="tag">Assignments ${fmt.pct(c.assignmentPct)}</span>${c.labPct !== null ? html`<span class="tag">Lab ${fmt.pct(c.labPct)}</span>` : ''}
            <span class="badge ${c.trend === 'Declining' ? 'attention' : c.trend === 'Improving' ? 'safe' : 'plain'}">${c.trend}</span></div></div>
            ${table([{ label: 'Assessment', render: (a) => html`<b>${a.name}</b> <span class="tag">${a.kind}</span>` }, { label: 'Marks', render: (a) => (a.marks === null ? html`<span class="muted">Not yet published</span>` : html`<b>${fmt.marks(a.marks)}</b> / ${fmt.marks(a.max_marks)}`) },
    { label: 'Percentage', render: (a) => fmt.pct(a.pct) }, { label: 'Class average', render: (a) => (a.class_avg === null ? '—' : `${a.class_avg} / ${fmt.marks(a.max_marks)}`) }, { label: 'Date', render: (a) => fmt.date(a.held_on || a.due_on) },
    { label: 'Updated', render: (a) => (a.updated_at ? fmt.ago(a.updated_at) : '—') }], c.assessments)}</div>`)}</div>`.s;
      } catch (e) { errorBox(v, e, load); }
    }
    state.view.onLive = (k) => load();
    load();
  }, R);

  // ---------- explainable risk ----------
  // Kept for the staff and admin student views: one course, opened, at a glance.
  const riskCard = (c) => html`<div class="rv-list">${RiskViz.courseRow(c, { open: true })}</div>`;
  route('/student/risk', async () => {
    const v = shell('#/student/performance');
    async function load() {
      try {
        const d = await api.get('/api/student/risk');
        const o = d.overall;
        const courses = d.courses.slice().sort((a, b) => RiskViz.ORDER[a.level] - RiskViz.ORDER[b.level]);
        const flagged = courses.filter((c) => c.level !== 'Normal');
        const actions = flagged.flatMap((c) => RiskViz.actions(c).slice(0, 2).map((r) => ({ c, r }))).slice(0, 4);
        const lvl = o?.level || 'Normal';
        v.innerHTML = html`<div class="page-head"><div><h1>Performance</h1><p>Tap a course to see why and what to do.</p></div><div class="btn-row"><a class="btn sm " href="#/student/performance">Marks</a><a class="btn sm primary" href="#/student/risk">Risk</a></div></div>
          <div class="card rv-hero ${lvl}">
            <div class="rv-hero-l"><div class="small muted">Overall</div><div class="risk-level ${lvl}">${lvl === 'High' ? 'HIGH RISK' : lvl === 'Attention' ? 'WATCH' : 'ON TRACK'}</div>
              <div class="rv-hero-n"><b>${flagged.length}</b> of ${courses.length} course${courses.length === 1 ? '' : 's'} need${flagged.length === 1 ? 's' : ''} action</div>
              ${d.history.length > 1 ? html`<div class="rv-trail" title="Recent assessments, newest on the right">${d.history.slice(0, 8).reverse().map((h) => html`<span class="${h.level}" title="${h.level} · ${fmt.ago(h.created_at)}"></span>`)}<span class="small muted">trend</span></div>` : ''}</div>
            <div class="grow">${RiskViz.tiles(courses)}</div></div>
          ${actions.length ? html`<div class="card rv-todo"><h4>${icon('target', 15)} Do this now</h4>${actions.map(({ c, r }, i) => html`<button class="rv-todo-i ${c.level}" data-click="rvjump" data-id="${c.offering_id}"><span class="n">${i + 1}</span><span class="grow">${r}</span><span class="tag mono">${c.code}</span></button>`)}</div>`
            : html`<div class="alert success" style="margin-top:16px"><div class="ico">✓</div><div><b>Nothing to fix right now.</b><p>Keep attending and submitting on time.</p></div></div>`}
          <div class="row between wrap" style="margin:18px 0 8px;gap:8px"><h2>Courses</h2>${RiskViz.counts(courses)}</div>
          <div class="rv-list">${courses.map((c, i) => RiskViz.courseRow(c, { open: i === 0 && c.level !== 'Normal' }))}</div>
          <p class="small muted" style="margin-top:16px">Risk levels are early-warning guidance, not grades, and are not shared outside your institution.</p>`.s;
        RiskViz.wire(v);
      } catch (e) { errorBox(v, e, load); }
    }
    bind(v, { rvjump: (el) => RiskViz.jump(v, el.dataset.id), rvfilter: (el) => RiskViz.filter(v, el) });
    state.view.onLive = () => load();
    load();
  }, R);

  route('/student/notifications', async () => { const v = shell('#/student/notifications'); notificationsView(v); }, R);

  route('/student/profile', async () => {
    const v = shell('#/student/profile');
    try {
      const d = await api.get('/api/student/profile');
      const p = d.profile; const registered = d.courses.filter((c) => c.status === 'Registered');
      const earned = d.history.reduce((t, h) => t + (h.credits_earned || 0), 0);
      const cgpa = earned ? (d.history.reduce((t, h) => t + h.sgpa * (h.credits_earned || 0), 0) / earned).toFixed(2) : '—';
      const semCredits = registered.reduce((t, c) => t + (c.credits || 0), 0);
      v.innerHTML = html`
        ${App.profileHero({ name: p.name, title: `Student · ${p.programme}`, institution: `${p.college} · ${p.university}`, logoSrc: state.me.college?.logo || '',
    chips: [html`<span class="mono">${p.roll_no}</span>`, `Semester ${p.current_semester}`, p.section ? `Section ${p.section}` : '', `Batch ${p.batch}`, p.active ? html`<span class="ph-live">Active</span>` : 'Inactive'],
    actions: html`<a class="btn" href="#/account/password">Change password</a><a class="btn primary" href="#/report/student/me">${icon('print', 16)} Academic report</a>`,
    stats: [['CGPA', cgpa, `${d.history.length} semester${d.history.length === 1 ? '' : 's'} completed`], ['Credits earned', earned, 'To date'], ['This semester', `${registered.length} courses`, `${semCredits} credits`], ['Academic year', p.academic_year || '—', `${p.term || ''} term`]] })}
        <div class="grid prof-grid">
          <div class="stack-lg">
            ${App.detailCard('Enrolment', [['Roll number', html`<span class="mono">${p.roll_no}</span>`], ['Programme', p.programme], ['Department', p.department], ['Regulation', p.regulation], ['Batch', p.batch], ['Semester', `${p.current_semester} (${p.term || '—'})`], ['Section', p.section]])}
            ${App.detailCard('Institution', [['College', p.college], ['University', p.university]])}
            ${App.detailCard('Contact', [['Email', p.email], ['Login ID', p.roll_no]])}
          </div>
          <div class="stack-lg">
            <div class="card"><div class="card-head"><h2>Registered courses</h2><a class="small" href="#/student/courses">Manage →</a></div>
              ${table([{ label: 'Code', render: (c) => html`<b class="mono">${c.code}</b>` }, { label: 'Course', render: (c) => html`${c.name}<div class="small muted">${c.course_type || ''}</div>` }, { label: 'Faculty', render: (c) => c.faculty_name || 'To be announced' }, { label: 'Credits', key: 'credits', num: true }], registered, { empty: 'No courses registered yet.' })}
              ${registered.length ? html`<div class="table-foot"><span>${registered.length} courses</span><b>${semCredits} credits</b></div>` : ''}</div>
            <div class="card"><div class="card-head"><h2>Academic history</h2><span class="small muted">SGPA by semester</span></div>
              ${d.history.length ? html`<div class="card-body">${Charts.hbars(d.history.map((h) => ({ label: `Semester ${h.semester_number}`, value: h.sgpa })), { max: 10, fmtV: (x) => Number(x).toFixed(2) })}</div>` : ''}
              ${table([{ label: 'Semester', key: 'semester_number' }, { label: 'SGPA', render: (h) => Number(h.sgpa).toFixed(2), num: true }, { label: 'Attendance', render: (h) => fmt.pct(h.attendance_pct), num: true }, { label: 'Credits earned', key: 'credits_earned', num: true }], d.history, { empty: 'No completed semesters yet.' })}</div>
          </div>
        </div>`.s;
    } catch (e) { errorBox(v, e, () => App.render()); }
  }, R);

  window.StudentViews = { riskCard, profileGrid };
})();
