import { TAU, clamp, lerp } from '../core/util.js';

/* NEON//SHIFT — pixel-exact drawing primitives. All gameplay art is drawn with these into a
   LOW-RES canvas which the browser scales up with nearest-neighbour filtering (crisp pixel art).
   `g` is the active 2D context (live binding: change it with setGfx / withCtx). */
/* ------------------------------------------------------------ colour */
export const _rgb = new Map();
export function hex2rgb(h) {
  let v = _rgb.get(h);
  if (!v) { v = [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; _rgb.set(h, v); }
  return v;
}
export const _mix = new Map();
export function mix(a, b, t) {                  // '#rrggbb' x2 -> '#rrggbb' (quantised so the cache stays small)
  t = Math.round(clamp(t, 0, 1) * 16) / 16;
  const key = a + b + t;
  let v = _mix.get(key);
  if (v) return v;
  const A = hex2rgb(a), B = hex2rgb(b);
  const h = n => Math.round(n).toString(16).padStart(2, '0');
  v = '#' + h(lerp(A[0], B[0], t)) + h(lerp(A[1], B[1], t)) + h(lerp(A[2], B[2], t));
  _mix.set(key, v);
  return v;
}

/* ------------------------------------------------------------ canvas */
export let g = null;                             // active 2D context for the primitives below
export function setGfx(ctx) { g = ctx; }
export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d');
  x.imageSmoothingEnabled = false;
  return [c, x];
}
export function withCtx(ctx, fn) { const prev = g; g = ctx; try { fn(); } finally { g = prev; } }

/* ------------------------------------------------------------ primitives (integer pixel output) */
export function R(x, y, w, h, c) { g.fillStyle = c; g.fillRect(Math.round(x), Math.round(y), w, h); }
export function px(x, y, c) { g.fillStyle = c; g.fillRect(Math.round(x), Math.round(y), 1, 1); }

