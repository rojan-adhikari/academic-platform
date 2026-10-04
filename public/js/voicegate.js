/* Voice gate: keeps voice input usable in a noisy staff room.
   Browser speech recognition hears everyone in the room, so every recognised phrase is checked against the
   microphone level measured while it was spoken. Only speech clearly louder than the room's background
   (the operator close to the microphone) is accepted; quieter chatter further away is ignored.
   The gate also rejects low-confidence recognitions and offers hold-to-talk. */
(function () {
  'use strict';
  const KEY = 'nerd-voice-settings';
  const DEFAULTS = { sensitivity: 50, mode: 'toggle', gate: true };
  const FRAME_MS = 40;
  const HISTORY_MS = 15000;
  const MIN_LOUD_MS = 240;        // at least this much near-speaker speech per phrase
  const FLOOR_MARGIN_DB = 10;     // near speech must stand this far above the room's background
  const MIN_CONFIDENCE = 0.55;    // below this a recognition is treated as unclear

  function load() { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { ...DEFAULTS }; } }
  const settings = load();
  function save() { try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* storage unavailable */ } }

  // Sensitivity 0 (strict, only a loud close voice) to 100 (lenient) maps to an absolute level of -22 to -58 dBFS.
  const absThreshold = () => -22 - (settings.sensitivity / 100) * 36;

  function create() {
    let stream = null, ctx = null, analyser = null, timer = null, buf = null;
    let starting = null;
    const hist = []; // { t, db }
    let current = -100;
    const listeners = new Set();

    function floor() {
      // The room's background: the 30th percentile of the last 8 seconds (speech pauses dominate this).
      const since = performance.now() - 8000;
      const xs = hist.filter((h) => h.t >= since).map((h) => h.db).sort((a, b) => a - b);
      if (xs.length < 10) return -70;
      return xs[Math.floor(xs.length * 0.3)];
    }
    const threshold = () => Math.max(absThreshold(), floor() + FLOOR_MARGIN_DB);

    function tick() {
      analyser.getFloatTimeDomainData(buf);
      let sum = 0; for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      const rms = Math.sqrt(sum / buf.length);
      current = rms > 0 ? Math.max(-100, 20 * Math.log10(rms)) : -100;
      const t = performance.now();
      hist.push({ t, db: current });
      while (hist.length && hist[0].t < t - HISTORY_MS) hist.shift();
      const thr = threshold();
      listeners.forEach((fn) => { try { fn({ db: current, threshold: thr, floor: floor(), near: current >= thr }); } catch { /* listener gone */ } });
    }

    async function start() {
      if (stream) return true;
      if (starting) return starting;
      if (!navigator.mediaDevices?.getUserMedia) return false;
      starting = (async () => {
        try {
          // Echo cancellation and noise suppression clean up our level measurement; auto gain is off so that
          // distance from the microphone still shows up as a lower level.
          stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false, channelCount: 1 } });
          ctx = new (window.AudioContext || window.webkitAudioContext)();
          const src = ctx.createMediaStreamSource(stream);
          // Keep only the speech band so fans, traffic hum and hiss do not count as voice.
          const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 180;
          const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3800;
          analyser = ctx.createAnalyser(); analyser.fftSize = 1024;
          src.connect(hp); hp.connect(lp); lp.connect(analyser);
          buf = new Float32Array(analyser.fftSize);
          timer = setInterval(tick, FRAME_MS);
          return true;
        } catch { stop(); return false; } finally { starting = null; }
      })();
      return starting;
    }
    function stop() {
      if (timer) clearInterval(timer); timer = null;
      if (stream) stream.getTracks().forEach((t) => t.stop()); stream = null;
      if (ctx) ctx.close().catch(() => {}); ctx = null; analyser = null;
      hist.length = 0; current = -100;
    }

    // Was a phrase spoken between `from` and `to` (performance.now() times) by someone close to the microphone?
    function judge(from, to = performance.now()) {
      if (!settings.gate) return { ok: true, skipped: 'gate off' };
      if (!stream) return { ok: true, skipped: 'no level meter' };
      const thr = threshold();
      const xs = hist.filter((h) => h.t >= from - 300 && h.t <= to + 100);
      if (!xs.length) return { ok: true, skipped: 'no samples' };
      const loudMs = xs.filter((h) => h.db >= thr).length * FRAME_MS;
      const peak = Math.max(...xs.map((h) => h.db));
      return { ok: loudMs >= MIN_LOUD_MS, peak, threshold: thr, floor: floor(), loudMs };
    }

    // Pick the best alternative of a final SpeechRecognitionResult and check its confidence.
    function pick(result, accept) {
      const alts = []; for (let i = 0; i < result.length; i++) alts.push(result[i]);
      const usable = alts.filter((a) => a.transcript && a.transcript.trim());
      if (!usable.length) return { ok: false, reason: 'Nothing clear was heard.' };
      const chosen = (accept && usable.find((a) => accept(a.transcript))) || usable[0];
      // Chrome reports 0 when it has no estimate; only a real low score counts against a phrase.
      if (chosen.confidence > 0 && chosen.confidence < MIN_CONFIDENCE) return { ok: false, transcript: chosen.transcript, confidence: chosen.confidence, reason: `The recognition was unclear (${Math.round(chosen.confidence * 100)}% confident).` };
      return { ok: true, transcript: chosen.transcript, confidence: chosen.confidence };
    }

    return { start, stop, judge, pick, threshold, floor, onLevel: (fn) => { listeners.add(fn); return () => listeners.delete(fn); }, get active() { return !!stream; }, get level() { return current; } };
  }

  const reason = (j) => `Ignored: this sounded like background speech, not the person at the microphone (${Math.round(j.peak)} dB, needs ${Math.round(j.threshold)} dB). Speak closer to the microphone, or raise the sensitivity.`;

  // A compact control: live level meter with the acceptance line, sensitivity slider, capture mode and gate switch.
  function controls(gate, { onChange, holdLabel = 'Hold Ctrl+Alt' } = {}) {
    const el = document.createElement('div');
    el.className = 'vg';
    el.innerHTML = `<div class="vg-meter" role="meter" aria-label="Microphone level" aria-valuemin="-80" aria-valuemax="0" aria-valuenow="-80">
        <div class="vg-fill"></div><div class="vg-thr" title="Speech must reach this line to count"></div></div>
      <span class="vg-state small muted">Mic idle</span>
      <label class="vg-field small">Sensitivity <input type="range" min="0" max="100" step="5" class="vg-sens" aria-label="Microphone sensitivity"></label>
      <label class="vg-field small"><select class="input vg-mode" aria-label="How voice capture starts"><option value="toggle">Press to start / stop</option><option value="hold">${holdLabel} to talk</option></select></label>
      <label class="vg-field small vg-check"><input type="checkbox" class="vg-gate"> Nearest voice only</label>`;
    const fill = el.querySelector('.vg-fill'), thrEl = el.querySelector('.vg-thr'), stateEl = el.querySelector('.vg-state'), meter = el.querySelector('.vg-meter');
    const sens = el.querySelector('.vg-sens'), mode = el.querySelector('.vg-mode'), gateBox = el.querySelector('.vg-gate');
    sens.value = settings.sensitivity; mode.value = settings.mode; gateBox.checked = settings.gate;
    const pct = (db) => Math.max(0, Math.min(100, ((db + 80) / 80) * 100));
    const off = gate.onLevel(({ db, threshold, near }) => {
      if (!el.isConnected) { off(); return; }
      fill.style.width = pct(db) + '%'; thrEl.style.left = pct(threshold) + '%';
      fill.classList.toggle('near', near); meter.setAttribute('aria-valuenow', String(Math.round(db)));
      stateEl.textContent = near ? 'Hearing you' : db > threshold - 12 ? 'Background noise' : 'Quiet';
    });
    thrEl.style.left = pct(absThreshold()) + '%';
    sens.addEventListener('input', () => { settings.sensitivity = Number(sens.value); save(); thrEl.style.left = pct(gate.active ? gate.threshold() : absThreshold()) + '%'; onChange?.(settings); });
    mode.addEventListener('change', () => { settings.mode = mode.value; save(); onChange?.(settings); });
    gateBox.addEventListener('change', () => { settings.gate = gateBox.checked; save(); onChange?.(settings); });
    return el;
  }

  window.VoiceGate = { create, controls, settings, reason, MIN_CONFIDENCE };
})();
