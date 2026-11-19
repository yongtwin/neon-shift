'use strict';
/* =====================================================================
   Tiny WebAudio synth — no audio files. Every sound is a short tone sweep
   and/or filtered noise burst. Created lazily on the first user gesture.
   ===================================================================== */
const SFX = (() => {
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
    hit(power = 1) {
      noise(0.12 + 0.05 * power, 0.20 + 0.06 * power, 2600, 160);
      tone(190, 55, 0.11 + 0.03 * power, 'square', 0.10);
      tone(1500, 600, 0.04, 'square', 0.04);
    },
    kill() {
      noise(0.42, 0.30, 2200, 70);
      tone(380, 40, 0.34, 'sawtooth', 0.11);
      tone(900, 200, 0.14, 'square', 0.05, 0.02);
    },
    shoot()   { tone(820, 110, 0.13, 'sawtooth', 0.07); noise(0.08, 0.08, 4500, 900, 'highpass'); },
    bolt()    { noise(0.09, 0.12, 3000, 400); tone(520, 120, 0.09, 'square', 0.06); },
    eshoot()  { tone(500, 180, 0.12, 'square', 0.05); },
    charge()  { tone(180, 520, 0.38, 'sawtooth', 0.035); },
    warn()    { tone(900, 900, 0.05, 'square', 0.04); tone(1200, 1200, 0.05, 'square', 0.04, 0.08); },
    parry()   { tone(1500, 1300, 0.16, 'sine', 0.12); tone(2300, 2000, 0.22, 'sine', 0.09, 0.02); noise(0.06, 0.12, 8000, 3000, 'highpass'); },
    block()   { tone(260, 150, 0.09, 'square', 0.08); noise(0.07, 0.10, 3500, 600, 'bandpass'); },
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
  function toggleMute() { muted = !muted; if (master) master.gain.value = muted ? 0 : 0.6; return muted; }
  return { init, play, toggleMute, get muted() { return muted; } };
})();
