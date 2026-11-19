import { ACCENT, ENEMY_HEIGHT, drawEnemy, drawPlayer, makeChipIcon } from '../art/art.js';
import { ninjaAnchors } from '../art/ninja.js';
import { R, disc, g, glow, line, makeCanvas, mix, px, ring, setGfx, text, textW, withCtx } from '../art/pixel.js';
import { CHIP_INFO, CHIP_ORDER } from '../chips/chips.js';
import { dbgBoxes, hurtbox } from '../combat/combat.js';
import { Feel } from '../combat/feel.js';
import { Game } from '../core/game.js';
import { S, bullets, enemies, enemyBullets } from '../core/state.js';
import { PPU, seeded } from '../core/util.js';
import { FX } from '../effects/fx.js';
import * as STAGE1 from '../levels/stage1.js';
import { SCARF_N, muzzleWorld, player } from '../player/player.js';
import { Compositor } from './compositor.js';
import { HUD } from '../ui/hud.js';
import { SIGN_COL, SIGN_TEXT, THEMES, THEME_NAMES, buildStrip } from './themes.js';
export { SIGN_COL, SIGN_TEXT, buildStrip, Compositor };
/* =====================================================================
   Renderer. Everything is drawn into a low-resolution canvas (≈270px tall).
   The compositor (compositor.js) presents it through WebGL with bloom at an
   integer scale, or falls back to CSS nearest-neighbour scaling. Background layers,
   platforms and props are generated procedurally ONCE (seeded) and then
   blitted, so the per-frame cost is a few dozen drawImage calls.
   ===================================================================== */
export const view = { W: 480, H: 270, css: 3, gy: 200, camX: 3, camY: 0, cpx: 0, cpy: 0, sky: null, vig: null };
export const ART = { layers: [], plats: [], props: {}, ready: false, theme: 'district' };

export const sx = wx => Math.round(wx * PPU) - view.cpx + (view.W >> 1);
export const sy = wy => view.gy + view.cpy - Math.round(wy * PPU);

/* ------------------------------------------------------------------ themes */
const themeQ = /[?&]theme=(\w+)/.exec(location.search);                // dev override: ?theme=complex
if (themeQ && THEMES[themeQ[1]]) ART.theme = themeQ[1];
export function theme() { return THEMES[ART.theme] || THEMES.district; }
/** switch stage look: 'district' | 'complex' | 'core' (rebuilds sky, strips and platform sprites) */
export function setTheme(name) {
  if (!THEMES[name]) return false;
  ART.theme = name;
  if (S.gameEl) S.gameEl.style.background = theme().bg;
  if (ART.ready) { buildArt(); buildSky(); }
  return true;
}
export { THEME_NAMES };

/* ------------------------------------------------------------------ sizing */
export function resizeView() {
  const dpr = window.devicePixelRatio || 1;
  const cw = Math.max(1, S.gameEl.clientWidth), ch = Math.max(1, S.gameEl.clientHeight);
  const zq = /[?&]zoom=(\d+)/.exec(location.search);                  // dev override: ?zoom=4
  const dev = zq ? +zq[1] : Math.max(2, Math.round(ch * dpr / 270));  // device pixels per art pixel (integer → crisp)
  const css = dev / dpr;
  view.css = css; view.dev = dev;
  view.W = Math.min(760, Math.ceil(cw / css)); view.H = Math.ceil(ch / css);
  S.screenEl.width = view.W; S.screenEl.height = view.H;
  S.screenEl.style.width = (view.W * css) + 'px'; S.screenEl.style.height = (view.H * css) + 'px';
  S.screenCtx.imageSmoothingEnabled = false;
  view.gy = Math.round(view.H * 0.74);
  if (!Compositor.ready) Compositor.init(S.gameEl, S.screenEl);
  Compositor.resize(view.W, view.H, dev, css);
  buildSky(); buildVignette();
}

export function buildSky() { view.sky = theme().sky(view.W, view.H, view.gy); }

export function buildVignette() {
  const [c, x] = makeCanvas(view.W, view.H);
  const grad = x.createRadialGradient(view.W / 2, view.H * 0.5, view.H * 0.35, view.W / 2, view.H * 0.5, view.H * 0.95);
  grad.addColorStop(0, 'rgba(0,0,0,0)'); grad.addColorStop(1, 'rgba(2,4,12,0.55)');
  x.fillStyle = grad; x.fillRect(0, 0, view.W, view.H);
  view.vig = c;
}

export function buildBackground() { ART.layers = theme().layers(); }

