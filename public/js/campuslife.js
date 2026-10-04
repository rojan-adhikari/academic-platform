/* Student & staff portals: weekly timetable, clubs, classroom stream and deadlines. */
(function () {
  'use strict';
  const { html, raw, $, api, route, go, shell, bind, icon, fmt, loading, errorBox, toast, modal, confirmBox, formData } = App;

  const readDataUrl = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
  // Upload the PDF chosen in a file input and return its id (or null if none chosen).
  async function uploadPdf(offeringId, input) {
    const f = input && input.files && input.files[0];
    if (!f) return null;
    if (f.type !== 'application/pdf') throw new Error('Please choose a PDF file.');
    if (f.size > 8 * 1024 * 1024) throw new Error('The PDF must be under 8 MB.');
    const r = await api.post(`/api/classroom/${offeringId}/files`, { name: f.name, data: await readDataUrl(f) });
    return r.id;
  }
  const pdfLink = (fileId, name) => html`<a class="pdf-link" href="/api/classroom/files/${fileId}" target="_blank" rel="noopener">${icon('download', 14)} ${name || 'PDF'}</a>`;

  // ---------------- Timetable ----------------
  function ttCell(s, view) {
    if (!s) return html`<td class="tt-empty"></td>`;
    if (view === 'section') return html`<td class="tt-cell"><b>${s.course_code || s.label || ''}</b><span>${s.course_name || ''}</span>${s.faculty_code ? html`<small>${s.faculty_code}</small>` : ''}</td>`;
    return html`<td class="tt-cell"><b>${s.course_code || ''}</b><span>${s.course_name || ''}</span><small>Sec ${s.section || '—'}</small></td>`;
  }
  function timetableGrid(d) {
    const by = {}; d.slots.forEach((s) => { by[`${s.day}-${s.period}`] = s; });
    const cols = [];
    d.periods.forEach((pd) => { cols.push({ type: 'p', p: pd.p }); if (d.breaks[pd.p]) cols.push({ type: 'b', name: d.breaks[pd.p].name }); });
    const days = [1, 2, 3, 4, 5, 6];
    const pt = (p) => d.periods.find((x) => x.p === p);
    return html`<div class="tt-wrap"><table class="tt">
      <thead><tr><th class="tt-day">Day</th>${cols.map((c) => c.type === 'b'
    ? html`<th class="tt-break"><span>${c.name}</span></th>`
    : html`<th><div class="tt-pn">P${c.p}</div><div class="tt-time">${pt(c.p).start}–${pt(c.p).end}</div></th>`)}</tr></thead>
      <tbody>${days.map((dn, ri) => html`<tr><th class="tt-day">${d.days[dn - 1]}</th>${cols.map((c) => {
    if (c.type === 'b') return ri === 0 ? html`<td class="tt-break" rowspan="${days.length}"><span>${c.name}</span></td>` : '';
    return ttCell(by[`${dn}-${c.p}`], d.view);
  })}</tr>`)}</tbody></table></div>`;
  }
  async function timetablePage(v, role) {
    try {
      const d = await api.get('/api/timetable');
      const title = role === 'student' ? 'My Timetable' : 'Teaching Timetable';
      const sub = role === 'student' && d.section
        ? html`<p>${d.section.department} · Section ${d.section.name} · ${d.section.batch}</p>` : '';
      v.innerHTML = html`<div class="page-head"><div><h1>${title}</h1>${sub}</div></div>
        ${d.slots.length ? html`${timetableGrid(d)}<p class="small muted tt-note">Mentor Hour ${d.mentor.start}–${d.mentor.end} on all working days.</p>`
    : html`<div class="empty"><b>No classes scheduled.</b></div>`}`.s;
    } catch (e) { errorBox(v, e, () => App.render()); }
  }
  route('/student/timetable', () => timetablePage(shell('#/student/timetable'), 'student'), { roles: ['student'] });
  route('/staff/timetable', () => timetablePage(shell('#/staff/timetable'), 'staff'), { roles: ['staff'] });

  // ---------------- Clubs ----------------
  async function studentClubs(v) {
    try {
      const d = await api.get('/api/clubs');
      const mine = d.clubs.filter((c) => c.joined);
      const cats = [...new Set(d.clubs.map((c) => c.category))];
      const card = (c) => html`<div class="club-card"><div class="club-top"><div><b>${c.name}</b><div class="small muted">${c.category} · ${c.members} member${c.members === 1 ? '' : 's'}</div></div>
          <span class="badge ${c.joined ? 'safe' : 'info'} plain">${c.joined ? 'Joined' : c.category}</span></div>
        ${c.description ? html`<p class="small muted">${c.description}</p>` : ''}
        ${c.lead_name ? html`<div class="small muted">Lead: ${c.lead_name}</div>` : ''}
        <div class="btn-row">${c.joined
    ? html`<button class="btn sm ghost" data-click="leave" data-id="${c.id}">Leave</button>`
    : html`<button class="btn sm primary" data-click="join" data-id="${c.id}" data-name="${c.name}">${icon('plus', 14)} Join</button>`}</div></div>`;
      v.innerHTML = html`<div class="page-head"><div><h1>Clubs & Societies</h1></div></div>
        <div class="card"><div class="card-head"><h2>My clubs</h2></div><div class="card-body">
          ${mine.length ? html`<div class="club-grid">${mine.map(card)}</div>` : html`<div class="muted small">You are not in any clubs yet. Browse clubs and join the ones you like.</div>`}</div></div>
        ${cats.map((cat) => html`<div class="card"><div class="card-head"><h2>${cat}</h2></div><div class="card-body"><div class="club-grid">${d.clubs.filter((c) => c.category === cat).map(card)}</div></div></div>`)}`.s;
      bind(v, {
        join: (el) => {
          const me = App.state.me, name = el.dataset.name;
          modal({ title: `Join ${name}`, body: html`<form data-form="join" class="stack">
              <div class="row g2"><div class="field"><label>Name</label><input class="input" value="${me.name}" disabled></div>
                <div class="field"><label>Roll number</label><input class="input" value="${me.rollNo || ''}" disabled></div></div>
              <div class="field"><label>Phone number</label><input class="input" name="phone" inputmode="tel" placeholder="e.g. 98765 43210" required></div>
              <div class="field"><label>Why do you want to join?</label><textarea class="input" name="interest" rows="3" required></textarea></div></form>`,
          foot: html`<button class="btn" data-close>Cancel</button><button class="btn primary" id="join-save">Join club</button>`,
          onMount: (root, close) => { $('#join-save', root).onclick = async () => {
            const b = formData($('form[data-form="join"]', root));
            try { await api.post(`/api/clubs/${el.dataset.id}/join`, b); close(); toast('You have joined the club.', 'success'); studentClubs(v); }
            catch (e) { toast(e.message, 'error'); } }; } });
        },
        leave: async (el) => { if (!(await confirmBox('Leave club', 'You can join again anytime.', 'Leave'))) return; await api.del(`/api/clubs/${el.dataset.id}/leave`); toast('You have left the club.'); studentClubs(v); },
      });
    } catch (e) { errorBox(v, e, () => studentClubs(v)); }
  }
  route('/student/clubs', () => studentClubs(shell('#/student/clubs')), { roles: ['student'] });

  async function staffClubs(v) {
    try {
      const d = await api.get('/api/clubs');
      const cats = [...new Set(d.clubs.map((c) => c.category))];
      const card = (c) => html`<div class="club-card"><div class="club-top"><div><b>${c.name}</b><div class="small muted">${c.category}</div></div><span class="badge info plain">${c.members}</span></div>
        ${c.description ? html`<p class="small muted">${c.description}</p>` : ''}
        <div class="btn-row"><button class="btn sm" data-click="members" data-id="${c.id}" data-name="${c.name}">${icon('users', 14)} View members</button></div></div>`;
      v.innerHTML = html`<div class="page-head"><div><h1>Clubs & Societies</h1></div></div>
        ${cats.map((cat) => html`<div class="card"><div class="card-head"><h2>${cat}</h2></div><div class="card-body"><div class="club-grid">${d.clubs.filter((c) => c.category === cat).map(card)}</div></div></div>`)}`.s;
      bind(v, {
        members: async (el) => {
          const r = await api.get(`/api/clubs/${el.dataset.id}/members`);
          modal({ title: `${el.dataset.name} — members`, wide: true, body: r.members.length
            ? App.table([{ label: 'Roll No', key: 'roll_no' }, { label: 'Name', key: 'name' }, { label: 'Dept', key: 'dept' }, { label: 'Section', key: 'section' }, { label: 'Phone', render: (x) => x.phone || '—' }, { label: 'Role', key: 'role' }], r.members)
            : html`<div class="empty"><b>No members yet.</b></div>` });
        },
      });
    } catch (e) { errorBox(v, e, () => staffClubs(v)); }
  }
  route('/staff/clubs', () => staffClubs(shell('#/staff/clubs')), { roles: ['staff'] });

  // ---------------- Classroom ----------------
  const KIND_LABEL = { assignment: 'Assignment', note: 'Note', material: 'Material' };
  async function classroomIndex(v, role) {
    const base = role === 'student' ? '#/student/classroom' : '#/staff/classroom';
    try {
      const d = await api.get('/api/classroom/courses');
      let deadlines = null;
      if (role === 'student') { try { deadlines = await api.get('/api/student/deadlines'); } catch { /* ignore */ } }
      const courseCard = (c) => html`<a class="cls-card" href="${base}/${c.id}"><div><b>${c.code}</b><span>${c.name}</span>
          <small class="muted">${role === 'staff' ? (c.section ? `Section ${c.section}` : '') : (c.faculty_name || '')}</small></div>
          <div class="cls-meta"><span class="badge info plain">${c.posts} post${c.posts === 1 ? '' : 's'}</span>${c.nextDue ? html`<small class="muted">Due ${fmt.date(c.nextDue.due_on)}</small>` : ''}</div></a>`;
      v.innerHTML = html`<div class="page-head"><div><h1>Classroom</h1></div></div>
        ${deadlines && deadlines.upcoming.length ? html`<div class="card"><div class="card-head"><h2>Upcoming deadlines</h2></div><div class="card-body stack-sm">
          ${deadlines.upcoming.slice(0, 6).map((a) => html`<div class="dl-row"><div><b>${a.title}</b><div class="small muted">${a.course_code} · ${a.course_name}</div></div>
            <div class="dl-right"><span class="badge ${a.my_status ? 'safe' : 'attention'} plain">${a.my_status || 'Due'}</span><small class="muted">${fmt.date(a.due_on)}</small></div></div>`)}</div></div>` : ''}
        ${d.courses.length ? html`<div class="cls-grid">${d.courses.map(courseCard)}</div>` : html`<div class="empty"><b>No courses yet.</b></div>`}`.s;
    } catch (e) { errorBox(v, e, () => App.render()); }
  }
  route('/student/classroom', () => classroomIndex(shell('#/student/classroom'), 'student'), { roles: ['student'] });
  route('/staff/classroom', () => classroomIndex(shell('#/staff/classroom'), 'staff'), { roles: ['staff'] });

  function postCard(p, ctx) {
    const due = p.kind === 'assignment' && p.due_on;
    return html`<div class="post-card ${p.kind}"><div class="post-head"><span class="post-kind">${icon(p.kind === 'assignment' ? 'clipboard' : p.kind === 'material' ? 'book' : 'info', 15)} ${KIND_LABEL[p.kind]}</span>
        <small class="muted">${fmt.ago(p.created_at)}</small></div>
      <h3>${p.title}</h3>${p.body ? html`<p>${p.body}</p>` : ''}
      <div class="post-attach">${p.file_id ? pdfLink(p.file_id, p.file_name) : ''}${p.link ? html`<a class="small" href="${p.link}" target="_blank" rel="noopener">${icon('external', 14)} Open link</a>` : ''}</div>
      <div class="post-foot"><div class="small muted">${p.author_name || ''}${due ? html` · Due <b>${fmt.date(p.due_on)}</b>` : ''}${p.points != null ? ` · ${p.points} points` : ''}</div>
        <div class="btn-row">
          ${ctx.canManage && p.kind === 'assignment' ? html`<button class="btn sm ghost" data-click="subs" data-id="${p.id}" data-t="${p.title}">${p.submissions != null ? `${p.submissions} submitted` : 'Submissions'}</button>` : ''}
          ${ctx.canManage ? html`<button class="btn sm ghost" data-click="edit" data-id="${p.id}">Edit</button><button class="btn sm ghost danger" data-click="del" data-id="${p.id}">Delete</button>` : ''}
          ${!ctx.canManage && p.kind === 'assignment' ? (p.mySubmission ? html`<span class="badge safe plain">${p.mySubmission.status}</span>` : html`<button class="btn sm primary" data-click="submit" data-id="${p.id}" data-t="${p.title}">Submit assignment</button>`) : ''}
        </div></div></div>`;
  }

  function postForm(kind, post) {
    const isA = kind === 'assignment';
    return html`<form data-form="post" class="stack">
      <div class="field"><label>Title</label><input class="input" name="title" maxlength="160" required value="${post ? post.title : ''}"></div>
      <div class="field"><label>Details</label><textarea class="input" name="body" rows="4">${post ? (post.body || '') : ''}</textarea></div>
      <div class="field"><label>Link (optional)</label><input class="input" name="link" maxlength="400" value="${post ? (post.link || '') : ''}"></div>
      <div class="field"><label>PDF attachment (optional)</label><input class="input" type="file" name="pdf" accept="application/pdf">
        ${post && post.file_id ? html`<div class="small muted" style="margin-top:4px">Current: ${pdfLink(post.file_id, post.file_name)} — choose a file to replace it.</div>` : ''}</div>
      ${isA ? html`<div class="row g2"><div class="field"><label>Due date</label><input class="input" type="date" name="dueOn" value="${post ? (post.due_on || '') : ''}"></div>
        <div class="field"><label>Points</label><input class="input" type="number" name="points" min="0" max="100" value="${post && post.points != null ? post.points : ''}"></div></div>` : ''}</form>`;
  }

  async function classroomStream(v, role, offeringId) {
    const base = role === 'student' ? '#/student/classroom' : '#/staff/classroom';
    try {
      const d = await api.get(`/api/classroom/${offeringId}`);
      const c = d.course;
      const mk = (kind) => ({ el }) => {
        modal({ title: `New ${KIND_LABEL[kind].toLowerCase()}`, body: postForm(kind), foot: html`<button class="btn" data-close>Cancel</button><button class="btn primary" id="pf-save">Post</button>`,
          onMount: (root, close) => { const btn = $('#pf-save', root); btn.onclick = async () => {
            const form = $('form[data-form="post"]', root); const body = formData(form);
            btn.disabled = true;
            try { const fileId = await uploadPdf(offeringId, $('input[name="pdf"]', form)); await api.post(`/api/classroom/${offeringId}/posts`, { kind, ...body, fileId }); close(); toast('Posted.', 'success'); classroomStream(v, role, offeringId); }
            catch (e) { btn.disabled = false; toast(e.message, 'error'); } }; } });
      };
      v.innerHTML = html`<div class="page-head"><div><a class="small" href="${base}">← Classroom</a><h1>${c.name}</h1>
          <p>${c.code}${c.section ? ` · Section ${c.section}` : ''}${c.faculty_name ? ` · ${c.faculty_name}` : ''}</p></div>
        ${d.canManage ? html`<div class="btn-row"><button class="btn primary" data-click="new-assignment">${icon('plus', 15)} New assignment</button>
          <button class="btn" data-click="new-note">New note</button><button class="btn" data-click="new-material">New material</button></div>` : ''}</div>
        <div class="stack" id="cls-stream">${d.posts.length ? d.posts.map((p) => postCard(p, d)) : html`<div class="empty"><b>No posts yet.</b></div>`}</div>`.s;
      bind(v, {
        'new-assignment': (el, ev) => mk('assignment')({ el, ev }),
        'new-note': (el, ev) => mk('note')({ el, ev }),
        'new-material': (el, ev) => mk('material')({ el, ev }),
        edit: async (el) => {
          const post = d.posts.find((p) => String(p.id) === el.dataset.id);
          modal({ title: `Edit ${KIND_LABEL[post.kind].toLowerCase()}`, body: postForm(post.kind, post), foot: html`<button class="btn" data-close>Cancel</button><button class="btn primary" id="pf-save">Save</button>`,
            onMount: (root, close) => { const btn = $('#pf-save', root); btn.onclick = async () => {
              const form = $('form[data-form="post"]', root); const body = formData(form);
              btn.disabled = true;
              try { const newFile = await uploadPdf(offeringId, $('input[name="pdf"]', form)); await api.put(`/api/classroom/posts/${post.id}`, { ...body, fileId: newFile || post.file_id || '' }); close(); toast('Saved.', 'success'); classroomStream(v, role, offeringId); }
              catch (e) { btn.disabled = false; toast(e.message, 'error'); } }; } });
        },
        del: async (el) => { if (!(await confirmBox('Delete post', 'This will be removed for everyone.', 'Delete', true))) return; await api.del(`/api/classroom/posts/${el.dataset.id}`); toast('Deleted.'); classroomStream(v, role, offeringId); },
        subs: async (el) => {
          const r = await api.get(`/api/classroom/posts/${el.dataset.id}/submissions`);
          modal({ title: `${el.dataset.t} — submissions`, wide: true, body: r.submissions.length
            ? App.table([{ label: 'Roll No', key: 'roll_no' }, { label: 'Name', key: 'name' }, { label: 'Status', key: 'status' },
              { label: 'PDF', render: (x) => x.file_id ? pdfLink(x.file_id, 'PDF') : '—' },
              { label: 'Link', render: (x) => x.link ? html`<a href="${x.link}" target="_blank" rel="noopener">link</a>` : '—' }, { label: 'Submitted', render: (x) => fmt.dateTime(x.submitted_at) }], r.submissions)
            : html`<div class="empty"><b>No submissions yet.</b></div>` });
        },
        submit: (el) => {
          modal({ title: `Submit: ${el.dataset.t}`, body: html`<form data-form="sub" class="stack">
            <div class="field"><label>Upload PDF</label><input class="input" type="file" name="pdf" accept="application/pdf"></div>
            <div class="field"><label>Submission link (optional)</label><input class="input" name="link" placeholder="https://…" maxlength="400"></div>
            <div class="field"><label>Note (optional)</label><textarea class="input" name="note" rows="3"></textarea></div></form>`,
          foot: html`<button class="btn" data-close>Cancel</button><button class="btn primary" id="sub-save">Submit</button>`,
          onMount: (root, close) => { const btn = $('#sub-save', root); btn.onclick = async () => {
            const form = $('form[data-form="sub"]', root); const body = formData(form);
            btn.disabled = true;
            try { const fileId = await uploadPdf(offeringId, $('input[name="pdf"]', form)); await api.post(`/api/classroom/posts/${el.dataset.id}/submit`, { ...body, fileId }); close(); toast('Submitted.', 'success'); classroomStream(v, role, offeringId); }
            catch (e) { btn.disabled = false; toast(e.message, 'error'); } }; } });
        },
      });
    } catch (e) { errorBox(v, e, () => classroomStream(v, role, offeringId)); }
  }
  route('/student/classroom/:offeringId', (p) => classroomStream(shell('#/student/classroom'), 'student', p.offeringId), { roles: ['student'] });
  route('/staff/classroom/:offeringId', (p) => classroomStream(shell('#/staff/classroom'), 'staff', p.offeringId), { roles: ['staff'] });
})();
