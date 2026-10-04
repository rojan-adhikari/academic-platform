/* Lightweight SVG charts (no dependencies). Values carry native <title> tooltips. */
(function () {
  'use strict';
  const { html, raw, esc } = App;
  const C = { primary: '#27507d', accent: '#2a8c7e', safe: '#1e7a4f', warn: '#d98e04', crit: '#b42318', muted: '#9aa7b6', grid: '#eaeef3' };
  const short = (d) => { const x = new Date(String(d) + 'T00:00:00'); return Number.isNaN(x.getTime()) ? String(d) : x.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }); };
  const longDate = (d) => { const x = new Date(String(d) + 'T00:00:00'); return Number.isNaN(x.getTime()) ? String(d) : x.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); };

  // Tap/click any data point to see its full day and date in a small tooltip (also works on touch, where there is no hover).
  let tipEl = null;
  function hideTip() { if (tipEl) tipEl.style.display = 'none'; }
  function showTip(dot) {
    const txt = dot.getAttribute('data-tip'); if (!txt) return;
    if (!tipEl) { tipEl = document.createElement('div'); tipEl.className = 'chart-tip'; tipEl.setAttribute('role', 'status'); document.body.appendChild(tipEl); }
    tipEl.textContent = txt; tipEl.style.display = 'block';
    const r = dot.getBoundingClientRect(); const t = tipEl.getBoundingClientRect();
    const maxLeft = window.scrollX + document.documentElement.clientWidth - t.width - 8;
    let left = r.left + window.scrollX + r.width / 2 - t.width / 2;
    left = Math.max(window.scrollX + 8, Math.min(left, maxLeft));
    let top = r.top + window.scrollY - t.height - 10;
    if (top < window.scrollY + 4) top = r.bottom + window.scrollY + 10; // flip below if no room above
    tipEl.style.left = left + 'px'; tipEl.style.top = top + 'px';
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('click', (e) => {
      const dot = e.target.closest && e.target.closest('.chart circle[data-tip]');
      if (dot) { e.stopPropagation(); showTip(dot); } else { hideTip(); }
    });
    document.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.closest && e.target.closest('.chart circle[data-tip]')) { e.preventDefault(); showTip(e.target); }
      else if (e.key === 'Escape') hideTip();
    });
    window.addEventListener('hashchange', hideTip);
    window.addEventListener('resize', hideTip);
  }

  // series: [{ label, color, points: [{x: label, y: number}] }]
  function line(series, { height = 220, yMin = 0, yMax = 100, threshold = null, thresholdLabel = 'Threshold', unit = '%', dateX = false } = {}) {
    const W = 640, H = height, L = 38, R = 12, T = 12, B = 28;
    const all = series.flatMap((s) => s.points);
    if (!all.length) return html`<div class="empty"><b>No data yet.</b></div>`;
    const n = Math.max(...series.map((s) => s.points.length));
    const x = (i) => L + (n <= 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (n - 1));
    const y = (v) => T + (H - T - B) * (1 - (v - yMin) / (yMax - yMin || 1));
    const ticks = 4;
    let g = '';
    for (let i = 0; i <= ticks; i++) { const v = yMin + ((yMax - yMin) * i) / ticks; g += `<line class="grid-line" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${Math.round(v)}${unit}</text>`; }
    if (threshold !== null) g += `<line x1="${L}" x2="${W - R}" y1="${y(threshold)}" y2="${y(threshold)}" stroke="${C.crit}" stroke-dasharray="5 4" stroke-width="1.4"/><text x="${W - R}" y="${y(threshold) - 5}" text-anchor="end" style="fill:${C.crit}">${esc(thresholdLabel)} ${threshold}${unit}</text>`;
    const labels = series[0].points.map((p) => p.x);
    const step = Math.max(1, Math.ceil(labels.length / 7));
    labels.forEach((l, i) => { if (i % step === 0 || i === labels.length - 1) g += `<text x="${x(i)}" y="${H - 8}" text-anchor="middle">${esc(dateX ? short(l) : l)}</text>`; });
    for (const s of series) {
      const col = s.color || C.primary;
      const pts = s.points.map((p, i) => `${x(i)},${y(p.y)}`).join(' ');
      g += `<polyline fill="none" stroke="${col}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round" points="${pts}"/>`;
      if (s.points.length <= 40) s.points.forEach((p, i) => {
        const tip = `${s.label} · ${dateX ? longDate(p.x) : p.x}: ${p.y}${unit}`;
        g += `<circle cx="${x(i)}" cy="${y(p.y)}" r="3.2" fill="#fff" stroke="${col}" stroke-width="2"><title>${esc(tip)}</title></circle>`;
        g += `<circle class="chart-dot" cx="${x(i)}" cy="${y(p.y)}" r="11" fill="transparent" data-tip="${esc(tip)}" tabindex="0" role="button" aria-label="${esc(tip)}"></circle>`;
      });
    }
    const legend = series.length > 1 ? html`<div class="legend" style="margin-top:6px">${series.map((s) => html`<span><i style="background:${s.color || C.primary}"></i>${s.label}</span>`)}</div>` : '';
    return html`<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${series.map((s) => s.label).join(', ')} chart">${raw(g)}</svg>${legend}`;
  }

  // items: [{ label, value, color, title }]
  function bars(items, { height = 200, max = null, unit = '', color = C.primary } = {}) {
    if (!items.length) return html`<div class="empty"><b>No data yet.</b></div>`;
    const W = 640, H = height, L = 34, R = 8, T = 16, B = 30;
    const M = max ?? Math.max(1, ...items.map((i) => i.value));
    const bw = (W - L - R) / items.length;
    let g = '';
    for (let i = 0; i <= 4; i++) { const v = (M * i) / 4; const yy = T + (H - T - B) * (1 - i / 4); g += `<line class="grid-line" x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}"/><text x="${L - 6}" y="${yy + 4}" text-anchor="end">${Math.round(v)}${unit}</text>`; }
    items.forEach((it, i) => {
      const h = ((H - T - B) * it.value) / M;
      const xx = L + i * bw + bw * 0.18;
      g += `<rect x="${xx}" y="${H - B - h}" width="${bw * 0.64}" height="${Math.max(h, 0)}" rx="3" fill="${it.color || color}"><title>${esc(it.title || `${it.label}: ${it.value}${unit}`)}</title></rect>`;
      g += `<text x="${xx + bw * 0.32}" y="${H - B - h - 4}" text-anchor="middle" style="fill:#3c4a58;font-weight:600">${it.value}${unit}</text>`;
      g += `<text x="${xx + bw * 0.32}" y="${H - 10}" text-anchor="middle">${esc(it.label.length > 14 ? it.label.slice(0, 13) + '…' : it.label)}</text>`;
    });
    return html`<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">${raw(g)}</svg>`;
  }

  function hbars(items, { max = null, unit = '', fmtV = null } = {}) {
    if (!items.length) return html`<div class="empty"><b>No data yet.</b></div>`;
    const M = max ?? Math.max(1, ...items.map((i) => i.value || 0));
    return html`<div class="bars-h">${items.map((it) => html`<div class="bar-row" title="${it.title || ''}"><span class="nowrap" style="overflow:hidden;text-overflow:ellipsis">${it.label}</span>
      <div class="track"><span style="width:${Math.max(0, Math.min(100, ((it.value || 0) / M) * 100))}%;background:${it.color || C.primary}"></span></div><b class="right">${fmtV ? fmtV(it.value) : `${it.value ?? '—'}${unit}`}</b></div>`)}</div>`;
  }

  function donut(pct, { size = 120, threshold = null, status = 'Safe', label = '' } = {}) {
    const r = 46, c = 2 * Math.PI * r, p = Math.max(0, Math.min(100, pct || 0));
    const col = status === 'Critical' ? C.crit : status === 'Attention' ? C.warn : C.safe;
    let tmark = '';
    if (threshold !== null) { const a = (threshold / 100) * 2 * Math.PI - Math.PI / 2; tmark = `<line x1="${60 + 38 * Math.cos(a)}" y1="${60 + 38 * Math.sin(a)}" x2="${60 + 56 * Math.cos(a)}" y2="${60 + 56 * Math.sin(a)}" stroke="#15202b" stroke-width="2"><title>Threshold ${threshold}%</title></line>`; }
    return html`<svg width="${size}" height="${size}" viewBox="0 0 120 120" role="img" aria-label="${label} ${p}%">
      <circle cx="60" cy="60" r="${r}" fill="none" stroke="#eaeef3" stroke-width="12"/>
      <circle cx="60" cy="60" r="${r}" fill="none" stroke="${col}" stroke-width="12" stroke-linecap="round" stroke-dasharray="${(c * p) / 100} ${c}" transform="rotate(-90 60 60)"/>
      ${raw(tmark)}<text x="60" y="58" text-anchor="middle" style="font-size:21px;font-weight:750;fill:#15202b">${Math.round(p * 10) / 10}%</text>
      <text x="60" y="76" text-anchor="middle" style="font-size:10.5px;fill:#66758a">${label}</text></svg>`;
  }

  // segments: [{ label, value, color }]
  function dist(segments) {
    const total = segments.reduce((s, x) => s + x.value, 0) || 1;
    return html`<div class="distbar">${segments.map((s) => html`<span style="width:${(s.value / total) * 100}%;background:${s.color}" title="${s.label}: ${s.value}"></span>`)}</div>
      <div class="legend" style="margin-top:8px">${segments.map((s) => html`<span><i style="background:${s.color}"></i>${s.label} <b>${s.value}</b></span>`)}</div>`;
  }
  const riskSegments = (d) => [{ label: 'Normal', value: d.find((x) => x.label === 'Normal')?.count || 0, color: C.safe }, { label: 'Attention', value: d.find((x) => x.label === 'Attention')?.count || 0, color: C.warn }, { label: 'High', value: d.find((x) => x.label === 'High')?.count || 0, color: C.crit }];

  // Pie / donut. segments: [{ label, value, color }]. Slices are sized by value (a real part-to-whole).
  // Not colour-only: every slice carries a %, a <title>, and a text legend with the counts.
  function pie(segments, { size = 150, donut = 0, centerTop = '', centerSub = '', unit = '', legend = true, ariaLabel = '' } = {}) {
    const segs = (segments || []).filter((s) => (s.value || 0) > 0);
    const total = segs.reduce((s, x) => s + (x.value || 0), 0);
    const cx = 80, cy = 80, R = 70, rh = donut ? Math.round(R * donut) : 0;
    if (!total) return html`<div class="empty"><b>No data yet.</b></div>`;
    const pt = (r, a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    let a0 = -Math.PI / 2; let g = ''; let lbls = '';
    if (segs.length === 1) {
      g = `<circle cx="${cx}" cy="${cy}" r="${R}" fill="${segs[0].color}"><title>${esc(segs[0].label)}: ${segs[0].value}${unit} (100%)</title></circle>`;
      if (rh) g += `<circle cx="${cx}" cy="${cy}" r="${rh}" fill="var(--surface)"/>`;
    } else {
      for (const s of segs) {
        const frac = s.value / total; const a1 = a0 + frac * 2 * Math.PI; const large = a1 - a0 > Math.PI ? 1 : 0;
        const [x0, y0] = pt(R, a0), [x1, y1] = pt(R, a1);
        let d;
        if (rh) { const [ix1, iy1] = pt(rh, a1), [ix0, iy0] = pt(rh, a0); d = `M ${x0} ${y0} A ${R} ${R} 0 ${large} 1 ${x1} ${y1} L ${ix1} ${iy1} A ${rh} ${rh} 0 ${large} 0 ${ix0} ${iy0} Z`; }
        else d = `M ${cx} ${cy} L ${x0} ${y0} A ${R} ${R} 0 ${large} 1 ${x1} ${y1} Z`;
        g += `<path d="${d}" fill="${s.color}" stroke="var(--surface)" stroke-width="1.5"><title>${esc(s.label)}: ${s.value}${unit} (${Math.round(frac * 100)}%)</title></path>`;
        if (frac >= 0.07) { const [lx, ly] = pt(rh ? (R + rh) / 2 : R * 0.62, (a0 + a1) / 2); lbls += `<text x="${lx}" y="${ly + 3.5}" text-anchor="middle" style="font-size:11px;font-weight:700;fill:#fff;paint-order:stroke;stroke:rgba(0,0,0,.18);stroke-width:2px">${Math.round(frac * 100)}%</text>`; }
        a0 = a1;
      }
    }
    const center = rh && (centerTop || centerSub) ? `<text x="${cx}" y="${cy - 2}" text-anchor="middle" style="font-size:19px;font-weight:750;fill:var(--ink)">${esc(centerTop)}</text><text x="${cx}" y="${cy + 15}" text-anchor="middle" style="font-size:10px;fill:var(--muted)">${esc(centerSub)}</text>` : '';
    const leg = legend ? html`<ul class="pie-legend">${segs.map((s) => html`<li><i style="background:${s.color}"></i><span class="pl-label">${s.label}</span><b>${s.value}${unit}</b><span class="muted">${Math.round((s.value / total) * 100)}%</span></li>`)}</ul>` : '';
    return html`<div class="pie-wrap"><svg width="${size}" height="${size}" viewBox="0 0 160 160" role="img" aria-label="${esc(ariaLabel || segs.map((s) => `${s.label} ${s.value}${unit}`).join(', '))}">${raw(g + lbls + center)}</svg>${leg}</div>`;
  }

  function spark(values, { width = 120, height = 32, color = C.primary, threshold = null } = {}) {
    if (!values || values.length < 2) return '';
    const mn = Math.min(...values, threshold ?? 100) - 2, mx = Math.max(...values, threshold ?? 0) + 2;
    const x = (i) => (i * width) / (values.length - 1); const y = (v) => height - ((v - mn) / (mx - mn || 1)) * height;
    const t = threshold !== null ? `<line x1="0" x2="${width}" y1="${y(threshold)}" y2="${y(threshold)}" stroke="${C.crit}" stroke-dasharray="3 3" stroke-width="1"/>` : '';
    return html`<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-hidden="true">${raw(t)}<polyline fill="none" stroke="${color}" stroke-width="1.8" points="${values.map((v, i) => `${x(i)},${y(v)}`).join(' ')}"/></svg>`;
  }

  window.Charts = { line, bars, hbars, donut, pie, dist, riskSegments, spark, C };
})();