export function line(x0, y0, x1, y1, t, c) {     // thick Bresenham
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  g.fillStyle = c;
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  const o = t >> 1;
  for (let n = 0; n < 600; n++) {
    g.fillRect(x0 - o, y0 - o, t, t);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

export function disc(cx, cy, r, c) {
  cx = Math.round(cx); cy = Math.round(cy); r = Math.round(r);
  g.fillStyle = c;
  for (let dy = -r; dy <= r; dy++) {
    const hw = Math.round(Math.sqrt(r * r - dy * dy + 0.25));
    g.fillRect(cx - hw, cy + dy, hw * 2 + 1, 1);
  }
}

export function ring(cx, cy, r, c, t = 1) {
  const n = Math.max(12, Math.ceil(r * 5));
  g.fillStyle = c;
  const o = t >> 1;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    g.fillRect(Math.round(cx + Math.cos(a) * r) - o, Math.round(cy + Math.sin(a) * r) - o, t, t);
  }
}

export function arcPx(cx, cy, r, a0, a1, t, c, f = 1) {   // math-style angles (y up); f mirrors x
  const n = Math.max(4, Math.ceil(Math.abs(a1 - a0) * r / 1.2));
  g.fillStyle = c;
  const o = t >> 1;
  for (let i = 0; i <= n; i++) {
    const a = a0 + (a1 - a0) * (i / n);
    g.fillRect(Math.round(cx + Math.cos(a) * r * f) - o, Math.round(cy - Math.sin(a) * r) - o, t, t);
  }
}

/* tapered crescent used for sword slashes: thick leading part, thin tail */
export function crescent(cx, cy, r, a0, a1, wMax, c, f = 1, tail = 0.8) {
  const n = Math.max(6, Math.ceil(Math.abs(a1 - a0) * r / 1.4));
  g.fillStyle = c;
  for (let i = 0; i <= n; i++) {
    const u = i / n, a = a0 + (a1 - a0) * u;
    const w = wMax * Math.pow(Math.sin(Math.PI * Math.pow(u, tail)), 0.75);
    const wi = Math.round(w);
    if (wi < 1) continue;
    const ca = Math.cos(a) * f, sa = -Math.sin(a);
    for (let k = 0; k < wi; k++) g.fillRect(Math.round(cx + ca * (r - k)), Math.round(cy + sa * (r - k)), 2, 2);
  }
}

/* ------------------------------------------------------------ glow (stepped, additive) */
export const _glow = new Map();
export function glowSprite(color, r) {
  const key = color + r;
  let s = _glow.get(key);
  if (s) return s;
  const [c, x] = makeCanvas(r * 2 + 1, r * 2 + 1);
  const [R0, G0, B0] = hex2rgb(color);
  const bands = Math.max(3, Math.min(6, Math.round(r / 3)));
  withCtx(x, () => {
    for (let i = 0; i < bands; i++) {
      x.fillStyle = `rgba(${R0},${G0},${B0},${0.075 + i * 0.012})`;
      disc(r, r, Math.max(1, Math.round(r * (1 - i / bands))), x.fillStyle);
    }
  });
  _glow.set(key, c);
  return c;
}
export function glow(x, y, color, r, a = 1) {
  if (a <= 0) return;
  const s = glowSprite(color, r);
  const prevA = g.globalAlpha, prevO = g.globalCompositeOperation;
  g.globalCompositeOperation = 'lighter';
  g.globalAlpha = prevA * Math.min(1, a);
  g.drawImage(s, Math.round(x) - r, Math.round(y) - r);
  g.globalCompositeOperation = prevO;
  g.globalAlpha = prevA;
}

/* ------------------------------------------------------------ 3x5 pixel font (HUD popups, neon signs) */
export const FONT_SRC = {
  A: '###/#.#/###/#.#/#.#', B: '##./#.#/##./#.#/##.', C: '.##/#../#../#../.##', D: '##./#.#/#.#/#.#/##.',
  E: '###/#../##./#../###', F: '###/#../##./#../#..', G: '.##/#../#.#/#.#/.##', H: '#.#/#.#/###/#.#/#.#',
  I: '###/.#./.#./.#./###', J: '..#/..#/..#/#.#/.#.', K: '#.#/#.#/##./#.#/#.#', L: '#../#../#../#../###',
  M: '#.#/###/###/#.#/#.#', N: '##./#.#/#.#/#.#/#.#', O: '.#./#.#/#.#/#.#/.#.', P: '##./#.#/##./#../#..',
  Q: '.#./#.#/#.#/##./.##', R: '##./#.#/##./#.#/#.#', S: '.##/#../.#./..#/##.', T: '###/.#./.#./.#./.#.',
  U: '#.#/#.#/#.#/#.#/###', V: '#.#/#.#/#.#/#.#/.#.', W: '#.#/#.#/###/###/#.#', X: '#.#/#.#/.#./#.#/#.#',
  Y: '#.#/#.#/.#./.#./.#.', Z: '###/..#/.#./#../###',
  0: '###/#.#/#.#/#.#/###', 1: '.#./##./.#./.#./###', 2: '##./..#/.#./#../###', 3: '##./..#/.#./..#/##.',
  4: '#.#/#.#/###/..#/..#', 5: '###/#../##./..#/##.', 6: '.##/#../###/#.#/###', 7: '###/..#/.#./.#./.#.',
  8: '###/#.#/###/#.#/###', 9: '###/#.#/###/..#/##.',
  '!': '.#./.#./.#./.../.#.', '?': '###/..#/.#./.../.#.', '.': '.../.../.../.../.#.', ':': '.../.#./.../.#./...',
  '-': '.../.../###/.../...', '+': '.../.#./###/.#./...', '%': '#.#/..#/.#./#../#.#', '|': '.#./.#./.#./.#./.#.',
  '<': '..#/.#./#../.#./..#', '>': '#../.#./..#/.#./#..', '_': '.../.../.../.../###', '*': '#.#/.#./###/.#./#.#',
  'x': '.../#.#/.#./#.#/...', ' ': '.../.../.../.../...',
};
export const FONT = {};
for (const k in FONT_SRC) FONT[k] = FONT_SRC[k].split('/').map(r => [...r].map(ch => ch === '#'));
export function textW(s, sc = 1) { return s.length * 4 * sc - sc; }
export function text(s, x, y, c, sc = 1, shadow = null) {
  s = String(s).toUpperCase();
  for (let pass = shadow ? 0 : 1; pass < 2; pass++) {
    g.fillStyle = pass === 0 ? shadow : c;
    const ox = pass === 0 ? sc : 0, oy = pass === 0 ? sc : 0;
    let cx = Math.round(x);
    for (let i = 0; i < s.length; i++, cx += 4 * sc) {
      const gl = FONT[s[i]]; if (!gl) continue;
      for (let ry = 0; ry < 5; ry++) for (let rx = 0; rx < 3; rx++)
        if (gl[ry][rx]) g.fillRect(cx + rx * sc + ox, Math.round(y) + ry * sc + oy, sc, sc);
    }
  }
}
