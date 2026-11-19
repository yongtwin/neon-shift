/* =====================================================================
   Combat feel timers (logic only): hit-stop, screen shake, screen flash and
   perfect-parry slow-mo. All of these tick in REAL time (core/game.js
   `advance`), so they behave the same at any refresh rate.

   - Hit-stop freezes the simulation only; the loop, shake and HUD keep running,
     inputs are buffered. It is capped (HITSTOP_CAP) and always ends; the
     leftover of the frame that ends it is carried into the sim.
   - Shake is an envelope: amplitude `mag` art-px, quadratic fall-off over
     `dur = SHAKE_BASE + mag * SHAKE_PER_PX` seconds, biased along the hit
     direction (kx). shakeX/shakeY are integer art-pixel offsets for the camera.
   ===================================================================== */
export const HITSTOP_CAP = 0.2;
export const SHAKE_BASE = 0.12, SHAKE_PER_PX = 0.035;

export const Feel = {
  hitstop: 0,                 // seconds of frozen simulation remaining
  shake: 0, kx: 0, shakeX: 0, shakeY: 0,
  shakeAmp: 0, shakeT: 0, shakeDur: 0,
  flash: 0, flashCol: '#ffffff',
  slowT: 0,                   // perfect-parry slow motion remaining (real seconds)
  slowScale: 0.3,
  log: null,                  // optional array: tests / tuning can record {t, kind, v}

  reset() { this.hitstop = 0; this.shake = 0; this.shakeAmp = 0; this.shakeX = 0; this.shakeY = 0; this.flash = 0; },
  stop(dur) {                                                  // hit-stop: freeze the sim briefly
    if (dur > this.hitstop) this.hitstop = Math.min(HITSTOP_CAP, dur);
    if (this.log) this.log.push({ kind: 'stop', v: dur });
  },
  kick(mag, dirX = 0) {                                        // start (or upgrade) a shake
    if (mag >= this.shake) {
      this.shakeAmp = mag; this.shake = mag; this.shakeT = 0; this.shakeDur = SHAKE_BASE + mag * SHAKE_PER_PX; this.kx = dirX;
      if (this.log) this.log.push({ kind: 'kick', v: mag });
    }
  },
  screenFlash(a, col = '#ffffff') { this.flash = Math.max(this.flash, a); this.flashCol = col; },
  slowmo(t) { this.slowT = Math.max(this.slowT, t); },
  updateScreen(dt) {                                           // runs even during hit-stop so shake still plays out
    if (this.shakeAmp > 0) {
      this.shakeT += dt;
      const u = this.shakeT / this.shakeDur;
      if (u >= 1) { this.shakeAmp = 0; this.shake = 0; this.shakeX = 0; this.shakeY = 0; }
      else {
        const s = this.shakeAmp * (1 - u) * (1 - u);
        this.shake = s;
        const osc = Math.cos(this.shakeT * 70);                // fast oscillation reads as impact, not drift
        this.shakeX = Math.round(s * (this.kx ? this.kx * 0.75 * osc : osc * 0.7) + s * (Math.random() - 0.5) * 0.6);
        this.shakeY = Math.round(s * (Math.random() - 0.5) * 0.9);
      }
    } else { this.shake = 0; this.shakeX = 0; this.shakeY = 0; }
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 7);
  },
};
