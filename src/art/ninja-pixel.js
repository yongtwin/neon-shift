/* =====================================================================
   ninja-pixel.js — tiny software pixel rasteriser used by the ninja.

   Everything is drawn into a Uint32 RGBA buffer with pixel-centre tests
   (no anti-aliasing), so every pixel lands on the art grid. Shapes can be
   shaded automatically into 3 tones + rim light, and each body part is
   composited as a "group" that receives its own 1-px dark outline
   (outline under the part, on top of what's behind it → clean part
   separation, like hand-pixelled sprites).

   Buffer space: x right, y down. Light comes from front-top (+x, -y).
   ===================================================================== */

const LE = (() => new Uint8Array(new Uint32Array([1]).buffer)[0] === 1)();

/** '#rrggbb' -> packed 32-bit RGBA in ImageData byte order. */
export function rgb(hex, a = 255) {
  const n = parseInt(hex.slice(1), 16), r = n >> 16 & 255, g = n >> 8 & 255, b = n & 255;
  return LE ? ((a << 24) | (b << 16) | (g << 8) | r) >>> 0 : ((r << 24) | (g << 16) | (b << 8) | a) >>> 0;
}
const A_OF = c => LE ? c >>> 24 : c & 255;

/** blend packed src (with its own alpha) over dst */
function over(dst, src) {
  const sa = A_OF(src);
  if (sa >= 255 || !dst) return src;
  if (sa === 0) return dst;
  const da = A_OF(dst), k = sa / 255, ik = 1 - k;
  if (LE) {
    const r = (src & 255) * k + (dst & 255) * ik, g = (src >> 8 & 255) * k + (dst >> 8 & 255) * ik, b = (src >> 16 & 255) * k + (dst >> 16 & 255) * ik;
    const a = Math.min(255, sa + da * ik);
    return ((a << 24) | ((b & 255) << 16) | ((g & 255) << 8) | (r & 255)) >>> 0;
  }
  const r = (src >>> 24) * k + (dst >>> 24) * ik, g = (src >> 16 & 255) * k + (dst >> 16 & 255) * ik, b = (src >> 8 & 255) * k + (dst >> 8 & 255) * ik;
  return (((r & 255) << 24) | ((g & 255) << 16) | ((b & 255) << 8) | Math.min(255, sa + da * ik)) >>> 0;
}

export class PixBuf {
  constructor(w, h) { this.w = w; this.h = h; this.d = new Uint32Array(w * h); }
  clear() { this.d.fill(0); }
  set(x, y, c) {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h || !c) return;
    const i = y * this.w + x;
    this.d[i] = A_OF(c) >= 255 ? c : over(this.d[i], c);
  }
  get(x, y) { return x < 0 || y < 0 || x >= this.w || y >= this.h ? 0 : this.d[y * this.w + x]; }
  alpha(x, y) { return A_OF(this.get(x, y)); }
}

/* --------------------------------------------------------------- shading helpers */
const LX = 0.5, LY = -0.86;                   // light dir (buffer space): front + up
/** choose a tone from [dark, mid, light, rim?] for a unit-ish normal (nx, ny) */
export function toneFor(T, nx, ny, edge) {
  const d = nx * LX + ny * LY;
  if (T[3] && edge > 0.62 && nx < -0.55 && ny > -0.6) return T[3];   // back-edge rim light
  if (d > 0.38) return T[2];
  if (d < -0.32) return T[0];
  return T[1];
}

/* --------------------------------------------------------------- primitives (buffer space, float input) */
/** tapered capsule from (ax,ay) r0 to (bx,by) r1; T = colour or tone array */
export function capsule(B, ax, ay, bx, by, r0, r1, T) {
  const minX = Math.floor(Math.min(ax - r0, bx - r1)) - 1, maxX = Math.ceil(Math.max(ax + r0, bx + r1)) + 1;
  const minY = Math.floor(Math.min(ay - r0, by - r1)) - 1, maxY = Math.ceil(Math.max(ay + r0, by + r1)) + 1;
  const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1e-6;
  const arr = Array.isArray(T);
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
    const px = x + 0.5, py = y + 0.5;
    let t = ((px - ax) * dx + (py - ay) * dy) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t;
    const cx = ax + dx * t, cy = ay + dy * t, r = r0 + (r1 - r0) * t;
    const ex = px - cx, ey = py - cy, dd = Math.sqrt(ex * ex + ey * ey);
    if (dd > r) continue;
    if (!arr) { B.set(x, y, T); continue; }
    const k = r > 0.01 ? 1 / r : 0;
    B.set(x, y, toneFor(T, ex * k, ey * k, dd * k));
  }
}

