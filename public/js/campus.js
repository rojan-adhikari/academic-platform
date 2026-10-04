/* Campus guide visitor experience (KPR Compass, ported to vanilla JS).
   Routes: #/campus/:cid (public, full screen) and #/campus (signed in: opens the user's own college guide).
   Data and logic come from window.CompassData / CompassGeo / CompassSearch / CompassI18n. */
(function () {
  'use strict';
  const { html, raw, $, $$, api, route, go, state, bind, icon } = App;

  // Interface text of the original KPR Compass visitor screen.
  const copy={en:{question:'Where do you want to go?',subtitle:'Find a building, venue, or campus facility.',search:'Search buildings, departments, cabins or rooms…',explore:'Explore',events:'Events',saved:'Saved',scan:'Scan QR',start:'Starting point',navigate:'Show route',directions:'Directions',places:'Places',noEvents:'No events have been published yet.',officialEvents:'View KPRIET events',source:'KPRIET campus layout',google:'Google Maps',openGoogle:'Open in Google Maps',campus:'Campus layout',from:'From',to:'To',share:'Share route',stepFree:'Step-free routes need surveyed ramps and lifts',offline:'Map ready offline after first visit',searchEmpty:'No published match. Try a department, building, event, room or facility.',exact:'A QR checkpoint sets your exact location inside a building.',code:'Checkpoint code',set:'Set location',camera:'Open camera',view:'View on map',arrival:'Get to campus',routeNote:'Follow the marked campus roads. Path lengths and indoor access have not been measured.',mySaved:'Your saved events',saveEmpty:'Save an event to keep it here.',staff:'Staff',mapSource:'Published campus layout',recent:'Popular destinations',routeUnavailable:'No open route is available to this place.'},ta:{question:'நீங்கள் எங்கு செல்ல விரும்புகிறீர்கள்?',subtitle:'கட்டிடம், அரங்கம் அல்லது வளாக வசதியைத் தேடுங்கள்.',search:'கட்டிடம், துறை, அறை அல்லது நிகழ்வைத் தேடுங்கள்…',explore:'வளாகம்',events:'நிகழ்வுகள்',saved:'சேமிப்பு',scan:'QR ஸ்கேன்',start:'தொடக்க இடம்',navigate:'வழி காட்டு',directions:'வழிகாட்டுதல்',places:'இடங்கள்',noEvents:'KPR Compass-இல் நிகழ்வு அரங்குகள் இன்னும் வெளியிடப்படவில்லை.',officialEvents:'KPRIET நிகழ்வுகளைப் பார்',source:'KPRIET வளாக வரைபடம்',google:'Google Maps',openGoogle:'Google Maps-இல் திற',campus:'வளாக வரைபடம்',from:'இருந்து',to:'வரை',share:'வழியைப் பகிர்',stepFree:'படிகள் இல்லாத வழிக்கு சரிபார்க்கப்பட்ட சரிவுப்பாதை மற்றும் மின்தூக்கி விவரம் தேவை',offline:'முதல் வருகைக்குப் பிறகு வரைபடம் இணையமின்றியும் கிடைக்கும்',searchEmpty:'இடம் கிடைக்கவில்லை. கட்டிடப் பெயர் அல்லது எண்ணைத் தேடுங்கள்.',exact:'கட்டிடத்திற்குள் QR குறியீடு சரியான தொடக்க இடத்தை அமைக்கும்.',code:'இடக் குறியீடு',set:'இடத்தை அமை',camera:'கேமராவைத் திற',view:'வரைபடத்தில் பார்',arrival:'வளாகத்துக்கு வழி',routeNote:'வரைபடத்தில் குறிக்கப்பட்ட சாலைகளைப் பின்பற்றுங்கள். பாதை நீளமும் உள் அணுகலும் அளவிடப்படவில்லை.',mySaved:'சேமித்த நிகழ்வுகள்',saveEmpty:'நிகழ்வைச் சேமிக்கவும்.',staff:'பணியாளர்',mapSource:'வெளியிடப்பட்ட வளாக வரைபடம்',recent:'பிரபலமான இடங்கள்',routeUnavailable:'இந்த இடத்துக்கு திறந்த வழி இல்லை.'}};
  const departmentNames={admin:'Administration · Artificial Intelligence and Data Science',cse:'Computer Science and Engineering',ece:'Electronics and Communication Engineering',mechanical:'Mechanical Engineering','civil-eee':'Civil Engineering · Electrical and Electronics Engineering',chemical:'Chemical Engineering',biomedical:'Biomedical Engineering',kprcas1:'Science & Humanities',kprcas2:'Science & Humanities'};

  // Interface text added for nerd that the original KPR Compass did not have.
  const EXTRA_TA = {
    All: 'அனைத்தும்', 'Back to portal': 'போர்டலுக்குத் திரும்பு', 'Sign in': 'உள்நுழை', Institutions: 'கல்வி நிறுவனங்கள்',
    'Campus guide admin': 'வளாக வழிகாட்டி நிர்வாகம்', "You're already registered": 'நீங்கள் ஏற்கனவே பதிவு செய்துள்ளீர்கள்',
    'No events in this list.': 'இந்தப் பட்டியலில் நிகழ்வுகள் இல்லை.', 'Preparing photo…': 'புகைப்படம் தயாராகிறது…',
    'Could not read this image. Try another photo.': 'இந்தப் படத்தைப் படிக்க முடியவில்லை. வேறு புகைப்படத்தை முயற்சிக்கவும்.',
    'Powered by nerd': 'nerd மூலம் இயக்கப்படுகிறது', 'Campus alerts': 'வளாக அறிவிப்புகள்',
    'Loading campus guide…': 'வளாக வழிகாட்டி ஏற்றப்படுகிறது…', 'Campus guide unavailable': 'வளாக வழிகாட்டி கிடைக்கவில்லை',
    'Showing the copy saved on this device.': 'இந்தச் சாதனத்தில் சேமித்த பதிப்பு காட்டப்படுகிறது.',
    'Place not found. Showing all places.': 'இடம் கிடைக்கவில்லை. அனைத்து இடங்களும் காட்டப்படுகின்றன.',
    'Copy this link:': 'இந்த இணைப்பை நகலெடுக்கவும்:', Language: 'மொழி',
  };
  const ICON_EXTRA = {
    scan: '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M4 12h16"/>',
    checkc: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.7 2.7L16.5 9"/>',
    access: '<circle cx="12" cy="4.5" r="1.6"/><path d="M6 8.5l6 1.2 6-1.2M12 9.7v4.3l-3.5 6M12 14l3.5 6"/>',
    grid2: '<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>',
    life: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M5.6 5.6l3.6 3.6M14.8 14.8l3.6 3.6M18.4 5.6l-3.6 3.6M9.2 14.8l-3.6 3.6"/>',
  };
  const ic = (name, size = 18) => (ICON_EXTRA[name] ? raw(`<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_EXTRA[name]}</svg>`) : icon(name, size));

  const KPR_MAP = '/assets/compass/kpriet-campus-layout.webp';
  const POPULAR = ['imperial', 'cse', 'library', 'kalaiarangam'];
  const ls = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
  };
  const savedLang = () => (ls.get('kpr-compass-lang', 'en') === 'ta' ? 'ta' : 'en');
  const publicNodes = (c) => c.nodes.filter((n) => n.kind !== 'junction');
  const pinGlyph = (n) => (n.kind === 'start' ? '⌖' : n.kind === 'entrance' ? 'G' : n.kind === 'parking' ? 'P' : n.kind === 'venue' ? '◆' : '•');

  let current = null; // the live guide instance (one at a time)

  // ======================================================================
  // Map: the official layout image with pins, route lines, live position, floors, zoom and pan.
  // The element is kept between re-renders so zoom, floor and scroll survive.
  // ======================================================================
  function MapView(g) {
    const el = document.createElement('div');
    el.className = 'cg-map-shell';
    let zoom = 1, floor = 0, follow = true, props = {}, centerSig = '', lastFix = 0;
    // Persistent live-position marker — kept across redraws so it glides between
    // GPS fixes (CSS transition) instead of teleporting, like map navigation.
    let liveEl = null, lastMarker = null, headingDeg = null;
    el.innerHTML = '<div class="cg-floors"></div><div class="cg-map-tools"></div><div class="cg-map-viewport"><div class="cg-stage"><img alt="" draggable="false"><div class="cg-map-layer"></div></div></div><a class="cg-map-credit" target="_blank" rel="noreferrer"></a>';
    const vp = el.querySelector('.cg-map-viewport'), stage = el.querySelector('.cg-stage'), img = stage.querySelector('img'), layer = stage.querySelector('.cg-map-layer');
    const sigOf = () => [props.destination, (props.path || []).join('|'), zoom, !!props.live, g.st.data.version].join('#');

    function draw() {
      const data = g.st.data, T = g.T, P = g.P;
      const path = props.path || [], dest = props.destination;
      const floors = [...new Set(data.nodes.map((n) => n.floor))].sort((a, b) => a - b);
      if (!floors.includes(floor)) floor = floors[0] || 0;
      el.querySelector('.cg-floors').innerHTML = floors.map((f) => html`<button type="button" data-m="floor" data-f="${f}" class="${f === floor ? 'active' : ''}">${f === 0 ? T('Ground') : `${T('Floor')} ${f}`}</button>`.s).join('');
      el.querySelector('.cg-map-tools').innerHTML = html`${props.live ? html`<button type="button" data-m="follow" class="${follow ? 'following' : ''}" aria-label="${T(follow ? 'Pause map follow' : 'Follow my location')}" title="${T(follow ? 'Following location' : 'Follow my location')}">${icon('locate', 18)}</button>` : ''}
        <button type="button" data-m="zin" aria-label="${T('Zoom in')}" title="${T('Zoom in')}" ${zoom >= 2 ? 'disabled' : ''}>${icon('zoomin', 18)}</button>
        <button type="button" data-m="zout" aria-label="${T('Zoom out')}" title="${T('Zoom out')}" ${zoom <= 0.75 ? 'disabled' : ''}>${icon('zoomout', 18)}</button>`.s;
      stage.style.width = `calc(var(--cg-map-width) * ${zoom})`;
      const src = data.mapImages && data.mapImages[String(floor)];
      if (src) {
        if (img.getAttribute('src') !== src) img.setAttribute('src', src);
        img.alt = floor === 0 ? T('KPRIET published campus layout showing numbered buildings and roads') : `${T('Uploaded floor')} ${floor} ${T('plan')}`;
        img.hidden = false;
      } else { img.hidden = true; img.removeAttribute('src'); }
      const segs = path.slice(1).map((id, i) => ({ from: data.nodes.find((n) => n.id === path[i]), to: data.nodes.find((n) => n.id === id) }))
        .filter((s) => s.from && s.to && s.from.floor === s.to.floor && s.from.floor === floor);
      const line = (s, cls) => `<line class="${cls}" x1="${s.from.x}" y1="${s.from.y}" x2="${s.to.x}" y2="${s.to.y}" vector-effect="non-scaling-stroke"/>`;
      layer.innerHTML = html`${!src ? html`<div class="cg-unmapped">${T('No floor plan uploaded')}</div>` : ''}
        ${src && floor === 0 && src === KPR_MAP ? raw('<span class="cg-mask cg-mask-pin"></span><span class="cg-mask cg-mask-words"></span>') : ''}
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" class="cg-route-lines" aria-hidden="true">${raw(segs.map((s) => line(s, 'route-casing')).join('') + segs.map((s) => line(s, 'route-core')).join(''))}</svg>
        ${publicNodes(data).filter((n) => n.floor === floor).map((n) => {
          const hosted = data.events.filter((e) => CompassData.venueNode(data, e.venue) === n.id);
          const title = [P(n.name), ...hosted.map((e) => g.evText(e, 'title'))].join(' · ');
          return html`<button type="button" data-m="pin" data-id="${n.id}" title="${title}" aria-label="${P(n.name) + (hosted.length ? ` · ${hosted.length} ${T(hosted.length === 1 ? 'event' : 'events')}` : '')}"
            class="cg-pin${n.id === dest ? ' destination' : ''}${path.includes(n.id) ? ' on-route' : ''}${hosted.length ? ' has-event' : ''}" style="left:${n.x}%;top:${n.y}%"><span>${pinGlyph(n)}</span>${hosted.length ? html`<em class="cg-pin-badge">${hosted.length}</em>` : ''}</button>`;
        })}`.s;
      const credit = el.querySelector('.cg-map-credit');
      credit.href = data.sourceUrl || CompassData.sample.sourceUrl;
      credit.innerHTML = html`${g.tx().mapSource}${icon('external', 12)}`.s;
      drawLive();
    }
    // Live position: a single marker kept outside the redrawn layer so it glides
    // from fix to fix (CSS transition) and the heading cone rotates to the way
    // you are moving — the Google-Maps navigation feel.
    function drawLive() {
      const data = g.st.data, fix = props.fix;
      if (!liveEl) {
        liveEl = document.createElement('div');
        liveEl.className = 'cg-live-pos';
        liveEl.innerHTML = '<span class="cg-acc-ring"></span><span class="cg-live-cone"></span><span class="cg-pos-dot"></span>';
        stage.appendChild(liveEl);
      }
      const m = fix && props.live && floor === 0 ? CompassGeo.geoToMap(data, fix.lat, fix.lon) : null;
      const onMap = !!m && m.x >= 0 && m.x <= 100 && m.y >= 0 && m.y <= 100;
      if (!onMap) { liveEl.classList.remove('show'); lastMarker = null; return; }
      // Bearing from how the dot actually moved on this map (independent of how
      // north sits on the image); only update when the step is big enough to trust.
      if (lastMarker) {
        const dx = m.x - lastMarker.x, dy = m.y - lastMarker.y;
        if (dx * dx + dy * dy > 0.05) headingDeg = Math.atan2(dy, dx) * 180 / Math.PI;
      }
      lastMarker = { x: m.x, y: m.y };
      liveEl.style.left = m.x + '%';
      liveEl.style.top = m.y + '%';
      const ring = Math.min(180, Math.max(38, fix.accuracy * 2.8));
      const r = liveEl.querySelector('.cg-acc-ring');
      r.style.width = ring + 'px'; r.style.height = ring + 'px';
      const cone = liveEl.querySelector('.cg-live-cone');
      if (headingDeg == null) { cone.style.display = 'none'; }
      else { cone.style.display = ''; cone.style.transform = 'translate(-50%,-50%) rotate(' + (headingDeg + 90) + 'deg)'; }
      liveEl.classList.add('show');
    }
    // Centre on the destination, or on the whole route when it fits (same rule as the original).
    function center() {
      const data = g.st.data, n = data.nodes.find((p) => p.id === props.destination);
      requestAnimationFrame(() => {
        if (!el.isConnected) return;
        const fl = props.live ? 0 : (n ? n.floor : 0);
        const pts = (props.path || []).map((id) => data.nodes.find((p) => p.id === id)).filter((p) => p && p.floor === fl);
        const ys = pts.map((p) => p.y), xs = pts.map((p) => p.x);
        const fy = ys.length && stage.offsetHeight * (Math.max(...ys) - Math.min(...ys)) / 100 < vp.clientHeight * 0.82 ? (Math.max(...ys) + Math.min(...ys)) / 2 : n ? n.y : 55;
        const fx = xs.length && stage.offsetWidth * (Math.max(...xs) - Math.min(...xs)) / 100 < vp.clientWidth * 0.82 ? (Math.max(...xs) + Math.min(...xs)) / 2 : n ? n.x : 65;
        vp.scrollTop = Math.max(0, stage.offsetHeight * fy / 100 - vp.clientHeight * 0.5);
        vp.scrollLeft = Math.max(0, stage.offsetWidth * fx / 100 - vp.clientWidth * 0.5);
      });
    }
    function followFix() {
      const fix = props.fix;
      if (!props.live || !fix || !follow || floor !== 0 || fix.timestamp === lastFix) return;
      lastFix = fix.timestamp;
      const m = CompassGeo.geoToMap(g.st.data, fix.lat, fix.lon);
      if (!m) return;
      requestAnimationFrame(() => {
        const top = Math.max(0, stage.offsetHeight * m.y / 100 - vp.clientHeight * 0.5);
        const left = Math.max(0, stage.offsetWidth * m.x / 100 - vp.clientWidth * 0.5);
        // Glide the map to keep you centred, the way navigation pans as you walk.
        try { vp.scrollTo({ top, left, behavior: 'smooth' }); }
        catch { vp.scrollTop = top; vp.scrollLeft = left; }
      });
    }
    function update(next) {
      const prevDest = props.destination;
      props = next;
      if (next.destination && next.destination !== prevDest) { const n = g.st.data.nodes.find((p) => p.id === next.destination); if (n) floor = next.live ? 0 : n.floor; }
      draw();
      const sig = sigOf();
      if (sig !== centerSig) { centerSig = sig; center(); }
      followFix();
    }
    // Mouse drag pans the map (touch devices scroll natively).
    let drag = null, suppress = false;
    vp.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse' || e.button !== 0) return; drag = { x: e.clientX, y: e.clientY, l: vp.scrollLeft, t: vp.scrollTop, moved: false }; });
    const onMove = (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 5) { drag.moved = true; vp.classList.add('dragging'); }
      if (drag.moved) { vp.scrollLeft = drag.l - dx; vp.scrollTop = drag.t - dy; }
    };
    const onUp = () => { if (drag && drag.moved) { suppress = true; setTimeout(() => { suppress = false; }, 0); } drag = null; vp.classList.remove('dragging'); };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    el.addEventListener('click', (e) => {
      if (suppress) { e.preventDefault(); e.stopPropagation(); return; }
      const b = e.target.closest('[data-m]');
      if (!b || !el.contains(b)) return;
      e.preventDefault(); e.stopPropagation();
      const m = b.dataset.m;
      if (m === 'pin') { g.pick(b.dataset.id); return; }
      if (m === 'floor') floor = Number(b.dataset.f);
      if (m === 'follow') { follow = !follow; lastFix = 0; }
      if (m === 'zin' || m === 'zout') {
        // keep the visual centre while zooming
        const cx = (vp.scrollLeft + vp.clientWidth / 2) / (stage.offsetWidth || 1), cy = (vp.scrollTop + vp.clientHeight / 2) / (stage.offsetHeight || 1);
        zoom = m === 'zin' ? Math.min(2, zoom + 0.25) : Math.max(0.75, zoom - 0.25);
        draw();
        vp.scrollLeft = cx * stage.offsetWidth - vp.clientWidth / 2; vp.scrollTop = cy * stage.offsetHeight - vp.clientHeight / 2;
        centerSig = sigOf();
        return;
      }
      draw(); followFix();
    }, true);
    return {
      el, update,
      saveScroll() { return { l: vp.scrollLeft, t: vp.scrollTop }; },
      restoreScroll(s) { if (s) { vp.scrollLeft = s.l; vp.scrollTop = s.t; } },
      destroy() { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); },
    };
  }

  // ======================================================================
  // The guide page
  // ======================================================================
  function Guide(info, cid, query, opts) {
    const st = {
      cid, info, data: info.data, lang: savedLang(),
      view: 'explore', mode: 'layout', query: '', start: 'entry', originMode: 'gps', target: '', selectedRoom: '', selectedEvent: '',
      accessible: false, saved: ls.get(`cg.saved.${cid}`, []), navigating: false, eventTab: 'all', modal: null, offlineCopy: !!opts.offline,
    };
    if (!Array.isArray(st.saved)) st.saved = [];
    const gd = { active: false, voice: false, fix: null, error: '', watch: null, spoken: '', cache: null };
    const T = (s) => (st.lang === 'ta' && EXTRA_TA[s]) || CompassI18n.t(st.lang, s);
    const P = (s) => CompassI18n.place(st.lang, s || '');
    const tx = () => copy[st.lang];
    const evText = (e, k) => {
      const ta = { title: 'titleTa', time: 'timeTa', description: 'descriptionTa', instructions: 'instructionsTa' }[k];
      return st.lang === 'ta' ? (e[ta] || T(e[k] || '')) : (e[k] || '');
    };
    const college = info.college;
    const isKpr = /KPRIET/i.test(college.short_name || '');
    const placeQuery = encodeURIComponent([college.name, college.location].filter(Boolean).join(', '));
    const GOOGLE = `https://www.google.com/maps/search/?api=1&query=${placeQuery}`;
    const GOOGLE_EMBED = `https://maps.google.com/maps?q=${placeQuery}&t=k&z=17&output=embed`;
    const EVENTS_URL = isKpr ? 'https://www.kpriet.ac.in/happenings' : college.website;
    const g = { st, T, P, tx, evText, pick };
    let root, map, navMap, timer, resultsSig = '', navSig = '', destroyed = false, scan = null, keyHandler, notifyTimer;

    // ---------------- live guide (GPS) ----------------
    function guidePath() {
      if (!(gd.active && gd.fix && st.target && gd.fix.accuracy <= 35)) return null;
      const key = [gd.fix.timestamp, gd.fix.lat, gd.fix.lon, st.target, st.accessible, st.data.version].join('|');
      if (gd.cache && gd.cache.key === key) return gd.cache.path;
      const path = CompassGeo.liveRoute(st.data, gd.fix, st.target, st.accessible && !!st.data.accessibilityVerified);
      gd.cache = { key, path };
      return path;
    }
    function guideInstruction() { const p = guidePath(); return gd.active && gd.fix && p ? CompassGeo.liveInstruction(st.data, p.ids, gd.fix, st.lang) : null; }
    function gpsStop() {
      if (gd.watch !== null && navigator.geolocation) navigator.geolocation.clearWatch(gd.watch);
      gd.watch = null; gd.active = false; gd.voice = false;
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    }
    function gpsStart(force = false) {
      if (gd.watch !== null) { if (!force && !gd.error) return; navigator.geolocation.clearWatch(gd.watch); gd.watch = null; }
      if (!navigator.geolocation) { gd.error = 'Live location is unavailable on this device.'; return; }
      gd.error = ''; gd.fix = null; gd.spoken = ''; gd.active = true;
      gd.watch = navigator.geolocation.watchPosition((p) => {
        gd.fix = { lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy, heading: p.coords.heading, timestamp: p.timestamp };
        gd.error = ''; liveUpdate();
      }, (err) => {
        gd.error = err.code === 1 ? 'Location permission was denied. Enable it in your browser settings.' : 'Could not get your location. Move outdoors or try again.';
        liveUpdate();
      }, { enableHighAccuracy: true, maximumAge: 1500, timeout: 12000 });
    }
    function speak() {
      const ins = guideInstruction();
      if (!gd.active || !gd.voice || !ins || !ins.speak || !('speechSynthesis' in window)) return;
      if (ins.text === gd.spoken) return;
      gd.spoken = ins.text;
      try {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(ins.text); u.lang = st.lang === 'ta' ? 'ta-IN' : 'en-IN'; u.rate = 0.92;
        window.speechSynthesis.speak(u);
      } catch { /* speech unavailable */ }
    }

    // ---------------- derived ----------------
    function currentRoute() {
      if (!st.target) return null;
      return st.originMode === 'gps' ? guidePath() : CompassData.route(st.data, st.start, st.target, st.accessible && !!st.data.accessibilityVerified);
    }
    const destination = () => st.data.nodes.find((n) => n.id === st.target);
    function evState(e) {
      const now = Date.now(), s = e.startsAt ? Date.parse(e.startsAt) : NaN, en = e.endsAt ? Date.parse(e.endsAt) : NaN;
      if (s <= now && en >= now) return 'Happening now';
      if (s > now) return 'Upcoming';
      if (en < now) return 'Past';
      return '';
    }
    const activeAlerts = () => (st.data.alerts || []).filter((a) => a && a.message && a.active !== false
      && !(a.startsAt && Date.parse(a.startsAt) > Date.now()) && !(a.endsAt && Date.parse(a.endsAt) < Date.now()));

    // ---------------- actions ----------------
    function resetSel() { st.navigating = false; st.selectedRoom = ''; st.selectedEvent = ''; st.mode = 'layout'; st.view = 'explore'; st.query = ''; }
    // A start point set by a checkpoint or the From list is kept; otherwise live GPS is the origin.
    function beginOrigin() { if (st.originMode === 'gps') gpsStart(); }
    function pick(id) {
      if (!st.data.nodes.some((n) => n.id === id)) return;
      beginOrigin(); resetSel(); st.target = id; renderAll(true);
    }
    function selectEvent(id) {
      const e = st.data.events.find((x) => x.id === id); if (!e) return false;
      st.selectedRoom = (st.data.rooms || []).find((r) => r.id === e.venue)?.id || ''; st.selectedEvent = id; st.target = CompassData.venueNode(st.data, e.venue);
      return true;
    }
    function selectRoom(id) {
      const r = (st.data.rooms || []).find((x) => x.id === id); if (!r) return false;
      st.selectedRoom = id; st.selectedEvent = '';
      st.target = r.checkpoint && CompassData.route(st.data, 'entry', r.checkpoint) ? r.checkpoint : r.building;
      return true;
    }
    function pickEvent(id) { if (!st.data.events.some((x) => x.id === id)) return; beginOrigin(); resetSel(); selectEvent(id); renderAll(true); }
    function pickRoom(id) { if (!(st.data.rooms || []).some((x) => x.id === id)) return; beginOrigin(); resetSel(); selectRoom(id); renderAll(true); }
    function checkpointFromText(rawText) {
      let id = String(rawText || '').trim();
      try {
        const u = new URL(id);
        id = u.searchParams.get('checkpoint') || new URLSearchParams(u.hash.split('?')[1] || '').get('checkpoint') || id;
      } catch { /* a plain code */ }
      return id ? st.data.nodes.find((n) => n.id.toLowerCase() === id.toLowerCase()) : null;
    }
    function checkpoint(rawText) {
      const n = checkpointFromText(rawText);
      if (!n) { notify('Checkpoint code not found.'); return false; }
      st.start = n.id; st.originMode = 'manual'; gpsStop(); stopScan(); st.modal = null;
      renderAll();
      notify(T('Starting from ') + P(n.name));
      return true;
    }
    async function share() {
      const url = `${location.origin}${location.pathname}#/campus/${cid}?to=${encodeURIComponent(st.target)}`;
      if (navigator.share) { try { await navigator.share({ title: destination()?.name, url }); } catch { /* cancelled */ } return; }
      try { await navigator.clipboard.writeText(url); notify('Route link copied'); } catch { notify(`${T('Copy this link:')} ${url}`, 9000); }
    }
    function notify(msg, ms = 4200) {
      const box = $('#cg-toast', root); if (!box) return;
      box.innerHTML = html`<div class="cg-toast" role="status"><span>${T(msg)}</span><button type="button" data-click="dismiss" aria-label="${T('Dismiss')}">${icon('x', 15)}</button></div>`.s;
      clearTimeout(notifyTimer); notifyTimer = setTimeout(() => { if (box.isConnected) box.innerHTML = ''; }, ms);
    }
    function saveToggle(id) {
      st.saved = st.saved.includes(id) ? st.saved.filter((x) => x !== id) : [...st.saved, id];
      ls.set(`cg.saved.${cid}`, st.saved);
    }

    // ---------------- QR scanning: native BarcodeDetector, else ZXing loaded on demand ----------------
    function stopScan() {
      if (!scan) return;
      scan.stopped = true; clearTimeout(scan.timer);
      if (scan.stream) scan.stream.getTracks().forEach((t) => t.stop());
      scan = null;
      const v = $('#cg-video', root); if (v) { v.srcObject = null; v.hidden = true; }
      const b = $('[data-click="beginScan"]', root); if (b) { b.disabled = false; b.innerHTML = html`${ic('scan', 17)}${tx().camera}`.s; }
    }
    function loadZxing() {
      if (window.ZXing) return Promise.resolve(window.ZXing);
      return new Promise((resolve, reject) => {
        const s = document.createElement('script'); s.src = '/js/vendor/zxing.min.js'; s.async = true;
        s.onload = () => (window.ZXing ? resolve(window.ZXing) : reject(new Error('Could not open camera. Enter the printed location code.')));
        s.onerror = () => reject(new Error('Could not open camera. Enter the printed location code.'));
        document.head.appendChild(s);
      });
    }
    async function beginScan() {
      if (scan) return;
      const me = { stopped: false, timer: 0, stream: null }; scan = me;
      const btn = $('[data-click="beginScan"]', root); if (btn) { btn.disabled = true; btn.innerHTML = html`${ic('scan', 17)}${T('Scanning…')}`.s; }
      try {
        const video = $('#cg-video', root);
        if (!navigator.mediaDevices?.getUserMedia || !video) throw new Error('Camera unavailable. Use HTTPS and allow camera access, or enter the location code.');
        let detect, native = null;
        if ('BarcodeDetector' in window) { try { const f = await window.BarcodeDetector.getSupportedFormats(); if (f.includes('qr_code')) native = new window.BarcodeDetector({ formats: ['qr_code'] }); } catch { native = null; } }
        if (native) detect = async () => { const r = await native.detect(video); return (r[0] && r[0].rawValue) || ''; };
        else {
          const Z = await loadZxing(); const reader = new Z.QRCodeReader(); const canvas = document.createElement('canvas');
          detect = async () => {
            const w = video.videoWidth, h = video.videoHeight; if (!w || !h) return '';
            const s = Math.min(1, 720 / Math.max(w, h)); canvas.width = Math.round(w * s); canvas.height = Math.round(h * s);
            canvas.getContext('2d', { willReadFrequently: true }).drawImage(video, 0, 0, canvas.width, canvas.height);
            try { return reader.decode(new Z.BinaryBitmap(new Z.HybridBinarizer(new Z.HTMLCanvasElementLuminanceSource(canvas)))).getText(); } catch { return ''; }
          };
        }
        if (me.stopped) return;
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        if (me.stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
        me.stream = stream; video.srcObject = stream; video.hidden = false;
        await video.play().catch(() => {});
        const tick = async () => {
          if (me.stopped) return;
          let text = '';
          try { text = await detect(); } catch { text = ''; }
          if (me.stopped) return;
          if (text && checkpointFromText(text)) { checkpoint(text); return; }
          me.timer = setTimeout(tick, 260);
        };
        tick();
      } catch (e) {
        stopScan();
        notify(e && e.name === 'NotAllowedError' ? 'Camera permission denied. Enable camera access in your browser.' : (e && e.message) || 'Could not open camera. Enter the printed location code.', 6500);
      }
    }

    // ---------------- ID photos: resized in the browser to at most 1600 px JPEG ----------------
    async function toJpeg(file) {
      const url = URL.createObjectURL(file);
      try {
        const im = await new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => reject(new Error('Could not read this image. Try another photo.')); i.src = url; });
        const s = Math.min(1, 1600 / Math.max(im.naturalWidth, im.naturalHeight));
        const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(im.naturalWidth * s)); c.height = Math.max(1, Math.round(im.naturalHeight * s));
        const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(im, 0, 0, c.width, c.height);
        return c.toDataURL('image/jpeg', 0.86);
      } finally { URL.revokeObjectURL(url); }
    }

    // ======================================================================
    // Rendering
    // ======================================================================
    function topbar() {
      const me = state.me;
      const manager = me && Array.isArray(me.permissions) && me.permissions.includes('manage_campus_guide') && (!me.college || me.college.id === college.id);
      return html`<header class="cg-top"><div class="cg-top-in">
        <button type="button" class="cg-brand" data-click="home" aria-label="${info.guideName}">
          <span class="cg-logo">${isKpr ? raw('<img src="/assets/compass/kpriet-logo.png" alt="KPRIET">') : App.logo(30)}</span>
          <span class="cg-brand-text"><strong>${info.guideName}</strong><small>${T('CAMPUS GUIDE')}</small></span></button>
        <nav class="cg-dnav" aria-label="${info.guideName}">${['explore', 'events', 'saved'].map((v) => html`<button type="button" data-click="view" data-v="${v}" class="${st.view === v ? 'active' : ''}">${tx()[v]}</button>`)}</nav>
        <div class="cg-actions">
          <div class="cg-lang" role="group" aria-label="${T('Language')}"><button type="button" data-click="lang" data-l="en" class="${st.lang === 'en' ? 'active' : ''}" lang="en" aria-pressed="${st.lang === 'en'}">EN</button><button type="button" data-click="lang" data-l="ta" class="${st.lang === 'ta' ? 'active' : ''}" lang="ta" aria-pressed="${st.lang === 'ta'}">தமிழ்</button></div>
          ${manager ? html`<a class="cg-icon-link" href="#/admin/campus" title="${T('Campus guide admin')}" aria-label="${T('Campus guide admin')}">${icon('settings', 18)}</a>` : ''}
          ${me ? html`<a class="cg-portal" href="${me.home}" title="${T('Back to portal')}">${icon('back', 16)}<span>${T('Back to portal')}</span></a>`
            : html`<a class="cg-inst" href="#/universities">${T('Institutions')}</a><a class="cg-portal" href="#/college/${college.id}/login">${icon('user', 16)}<span>${T('Sign in')}</span></a>`}
        </div></div></header>`;
    }
    function intro() {
      const loc = st.lang === 'ta' && /Coimbatore/i.test(college.location || '') ? T('Coimbatore · Tamil Nadu') : college.location;
      return html`<div class="cg-intro"><div>
          <span class="cg-eyebrow"><span class="cg-eyebrow-dot"></span>${T(String(college.name).toUpperCase())}</span>
          <h1>${st.view === 'events' ? tx().events : st.view === 'saved' ? tx().mySaved : tx().question}</h1>
          <p>${st.view === 'explore' ? tx().subtitle : loc}</p></div>
        <div class="cg-intro-actions">
          <button type="button" class="cg-gps-btn ${gd.active ? 'active' : ''}" data-click="gpsToggle">${icon('locate', 18)}${T(gd.active ? 'Stop GPS' : 'Live GPS')}</button>
          <a class="cg-arrival" href="${GOOGLE}" target="_blank" rel="noreferrer">${icon('nav', 16)}${tx().arrival}${icon('external', 14)}</a>
        </div></div>`;
    }
    function gpsStrip() {
      if (!(gd.active || gd.error)) return '';
      const data = st.data, m = gd.fix ? CompassGeo.geoToMap(data, gd.fix.lat, gd.fix.lon) : null;
      const onMap = !!m && m.x >= 0 && m.x <= 100 && m.y >= 0 && m.y <= 100;
      const text = (gd.error ? T(gd.error) : '') || (!gd.fix ? T('Finding your position…')
        : `${T('Live GPS')} · ${T('accuracy')} ±${Math.round(gd.fix.accuracy)} m${onMap ? '' : ` · ${T('outside mapped area')}`}${data.gpsCalibrated ? '' : ` · ${T('approximate alignment')}`}`);
      return html`<div class="cg-gps-status" role="status"><span class="cg-gps-dot ${gd.fix && gd.fix.accuracy <= 35 ? 'ready' : ''}"></span><span>${text}</span>${gd.active && gd.fix ? html`<span class="cg-gps-meta">${T(st.target ? 'Following route' : 'Choose a destination for directions')}</span>` : ''}</div>`;
    }
    function alertsStrip() {
      const a = activeAlerts(); if (!a.length) return '';
      return html`<div class="cg-alerts" role="status" aria-label="${T('Campus alerts')}">${icon('bell', 18)}<span>${a.map((x) => (st.lang === 'ta' && x.messageTa) || x.message).join(' · ')}</span></div>`;
    }
    function searchBar() {
      return html`<div class="cg-search">${icon('search', 20)}
        <input id="cg-q" type="text" autocomplete="off" enterkeyhint="search" placeholder="${tx().search}" aria-label="${tx().search}" value="${st.query}" data-input="search">
        <button type="button" class="cg-clear ${st.query ? '' : 'hidden'}" data-click="clearSearch" aria-label="${T('Clear search')}">${icon('x', 18)}</button>
        <button type="button" class="cg-scan-top" data-click="scanOpen">${ic('scan', 19)}<span>${tx().scan}</span></button></div>
        <button type="button" class="cg-id-entry" data-click="idOpen">${ic('scan', 17)}${T('Visitor ID check-in')}${icon('arrow', 15)}</button>`;
    }
    function popular() {
      if (st.target || st.query) return '';
      const nodes = POPULAR.map((id) => st.data.nodes.find((n) => n.id === id)).filter(Boolean);
      if (!nodes.length) return '';
      return html`<div class="cg-popular"><span>${tx().recent}</span>${nodes.map((n) => html`<button type="button" data-click="pick" data-id="${n.id}">${P(n.name.replace(/ · \d+$/, ''))}${icon('arrow', 14)}</button>`)}</div>`;
    }
    function results() {
      const data = st.data;
      return st.query.trim() ? CompassSearch.searchCampus(data, st.query)
        : publicNodes(data).map((n) => ({ kind: 'place', id: n.id, node: n.id, title: n.name, subtitle: departmentNames[n.id] || (n.kind === 'building' ? 'Academic building' : n.kind === 'venue' ? 'Venue' : n.kind === 'parking' ? 'Parking' : 'Campus place'), score: 0 }));
    }
    function placeList() {
      const rs = results();
      return html`<div class="cg-results-head"><h2>${st.query ? `${rs.length} ${T('results')}` : T('Explore campus')}</h2><span>${publicNodes(st.data).length} ${T('locations')}</span></div>
        <div class="cg-place-list">${rs.length ? rs.map((r) => html`<button type="button" class="cg-place-row" data-click="${r.kind === 'room' ? 'pickRoom' : r.kind === 'event' ? 'pickEvent' : 'pick'}" data-id="${r.kind === 'room' || r.kind === 'event' ? r.id : r.node}">
            <span class="cg-place-icon">${r.kind === 'room' ? ic('grid2', 18) : r.kind === 'event' ? icon('calendar', 18) : r.kind === 'facility' ? ic('life', 18) : icon('pin', 18)}</span>
            <span class="cg-place-text"><strong>${r.kind === 'place' || r.kind === 'facility' ? P(r.title) : r.kind === 'event' ? evText(st.data.events.find((e) => e.id === r.id) || { title: r.title }, 'title') : r.title}</strong><small>${P(T(r.subtitle))}</small></span>${icon('arrow', 17)}</button>`)
          : html`<p class="cg-empty">${tx().searchEmpty}</p>`}</div>`;
    }
    function directions() {
      const data = st.data, dest = destination(), room = (data.rooms || []).find((r) => r.id === st.selectedRoom);
      const rel = data.events.find((e) => e.id === st.selectedEvent);
      const nodeEvents = data.events.filter((e) => CompassData.venueNode(data, e.venue) === st.target);
      const cr = currentRoute(), ins = guideInstruction();
      const origins = data.nodes.filter((n) => ['start', 'entrance', 'parking'].includes(n.kind) || n.id === st.start);
      const fixSmall = gd.active && gd.fix ? `GPS ${T('accuracy')} ±${Math.round(gd.fix.accuracy)} m` : T('Selected starting point');
      return html`<div class="cg-panel-head"><span class="cg-kicker">${tx().directions}</span><button type="button" data-click="allPlaces">${icon('back', 15)}${T('All places')}</button></div>
        <h2 class="cg-route-title">${P((room && room.name) || (dest && dest.name) || '')}</h2>
        ${!rel && nodeEvents.length ? html`<div class="cg-events-here"><strong>${T('Events at this location')}</strong>${nodeEvents.map((e) => html`<button type="button" data-click="pickEvent" data-id="${e.id}">${icon('calendar', 16)}<span>${evText(e, 'title')}<small>${evText(e, 'time')} · ${P(CompassData.venueName(data, e.venue))}</small></span>${icon('arrow', 15)}</button>`)}</div>` : ''}
        ${rel ? html`<div class="cg-room-card">${rel.posterUrl ? html`<img class="cg-route-poster" src="${rel.posterUrl}" alt="${evText(rel, 'title') + ' poster'}">` : ''}<strong>${evText(rel, 'title')}</strong><span>${evText(rel, 'time')} · ${P(CompassData.venueName(data, rel.venue))}</span>${rel.instructions ? html`<p>${evText(rel, 'instructions')}</p>` : ''}</div>` : ''}
        ${room ? html`<div class="cg-room-card"><strong>${P(room.department)}</strong><span>${[P(data.nodes.find((n) => n.id === room.building)?.name || ''), room.floor === null || room.floor === undefined ? '' : `${T('Floor')} ${room.floor}`, room.roomNumber].filter(Boolean).join(' · ')}</span>
          <p>${room.directions || T('Continue from the building entrance. Ask staff for the precise room location.')}</p>${!room.checkpoint ? html`<small>${T('GPS route ends at the building. Scan a posted checkpoint for indoor position.')}</small>` : ''}</div>` : ''}
        <div class="cg-origin"><label for="cg-from">${tx().from}</label><div class="cg-origin-row">
          <select id="cg-from" class="input" data-change="origin"><option value="gps" ${st.originMode === 'gps' ? 'selected' : ''}>${T('My live location')}</option>
            ${origins.map((n) => html`<option value="${n.id}" ${st.originMode !== 'gps' && st.start === n.id ? 'selected' : ''}>${P(n.name)}</option>`)}</select>
          <button type="button" class="cg-square" data-click="scanOpen" aria-label="${T('Scan starting location')}" title="${T('Scan starting location')}">${ic('scan', 19)}</button></div></div>
        ${cr ? html`<div class="cg-live-panel"><div class="cg-live-top"><span class="cg-live-icon">${icon('nav', 20)}</span><div><strong>${T(gd.active ? 'Live guidance' : 'Follow this route')}</strong><small>${fixSmall}</small></div>
              <button type="button" class="btn primary" data-click="navStart">${T('Start')}</button></div>
            ${gd.active ? html`<div class="cg-turn" role="status">${(ins && ins.text) || (gd.error ? T(gd.error) : '') || T(gd.fix ? 'Route could not be matched here. Check the map or move outdoors.' : 'Finding your position…')}</div>
              <label class="cg-switch-row"><span>${T('Speak directions')}</span><input type="checkbox" class="cg-switch" data-change="voice" ${gd.voice ? 'checked' : ''}></label>` : ''}</div>
          <div class="cg-route-note">${icon('compass', 17)}<span>${tx().routeNote}</span></div>
          ${data.distanceVerified ? html`<div class="cg-route-facts">${icon('clock', 16)}${T('About')} ${cr.meters} m · ${cr.minutes} ${T('min walk')}</div>` : ''}
          ${data.accessibilityVerified ? html`<label class="cg-switch-row cg-stepfree"><span>${ic('access', 17)}${T('Step-free route')}</span><input type="checkbox" class="cg-switch" data-change="accessible" ${st.accessible ? 'checked' : ''}></label>` : ''}
          <ol class="cg-steps">${cr.ids.map((id, i) => {
            const n = data.nodes.find((x) => x.id === id); if (!n) return '';
            const edge = cr.edges[i - 1], note = (edge && edge.note) || n.detail;
            const lead = T(i === 0 ? 'Start at ' : i === cr.ids.length - 1 ? 'Arrive at ' : 'Continue toward ');
            return html`<li><span class="cg-step-n">${i + 1}</span><div><strong>${lead}${P(n.name)}</strong>${note ? html`<small>${P(note)}</small>` : ''}</div>${data.distanceVerified && edge ? html`<em>${edge.meters} m</em>` : ''}</li>`;
          })}</ol>`
        : html`<div class="cg-live-panel"><div class="cg-live-top"><span class="cg-live-icon">${icon('locate', 20)}</span><div>
            <strong>${T(st.originMode === 'gps' ? (gd.error ? 'Location unavailable' : gd.active ? 'Finding your position…' : 'Allow location access for live guidance') : 'Route unavailable')}</strong>
            <small>${st.originMode === 'gps' ? (gd.error ? T(gd.error) : gd.fix ? (gd.fix.accuracy > 35 ? `GPS ${T('accuracy')} ±${Math.round(gd.fix.accuracy)} m` : T('Route could not be matched here. Check the map or move outdoors.')) : T('Allow location access to see a route from where you are.')) : tx().routeUnavailable}</small></div>
            ${st.originMode === 'gps' ? html`<button type="button" class="btn primary" data-click="retryGps">${T('Retry GPS')}</button>` : ''}</div></div>`}
        <div class="cg-route-actions"><button type="button" class="btn" data-click="share">${icon('share', 16)}${tx().share}</button><a href="${GOOGLE}" target="_blank" rel="noreferrer">${tx().openGoogle}${icon('external', 14)}</a></div>
        ${!data.accessibilityVerified ? html`<div class="cg-access-note">${ic('access', 18)}<span>${tx().stepFree}</span></div>` : ''}`;
    }
    function resultsSignature() {
      const cr = currentRoute(), ins = guideInstruction();
      return JSON.stringify([st.lang, st.target, st.originMode, st.start, cr && cr.ids, ins && ins.text, gd.active, gd.error, gd.voice, gd.fix ? Math.round(gd.fix.accuracy) : -1]);
    }
    function mapPanel() {
      return html`<div class="cg-map-head"><div><strong>${st.mode === 'layout' ? tx().campus : tx().google}</strong><small>${st.mode === 'layout' ? tx().mapSource : (st.lang === 'ta' && isKpr ? T('KPRIET · Arasur, Coimbatore') : `${college.short_name} · ${college.location || ''}`)}</small></div>
        <div class="cg-map-tabs" role="tablist"><button type="button" role="tab" aria-selected="${st.mode === 'layout'}" class="${st.mode === 'layout' ? 'active' : ''}" data-click="mode" data-mode="layout">${icon('map', 15)}${tx().campus}</button><button type="button" role="tab" aria-selected="${st.mode === 'google'}" class="${st.mode === 'google' ? 'active' : ''}" data-click="mode" data-mode="google">${icon('globe', 15)}${tx().google}</button></div></div>
        ${st.mode === 'layout' ? raw('<div data-map-slot></div>') : html`<div class="cg-google"><iframe title="${T('Google Maps view of KPRIET')}" src="${GOOGLE_EMBED}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" allowfullscreen></iframe><a href="${GOOGLE}" target="_blank" rel="noreferrer">${tx().openGoogle}${icon('external', 15)}</a></div>`}`;
    }
    function exploreBody() {
      return html`${popular()}<div class="cg-grid ${st.query.trim() ? 'searching' : ''}">
        <section class="cg-panel cg-results" id="cg-results">${st.target ? directions() : html`<div class="cg-panel-head"><span class="cg-kicker">${tx().places}</span></div>${placeList()}`}</section>
        <section class="cg-panel cg-mappanel" id="cg-mappanel">${mapPanel()}</section></div>`;
    }
    function eventCard(e) {
      const stt = evState(e), saved = st.saved.includes(e.id);
      return html`<article class="cg-event">${e.posterUrl ? html`<img class="cg-poster" src="${e.posterUrl}" alt="${evText(e, 'title') + ' poster'}" loading="lazy">` : ''}
        <div class="cg-event-main"><div class="cg-event-kickers"><span class="cg-kicker">${icon('clock', 14)}${evText(e, 'time')}</span>${stt ? html`<span class="cg-state ${stt === 'Happening now' ? 'is-live' : stt === 'Past' ? 'is-past' : ''}">${T(stt)}</span>` : ''}</div>
          <h2>${evText(e, 'title')}</h2>${(st.lang === 'ta' && e.descriptionTa) || e.description ? html`<p>${evText(e, 'description')}</p>` : ''}
          <p class="cg-event-venue">${icon('pin', 15)}${P(CompassData.venueName(st.data, e.venue))}</p>${e.instructions ? html`<p class="cg-event-ins">${evText(e, 'instructions')}</p>` : ''}</div>
        <div class="cg-event-actions"><button type="button" class="cg-heart ${saved ? 'saved' : ''}" data-click="save" data-id="${e.id}" aria-pressed="${saved}" aria-label="${T(saved ? 'Remove saved event' : 'Save event')}" title="${T(saved ? 'Remove saved event' : 'Save event')}">${icon('heart', 19)}</button>
          <button type="button" class="btn" data-click="pickEvent" data-id="${e.id}">${icon('nav', 15)}${tx().navigate}</button>
          ${e.registrationOpen && stt !== 'Past' ? html`<button type="button" class="btn primary" data-click="participate" data-id="${e.id}">${T('Participate')}</button>` : ''}</div></article>`;
    }
    function eventsView() {
      const evs = [...st.data.events].sort((a, b) => (a.startsAt ? Date.parse(a.startsAt) : Infinity) - (b.startsAt ? Date.parse(b.startsAt) : Infinity));
      if (!evs.length) return html`<div class="cg-panel cg-simple"><div class="cg-event-empty">${icon('calendar', 30)}<h2>${tx().noEvents}</h2><p>${T('Explore campus venues now. Events added by the organiser will appear here.')}</p>
        ${EVENTS_URL ? html`<a href="${EVENTS_URL}" target="_blank" rel="noreferrer">${tx().officialEvents}${icon('external', 15)}</a>` : ''}</div></div>`;
      const tabs = [['all', 'All'], ['now', 'Happening now'], ['upcoming', 'Upcoming'], ['past', 'Past']];
      const want = { now: 'Happening now', upcoming: 'Upcoming', past: 'Past' };
      const list = st.eventTab === 'all' ? evs : evs.filter((e) => evState(e) === want[st.eventTab]);
      return html`<div class="cg-panel cg-simple"><div class="cg-event-head"><div><span class="cg-kicker">${T('CAMPUS EVENTS')}</span><h2>${T('Events & venues')}</h2></div><span>${evs.length} ${T('published')}</span></div>
        <div class="cg-tabs" role="tablist">${tabs.map(([k, l]) => { const n = k === 'all' ? evs.length : evs.filter((e) => evState(e) === want[k]).length; return html`<button type="button" role="tab" aria-selected="${st.eventTab === k}" class="${st.eventTab === k ? 'active' : ''}" data-click="evtab" data-tab="${k}">${T(l)}<b>${n}</b></button>`; })}</div>
        ${list.length ? list.map(eventCard) : html`<p class="cg-empty">${T('No events in this list.')}</p>`}</div>`;
    }
    function savedView() {
      const evs = st.data.events.filter((e) => st.saved.includes(e.id));
      return html`<div class="cg-panel cg-simple">${evs.length ? evs.map((e) => html`<article class="cg-event cg-saved">${e.posterUrl ? html`<img class="cg-poster sm" src="${e.posterUrl}" alt="${evText(e, 'title') + ' poster'}">` : ''}
          <div class="cg-event-main"><h2>${evText(e, 'title')}</h2><p>${evText(e, 'time')} · ${P(CompassData.venueName(st.data, e.venue))}</p></div>
          <div class="cg-event-actions"><button type="button" class="cg-heart saved" data-click="save" data-id="${e.id}" aria-label="${T('Remove saved event')}" title="${T('Remove saved event')}">${icon('heart', 19)}</button><button type="button" class="btn primary" data-click="pickEvent" data-id="${e.id}">${tx().navigate}</button></div></article>`)
        : html`<div class="cg-event-empty">${icon('heart', 30)}<h2>${tx().saveEmpty}</h2></div>`}</div>`;
    }
    function mainView() {
      const v = st.view === 'events' ? eventsView() : st.view === 'saved' ? savedView()
        : html`<div id="cg-gps">${gpsStrip()}</div>${searchBar()}<div id="cg-explore">${exploreBody()}</div>`;
      return html`${intro()}${st.offlineCopy ? html`<div class="cg-offline-note">${icon('info', 16)}${T('Showing the copy saved on this device.')}</div>` : ''}${alertsStrip()}${v}
        <div class="cg-footer"><span>${'serviceWorker' in navigator ? html`${icon('check', 15)}${tx().offline}` : ''}</span>
          <a href="${st.data.sourceUrl || CompassData.sample.sourceUrl}" target="_blank" rel="noreferrer">${T('Map source: KPRIET')}${icon('external', 13)}</a>
          <a href="#/" class="cg-powered">${App.logo(16)}${T('Powered by nerd')}</a></div>`;
    }
    function mobileBar() {
      return html`<nav class="cg-mobilebar" aria-label="${info.guideName}">
        <button type="button" data-click="view" data-v="explore" class="${st.view === 'explore' ? 'active' : ''}">${icon('compass', 20)}<span>${tx().explore}</span></button>
        <button type="button" data-click="view" data-v="events" class="${st.view === 'events' ? 'active' : ''}">${icon('calendar', 20)}<span>${tx().events}</span></button>
        <button type="button" data-click="scanOpen">${ic('scan', 20)}<span>${T('QR')}</span></button>
        <button type="button" data-click="view" data-v="saved" class="${st.view === 'saved' ? 'active' : ''}">${icon('heart', 20)}<span>${tx().saved}</span></button></nav>`;
    }

    function attachMap(slotRoot, mv, props, scroll) {
      const slot = $('[data-map-slot]', slotRoot);
      if (!slot) return;
      slot.replaceWith(mv.el);
      if (scroll) mv.restoreScroll(scroll);
      mv.update(props);
    }
    const mapProps = () => ({ path: currentRoute()?.ids, destination: st.target, fix: gd.fix, live: gd.active });

    function renderAll(scrollTop) {
      if (destroyed) return;
      const keep = map.saveScroll();
      const q = $('#cg-q', root), focused = q && document.activeElement === q;
      root.lang = st.lang;
      document.documentElement.lang = st.lang;
      $('#cg-topbar', root).innerHTML = topbar().s;
      $('#cg-main', root).innerHTML = mainView().s;
      $('#cg-mbar', root).innerHTML = mobileBar().s;
      attachMap($('#cg-main', root), map, mapProps(), keep);
      resultsSig = resultsSignature();
      if (focused) { const n = $('#cg-q', root); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }
      renderModal();
      renderNav();
      if (scrollTop) window.scrollTo(0, 0);
    }
    function renderExploreBody() {
      const box = $('#cg-explore', root); if (!box) return;
      const keep = map.saveScroll();
      box.innerHTML = exploreBody().s;
      attachMap(box, map, mapProps(), keep);
      resultsSig = resultsSignature();
      const clear = $('.cg-clear', root); if (clear) clear.classList.toggle('hidden', !st.query);
    }
    // Cheap update for GPS fixes: only touch what changed.
    function liveUpdate() {
      if (destroyed) return;
      const gps = $('#cg-gps', root); if (gps) gps.innerHTML = gpsStrip().s;
      const gb = $('.cg-gps-btn', root); if (gb) { gb.classList.toggle('active', gd.active); gb.innerHTML = html`${icon('locate', 18)}${T(gd.active ? 'Stop GPS' : 'Live GPS')}`.s; }
      if (st.view === 'explore' && st.target) {
        const sig = resultsSignature(), box = $('#cg-results', root);
        if (box && sig !== resultsSig && !(document.activeElement && document.activeElement.id === 'cg-from')) { box.innerHTML = directions().s; resultsSig = sig; }
      }
      if (map.el.isConnected) map.update(mapProps());
      if (st.navigating) updateNav();
      speak();
    }

    // ---------------- navigation screen ----------------
    function navStatus() {
      const ins = guideInstruction();
      return (gd.error ? T(gd.error) : '') || (!gd.fix ? T('Finding your position…') : gd.fix.accuracy > 35 ? `GPS ${T('accuracy')} ±${Math.round(gd.fix.accuracy)} m. ${T('Move outdoors for a clearer fix.')}` : (ins && ins.text) || T('Checking your position against the mapped paths…'));
    }
    function navBottom() {
      const p = guidePath();
      return html`<div class="cg-nav-prompt"><span class="cg-nav-prompt-icon">${icon('nav', 25)}</span><div><strong role="status">${navStatus()}</strong>
          <small>${gd.fix ? `GPS ±${Math.round(gd.fix.accuracy)} m · ${T(st.data.gpsCalibrated ? 'Outdoor position' : 'Approximate map alignment')}` : T('Allow location access for live guidance')}</small></div></div>
        <div class="cg-nav-meta"><span>${st.data.distanceVerified && p ? `${T('About')} ${p.meters} m · ${p.minutes} ${T('min walk')}` : T('Follow the marked campus path')}</span>
          <label class="cg-switch-row inline"><span>${T('Voice')}</span><input type="checkbox" class="cg-switch" data-change="voice" ${gd.voice ? 'checked' : ''}></label>
          <button type="button" class="btn sm" data-click="navGps" ${gd.active && !gd.error ? 'disabled' : ''}>${T(gd.error ? 'Retry GPS' : 'GPS on')}</button></div>
        <div class="cg-nav-caution">${T('Outdoor GPS can drift. Inside buildings, scan a posted checkpoint to set your position.')}</div>
        <button type="button" class="cg-nav-stop" data-click="navExit">${T('End navigation')}</button>`;
    }
    const navSignature = () => JSON.stringify([navStatus(), gd.voice, gd.active, gd.error, st.lang, gd.fix && Math.round(gd.fix.accuracy), guidePath()?.meters]);
    function renderNav() {
      const box = $('#cg-nav', root); if (!box) return;
      const dest = destination();
      if (!st.navigating || !dest) { box.innerHTML = ''; document.body.classList.remove('cg-noscroll'); return; }
      document.body.classList.add('cg-noscroll');
      box.innerHTML = html`<div class="cg-navscreen" role="dialog" aria-modal="true" aria-label="${T('Navigation to ') + P(dest.name)}">
        <div class="cg-nav-top"><button type="button" class="cg-nav-exit" data-click="navExit" aria-label="${T('Close navigation')}">${icon('back', 21)}</button>
          <div><span>${T('GUIDING TO')}</span><strong>${P(dest.name)}</strong></div><span class="cg-nav-live"><span></span>${T('LIVE')}</span></div>
        <div class="cg-nav-map"><div data-map-slot></div></div><div class="cg-nav-bottom" id="cg-nav-bottom">${navBottom()}</div></div>`.s;
      if (!navMap) navMap = MapView(g);
      attachMap(box, navMap, mapProps());
      navSig = navSignature();
    }
    function updateNav() {
      const b = $('#cg-nav-bottom', root); if (!b) return;
      const sig = navSignature();
      if (sig !== navSig) { b.innerHTML = navBottom().s; navSig = sig; }
      if (navMap) navMap.update(mapProps());
    }

    // ---------------- modals ----------------
    function photoField(side, label) {
      const p = st.modal.photos[side];
      return html`<div class="cg-photo" data-photo="${side}"><strong>${label}</strong><span>${p ? (p.busy ? T('Preparing photo…') : p.name) : T('Take a photo or choose an image')}</span>
        ${p && p.url ? html`<img src="${p.url}" alt="${label} preview">` : ''}
        <div class="cg-photo-actions"><label class="btn sm">${icon('camera', 15)}${T('Take photo')}<input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" data-change="photo" data-side="${side}"></label>
          <label class="btn sm">${icon('upload', 15)}${T('Choose file')}<input type="file" accept="image/jpeg,image/png,image/webp" data-change="photo" data-side="${side}"></label></div>
        <small>${T('JPEG, PNG or WebP · up to 10 MB')}</small></div>`;
    }
    const closeBtn = () => html`<button type="button" class="cg-x" data-click="closeModal" aria-label="${T('Close')}">${icon('x', 20)}</button>`;
    function modalHtml() {
      const m = st.modal;
      if (m.type === 'scan') {
        return html`<div class="cg-modal" role="dialog" aria-modal="true" aria-label="${tx().scan}"><div class="cg-modal-head"><h2>${tx().scan}</h2>${closeBtn()}</div>
          <p class="cg-modal-p">${tx().exact} ${T('Enter only a location code printed beside a campus checkpoint. ID cards go to Visitor ID check-in.')}</p>
          <video id="cg-video" class="cg-video" autoplay playsinline muted hidden></video>
          <button type="button" class="btn primary block lg" data-click="beginScan">${ic('scan', 17)}${tx().camera}</button>
          <div class="cg-or"><span>${T('OR')}</span></div>
          <form class="cg-code-row" data-submit="code"><input class="input" name="code" placeholder="${tx().code}" aria-label="${tx().code}" autocomplete="off" autocapitalize="none" spellcheck="false"><button class="btn primary" type="submit">${tx().set}</button></form></div>`;
      }
      if (m.type === 'participate') {
        const e = st.data.events.find((x) => x.id === m.eventId) || { title: '' };
        return html`<div class="cg-modal" role="dialog" aria-modal="true" aria-label="${T('Participate') + ' ' + evText(e, 'title')}"><div class="cg-modal-head"><div><span class="cg-kicker">${T('EVENT PARTICIPATION')}</span><h2>${evText(e, 'title')}</h2></div>${closeBtn()}</div>
          ${m.reference ? html`<div class="cg-success">${ic('checkc', 40)}<h3>${T(m.already ? "You're already registered" : "You're registered")}</h3><p>${T('Keep this reference for the event desk:')}</p><strong class="cg-ref">${m.reference.slice(0, 8).toUpperCase()}</strong><button type="button" class="btn primary" data-click="closeModal">${T('Done')}</button></div>`
          : html`<form data-submit="participateForm" class="cg-form"><p class="cg-modal-p">${icon('clock', 15)} ${evText(e, 'time')}</p>
            <label>${T('Your name')}<input class="input" name="name" required maxlength="100" autocomplete="name"></label>
            <label>${T('College or organization')}<input class="input" name="institution" required maxlength="120" autocomplete="organization"></label>
            <label>${T('Email')}<input class="input" name="email" required maxlength="180" type="email" autocomplete="email"></label>
            <label class="cg-consent"><input type="checkbox" name="consent" required><span>${T('I agree to share these details with KPRIET event staff for registration and check-in.')}</span></label>
            ${m.error ? html`<p class="cg-error" role="alert">${T(m.error)}</p>` : ''}
            <button type="submit" class="btn primary block lg" ${m.busy ? 'disabled' : ''}>${T(m.busy ? 'Registering…' : 'Register for event')}</button></form>`}</div>`;
      }
      return html`<div class="cg-modal cg-id-modal" role="dialog" aria-modal="true" aria-label="${T('Visitor ID check-in')}"><div class="cg-modal-head"><div><span class="cg-kicker">${T('VISITOR CHECK-IN')}</span><h2>${T('Submit your college ID')}</h2></div>${closeBtn()}</div>
        ${m.received ? html`<div class="cg-success">${ic('checkc', 40)}<h3>${T('Photos received')}</h3><p>${T('Project administrators can review both sides in the admin portal. Show your physical ID at the desk if requested.')}</p><button type="button" class="btn primary" data-click="closeModal">${T('Done')}</button></div>`
        : html`<form data-submit="idcheck" class="cg-form"><p class="cg-modal-p cg-warn">${icon('info', 16)}<span>${T('This is a personal project, not an official KPRIET check-in. Submit only a college or event ID when requested. Do not upload Aadhaar, passport, driving licence or other government ID.')}</span></p>
          <div class="cg-two"><label>${T('Your name')}<input class="input" name="name" required maxlength="100" autocomplete="name"></label><label>${T('College / organisation')}<input class="input" name="institution" maxlength="100" autocomplete="organization"></label></div>
          <label>${T('Event')}<select class="input" name="eventName"><option value="">${T('General visit')}</option>${st.data.events.map((e) => html`<option value="${e.title}">${e.title}</option>`)}</select></label>
          <div class="cg-photo-grid">${photoField('front', T('Front of ID'))}${photoField('back', T('Back of ID'))}</div>
          <label class="cg-consent"><input type="checkbox" name="consent" required><span>${T('I agree to send both ID photos to the KPR Compass project administrators for event check-in. They can view and delete them in the protected admin portal.')}</span></label>
          <div id="cg-id-error">${m.error ? html`<p class="cg-error" role="alert">${T(m.error)}</p>` : ''}</div>
          <button type="submit" class="btn primary block lg" ${m.busy ? 'disabled' : ''}>${icon('camera', 17)}${T(m.busy ? 'Uploading…' : 'Submit both sides')}</button></form>`}</div>`;
    }
    function renderModal() {
      const box = $('#cg-modal', root); if (!box) return;
      if (!st.modal) { box.innerHTML = ''; return; }
      // keep typed values when the modal re-renders (language change, errors)
      const vals = {}; $$('input[name],select[name]', box).forEach((i) => { vals[i.name] = i.type === 'checkbox' ? i.checked : i.value; });
      box.innerHTML = html`<div class="cg-backdrop">${modalHtml()}</div>`.s;
      $$('input[name],select[name]', box).forEach((i) => { if (!(i.name in vals)) return; if (i.type === 'checkbox') i.checked = vals[i.name]; else i.value = vals[i.name]; });
    }
    function openModal(m) {
      stopScan(); st.modal = m; renderModal();
      const first = $('#cg-modal input:not([type=checkbox]):not([type=file])', root);
      if (first && m.type !== 'scan') first.focus();
    }
    function closeModal() { stopScan(); st.modal = null; renderModal(); }
    function setIdError(msg) { if (!st.modal) return; st.modal.error = msg; const b = $('#cg-id-error', root); if (b) b.innerHTML = msg ? html`<p class="cg-error" role="alert">${T(msg)}</p>`.s : ''; }

    async function submitParticipation(form) {
      const m = st.modal; if (!m || m.busy) return;
      const f = App.formData(form);
      m.busy = true; m.error = ''; renderModal();
      try {
        const r = await api.post(`/api/campus/${cid}/participations`, { eventId: m.eventId, name: f.name, institution: f.institution, email: f.email, consent: !!f.consent });
        m.reference = (r && r.id) || 'Registered'; m.already = !!r && r.status === 'already_registered';
      } catch (e) { m.error = e.message || 'Registration failed.'; }
      m.busy = false; if (st.modal === m) renderModal();
    }
    async function submitId(form) {
      const m = st.modal; if (!m || m.busy) return;
      const f = App.formData(form);
      if (!(m.photos.front && m.photos.front.url) || !(m.photos.back && m.photos.back.url) || !f.consent) { setIdError('Both sides and consent are required.'); return; }
      m.busy = true; m.error = ''; renderModal();
      try {
        await api.post(`/api/campus/${cid}/id-checkins`, { name: f.name, institution: f.institution, eventName: f.eventName, front: m.photos.front.url, back: m.photos.back.url, consent: true });
        m.received = true; m.photos = { front: null, back: null };
      } catch (e) { m.error = e.message || 'Upload failed.'; }
      m.busy = false; if (st.modal === m) renderModal();
    }

    // ---------------- handlers (data-click / data-change / data-input / data-submit) ----------------
    const handlers = {
      home: () => { st.view = 'explore'; st.target = ''; st.query = ''; renderAll(true); },
      view: (el) => { st.view = el.dataset.v; renderAll(true); },
      lang: (el) => { st.lang = el.dataset.l === 'ta' ? 'ta' : 'en'; ls.set('kpr-compass-lang', st.lang); gd.spoken = ''; renderAll(); },
      gpsToggle: () => { st.mode = 'layout'; if (gd.active) gpsStop(); else { st.originMode = 'gps'; gpsStart(); } renderAll(); },
      clearSearch: () => { st.query = ''; const q = $('#cg-q', root); if (q) { q.value = ''; q.focus(); } renderExploreBody(); },
      scanOpen: () => openModal({ type: 'scan' }),
      idOpen: () => openModal({ type: 'id', photos: { front: null, back: null } }),
      pick: (el) => pick(el.dataset.id),
      pickEvent: (el) => pickEvent(el.dataset.id),
      pickRoom: (el) => pickRoom(el.dataset.id),
      allPlaces: () => { st.target = ''; st.selectedEvent = ''; st.selectedRoom = ''; renderAll(); },
      navStart: () => { st.mode = 'layout'; st.originMode = 'gps'; gpsStart(); st.navigating = true; renderAll(); },
      navExit: () => { st.navigating = false; gpsStop(); renderAll(); },
      navGps: () => { gpsStart(true); liveUpdate(); },
      retryGps: () => { gpsStart(true); renderAll(); },
      share: () => share(),
      mode: (el) => {
        st.mode = el.dataset.mode === 'google' ? 'google' : 'layout';
        const keep = map.saveScroll(), box = $('#cg-mappanel', root);
        if (box) { box.innerHTML = mapPanel().s; attachMap(box, map, mapProps(), keep); }
      },
      save: (el) => { saveToggle(el.dataset.id); renderAll(); },
      participate: (el) => openModal({ type: 'participate', eventId: el.dataset.id }),
      evtab: (el) => { st.eventTab = el.dataset.tab; renderAll(); },
      closeModal: () => closeModal(),
      beginScan: () => beginScan(),
      dismiss: () => { const b = $('#cg-toast', root); if (b) b.innerHTML = ''; },
      search: (el) => { st.query = el.value; if (el.value) { st.target = ''; st.selectedRoom = ''; st.selectedEvent = ''; } renderExploreBody(); },
      origin: (el) => { if (el.value === 'gps') { st.originMode = 'gps'; gpsStart(); } else { st.originMode = 'manual'; st.start = el.value; gpsStop(); } renderAll(); },
      voice: (el) => { gd.voice = el.checked; gd.spoken = ''; if (!gd.voice && 'speechSynthesis' in window) window.speechSynthesis.cancel(); speak(); },
      accessible: (el) => { st.accessible = el.checked; gd.cache = null; renderAll(); },
      photo: async (el) => {
        const side = el.dataset.side, file = el.files && el.files[0]; if (!file || !st.modal || st.modal.type !== 'id') return;
        const m = st.modal;
        const redraw = () => { const b = $(`[data-photo="${side}"]`, root); if (b && st.modal === m) b.outerHTML = photoField(side, T(side === 'front' ? 'Front of ID' : 'Back of ID')).s; };
        if (file.size > 10_000_000) { setIdError('Each photo must be under 10 MB.'); el.value = ''; return; }
        setIdError('');
        m.photos[side] = { name: file.name, busy: true }; redraw();
        try { const url = await toJpeg(file); m.photos[side] = { name: file.name, url }; redraw(); }
        catch (e) { m.photos[side] = null; redraw(); setIdError(e.message || 'Could not read this image. Try another photo.'); }
      },
      code: (form) => checkpoint(form.elements.code.value),
      participateForm: (form) => submitParticipation(form),
      idcheck: (form) => submitId(form),
    };

    // ---------------- mount ----------------
    function mount() {
      const app = $('#app');
      app.innerHTML = '<div class="cg-app" id="cg-root"><div id="cg-topbar"></div><main class="cg-main" id="cg-main"></main><div id="cg-mbar"></div><div id="cg-modal"></div><div id="cg-nav"></div><div id="cg-toast" class="cg-toast-wrap" aria-live="polite"></div></div>';
      root = $('#cg-root', app);
      map = MapView(g);
      bind(root, handlers);
      root.addEventListener('click', (ev) => { if (ev.target.classList && ev.target.classList.contains('cg-backdrop')) closeModal(); });
      keyHandler = (e) => { if (e.key === 'Escape') { if (st.modal) closeModal(); else if (st.navigating) handlers.navExit(); } };
      document.addEventListener('keydown', keyHandler);

      // ?checkpoint= sets the starting point (printed QR checkpoints); ?to= opens directions.
      const cp = query.checkpoint ? checkpointFromText(query.checkpoint) : null;
      if (cp) { st.start = cp.id; st.originMode = 'manual'; }
      if (query.to) {
        const to = String(query.to);
        const ok = st.data.nodes.some((n) => n.id === to) ? ((st.target = to), true) : selectRoom(to) || selectEvent(to);
        if (ok && !cp) gpsStart();
      }
      renderAll(true);
      if (query.checkpoint && !cp) notify('Checkpoint code not found.');
      else if (cp) notify(T('Starting from ') + P(cp.name));
      if (query.to && !st.target) notify('Place not found. Showing all places.');

      timer = setInterval(poll, 60000);
      if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('/campus-sw.js').catch(() => {});
    }
    async function poll() {
      if (destroyed || document.hidden) return;
      try {
        const r = await api.get(`/api/campus/${cid}`);
        if (destroyed || !r || !r.data || !(r.data.version > st.data.version)) return;
        st.data = r.data; st.info = r; st.offlineCopy = false; gd.cache = null;
        ls.set(`cg.campus.${cid}`, r);
        if (st.target && !st.data.nodes.some((n) => n.id === st.target)) st.target = '';
        renderAll();
        notify('Campus information updated. Check your route and venue.');
      } catch { /* offline: keep the current copy */ }
    }
    function destroy() {
      if (destroyed) return;
      destroyed = true;
      gpsStop(); stopScan(); clearInterval(timer); clearTimeout(notifyTimer);
      document.removeEventListener('keydown', keyHandler);
      map.destroy(); if (navMap) navMap.destroy();
      document.body.classList.remove('cg-noscroll');
      document.documentElement.lang = 'en';
    }
    mount();
    return { destroy, cid };
  }

  // ======================================================================
  // Routes
  // ======================================================================
  function destroyCurrent() { if (current) { current.destroy(); current = null; } }
  window.addEventListener('hashchange', () => { if (current && !location.hash.startsWith(`#/campus/${current.cid}`)) destroyCurrent(); });

  function statusCard(inner) { $('#app').innerHTML = html`<div class="cg-app cg-status-page"><div class="cg-status-card">${App.logo(40)}${inner}</div></div>`.s; }

  route('/campus/:cid', async (p, q) => {
    destroyCurrent();
    const cid = String(Number(p.cid) || '');
    if (!cid) { go('#/universities'); return; }
    const ta = savedLang() === 'ta';
    statusCard(html`<p class="muted">${ta ? EXTRA_TA['Loading campus guide…'] : 'Loading campus guide…'}</p>`);
    let info = null, offline = false;
    try { info = await api.get(`/api/campus/${cid}`); ls.set(`cg.campus.${cid}`, info); }
    catch (e) {
      const cached = e.status === 0 ? ls.get(`cg.campus.${cid}`, null) : null;
      if (cached && cached.data && cached.college && CompassData.validCampus(cached.data)) { info = cached; offline = true; }
      else {
        if (!location.hash.startsWith(`#/campus/${cid}`)) return;
        statusCard(html`<h1>${ta ? EXTRA_TA['Campus guide unavailable'] : 'Campus guide unavailable'}</h1><p>${e.message || 'Unable to load the campus guide.'}</p>
          <div class="btn-row"><button class="btn primary" id="cg-retry">${icon('refresh', 16)} Retry</button><a class="btn" href="#/universities">Institutions</a>${state.me ? html`<a class="btn" href="${state.me.home}">Back to portal</a>` : ''}</div>`);
        const b = $('#cg-retry'); if (b) b.onclick = () => App.render();
        return;
      }
    }
    if (!location.hash.startsWith(`#/campus/${cid}`)) return; // navigated away while loading
    current = Guide(info, cid, q || {}, { offline });
  });

  route('/campus', async (p, q) => {
    destroyCurrent();
    if (!state.me) await App.loadMe();
    const me = state.me;
    if (!me) { go(App.loginHref()); return; }
    if (me.college && me.campusGuide) {
      const s = new URLSearchParams(q || {}).toString();
      location.replace(`#/campus/${me.college.id}${s ? '?' + s : ''}`);
      return;
    }
    const v = App.shell('#/campus');
    const manager = Array.isArray(me.permissions) && me.permissions.includes('manage_campus_guide');
    v.innerHTML = html`<div class="page-head"><div><h1>Campus Guide</h1><p>Maps, walking directions and events published by your college.</p></div></div>
      <div class="card card-pad cg-none"><span class="cg-none-icon">${icon('compass', 30)}</span><div><h2>${me.college ? `${me.college.name} has not published a campus guide yet` : 'Campus guides are published by each college'}</h2>
        <p class="muted">${me.college ? 'When your college publishes its campus map, walking routes and events, the guide opens here.' : 'Open a college from the institution directory to view its campus guide.'}</p>
        <div class="btn-row">${manager ? html`<a class="btn primary" href="#/admin/campus">${icon('settings', 16)} Set up the campus guide</a>` : ''}<a class="btn" href="#/universities">${icon('building', 16)} Browse institutions</a></div></div></div>`.s;
  });
})();
