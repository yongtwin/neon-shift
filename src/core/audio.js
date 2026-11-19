
/* =====================================================================
   Tiny WebAudio synth — no audio files. Every sound is a short tone sweep
   and/or filtered noise burst. Created lazily on the first user gesture.
   ===================================================================== */
export const SFX = (() => {
  let ctx = null, master = null, noiseBuf = null, muted = false;
  const lastT = {};

  function init() {
    try {
      if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.6;
      master.connect(ctx.destination);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    } catch { ctx = null; }
  }

  function tone(f0, f1, dur, type = 'square', vol = 0.06, delay = 0) {
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator(), gn = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    gn.gain.setValueAtTime(vol, t);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(gn); gn.connect(master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  function noise(dur, vol, f0, f1, type = 'lowpass', delay = 0, q = 0.8) {
    const t = ctx.currentTime + delay;
    const s = ctx.createBufferSource(); s.buffer = noiseBuf;
    const fl = ctx.createBiquadFilter(); fl.type = type; fl.Q.value = q;
    fl.frequency.setValueAtTime(f0, t);
    fl.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    const gn = ctx.createGain();
    gn.gain.setValueAtTime(vol, t);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(fl); fl.connect(gn); gn.connect(master);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
  }

  const S = {
    jump()    { tone(300, 640, 0.09, 'triangle', 0.07); },
    jump2()   { tone(420, 900, 0.10, 'triangle', 0.07); noise(0.08, 0.05, 3000, 6000, 'highpass'); },
    dash()    { noise(0.16, 0.10, 1400, 6000, 'bandpass'); tone(220, 90, 0.12, 'sawtooth', 0.04); },
    land()    { noise(0.07, 0.07, 700, 120); },
    slash(step = 1) {
      const k = 1 + (step - 1) * 0.16;
      noise(0.13, 0.13, 3200 * k, 700 * k, 'bandpass', 0, 1.2);
      tone(620 * k, 220 * k, 0.09, 'sawtooth', 0.045);
    },
    hit(power = 1) {                     // transient click + noise crack + sub thump (louder with power) + music duck
      const v = 1 + 0.25 * power;
      tone(2400, 900, 0.025, 'square', 0.07 * v);
      noise(0.10 + 0.05 * power, (0.22 + 0.06 * power) * v, 3000, 160);
      tone(190, 55, 0.11 + 0.03 * power, 'square', 0.11 * v);
      tone(85, 38, 0.12 + 0.04 * power, 'sine', 0.30 * v);
      if (power >= 3) { tone(60, 30, 0.22, 'sine', 0.35); noise(0.2, 0.18, 900, 80, 'lowpass', 0.02); }
      duck(power >= 3 ? 0.3 : 0.5, 0.15 + 0.04 * power);
    },
    kill() {
      noise(0.42, 0.30, 2200, 70);
      tone(380, 40, 0.34, 'sawtooth', 0.11);
      tone(900, 200, 0.14, 'square', 0.05, 0.02);
      tone(70, 30, 0.3, 'sine', 0.4);
      duck(0.25, 0.3);
    },
    lance()   { tone(140, 40, 0.3, 'sawtooth', 0.12); noise(0.3, 0.25, 5000, 200, 'bandpass', 0, 1.2); tone(70, 35, 0.25, 'sine', 0.35); duck(0.4, 0.2); },
    guardbreak() { tone(400, 60, 0.35, 'square', 0.1); noise(0.3, 0.28, 6000, 300, 'highpass'); tone(90, 40, 0.2, 'sine', 0.3); duck(0.4, 0.25); },
    parryPerfect() { tone(1760, 1700, 0.3, 'sine', 0.14); tone(2640, 2500, 0.35, 'sine', 0.1, 0.03); tone(880, 880, 0.25, 'triangle', 0.08); noise(0.08, 0.14, 9000, 4000, 'highpass'); duck(0.3, 0.45); },
    shoot()   { tone(820, 110, 0.13, 'sawtooth', 0.07); noise(0.08, 0.08, 4500, 900, 'highpass'); },
    bolt()    { noise(0.09, 0.12, 3000, 400); tone(520, 120, 0.09, 'square', 0.06); },
    eshoot()  { tone(500, 180, 0.12, 'square', 0.05); },
    charge()  { tone(180, 520, 0.38, 'sawtooth', 0.035); },
    warn()    { tone(900, 900, 0.05, 'square', 0.04); tone(1200, 1200, 0.05, 'square', 0.04, 0.08); },
    parry()   { tone(1500, 1300, 0.16, 'sine', 0.12); tone(2300, 2000, 0.22, 'sine', 0.09, 0.02); noise(0.06, 0.12, 8000, 3000, 'highpass'); },
    block()   { tone(150, 80, 0.12, 'square', 0.10); tone(70, 45, 0.1, 'sine', 0.25); noise(0.08, 0.14, 1400, 300, 'lowpass'); },   // dull thud (parry = bright chime)
    hurt()    { tone(260, 50, 0.24, 'sawtooth', 0.11); noise(0.2, 0.18, 1800, 120); },
    die()     { tone(500, 30, 0.7, 'sawtooth', 0.1); noise(0.7, 0.25, 3000, 60); },
    pickup()  { tone(660, 660, 0.12, 'triangle', 0.08); tone(880, 880, 0.12, 'triangle', 0.08, 0.1); tone(1320, 1320, 0.2, 'triangle', 0.08, 0.2); },
    xform()   { tone(240, 1500, 0.2, 'square', 0.05); noise(0.14, 0.10, 800, 7000, 'bandpass', 0, 2); tone(1800, 1800, 0.05, 'sine', 0.06, 0.18); },
    blink()   { tone(2000, 260, 0.16, 'sine', 0.10); noise(0.16, 0.12, 6000, 600, 'bandpass', 0, 1.5); },
    check()   { tone(520, 520, 0.08, 'triangle', 0.07); tone(780, 780, 0.12, 'triangle', 0.07, 0.07); },
    win()     { [523, 659, 784, 1046].forEach((f, i) => tone(f, f, 0.22, 'triangle', 0.08, i * 0.11)); },
    reboot()  { tone(120, 900, 0.4, 'sawtooth', 0.06); noise(0.3, 0.1, 400, 5000, 'bandpass'); },
    swap()    { tone(520, 700, 0.05, 'square', 0.04); },
  };

  function play(name, a) {
    if (!ctx || muted || !S[name]) return;
    const now = performance.now();
    if (lastT[name] && now - lastT[name] < 30) return;
    lastT[name] = now;
    try { S[name](a); } catch { /* audio must never break the game loop */ }
  }
  /* sidechain-style duck of the music bus so impacts cut through (depth = gain multiplier at the dip) */
  function duck(depth = 0.5, dur = 0.15) {
    if (!music || !music.duck) return;
    const g = music.duck.gain, t = ctx.currentTime;
    g.cancelScheduledValues(t); g.setValueAtTime(Math.min(g.value, depth), t); g.linearRampToValueAtTime(1, t + dur);
    lastDuck = { depth, dur, at: performance.now() };
  }
  let lastDuck = null;
  function toggleMute() { muted = !muted; if (master) master.gain.value = muted ? 0 : 0.6; return muted; }

  /* ------------------------------------------------------------------ EDM background track
     128 BPM, A minor (Am – F – C – G), 16-bar loop: 4-bar intro build, then the full drop.
     Synthesised live with a look-ahead step sequencer — no audio files. */
  const BPM = 128, STEP = 60 / BPM / 4, LOOP = 16;
  const ROOT = [55, 43.65, 65.41, 49];                                  // bass roots A1 F1 C2 G1
  const CHORD = [[220, 261.6, 329.6], [174.6, 220, 261.6], [261.6, 329.6, 392], [196, 246.9, 293.7]];
  const ARP = [0, 1, 2, 3, 2, 1, 0, 2, 1, 3, 2, 0, 3, 2, 1, 2];        // index into chord tones (3 = octave)
  let music = null;

  function startMusic() {
    if (!ctx) return;
    if (music) { music.paused = false; music.bus.gain.setTargetAtTime(music.on ? 0.42 : 0, ctx.currentTime, 0.1); return; }
    const duckG = ctx.createGain(); duckG.gain.value = 1; duckG.connect(master);
    const bus = ctx.createGain(); bus.gain.value = 0.42; bus.connect(duckG);
    const pump = ctx.createGain(); pump.gain.value = 1; pump.connect(bus);       // sidechain target (bass, pads, arp)
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; lp.Q.value = 6; lp.connect(pump);
    music = { bus, pump, lp, duck: duckG, on: true, paused: false, step: 0, next: ctx.currentTime + 0.1, timer: null };
    music.timer = setInterval(schedule, 25);
  }
  function stopMusic() { if (music) { music.paused = true; music.bus.gain.setTargetAtTime(0, ctx.currentTime, 0.15); } }
  function toggleMusic() {
    if (!music) return true;
    music.on = !music.on;
    music.bus.gain.setTargetAtTime(music.on && !music.paused ? 0.42 : 0, ctx.currentTime, 0.1);
    return music.on;
  }

  function schedule() {
    if (!music || music.paused || !music.on) { if (music) music.next = ctx.currentTime + 0.05; return; }
    while (music.next < ctx.currentTime + 0.12) { playStep(music.step, music.next); music.next += STEP; music.step = (music.step + 1) % (LOOP * 16); }
  }

  function voice(type, f, t, dur, vol, dest, attack = 0.005) {
    const o = ctx.createOscillator(), gn = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    gn.gain.setValueAtTime(0.0001, t); gn.gain.exponentialRampToValueAtTime(vol, t + attack);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(gn); gn.connect(dest); o.start(t); o.stop(t + dur + 0.02);
    return o;
  }
  function hit(t, dur, vol, f0, type, dest) {
    const s = ctx.createBufferSource(); s.buffer = noiseBuf;
    const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f0; fl.Q.value = 0.9;
    const gn = ctx.createGain(); gn.gain.setValueAtTime(vol, t); gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(fl); fl.connect(gn); gn.connect(dest); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
  }

  function playStep(i, t) {
    const bar = (i >> 4) % LOOP, s = i & 15, ch = bar & 3, intro = bar < 4, M = music;
    const build = intro ? (bar + (s / 16)) / 4 : 1;                    // filter opens through the intro
    M.lp.frequency.setTargetAtTime(intro ? 350 + build * 1100 : 1500 + 500 * Math.sin(i * 0.05), t, 0.08);
    /* kick (4 on the floor) + sidechain pump */
    if (!intro && s % 4 === 0) {
      const o = ctx.createOscillator(), gn = ctx.createGain();
      o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
      gn.gain.setValueAtTime(0.85, t); gn.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      o.connect(gn); gn.connect(M.bus); o.start(t); o.stop(t + 0.32);
      M.pump.gain.cancelScheduledValues(t); M.pump.gain.setValueAtTime(0.22, t); M.pump.gain.linearRampToValueAtTime(1, t + STEP * 3.2);
    }
    if (intro && bar === 3 && s >= 8 && s % 2 === 0) hit(t, 0.08, 0.05 + (s - 8) * 0.012, 2500, 'bandpass', M.bus);   // snare roll into the drop
    /* hats: open on the off-beat, ticks on 16ths */
    if (s % 4 === 2) hit(t, 0.09, 0.11, 7000, 'highpass', M.bus);
    else if (!intro) hit(t, 0.025, 0.03, 9000, 'highpass', M.bus);
    /* clap on 2 and 4 */
    if (!intro && (s === 4 || s === 12)) { hit(t, 0.14, 0.2, 1500, 'bandpass', M.bus); hit(t + 0.012, 0.1, 0.1, 2200, 'bandpass', M.bus); }
    /* pumping off-beat saw bass */
    if (!intro && s % 4 === 2) { voice('sawtooth', ROOT[ch] * 2, t, STEP * 1.7, 0.16, M.lp); voice('square', ROOT[ch], t, STEP * 1.7, 0.08, M.lp); }
    /* chord stab pad at the top of each bar */
    if (s === 0) for (const f of CHORD[ch]) { voice('sawtooth', f, t, STEP * 15, 0.035, M.lp, 0.04); voice('sawtooth', f * 1.006, t, STEP * 15, 0.03, M.lp, 0.04); }
    /* gated 16th arpeggio */
    const note = CHORD[ch][ARP[s] % 3] * (ARP[s] === 3 ? 2 : 1) * (bar % 2 ? 2 : 1);
    voice('square', note, t, STEP * 0.8, intro ? 0.02 + 0.02 * build : 0.035, M.lp);
  }

  return { init, play, duck, toggleMute, startMusic, stopMusic, toggleMusic, get muted() { return muted; }, get lastDuck() { return lastDuck; } };
})();