export function disc(B, cx, cy, r, T) { capsule(B, cx, cy, cx, cy, r, r, T); }

/** convex/concave polygon fill (even-odd, pixel centres). With a tone array the
 *  polygon gets a 1-px bevel: edges facing the light are lit, the others shaded. */
export function poly(B, P, T, bevel = 1.05) {
  let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
  for (let i = 0; i < P.length; i += 2) {
    minX = Math.min(minX, P[i]); maxX = Math.max(maxX, P[i]); minY = Math.min(minY, P[i + 1]); maxY = Math.max(maxY, P[i + 1]);
  }
  const n = P.length >> 1, arr = Array.isArray(T);
  let area = 0;
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; area += P[i * 2] * P[j * 2 + 1] - P[j * 2] * P[i * 2 + 1]; }
  const sgn = area > 0 ? 1 : -1;
  for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) for (let x = Math.floor(minX); x <= Math.ceil(maxX); x++) {
    const px = x + 0.5, py = y + 0.5;
    let inside = false;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = P[i * 2], yi = P[i * 2 + 1], xj = P[j * 2], yj = P[j * 2 + 1];
      if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) inside = !inside;
    }
    if (!inside) continue;
    if (!arr) { B.set(x, y, T); continue; }
    let best = 1e9, bnx = 0, bny = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, x0 = P[i * 2], y0 = P[i * 2 + 1], ex = P[j * 2] - x0, ey = P[j * 2 + 1] - y0;
      const l2 = ex * ex + ey * ey || 1e-6;
      let t = ((px - x0) * ex + (py - y0) * ey) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = px - (x0 + ex * t), qy = py - (y0 + ey * t), d = qx * qx + qy * qy;
      if (d < best) { best = d; const l = Math.sqrt(l2); bnx = ey / l * sgn; bny = -ex / l * sgn; }
    }
    if (Math.sqrt(best) > bevel) { B.set(x, y, T[1]); continue; }
    B.set(x, y, toneFor(T, bnx, bny, 1));
  }
}

/** 1-px line (Bresenham) */
export function line(B, x0, y0, x1, y1, c) {
  x0 = Math.floor(x0); y0 = Math.floor(y0); x1 = Math.floor(x1); y1 = Math.floor(y1);
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let e = dx + dy;
  for (let k = 0; k < 400; k++) {
    B.set(x0, y0, c);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * e;
    if (e2 >= dy) { e += dy; x0 += sx; }
    if (e2 <= dx) { e += dx; y0 += sy; }
  }
}

/** stamp a hand-authored pixel map (array of strings) centred at (cx,cy), rotated by ang (rad) */
export function stamp(B, map, pal, cx, cy, ang = 0, ox = null, oy = null) {
  const h = map.length, w = map[0].length;
  const ax = ox == null ? w / 2 : ox, ay = oy == null ? h / 2 : oy;
  if (!ang) {
    const x0 = Math.round(cx - ax), y0 = Math.round(cy - ay);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const c = pal[map[j][i]]; if (c) B.set(x0 + i, y0 + j, c); }
    return;
  }
  const c = Math.cos(ang), s = Math.sin(ang), R = Math.ceil(Math.hypot(w, h)) + 1;
  for (let y = Math.floor(cy - R); y <= cy + R; y++) for (let x = Math.floor(cx - R); x <= cx + R; x++) {
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
    const u = Math.floor(dx * c + dy * s + ax), v = Math.floor(-dx * s + dy * c + ay);
    if (u < 0 || v < 0 || u >= w || v >= h) continue;
    const col = pal[map[v][u]]; if (col) B.set(x, y, col);
  }
}

/** composite a group layer onto the main buffer with a 1-px 4-neighbour outline */
export function compositeGroup(main, layer, ol) {
  const w = main.w, h = main.h, L = layer.d, M = main.d;
  if (ol) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (A_OF(L[i]) >= 200) continue;
      if ((x > 0 && A_OF(L[i - 1]) >= 200) || (x < w - 1 && A_OF(L[i + 1]) >= 200) ||
          (y > 0 && A_OF(L[i - w]) >= 200) || (y < h - 1 && A_OF(L[i + w]) >= 200)) M[i] = ol;
    }
  }
  for (let i = 0; i < L.length; i++) { const c = L[i]; if (c) M[i] = A_OF(c) >= 255 ? c : over(M[i], c); }
  layer.clear();
}

/** buffer -> canvas */
export function toCanvas(B, canvas) {
  canvas.width = B.w; canvas.height = B.h;
  const x = canvas.getContext('2d');
  const img = x.createImageData(B.w, B.h);
  new Uint32Array(img.data.buffer).set(B.d);
  x.putImageData(img, 0, 0);
  return canvas;
}
