import { drawPlayer } from '../art/art.js';
import { R, crescent, disc, g, glow, line, makeCanvas, ring, text, textW, withCtx } from '../art/pixel.js';
import { Feel } from '../combat/feel.js';
import { TAU, easeOut, lerp, rnd } from '../core/util.js';
import { sx, sy } from '../render/render.js';

/* =====================================================================
   Combat juice: pooled particles, sword slashes, afterimages, popup text,
   beams, screen shake, screen flash and the global hit-stop timer.
   Everything is pooled / bounded so long fights never allocate per frame.
   ===================================================================== */
export const PT = { SPARK: 0, CHIP: 1, RING: 2, PUFF: 3, FLASH: 4, DEBRIS: 5, BIT: 6 };
export const POOL = 700;

export const FX = {
  /* hit-stop / shake / flash timers live in combat/feel.js; mirrored here so FX.<field> (window.NS.FX) keeps working */
  get hitstop() { return Feel.hitstop; }, set hitstop(v) { Feel.hitstop = v; },
  get shake() { return Feel.shake; }, set shake(v) { Feel.shake = v; },
  get kx() { return Feel.kx; }, set kx(v) { Feel.kx = v; },
  get shakeX() { return Feel.shakeX; }, set shakeX(v) { Feel.shakeX = v; },
  get shakeY() { return Feel.shakeY; }, set shakeY(v) { Feel.shakeY = v; },
  get flash() { return Feel.flash; }, set flash(v) { Feel.flash = v; },
  get flashCol() { return Feel.flashCol; }, set flashCol(v) { Feel.flashCol = v; },
  parts: [], slashes: [], ghosts: [], texts: [], beams: [],
  cursor: 0, live: 0,

  init() {
    this.parts.length = 0;
    for (let i = 0; i < POOL; i++) this.parts.push({ on: false, k: 0, x: 0, y: 0, vx: 0, vy: 0, g: 0, life: 0, max: 1, c: '#fff', c2: null, sz: 1, r0: 0, r1: 0, rot: 0, vr: 0, drag: 0, tx: 0, ty: 0 });
    this.reset();
  },
  reset() {
    for (const p of this.parts) p.on = false;
    this.slashes.length = 0; this.ghosts.length = 0; this.texts.length = 0; this.beams.length = 0;
    Feel.reset();
  },

  stop(dur) { Feel.stop(dur); },
  kick(mag, dirX = 0) { Feel.kick(mag, dirX); },
  screenFlash(a, col = '#ffffff') { Feel.screenFlash(a, col); },

  alloc() {
    for (let n = 0; n < POOL; n++) {
      const i = (this.cursor + n) % POOL, p = this.parts[i];
      if (!p.on) { this.cursor = (i + 1) % POOL; return p; }
    }
    const p = this.parts[this.cursor]; this.cursor = (this.cursor + 1) % POOL; return p;   // pool full: recycle oldest slot
  },
  add(k, x, y, vx, vy, life, c, o) {
    const p = this.alloc();
    p.on = true; p.k = k; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.life = life; p.max = life; p.c = c;
    p.c2 = null; p.g = 0; p.sz = 1; p.r0 = 0; p.r1 = 0; p.rot = 0; p.vr = 0; p.drag = 0;
    if (o) for (const key in o) p[key] = o[key];
    return p;
  },

  /* ---- emitters ---- */
  spark(x, y, ang, spd, life, c, o) { return this.add(PT.SPARK, x, y, Math.cos(ang) * spd, Math.sin(ang) * spd, life, c, o); },
  ring(x, y, r0, r1, life, c) { this.add(PT.RING, x, y, 0, 0, life, c, { r0, r1 }); },
  disc(x, y, r, life, c) { this.add(PT.FLASH, x, y, 0, 0, life, c, { r0: r }); },
  puff(x, y, vx, vy, life, c, r = 3) { this.add(PT.PUFF, x, y, vx, vy, life, c, { r0: r, r1: r * 1.8, drag: 3 }); },

  hitSparks(x, y, dirX, power, c1, c2) {                 // directional spark fan + impact flash
    const n = 7 + power * 4;
    for (let i = 0; i < n; i++) {
      const base = dirX > 0 ? 0 : Math.PI, ang = base + rnd(-0.9, 0.9) + (i % 3 === 0 ? rnd(-1.2, 1.2) : 0);
      this.spark(x, y, ang, rnd(6, 13 + power * 4), rnd(0.14, 0.3), i % 2 ? c1 : c2, { g: 12, c2: '#ffffff' });
    }
    this.disc(x, y, 4 + power * 3, 0.1, '#ffffff');
    if (power >= 2) this.ring(x, y, 3, 14 + power * 5, 0.18, c1);
  },
  burst(x, y, n, c, spd = 8) {
    for (let i = 0; i < n; i++) this.spark(x, y, rnd(0, TAU), rnd(spd * 0.4, spd), rnd(0.15, 0.4), c, { g: 14 });
  },
  dust(x, y, n, dir = 0) {
    for (let i = 0; i < n; i++) this.puff(x + rnd(-0.3, 0.3), y + 0.08, dir * rnd(1, 3) + rnd(-1.5, 1.5), rnd(0.2, 1.4), rnd(0.2, 0.38), '#7f93bd', rnd(1.5, 3));
  },
  debris(x, y, n, cols, spd = 9) {
    for (let i = 0; i < n; i++) this.add(PT.DEBRIS, x + rnd(-0.3, 0.3), y + rnd(-0.2, 0.5), rnd(-spd, spd), rnd(2, spd * 1.3), rnd(0.5, 0.95), cols[i % cols.length], { g: 26, sz: rnd(1.5, 3.2), rot: rnd(0, TAU), vr: rnd(-14, 14) });
    for (let i = 0; i < n; i++) this.add(PT.CHIP, x, y + 0.5, rnd(-spd, spd) * 0.8, rnd(1, spd), rnd(0.4, 0.8), cols[(i + 1) % cols.length], { g: 22, sz: 1 + (i % 2) });
  },
  bits(x, y, c, n = 10) {                                // data-bits that stream inward (chip transformation)
    for (let i = 0; i < n; i++) {
      const a = rnd(0, TAU), d = rnd(1.0, 1.9);
      this.add(PT.BIT, x + Math.cos(a) * d, y + Math.sin(a) * d, 0, 0, rnd(0.18, 0.3), c, { tx: x, ty: y, sz: 1 + (i % 2) });
    }
  },
  slash(o) { if (this.slashes.length < 8) this.slashes.push(o); },
  ghost(snap, color, life, alpha) { if (this.ghosts.length < 14) this.ghosts.push({ s: snap, c: color, life, max: life, a: alpha }); },
  text(str, x, y, c, life = 0.8) { if (this.texts.length < 8) this.texts.push({ s: str, x, y, c, life, max: life }); },
  beam(x0, y0, x1, y1, c1, c2, life, w = 3) { if (this.beams.length < 10) this.beams.push({ x0, y0, x1, y1, c1, c2, life, max: life, w }); },

  /* ---- simulation ---- */
  update(dt) {
    let live = 0;
    for (let i = 0; i < POOL; i++) {
      const p = this.parts[i];
      if (!p.on) continue;
      p.life -= dt;
      if (p.life <= 0) { p.on = false; continue; }
      live++;
      if (p.k === PT.BIT) {
        const u = 1 - p.life / p.max, k = Math.min(1, dt * 9 * (0.4 + u));
        p.x += (p.tx - p.x) * k; p.y += (p.ty - p.y) * k; continue;
      }
      if (p.drag) { const d = Math.exp(-p.drag * dt); p.vx *= d; p.vy *= d; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy -= p.g * dt; p.rot += p.vr * dt;
    }
    this.live = live;
    for (let i = this.slashes.length - 1; i >= 0; i--) {
      const s = this.slashes[i]; s.life -= dt;
      if (s.life <= 0) { this.slashes.splice(i, 1); continue; }
      if (s.follow) { s.x = s.follow.x + s.ox * s.f; s.y = s.follow.y + s.oy; }
    }
    for (let i = this.ghosts.length - 1; i >= 0; i--) { this.ghosts[i].life -= dt; if (this.ghosts[i].life <= 0) this.ghosts.splice(i, 1); }
    for (let i = this.texts.length - 1; i >= 0; i--) { const t = this.texts[i]; t.life -= dt; t.y += dt * 1.6; if (t.life <= 0) this.texts.splice(i, 1); }
    for (let i = this.beams.length - 1; i >= 0; i--) { this.beams[i].life -= dt; if (this.beams[i].life <= 0) this.beams.splice(i, 1); }
  },
  updateScreen(dt) { Feel.updateScreen(dt); },

  /* ---- drawing (called by the renderer; sx/sy are the world->screen helpers) ---- */
  drawBelow() {                                           // afterimages + slashes sit behind particles
    for (const gh of this.ghosts) {
      const u = gh.life / gh.max;
      drawPlayer(gh.s, sx(gh.s.x), sy(gh.s.y), { fill: gh.c, alpha: gh.a * u * u });
    }
  },
  slashCache: new Map(),
  slashSprite(s, uq) {                                    // crescents are rasterised once per (kind, facing, progress) then blitted
    const key = s.kind + '|' + s.f + '|' + uq;
    let e = this.slashCache.get(key);
    if (e) return e;
    const u = uq / 14, sweep = Math.min(1, u / 0.38), fade = u > 0.4 ? 1 - (u - 0.4) / 0.6 : 1;
    const aEnd = s.a0 + (s.a1 - s.a0) * easeOut(sweep), w = s.w * fade, size = (s.r + 8) * 2, C = size >> 1;
    const [cv, cx] = makeCanvas(size, size);
    if (w >= 1) withCtx(cx, () => {
      g.globalAlpha = 0.45 * fade; crescent(C, C, s.r + 2, s.a0, aEnd, w + 3, s.c1, s.f);
      g.globalAlpha = 1;
      crescent(C, C, s.r, s.a0, aEnd, w, s.c1, s.f);
      crescent(C, C, s.r - 1, s.a0, aEnd, w * 0.5, s.c2, s.f);
    });
    e = { cv, C }; this.slashCache.set(key, e);
    return e;
  },
  drawSlashes() {
    for (const s of this.slashes) {
      const uq = Math.min(13, Math.floor((1 - s.life / s.max) * 14));
      const e = this.slashSprite(s, uq);
      g.drawImage(e.cv, sx(s.x) - e.C, sy(s.y) - e.C);
    }
  },
  drawBeams() {
    for (const b of this.beams) {
      const u = b.life / b.max, w = Math.max(1, Math.round(b.w * u));
      const x0 = sx(b.x0), y0 = sy(b.y0), x1 = sx(b.x1), y1 = sy(b.y1);
      g.globalAlpha = 0.5 * u; line(x0, y0, x1, y1, w + 4, b.c1);
      g.globalAlpha = 1; line(x0, y0, x1, y1, w, b.c1); line(x0, y0, x1, y1, Math.max(1, w - 2), b.c2);
    }
  },
  drawParticles() {
    for (let i = 0; i < POOL; i++) {
      const p = this.parts[i];
      if (!p.on) continue;
      const u = 1 - p.life / p.max, X = sx(p.x), Y = sy(p.y);
      const col = p.c2 && u > 0.55 ? p.c2 : p.c;
      switch (p.k) {
        case PT.SPARK: {
          const len = 0.045, x2 = sx(p.x - p.vx * len), y2 = sy(p.y - p.vy * len);
          if (u > 0.75) g.globalAlpha = 1 - (u - 0.75) * 3;
          line(X, Y, x2, y2, 1, col); g.globalAlpha = 1; break;
        }
        case PT.CHIP: { const s = Math.max(1, Math.round(p.sz * (1 - u * 0.5))); R(X, Y, s, s, col); break; }
        case PT.DEBRIS: {
          const a = p.rot, h = p.sz;
          if (u > 0.7) g.globalAlpha = 1 - (u - 0.7) / 0.3;
          line(X - Math.cos(a) * h, Y - Math.sin(a) * h, X + Math.cos(a) * h, Y + Math.sin(a) * h, 2, col); g.globalAlpha = 1; break;
        }
        case PT.RING: { const r = lerp(p.r0, p.r1, easeOut(u)); g.globalAlpha = 1 - u * u; ring(X, Y, r, col, u < 0.5 ? 2 : 1); g.globalAlpha = 1; break; }
        case PT.PUFF: { const r = lerp(p.r0, p.r1, u); g.globalAlpha = 0.5 * (1 - u); disc(X, Y, r, col); g.globalAlpha = 1; break; }
        case PT.FLASH: { const r = Math.max(1, Math.round(p.r0 * (1 - u))); disc(X, Y, r, col); glow(X, Y, col, r * 2 + 4, 0.7 * (1 - u)); break; }
        case PT.BIT: { R(X, Y, p.sz, p.sz, col); break; }
      }
    }
  },
  drawTexts() {
    for (const t of this.texts) {
      const u = t.life / t.max, w = textW(t.s, 1), X = sx(t.x) - (w >> 1), Y = sy(t.y);
      g.globalAlpha = Math.min(1, u * 3);
      text(t.s, X, Y, t.c, 1, '#05070e');
      g.globalAlpha = 1;
    }
  },
  drawScreenFlash(W, H) {
    if (this.flash <= 0.01) return;
    g.globalAlpha = Math.min(0.85, this.flash); R(0, 0, W, H, this.flashCol); g.globalAlpha = 1;
  },
};
