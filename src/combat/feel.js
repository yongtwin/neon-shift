/* Combat feel timers (logic only): hit-stop, screen shake, screen flash and perfect-parry slow-mo.
   Hit-stop freezes the simulation only; the loop, shake and HUD keep running. */
export const Feel = {
  hitstop: 0,                 // seconds of frozen simulation remaining
  shake: 0, kx: 0, shakeX: 0, shakeY: 0,
  flash: 0, flashCol: '#ffffff',
  slowT: 0,                   // perfect-parry slow motion remaining

  reset() { this.hitstop = 0; this.shake = 0; this.flash = 0; },
  stop(dur) { if (dur > this.hitstop) this.hitstop = Math.min(0.14, dur); },       // hit-stop: freeze the sim briefly
  kick(mag, dirX = 0) { if (mag > this.shake) { this.shake = mag; } this.kx = dirX; },
  screenFlash(a, col = '#ffffff') { this.flash = Math.max(this.flash, a); this.flashCol = col; },
  slowmo(t) { this.slowT = Math.max(this.slowT, t); },
  updateScreen(dt) {                                      // runs even during hit-stop so shake still plays out
    if (this.shake > 0.05) {
      this.shake *= Math.exp(-dt * 13);
      this.shakeX = Math.round((Math.random() * 2 - 1) * this.shake + this.kx * this.shake * 0.8);
      this.shakeY = Math.round((Math.random() * 2 - 1) * this.shake * 0.7);
    } else { this.shake = 0; this.shakeX = 0; this.shakeY = 0; }
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 7);
  },
};