/* ------------------------------------------------------------------ platforms */
export function buildPlatformSprite(x1, x2, py, idx) {
  const w = Math.round((x2 - x1) * PPU), r = seeded(500 + idx * 31), T = theme().plat;
  const ground = py === 0, h = ground ? 260 : 30;
  const [c, x] = makeCanvas(w, h);
  withCtx(x, () => {
    if (ground) {
      R(0, 0, w, h, T.base);
      const cols = T.tiles;
      for (let ty = 8; ty < h; ty += 20) for (let tx = 0; tx < w; tx += 20) {
        const col = cols[(r() * cols.length) | 0];
        R(tx, ty, 20, 20, col); R(tx, ty, 20, 1, T.seamL); R(tx, ty + 19, 20, 1, T.seamD); R(tx + 19, ty, 1, 20, T.seamD);
        if (r() < 0.55) { px(tx + 2, ty + 2, T.rivet); px(tx + 17, ty + 2, T.rivet); px(tx + 2, ty + 16, T.seamL); px(tx + 17, ty + 16, T.seamL); }
        if (r() < 0.07) { R(tx + 4, ty + 6, 12, 8, T.seamD); for (let s = 0; s < 4; s++) R(tx + 5, ty + 7 + s * 2, 10, 1, '#16213b'); }       // vents
        if (r() < 0.05) { R(tx + 6, ty + 5, 8, 10, '#06222c'); R(tx + 7, ty + 7, 6, 1, T.screen); R(tx + 7, ty + 10, 4, 1, T.top2); R(tx + 7, ty + 12, 5, 1, T.screen); }  // screens
      }
      for (let k = 0; k < Math.max(2, w / 160); k++) {                           // glowing conduit strips
        const ty = 8 + 20 * (2 + ((r() * 8) | 0)) + 9, tx = (r() * w * 0.7) | 0, len = 50 + ((r() * 160) | 0);
        const col = T.conduit[r() < 0.5 ? 0 : 1];
        x.globalAlpha = 0.22; R(tx, ty - 2, len, 5, col); x.globalAlpha = 1; R(tx, ty, len, 1, col);
      }
      for (let k = 0; k < w / 120; k++) {                                        // hazard bands
        const tx = (r() * (w - 60)) | 0, ty = 28;
        if (r() < 0.45) for (let i = 0; i < 48; i++) { R(tx + i, ty, 1, 6, ((i + 6) >> 2) % 2 ? T.hazard : '#10131f'); }
      }
      for (let k = 0; k < w / 90; k++) { const tx = (r() * w) | 0; R(tx, 8, 4, h, T.pipe); R(tx, 8, 1, h, T.pipeL); R(tx + 3, 8, 1, h, '#0a1020'); }   // pipes
      R(0, 0, w, 3, T.top); R(0, 3, w, 1, T.top2); R(0, 4, w, 2, mix(T.top2, T.base, 0.6)); R(0, 6, w, 2, mix(T.top2, T.base, 0.82));
      for (let i = 0; i < 6; i++) { x.globalAlpha = 0.07 * (i + 1); R(0, 60 + i * 34, w, 34, '#02040a'); x.globalAlpha = 1; }
      R(0, 0, 1, h, T.top2); R(w - 1, 0, 1, h, T.top2); R(1, 0, 1, h, '#0b1426'); R(w - 2, 0, 1, h, '#0b1426');
    } else {
      R(0, 6, w, 15, T.tiles[0]); R(0, 6, w, 1, T.seamL); R(0, 20, w, 1, T.seamD);
      for (let tx = 10; tx < w - 10; tx += 20) { R(tx, 9, 1, 9, T.seamL); }
      for (let i = 0; i < w; i++) { if ((i >> 3) % 2) R(i, 17, 1, 3, T.hazard); else R(i, 17, 1, 3, T.seamD); }
      R(0, 3, w, 3, T.top); R(0, 6, w, 1, T.top2); R(0, 2, w, 1, T.top3);
      for (let tx = 14; tx < w - 8; tx += 26) { R(tx, 22, 3, 3, T.lamp); x.globalAlpha = 0.35; R(tx - 1, 22, 5, 5, T.lamp); x.globalAlpha = 1; }
      R(0, 6, 2, 15, T.base); R(w - 2, 6, 2, 15, T.base);
      x.globalAlpha = 0.18; R(2, 21, w - 4, 4, T.lamp); x.globalAlpha = 1;
    }
  });
  return { c, x1, x2, py, ground, topOff: ground ? 3 : 4 };
}

/* ------------------------------------------------------------------ props */
export function buildProp(d) {
  const r = seeded(d.seed), col = d.hue ? '#ff3d9d' : '#2fe6ff';
  let w = 24, h = 24, light = null;
  const draw = fn => { const [c, x] = makeCanvas(w, h); withCtx(x, () => fn(x)); return { c, w, h, light, type: d.type }; };
  switch (d.type) {
    case 'lamp': w = 30; h = 58; light = { x: 24, y: 6, color: ART.theme === 'district' ? (d.hue ? '#ff3d9d' : '#7ff2ff') : theme().plat.glow, r: 22 };
      return draw(() => { R(4, 4, 3, 54, '#15203b'); R(4, 4, 1, 54, '#2a3d6a'); R(2, 54, 7, 4, '#0c1327'); R(4, 4, 22, 3, '#15203b'); R(4, 4, 22, 1, '#2a3d6a'); R(21, 6, 8, 4, '#0a0f1e'); R(22, 9, 6, 2, light.color); });
    case 'crates': w = 40; h = 36;
      return draw(() => {
        const box = (bx, by, bw, bh) => { R(bx, by, bw, bh, '#1c2744'); R(bx, by, bw, 1, '#324a80'); R(bx, by + bh - 1, bw, 1, '#0a0f1e'); R(bx, by, 1, bh, '#26385f'); R(bx + bw - 1, by, 1, bh, '#0a0f1e');
          line(bx + 2, by + 2, bx + bw - 3, by + bh - 3, 1, '#0f1730'); line(bx + bw - 3, by + 2, bx + 2, by + bh - 3, 1, '#0f1730'); R(bx + 1, by + (bh >> 1), bw - 2, 2, col); x_alpha(); };
        const x_alpha = () => {};
        box(2, 18, 22, 18); box(24, 22, 14, 14); box(7, 2, 16, 16);
      });
    case 'barrel': w = 16; h = 22;
      return draw(() => { R(1, 2, 14, 20, '#2b2230'); R(1, 2, 14, 1, '#4a3a50'); R(0, 5, 16, 14, '#2b2230'); R(0, 7, 16, 2, '#ffb02e'); R(0, 14, 16, 2, '#ffb02e'); R(2, 3, 1, 18, '#4a3a50'); R(13, 3, 2, 18, '#14101a'); });
    case 'terminal': w = 20; h = 36;
      return draw(() => { R(2, 14, 16, 22, '#111a30'); R(2, 14, 16, 1, '#2a3d6a'); R(4, 17, 12, 10, '#06222c'); for (let i = 0; i < 4; i++) R(5, 18 + i * 2, 4 + ((r() * 6) | 0), 1, col); R(4, 30, 12, 2, '#0a1020'); R(5, 31, 2, 1, '#ff3d9d'); R(9, 31, 2, 1, '#ffc43d'); });
    case 'vent': w = 24; h = 10;
      return draw(() => { R(1, 3, 22, 7, '#0e1629'); R(1, 3, 22, 1, '#26385f'); for (let i = 0; i < 6; i++) R(3 + i * 3, 5, 2, 4, '#060a14'); R(0, 9, 24, 1, '#050810'); });
    default: { w = 34; h = 40; const t = SIGN_TEXT[(r() * SIGN_TEXT.length) | 0]; light = { x: 17, y: 10, color: col, r: 20 };
      return draw(() => { R(16, 16, 2, 24, '#15203b'); R(3, 2, 28, 16, '#070b18'); R(3, 2, 28, 1, col); R(3, 17, 28, 1, col); R(3, 2, 1, 16, col); R(30, 2, 1, 16, col); text(t.slice(0, 5), 17 - (textW(t.slice(0, 5), 1) >> 1) + 1, 7, col, 1); }); }
  }
}

/* ------------------------------------------------------------------ stage data (contract: STAGES[i] / S.stage, see levels) */
/* levels/stage1.js is the live view of the CURRENT stage (arrays mutated in place, WORLD_W / EXIT_X are `let`) */
const STAGE1_DATA = {
  get id() { return (S.stage && S.stage.id) || 'stage1'; },
  get theme() { return (S.stage && S.stage.theme) || 'district'; },
  get worldW() { return STAGE1.WORLD_W; }, get exitX() { return STAGE1.EXIT_X; },
  get plats() { return STAGE1.PLAT; }, get pickups() { return STAGE1.PICKUPS; }, get checkpoints() { return STAGE1.CHECKPOINTS; },
  get spawns() { return STAGE1.SPAWNS || []; }, get arenas() { return STAGE1.ARENAS; },
  get hazards() { return STAGE1.HAZARDS || []; }, get decor() { return STAGE1.DECOR; }, get fg() { return STAGE1.FG; },
};
let STAGE = STAGE1_DATA;
/** the stage currently drawn (S.stage once the stage loader lands, stage-1 data until then) */
export function stage() { return STAGE; }
const platOf = q => Array.isArray(q) ? q : [q.x1, q.x2, q.y || 0];
function hashId(id) { let h = 2166136261; for (const ch of String(id)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; }

/** stage props by theme (all seeded from the stage id, identical every run) */
const PROP_SETS = {
  district: [['lamp', 0.28], ['crates', 0.22], ['barrel', 0.14], ['terminal', 0.16], ['vent', 0.1], ['sign', 0.1]],
  complex: [['crates', 0.3], ['barrel', 0.2], ['terminal', 0.25], ['vent', 0.25]],
  core: [['terminal', 0.45], ['vent', 0.35], ['crates', 0.2]],
};
const PROP_REMAP = { complex: { sign: 'terminal', lamp: 'lamp' }, core: { sign: 'terminal', barrel: 'vent' } };
function buildDecor(st) {
  const r = seeded(hashId(st.id) % 1e9), decor = [], fg = [];
  const keep = [...(st.spawns || []).map(q => q.x), ...(st.pickups || []).map(q => q.x), ...(st.checkpoints || []), st.exitX];
  const free = x => keep.every(k => Math.abs(k - x) > 2.4);
  const set = PROP_SETS[st.theme] || PROP_SETS.district;
  for (const q of st.plats || []) {
    const [x1, x2, y] = platOf(q); if (y !== 0) continue;
    let x = x1 + 2.5 + r() * 3;
    while (x < x2 - 2) {
      if (free(x)) {
        let roll = r(), type = set[set.length - 1][0];
        for (const [t, w] of set) { if (roll < w) { type = t; break; } roll -= w; }
        decor.push({ type, x, seed: (r() * 1e6) | 0, hue: r() < 0.5 ? 0 : 1 });
      }
      x += 3.2 + r() * 5.5;
    }
  }
  for (let x = 8; x < (st.worldW || 145); x += 18 + r() * 14) fg.push({ x, kind: r() < 0.6 ? 'pole' : 'cable', seed: (r() * 1e6) | 0 });
  return { decor, fg };
}

/** stage load hook (called by the stage loader): theme + platform / decor art from the stage description */
export function onStageLoad(st) {
  if (!st) return;
  if (st.plats && st !== S.stage) STAGE = st;                  // explicit stage object; otherwise keep the live stage1.js view
  if (st.theme && THEMES[st.theme] && !themeQ) ART.theme = st.theme;
  if (ART.ready) { buildArt(); if (view.sky) buildSky(); }
}

export function buildArt() {
  if (S.gameEl) S.gameEl.style.background = theme().bg;
  buildBackground();
  const st = stage();
  ART.plats = (st.plats || []).map((q, i) => { const [x1, x2, y] = platOf(q); return buildPlatformSprite(x1, x2, y, i); });
  // prefer the level's own decor (gameplay reads it, e.g. steam vents); generate from the stage only if it has none
  const D = st.decor && st.decor.length ? { decor: st.decor, fg: st.fg || [] } : buildDecor(st);
  ART.decor = D.decor; ART.fg = D.fg;
  const remap = PROP_REMAP[ART.theme] || {};                     // district-only props get a themed stand-in
  for (const d of ART.decor) d.sprite = buildProp(remap[d.type] ? { ...d, type: remap[d.type] } : d);
  ART.chipIcons = {}; for (const id of CHIP_ORDER) ART.chipIcons[id] = makeChipIcon(id);
  ART.ready = true;
}

/* ------------------------------------------------------------------ frame */
export function tileXs(par, sw, cb) {
  const x0 = -((((view.cpx * par) % sw) + sw) % sw);
  for (let xx = Math.round(x0); xx < view.W; xx += sw) cb(xx);
}
export function drawStrip(L) {
  const base = view.gy + Math.round(view.cpy * L.par) + L.dy;
  if (base < view.H) R(0, base, view.W, view.H - base + 1, L.bottom);
  tileXs(L.par, L.w, xx => g.drawImage(L.c, xx, base - L.h));
  const tm = Game.time;
  for (const l of L.lights) {
    let a;
    if (l.kind === 'beacon') a = ((tm * 1.1 + l.ph) % 1) < 0.35 ? 1 : 0.0;
    else { a = 0.5 + 0.22 * Math.sin(tm * 2.1 + l.ph); if (((tm * 0.53 + l.ph) % 1) < 0.025) a *= 0.15; }
    if (a <= 0.02) continue;
    tileXs(L.par, L.w, xx => { const X = xx + l.x, Y = base - L.h + l.y; if (X > -30 && X < view.W + 30) { glow(X, Y, l.color, l.r, a * (l.kind === 'beacon' ? 1 : 0.42)); if (l.kind === 'beacon') px(X, Y, '#ff6a6a'); } });
  }
}


export function drawCars() { THEMES.district.ambient(view, Game.time, 1); }


export function drawPlatforms() {
  for (const P of ART.plats) {
    const X = sx(P.x1), Y = sy(P.py);
    if (X > view.W + 4 || X + P.c.width < -4) continue;
    g.drawImage(P.c, X, Y);
    if (P.ground) { g.globalAlpha = 0.2; R(X + 1, Y - 2, P.c.width - 2, 2, '#2fe6ff'); g.globalAlpha = 0.08; R(X + 1, Y - 5, P.c.width - 2, 3, '#2fe6ff'); g.globalAlpha = 1; }
    else { g.globalAlpha = 0.16; R(X + 2, Y - 2, P.c.width - 4, 2, '#7ff2ff'); g.globalAlpha = 1; }
  }
}

export function drawProps() {
  const tm = Game.time;
  for (const d of ART.decor || []) {
    const s = d.sprite, X = sx(d.x) - (s.w >> 1);
    if (X > view.W + 30 || X + s.w < -30) continue;
    const Y = sy(0) - s.h + (s.type === 'vent' ? 2 : 0);
    g.drawImage(s.c, X, Y);
    if (s.light) {
      const lx = X + s.light.x, ly = Y + s.light.y, fl = 0.8 + 0.2 * Math.sin(tm * 3 + d.seed);
      glow(lx, ly, s.light.color, s.light.r, 0.7 * fl);
      if (s.type === 'lamp') {                                                    // soft light cone on the street
        g.globalAlpha = 0.045; for (let k = 0; k < 30; k++) R(lx - 3 - k * 0.9, ly + 3 + k * 1.5, 7 + k * 1.8, 2, s.light.color); g.globalAlpha = 1;
      }
    }
    if (s.type === 'terminal') glow(X + 10, Y + 22, d.hue ? '#ff3d9d' : '#2fe6ff', 12, 0.35);
  }
}

export function drawCheckpoints() {
  const tm = Game.time;
  for (const cp of (stage().checkpoints || []).slice(1)) {
    const X = sx(cp), Y = sy(0), on = player.checkpoint >= cp;
    if (X < -30 || X > view.W + 30) continue;
    R(X - 1, Y - 44, 3, 44, '#15203b'); R(X - 1, Y - 44, 1, 44, '#2a3d6a');
    R(X - 4, Y - 48, 9, 5, '#0a0f1e'); R(X - 4, Y - 48, 9, 1, on ? '#2fe6ff' : '#34498c');
    R(X - 2, Y - 46, 5, 2, on ? '#7ff2ff' : '#26385f');
    if (on) { glow(X, Y - 46, '#2fe6ff', 20, 0.7 + 0.2 * Math.sin(tm * 4)); g.globalAlpha = 0.12; R(X - 2, 0, 5, Y - 46, '#2fe6ff'); g.globalAlpha = 1; }
    else glow(X, Y - 46, '#34498c', 8, 0.4);
  }
}

export function drawPickups() {
  const tm = Game.time;
  for (const pk of stage().pickups || []) {
    if (player.unlocked.has(pk.id)) continue;
    const A = ACCENT[pk.id], X = sx(pk.x), bob = Math.round(Math.sin(tm * 3 + pk.x) * 2), Y = sy(pk.y + 0.5) + bob;
    g.globalAlpha = 0.14 + 0.05 * Math.sin(tm * 5); R(X - 5, Y - 90, 11, 90 + (sy(0) - Y), A.m); g.globalAlpha = 1;       // light beam
    glow(X, Y, A.m, 30, 0.8);
    const ww = Math.max(3, Math.round(16 * Math.abs(Math.cos(tm * 2.4 + pk.x))));
    g.drawImage(ART.chipIcons[pk.id], X - (ww >> 1), Y - 8, ww, 16);
    ring(X, Y, 14 + Math.round(Math.sin(tm * 4) * 2), A.m, 1);
    const name = CHIP_INFO[pk.id].name; text(name, X - (textW(name) >> 1), Y - 24, A.l, 1, '#05070e');
    if (Math.random() < 0.15) px(X + ((Math.random() * 30 - 15) | 0), Y + ((Math.random() * 30 - 15) | 0), A.l);
  }
}

export function drawPortal() {
  const tm = Game.time, X = sx(stage().exitX), Y = sy(0);
  if (X < -60 || X > view.W + 60) return;
  const done = Game.kills >= (Game.totalEnemies || enemies.length);
  const col = '#2fe6ff';
  R(X - 17, Y - 5, 34, 5, '#0f1a33'); R(X - 17, Y - 5, 34, 1, '#2a3d6a');
  R(X - 16, Y - 74, 5, 70, '#15203b'); R(X + 11, Y - 74, 5, 70, '#15203b'); R(X - 16, Y - 74, 32, 5, '#15203b');
  R(X - 16, Y - 74, 32, 1, '#2a3d6a'); R(X - 11, Y - 70, 2, 66, col); R(X + 9, Y - 70, 2, 66, col);
  for (let yy = 0; yy < 64; yy += 2) {                                          // shimmering field
    const w = 16 + Math.round(Math.sin(tm * 6 + yy * 0.35) * 2), a = 0.28 + 0.18 * Math.sin(tm * 3 + yy * 0.2);
    g.globalAlpha = a; R(X - w + 8, Y - 68 + yy, w * 2 - 16, 2, yy % 6 < 2 ? '#e6ffff' : col); g.globalAlpha = 1;
  }
  glow(X, Y - 40, col, 46, 0.6 + 0.2 * Math.sin(tm * 3));
  const lbl = done ? 'EXIT OPEN' : 'EXIT'; text(lbl, X - (textW(lbl) >> 1), Y - 88, done ? '#ffe06b' : '#9fe9f5', 1, '#05070e');
}

export function drawArenaWalls() {
  const tm = Game.time;
  for (const a of stage().arenas || []) {
    const on = Game.arena === a, k = on ? Math.min(1, 1 - a.wallT / 0.4) : a.wallT / 0.5;
    if (k <= 0) continue;
    for (const wx of [a.x0, a.x1]) {
      const X = sx(wx), top = sy(0) - Math.round(200 * k);
      if (X < -20 || X > view.W + 20) continue;
      g.globalAlpha = 0.25 * k; R(X - 3, top, 7, sy(0) - top, '#ff3b4a'); g.globalAlpha = 1;
      for (let y = top; y < sy(0); y += 3) if (((y + (tm * 60 | 0)) % 9) < 5) R(X - 1, y, 3, 2, (y % 2) ? '#ff6a5a' : '#fff0c8');
      glow(X, sy(0) - 20, '#ff3b4a', 22, 0.6 * k);
      R(X - 4, sy(0) - 3, 9, 3, '#1b2238'); R(X - 4, sy(0) - 3, 9, 1, '#ff3b4a');
    }
  }
}

/* ------------------------------------------------------------------ hazards (laser grids, spikes) */
export function drawHazards() {
  const hz = stage().hazards; if (!hz || !hz.length) return;
  const tm = Game.time;
  for (const h of hz) {
    if (h.type === 'laser') {
      const X = sx(h.x), y0 = sy(h.y0 || 0), y1 = sy(h.y1 === undefined ? 4 : h.y1);
      if (X < -20 || X > view.W + 20) continue;
      const top = Math.min(y0, y1), bot = Math.max(y0, y1);
      const on = !!(h.active || h.solid || h.on), warn = h.warning ? Math.max(0.35, h.u || 0) : (h.warn || 0);
      for (const Y of [top - 4, bot]) { R(X - 4, Y, 9, 4, '#1b1d26'); R(X - 4, Y, 9, 1, '#4a4e5e'); R(X - 1, Y + 1, 3, 2, on ? '#ff3b4a' : warn ? '#ff8a4a' : '#5a1a22'); }
      if (on) {
        const fl = ((tm * 30) | 0) % 2;
        g.globalAlpha = 0.28; R(X - 3, top, 7, bot - top, '#ff3b4a'); g.globalAlpha = 1;
        for (let y = top; y < bot; y += 2) R(X - 1 - (fl && (y >> 1) % 3 === 0 ? 1 : 0), y, 3, 2, (y >> 1) % 4 ? '#ff5a4a' : '#fff0c8');
        R(X, top, 1, bot - top, '#ffe0d0');
        glow(X, (top + bot) >> 1, '#ff3b4a', 18, 0.7); glow(X, bot, '#ff3b4a', 10, 0.6);
      } else if (warn > 0) {                                                    // telegraph: faint flicker, faster near activation
        const w = warn, on = ((tm * (8 + 24 * w)) | 0) % 2;
        if (on) { g.globalAlpha = 0.25 + 0.5 * w; for (let y = top; y < bot; y += 4) R(X, y, 1, 2, '#ff6a5a'); g.globalAlpha = 1; glow(X, top, '#ff3b4a', 8, 0.5 * w); }
      }
    } else if (h.type === 'spikes') {
      const X0 = sx(h.x0), X1 = sx(h.x1), Y = sy(h.y || 0);
      if (X1 < -10 || X0 > view.W + 10) continue;
      R(X0, Y - 2, X1 - X0, 2, '#1b1d26');
      for (let x = X0; x < X1 - 2; x += 4) { R(x, Y - 4, 3, 2, '#4a4e5e'); R(x + 1, Y - 7, 1, 3, '#8a8fa3'); px(x + 1, Y - 8, '#ff3b4a'); }
      g.globalAlpha = 0.18; R(X0, Y - 9, X1 - X0, 2, '#ff3b4a'); g.globalAlpha = 1;
    }
  }
}

export function drawForeground() {
  const par = 1.38;
  for (const f of ART.fg || []) {
    const X = Math.round(f.x * PPU * par - view.cpx * par) + (view.W >> 1);
    if (X < -40 || X > view.W + 40) continue;
    const top = -4, bot = view.H;
    R(X, top, 3, bot, '#04060d'); R(X, top, 1, bot, '#0d1a33');
    R(X - 3, 20 + (f.seed % 30), 9, 2, '#04060d');
    if (f.kind === 'cable') {                                                   // sagging cable to the right
      const y0 = 24 + (f.seed % 30), len = 90;
      for (let i = 0; i <= len; i += 1) { const sag = Math.sin((i / len) * Math.PI) * 14; px(X + 3 + i, y0 + sag, '#04060d'); }
      glow(X + 5 + len / 2, y0 + 14, '#ff3d9d', 5, 0.25);
    } else { px(X + 2, 22 + (f.seed % 30), '#ff3b4a'); glow(X + 2, 22 + (f.seed % 30), '#ff3b4a', 5, ((Game.time * 1.3 + f.seed) % 1) < 0.5 ? 0.7 : 0.1); }
  }
}

export function drawRain() { const o = theme().overlay; if (o) o(view, Game.time); }


export function drawShadow(wx, wy, wpx) {
  const X = sx(wx), Y = sy(wy);
  g.globalAlpha = 0.32; R(X - (wpx >> 1), Y - 1, wpx, 3, '#000000'); R(X - (wpx >> 1) + 2, Y - 2, wpx - 4, 1, '#000000'); g.globalAlpha = 1;
}

/* render interpolation between fixed 120 Hz sim ticks */
const ix = o => o.prevX !== undefined ? o.prevX + (o.x - o.prevX) * (Game.alpha || 0) : o.x;
const iy = o => o.prevY !== undefined ? o.prevY + (o.y - o.prevY) * (Game.alpha || 0) : o.y;

export function drawEnemyEntity(e) {
  const ex = ix(e), ey = iy(e);
  const X = sx(ex) + (e.shake > 0 ? ((Math.random() * 3) | 0) - 1 : 0), Y = sy(ey);
  if (X < -60 || X > view.W + 60) return;
  if (e.kind !== 'drone') drawShadow(ex, ey, e.kind === 'warden' ? 30 : e.kind === 'turret' ? 20 : 18);
  if (e.kind === 'warden' && (e.anim === 'charge' || (e.anim === 'windup' && e.attack === 'charge'))) drawChargeLine(e, X, Y);
  drawEnemy(e, X, Y);
  const top = Y - (ENEMY_HEIGHT[e.kind] || 44);
  if (e.state === 'alert' && e.st < 0.45) {                                     // "!" reaction indicator
    const b = (((e.t * 12) | 0) % 2) ? '#ffe06b' : '#ff6a5a';
    text('!', X - 1, top - 4, b, 2, '#05070e');
  } else if (e.state === 'windup' && e.kind !== 'enforcer' && e.tele > 0.5 && ((e.t * 16) | 0) % 2) {
    text('!', X - 1, top - 4, '#ff3b4a', 2, '#05070e');
  } else if (e.state === 'windup' && e.kind === 'enforcer') {
    text('!', X - 1, top - 4, ((e.t * 16) | 0) % 2 ? '#ff3b4a' : '#ffe06b', 2, '#05070e');
  }
  if (e.hp < e.maxhp) {                                                         // health pip bar
    const bw = e.kind === 'warden' ? 30 : 18, bx = X - (bw >> 1), by = top + 2;
    R(bx - 1, by - 1, bw + 2, 4, '#05070e'); R(bx, by, bw, 2, '#3a1020'); R(bx, by, Math.max(1, Math.round(bw * e.hp / e.maxhp)), 2, e.state === 'stagger' ? '#ffe06b' : '#ff4b5a');
  }
}

/* boss charge telegraph: a scrolling red danger lane along the floor ahead of the Warden */
function drawChargeLine(e, X, Y) {
  const f = e.facing || 1, tm = Game.time, k = Math.max(0.35, Math.min(1, e.tele || 0.6));
  const len = Math.round(80 + 240 * k), x0 = X + f * 26, gy = sy(0);
  g.globalAlpha = 0.16 + 0.12 * k; R(f > 0 ? x0 : x0 - len, gy - 3, len, 3, '#ff3b4a'); g.globalAlpha = 1;
  const scroll = (tm * 90) % 12;
  for (let d = 0; d < len; d += 12) {
    const xx = x0 + f * (d + scroll); if ((d / 12) % 2) continue;
    R(f > 0 ? xx : xx - 6, gy - 2, 6, 1, '#ff5a4a');
    px(xx + f * 2, gy - 5, '#ff8a6a'); px(xx + f * 3, gy - 4, '#ff8a6a'); px(xx + f * 2, gy - 3, '#ff8a6a');   // chevrons
  }
  if (((tm * 12) | 0) % 2) glow(x0 + f * len, gy - 3, '#ff3b4a', 10, 0.8);
  void Y;
}
/* boss slam shockwave: a travelling wall of orange energy with ground sparks */
function drawShockwave(b, X) {
  const d = Math.sign(b.vx) || 1, tm = Game.time, gy = sy(0), fl = ((tm * 30) | 0) % 2;
  for (let i = 0; i < 6; i++) {                                         // trailing afterimage columns
    const h = 22 - i * 3, xx = X - d * i * 4;
    g.globalAlpha = 0.85 - i * 0.14;
    R(xx - 1, gy - h, 3, h, i === 0 ? '#ffffff' : i < 3 ? '#ffb347' : '#ff3b4a');
  }
  g.globalAlpha = 1;
  R(X - 2 + d, gy - 24 - fl, 4, 3, '#fff0c8');                         // crest
  for (let i = 0; i < 4; i++) px(X - d * (3 + i * 3), gy - 2 - ((i * 5 + fl * 3) % 7), i & 1 ? '#ffe27a' : '#ff7a1a');   // ground sparks
  R(X - d * 26, gy - 1, 26, 1, '#ff7a1a');
  glow(X, gy - 10, '#ff7a1a', 18, 0.9); glow(X, gy - 2, '#ff3b4a', 12, 0.7);
}

export function drawEnemyBullet(b) {
  const X = sx(b.x), Y = sy(b.y);
  if (b.wave) { drawShockwave(b, X); return; }
  // hostile bolt: dark-ringed hot core + 4-step trail, readable on every theme (red never appears in the backgrounds' key colours)
  const sp = Math.hypot(b.vx, b.vy || 0) || 1, ux = b.vx / sp, uy = -(b.vy || 0) / sp, pulse = ((Game.time * 20) | 0) % 2;
  for (let k = 1; k <= 4; k++) { g.globalAlpha = 0.6 / k; R(X - ux * k * 3 - 1, Y - uy * k * 3 - 1, 3, 3, k < 2 ? '#ffb347' : '#ff3b4a'); }
  g.globalAlpha = 1;
  disc(X, Y, 4, '#0a0508'); disc(X, Y, 3, '#ff3b4a'); disc(X, Y, 1 + pulse, '#fff0c8'); px(X - 1, Y - 1, '#ffffff');
  glow(X, Y, '#ff3b4a', 13, 0.9);
}
export function drawPlayerBullet(b) {                                       // drawn along its flight direction
  const X = sx(b.x), Y = sy(b.y), sp = Math.hypot(b.vx, b.vy || 0) || 1, ux = b.vx / sp, uy = -(b.vy || 0) / sp, refl = b.reflected;
  const c1 = refl ? '#9ff6ff' : '#ffc43d', c2 = '#ffffff';
  g.globalAlpha = 0.45; line(X - ux * 16, Y - uy * 16, X, Y, 3, c1); g.globalAlpha = 1;
  const k = b.big ? 2 : 1;
  line(X - ux * 6 * k, Y - uy * 6 * k, X + ux * 5 * k, Y + uy * 5 * k, b.big ? 9 : 5, '#05070e');
  line(X - ux * 5 * k, Y - uy * 5 * k, X + ux * 4 * k, Y + uy * 4 * k, b.big ? 7 : 3, c1);
  line(X - ux * 3 * k, Y - uy * 3 * k, X + ux * 4 * k, Y + uy * 4 * k, b.big ? 3 : 1, c2);
  glow(X, Y, c1, b.big ? 24 : 14, 0.85);
}

/* cannon aim guide: dotted sight line + lock-on brackets on the auto-aim target */
export function drawAimGuide() {
  const p = player;
  if (p.chip !== 'cannon' || p.dead || !Game.running) return;
  const m = muzzleWorld(), X0 = sx(m.x), Y0 = sy(m.y), tm = Game.time;
  const len = p.aimTarget ? Math.min(150, Math.hypot(p.aimTarget.x - m.x, p.aimTarget.y + p.aimTarget.h * 0.55 - m.y) * PPU - 10) : 70;
  g.globalAlpha = 0.55;
  for (let d = 6 + ((tm * 40) % 6); d < len; d += 6) px(X0 + m.dx * d, Y0 - m.dy * d, '#ffc43d');
  g.globalAlpha = 1;
  const e = p.aimTarget;
  if (e) {
    const cx = sx(e.x), cy = sy(e.y + e.h * 0.55), r = 9 + Math.round(Math.sin(tm * 10)), c = '#ffc43d';
    for (const [ax, ay] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      R(cx + ax * r - (ax > 0 ? 3 : 0), cy + ay * r, 4, 1, c); R(cx + ax * r, cy + ay * r - (ay > 0 ? 3 : 0), 1, 4, c);
    }
  }
}

export function drawPlayerEntity() {
  const p = player;
  const px_ = ix(p), py_ = iy(p), X = sx(px_), Y = sy(py_);
  if (p.onGround && !p.dead) { drawShadow(px_, py_, 16); glow(X, Y, ACCENT[p.chip].m, 14, 0.18); }
  if (p.dead && p.deadT > 0.45) return;                                         // disintegrated
  const blinkOff = p.inv > 0 && p.inv < 90 && !p.dead && p.hurtT <= 0 && ((p.inv * 18) | 0) % 2 === 0 && p.dash <= 0;
  const ov = null;
  if (blinkOff) g.globalAlpha = 0.45;
  drawPlayer(p, X, Y, ov);
  g.globalAlpha = 1;
}

export function drawBoxes() {
  g.globalAlpha = 0.9;
  const rect = (x0, y0, x1, y1, c) => { const a = sx(x0), b = sy(y1), w = sx(x1) - a, h = sy(y0) - b; R(a, b, w, 1, c); R(a, b + h, w, 1, c); R(a, b, 1, h, c); R(a + w, b, 1, h, c); };
  for (const bx of dbgBoxes) rect(bx.x0, bx.y0, bx.x1, bx.y1, '#ffff00');
  for (const e of enemies) if (e.alive) { const h = hurtbox(e); rect(h.x0, h.y0, h.x1, h.y1, '#ff4040'); }
  rect(player.x - 0.35, player.y, player.x + 0.35, player.y + 1.7, '#40ff80');
  g.globalAlpha = 1;
}

export function renderFrame() {
  const tm = Game.time, TH = theme();
  view.cpx = Math.round(view.camX * PPU) + Feel.shakeX;
  view.cpy = Math.round(view.camY * PPU) + Feel.shakeY;
  setGfx(S.screenCtx);
  g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  g.drawImage(view.sky, 0, 0);
  if (ART.theme === 'district') for (let i = 0; i < 6; i++) { const a = ((tm * 0.7 + i * 1.7) % 3) < 0.12 ? 1 : 0; if (a) px((i * 97 + 13) % view.W, 12 + (i * 31) % 60, '#ffffff'); }
  ART.layers.forEach((L, i) => { if (TH.ambient) TH.ambient(view, tm, i); drawStrip(L); });
  drawPlatforms();
  drawProps();
  drawCheckpoints(); drawPortal(); drawPickups();
  drawArenaWalls();
  drawHazards();
  for (const e of enemies) if (e.alive) drawEnemyEntity(e);
  FX.drawBelow();
  drawAimGuide();
  drawPlayerEntity();
  FX.drawSlashes(); FX.drawBeams();
  for (const b of bullets) drawPlayerBullet(b);
  for (const b of enemyBullets) drawEnemyBullet(b);
  FX.drawParticles();
  FX.drawTexts();
  drawForeground();
  drawRain();
  if (Game.showBoxes) drawBoxes();
  if (Compositor.mode !== 'webgl') g.drawImage(view.vig, 0, 0);                  // the GL post pass has its own vignette
  if (player.hp <= 2 && player.hp > 0 && Game.running) {                          // low-integrity warning pulse
    g.globalAlpha = 0.07 + 0.06 * Math.sin(tm * 6); R(0, 0, view.W, 4, '#ff2d5f'); R(0, view.H - 4, view.W, 4, '#ff2d5f'); R(0, 0, 4, view.H, '#ff2d5f'); R(view.W - 4, 0, 4, view.H, '#ff2d5f'); g.globalAlpha = 1;
  }
  FX.drawScreenFlash(view.W, view.H);
  HUD.setGuard(player.guard, player.guardMax, player.guardBreakT > 0);
  HUD.setStage((Game.stage || 0) + 1, (S.stage && S.stage.name) || TH.name);
  present();
}

const _fx = { flash: 0, hit: 0 };
function present() {
  _fx.flash = Math.min(1, FX.flash || 0);
  _fx.hit = (Feel.hitstop || 0) > 0 ? 0.35 : 0;
  Compositor.present(_fx);
}

/* scarf chain for poses that are not simulated (title hero, viewers): hangs from the ninja's collar */
const _sc = new Float32Array(SCARF_N * 2);
export function staticScarf(p, tm = 0, out = new Float32Array(SCARF_N * 2)) {
  const a = ninjaAnchors(p), fast = p.anim === 'run' || p.anim === 'dash' || p.warpU > 0;
  out[0] = a.scarf.x; out[1] = -a.scarf.y;
  for (let i = 1; i < SCARF_N; i++) {
    const w = Math.sin(tm * 6 + i * 0.9) * 0.9 * (i / SCARF_N);
    out[i * 2] = out[i * 2 - 2] - (fast ? 3.1 : 2.5); out[i * 2 + 1] = out[i * 2 - 1] + (fast ? 0.4 : p.anim === 'fall' ? -1.4 : 1.2) + w;
  }
  for (let i = 0; i < SCARF_N; i++) out[i * 2] *= p.facing || 1;
  return out;
}

/* title-screen hero: the ninja idling in the menu panel, cycling its transformations */
export function drawHero() {
  if (!S.heroCtx) return;
  const prev = g, tm = Game.time;
  const W = S.heroCtx.canvas.width, H = S.heroCtx.canvas.height;
  S.heroCtx.clearRect(0, 0, W, H);
  setGfx(S.heroCtx);
  const ph = ((tm / 2.2) | 0) % 4;
  const p = { facing: 1, anim: 'idle', t: tm, run: 0, chip: ph % 2 ? 'cannon' : 'blade', atkStep: 0, atkU: 0, shieldAmt: ph >= 2 ? 0.8 : 0, parryT: 0, blockFlash: 0, recoil: 0, muzzle: 0, xf: Math.min(1, (tm % 2.2) * 4), rot: 0, warpU: 0, hasShield: true, hasBlink: true, aim: 0 };
  p.scarf = staticScarf(p, tm, _sc);
  drawPlayer(p, (W >> 1) - 6, H - 8);
  setGfx(prev);
}

/* ------------------------------------------------------------------ dev tool: pose sheets (#sprites / #enemies) */
const VIEW_CELL = { sprites: [58, 64], enemies: [76, 84] };
export function drawViewer() {
  setGfx(S.screenCtx); g.globalAlpha = 1; R(0, 0, view.W, view.H, '#1a2038');
  const tm = Game.time, [cw, ch] = VIEW_CELL[Game.viewer] || VIEW_CELL.sprites;
  const qv = /[?&]v=(\d+),(\d+)/.exec(location.search), vx = qv ? +qv[1] : 0, vy = qv ? +qv[2] : 0;
  g.save(); g.translate(-vx * cw, -vy * ch);
  if (Game.viewer === 'sprites') {
    const poses = [
      ['idle', {}], ['run', { run: 0.4 }], ['run', { run: 1.2 }], ['run', { run: 2.0 }], ['run', { run: 2.8 }], ['jump', {}], ['fall', {}], ['dash', {}], ['hurt', {}],
      ['idle', { atkStep: 1, atkU: 0.32 }], ['idle', { atkStep: 2, atkU: 0.32 }], ['idle', { atkStep: 3, atkU: 0.36 }],
    ];
    CHIP_ORDER.forEach((chip, r) => poses.forEach((ps, i) => {
      const weapon = r % 2 ? 'cannon' : 'blade';
      const p = Object.assign({ facing: 1, anim: ps[0], t: tm, run: 0, chip: weapon, atkStep: 0, atkU: 0, shieldAmt: r >= 2 ? 0.8 : 0, parryT: 0, blockFlash: 0, recoil: 0, muzzle: weapon === 'cannon' && i === 9 ? 0.1 : 0, xf: 1, rot: 0, warpU: 0, hasShield: r >= 2, hasBlink: r >= 1, aim: weapon === 'cannon' ? (i - 6) * 0.25 : 0 }, ps[1]);
      if (weapon !== 'blade' && p.atkStep) { p.atkStep = 0; }
      p.scarf = staticScarf(p, tm);
      for (let k = 0; k < cw; k += 2) px(4 + i * cw + k, 61 + r * ch, '#262f58');
      drawPlayer(p, 34 + i * cw, 60 + r * ch);
    }));
  } else {
    const row = (kind, anims, y, dy = 0) => anims.forEach((a, i) => {
      for (let k = 0; k < cw; k += 2) px(4 + i * cw + k, y + 1, '#262f58');
      drawEnemy(Object.assign({ kind, facing: -1, anim: a[0], t: tm, walk: a[1] || 0, flash: 0, tele: a[2] || 0, recoil: 0, muzzle: a[3] || 0 }, a[4] || {}), 40 + i * cw, y - dy);
    });
    row('gunner', [['idle'], ['walk', 0], ['walk', 1.6], ['alert'], ['windup', 0, 0.7], ['fire', 0, 0, 0.1, { recoil: 1 }], ['hit', 0, 0, 0, { flash: 0.1 }], ['dead', 0, 0, 0, { deadU: 1 }]], 64);
    row('enforcer', [['idle'], ['walk', 0], ['chase', 1.6], ['windup', 0, 0.7], ['lunge'], ['recover'], ['hit', 0, 0, 0, { flash: 0.1 }], ['dead', 0, 0, 0, { deadU: 1 }]], 64 + ch);
    row('warden', [['idle'], ['walk', 1], ['windup', 0, 0.8, 0, { attack: 'bolt' }], ['fire', 0, 0, 0.1, { recoil: 1 }], ['windup', 0, 0.9, 0, { attack: 'slam' }], ['windup', 0, 0.9, 0, { attack: 'charge' }], ['idle', 0, 0, 0, { phase2: true, exposed: true }], ['dead', 0, 0, 0, { deadU: 1 }]], 64 + ch * 2 + 12);
    row('drone', [['idle'], ['walk'], ['windup', 0, 1], ['swoop'], ['fire', 0, 0, 0.1, { recoil: 1 }], ['hit', 0, 0, 0, { flash: 0.1 }], ['dead', 0, 0, 0, { deadU: 1 }]], 64 + ch * 3 + 12, 20);
    row('turret', [['idle', 0, 0, 0, { aim: 0.3 }], ['windup', 0, 1, 0, { aim: 0 }], ['fire', 0, 0, 0.1, { recoil: 1, aim: -0.3 }], ['hit', 0, 0, 0, { flash: 0.1 }], ['idle', 0, 0, 0, { mount: 'wall', aim: 0 }], ['dead', 0, 0, 0, { deadU: 1 }]], 64 + ch * 4 + 12);
  }
  g.restore();
  present();
}
export function viewerScarf(anim) { return staticScarf({ anim, facing: 1, t: 0 }); }
