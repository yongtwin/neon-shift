import { R, disc, g, glow, line, makeCanvas, mix, px, text, textW, withCtx } from '../art/pixel.js';
import { seeded } from '../core/util.js';

/* =====================================================================
   Stage themes: sky / parallax strips / platform style / live ambience.

     district — Neon District (stage 1): rainy night city, signs, flying cars
     complex  — Security Complex (stage 2): indoor facility, steel panels,
                pipes, warning stripes, cold white/teal strip lights, steam
     core     — Cyber Core (stage 3): dark data vault, server racks,
                green/cyan data streams, a pulsing core behind everything

   A theme supplies:
     sky(W, H, gy)        -> canvas (static backdrop, rebuilt on resize)
     layers()             -> parallax strips (built once per theme)
     plat                 -> colours for buildPlatformSprite
     ambient(view, tm, L) -> per-frame extras drawn between strips (optional)
     overlay(view, tm)    -> per-frame extras drawn in front of the world (rain…)
   ===================================================================== */

export const SIGN_TEXT = ['BAR', 'NOODLE', 'SYNTH', 'HOTEL', 'CYBER', '24H', 'ARCADE', 'NEXUS', 'TECH', 'CLINIC', 'OPEN', 'DRONE', 'RAMEN', 'CHIP', 'NEON', 'SHIFT'];
export const SIGN_COL = ['#2fe6ff', '#ff3d9d', '#ffc43d', '#a58bff', '#4dff9d'];

/* ------------------------------------------------------------------ city strip (district) */
export function buildStrip(o) {
  const [c, x] = makeCanvas(o.w, o.h), r = seeded(o.seed), lights = [];
  withCtx(x, () => {
    let bx = 0;
    while (bx < o.w) {
      let bw = Math.round(o.wMin + r() * (o.wMax - o.wMin));
      if (bx + bw > o.w || o.w - (bx + bw) < o.wMin * 0.6) bw = o.w - bx;
      const bh = Math.round(o.hMin + r() * (o.hMax - o.hMin)), top = o.h - bh;
      const body = mix(o.body, o.edge, r() * 0.18);
      R(bx, top, bw, bh, body);
      R(bx + bw - 3, top, 3, bh, mix(body, '#000000', 0.25));
      R(bx, top, bw, 1, o.edge);
      if (r() < 0.5) R(bx, top + 1, bw, 1, mix(o.edge, body, 0.55));
      const chance = o.win * (0.25 + 1.5 * r());
      for (let wy = top + 7; wy < o.h - 4; wy += o.wy) for (let wx = bx + 4; wx < bx + bw - 6; wx += o.wx)
        if (r() < chance) R(wx, wy, 2, o.wy > 5 ? 3 : 2, o.winCols[(r() * o.winCols.length) | 0]);
      const roof = r();
      if (roof < 0.28) { const ah = 8 + ((r() * 16) | 0), ax = bx + 3 + ((r() * (bw - 6)) | 0); R(ax, top - ah, 1, ah, o.edge); if (o.beacon) lights.push({ x: ax, y: top - ah, color: '#ff3b4a', r: 5, kind: 'beacon', ph: r() * 6 }); }
      else if (roof < 0.5) { R(bx + 4, top - 4, Math.min(10, bw - 8), 4, mix(body, o.edge, 0.4)); R(bx + 4, top - 4, Math.min(10, bw - 8), 1, o.edge); }
      else if (roof < 0.62) { const tw = 8; R(bx + 6, top - 9, tw, 7, mix(body, '#000000', 0.2)); R(bx + 6, top - 9, tw, 1, o.edge); R(bx + 7, top - 2, 1, 2, o.edge); R(bx + 12, top - 2, 1, 2, o.edge); }
      if (o.signs && r() < o.signs && bw > 14) {
        const t = SIGN_TEXT[(r() * SIGN_TEXT.length) | 0], col = SIGN_COL[(r() * SIGN_COL.length) | 0];
        const sc = o.signScale || 2, vertical = r() < 0.3 && bh > 60;
        if (vertical) {
          const h2 = t.length * 8 + 4, sxp = bx + bw - 12, syp = top + 10 + ((r() * Math.max(1, bh - h2 - 20)) | 0);
          R(sxp, syp, 11, h2, '#070b18'); R(sxp, syp, 11, 1, col); R(sxp, syp + h2 - 1, 11, 1, col); R(sxp, syp, 1, h2, col); R(sxp + 10, syp, 1, h2, col);
          for (let i = 0; i < t.length; i++) text(t[i], sxp + 4, syp + 3 + i * 8, col, 1);
          lights.push({ x: sxp + 5, y: syp + h2 / 2, color: col, r: 12, kind: 'neon', ph: r() * 6 });
        } else {
          const th = 5 * sc + 6, tw = textW(t, sc) + 8, sxp = bx + 2 + ((r() * Math.max(1, bw - tw - 4)) | 0), syp = top + 6 + ((r() * Math.min(30, bh * 0.3)) | 0);
          R(sxp, syp, tw, th, '#070b18'); R(sxp, syp, tw, 1, col); R(sxp, syp + th - 1, tw, 1, col); R(sxp, syp, 1, th, col); R(sxp + tw - 1, syp, 1, th, col);
          text(t, sxp + 4, syp + 3, col, sc);
          lights.push({ x: sxp + tw / 2, y: syp + th / 2, color: col, r: Math.min(18, tw / 3 + 6), kind: 'neon', ph: r() * 6 });
        }
      }
      bx += bw + (r() < 0.22 ? 2 + ((r() * 3) | 0) : 0);
    }
    fog(x, o);
  });
  return { c, w: o.w, h: o.h, lights, par: o.par, dy: o.dy, bottom: o.bottom };
}
function fog(x, o) {
  const bands = 8;
  for (let i = 0; i < bands; i++) {
    const y0 = Math.round(o.h * (0.25 + 0.75 * i / bands));
    g.globalAlpha = o.fogA * ((i + 1) / bands); R(0, y0, o.w, o.h - y0, o.fog); g.globalAlpha = 1;
  }
}

/* ------------------------------------------------------------------ facility strip (complex) */
function buildFacility(o) {
  const [c, x] = makeCanvas(o.w, o.h), r = seeded(o.seed), lights = [];
  withCtx(x, () => {
    let bx = 0;
    while (bx < o.w) {
      const bw = Math.min(o.w - bx, Math.round(o.wMin + r() * (o.wMax - o.wMin)));
      const bh = Math.round(o.hMin + r() * (o.hMax - o.hMin)), top = o.h - bh;
      const body = mix(o.body, o.edge, r() * 0.2);
      R(bx, top, bw, bh, body); R(bx, top, bw, 1, o.edge); R(bx + bw - 2, top, 2, bh, mix(body, '#000000', 0.3));
      // panel seams + rivets
      for (let py = top + 10; py < o.h; py += 14) { R(bx, py, bw, 1, mix(body, '#000000', 0.35)); if (r() < 0.6) { px(bx + 2, py + 2, o.edge); px(bx + bw - 4, py + 2, o.edge); } }
      for (let pxx = bx + 12; pxx < bx + bw - 4; pxx += 16) R(pxx, top + 2, 1, bh, mix(body, '#000000', 0.25));
      // warning stripes band
      if (r() < o.stripes) { const sy = top + 4 + ((r() * Math.max(1, bh * 0.4)) | 0); for (let i = 0; i < bw; i++) R(bx + i, sy, 1, 4, ((i + sy) >> 2) % 2 ? '#d9a400' : '#121418'); }
      // strip light
      if (r() < o.lamps) { const ly = top + 6 + ((r() * 20) | 0), lw = Math.min(bw - 6, 14 + ((r() * 20) | 0)), lx = bx + 3; R(lx, ly, lw, 2, '#eafcff'); R(lx, ly + 2, lw, 1, '#5fd8e0'); lights.push({ x: lx + lw / 2, y: ly, color: '#bff6ff', r: 16, kind: 'lamp', ph: r() * 6 }); }
      // status screen
      if (r() < o.screens && bw > 16) { const sx2 = bx + 4 + ((r() * (bw - 16)) | 0), sy2 = top + 14 + ((r() * Math.max(1, bh - 30)) | 0); R(sx2, sy2, 10, 7, '#04161a'); for (let k = 0; k < 3; k++) R(sx2 + 1, sy2 + 1 + k * 2, 2 + ((r() * 7) | 0), 1, k ? '#2fe6ff' : '#ff3b4a'); lights.push({ x: sx2 + 5, y: sy2 + 3, color: '#2fe6ff', r: 7, kind: 'neon', ph: r() * 6 }); }
      bx += bw;
    }
    // horizontal pipe runs
    for (let k = 0; k < o.pipes; k++) {
      const y0 = Math.round(o.h * (0.15 + r() * 0.6)), th = 3 + ((r() * 4) | 0), col = o.pipeCol;
      R(0, y0, o.w, th, col); R(0, y0, o.w, 1, mix(col, '#ffffff', 0.25)); R(0, y0 + th - 1, o.w, 1, mix(col, '#000000', 0.4));
      for (let fx = (r() * 30) | 0; fx < o.w; fx += 34 + ((r() * 30) | 0)) { R(fx, y0 - 1, 3, th + 2, mix(col, '#000000', 0.2)); R(fx, y0 - 1, 3, 1, mix(col, '#ffffff', 0.3)); }
    }
    fog(x, o);
  });
  return { c, w: o.w, h: o.h, lights, par: o.par, dy: o.dy, bottom: o.bottom };
}

/* ------------------------------------------------------------------ server racks (core) */
function buildRacks(o) {
  const [c, x] = makeCanvas(o.w, o.h), r = seeded(o.seed), lights = [];
  withCtx(x, () => {
    let bx = 0;
    while (bx < o.w) {
      const bw = Math.min(o.w - bx, Math.round(o.wMin + r() * (o.wMax - o.wMin)));
      const bh = Math.round(o.hMin + r() * (o.hMax - o.hMin)), top = o.h - bh;
      R(bx, top, bw - 1, bh, o.body); R(bx, top, bw - 1, 1, o.edge); R(bx, top, 1, bh, mix(o.body, o.edge, 0.5));
      for (let sy = top + 4; sy < o.h - 3; sy += 4) {
        R(bx + 2, sy, bw - 5, 3, mix(o.body, '#000000', 0.35));
        for (let lx = bx + 3; lx < bx + bw - 4; lx += 3) if (r() < o.leds) px(lx, sy + 1, r() < 0.8 ? o.led : '#ffffff');
      }
      if (r() < 0.25) lights.push({ x: bx + bw / 2, y: top + 8, color: o.led, r: 10, kind: 'neon', ph: r() * 6 });
      bx += bw + ((r() * 4) | 0);
    }
    fog(x, o);
  });
  return { c, w: o.w, h: o.h, lights, par: o.par, dy: o.dy, bottom: o.bottom };
}

/* ------------------------------------------------------------------ skies */
function skyBands(W, H, gy, stops) {
  const bandH = Math.ceil((gy + 40) / stops.length);
  for (let i = 0; i < stops.length; i++) R(0, i * bandH, W, bandH + 1, stops[i]);
  R(0, stops.length * bandH, W, H, stops[stops.length - 1]);
}
function districtSky(W, H, gy) {
  const [c, x] = makeCanvas(W, H), r = seeded(99);
  withCtx(x, () => {
    skyBands(W, H, gy, ['#05071a', '#080b24', '#0c1030', '#120f3a', '#1a1044', '#27134f', '#3a1558', '#561862', '#701b66']);
    for (let i = 0; i < 90; i++) { const sxp = (r() * W) | 0, syp = (r() * gy * 0.7) | 0, b = r(); px(sxp, syp, b > 0.85 ? '#ffffff' : b > 0.5 ? '#9aa8ff' : '#4a5496'); }
    const mx = (W * 0.76) | 0, my = (gy * 0.27) | 0;
    glow(mx, my, '#ff3d9d', 60, 0.5); glow(mx, my, '#7a5cff', 44, 0.4);
    disc(mx, my, 24, '#c9b7ff'); disc(mx, my, 22, '#d9ccff');
    disc(mx + 6, my - 4, 5, '#b8a4f0'); disc(mx - 8, my + 7, 4, '#b8a4f0'); disc(mx - 3, my - 11, 3, '#bba8f4');
    for (let yy = -24; yy <= 24; yy += 1) { const hw = Math.round(Math.sqrt(24 * 24 - yy * yy)); R(mx + hw - 7, my + yy, 7, 1, 'rgba(60,30,120,0.35)'); }
  });
  return c;
}
function complexSky(W, H, gy) {                         // the far back wall of the facility
  const [c, x] = makeCanvas(W, H), r = seeded(77);
  withCtx(x, () => {
    skyBands(W, H, gy, ['#06090d', '#081015', '#0a141a', '#0c1820', '#0e1c25', '#10212b', '#122631', '#142a36']);
    for (let yy = 0; yy < gy + 40; yy += 22) { R(0, yy, W, 1, '#16303a'); R(0, yy + 1, W, 1, '#05080b'); }
    for (let xx = 0; xx < W; xx += 36) { R(xx, 0, 2, gy + 60, '#0b1419'); R(xx, 0, 1, gy + 60, '#1a3540'); }
    for (let i = 0; i < 30; i++) { const xx = (r() * W) | 0, yy = (r() * gy) | 0; px(xx, yy, r() < 0.5 ? '#2a5560' : '#1d3d47'); }
    // high cold skylight band
    g.globalAlpha = 0.18; R(0, 12, W, 6, '#bff6ff'); g.globalAlpha = 0.08; R(0, 18, W, 30, '#7fd8e6'); g.globalAlpha = 1;
  });
  return c;
}
function coreSky(W, H, gy) {
  const [c, x] = makeCanvas(W, H), r = seeded(55);
  withCtx(x, () => {
    skyBands(W, H, gy, ['#010303', '#020605', '#030907', '#040c0a', '#05100d', '#061410', '#071813']);
    // circuit traces
    for (let i = 0; i < 26; i++) {
      let xx = (r() * W) | 0, yy = (r() * gy) | 0; const col = r() < 0.5 ? '#0b3324' : '#0a2a33';
      for (let s = 0; s < 6; s++) { const len = 6 + ((r() * 26) | 0); if (s % 2) { R(xx, yy, 1, len, col); yy += len; } else { R(xx, yy, len, 1, col); xx += len; } }
      px(xx, yy, '#1f8a5a');
    }
  });
  return c;
}

/* ------------------------------------------------------------------ live ambience */
function drawCars(view, tm) {
  const par = 0.28;
  for (let i = 0; i < 5; i++) {
    const sp = 14 + i * 7, dir = i % 2 ? -1 : 1, len = view.W + 160;
    const xx = ((tm * sp * dir + i * 137) % len + len) % len - 80;
    const yy = view.gy - 70 - i * 17 + Math.round(view.cpy * par);
    R(xx, yy, 7, 2, '#0a0e22'); R(xx + (dir > 0 ? 6 : 0), yy, 1, 2, '#ffe9a8');
    px(xx + (dir > 0 ? 0 : 6), yy, '#ff3b4a');
    g.globalAlpha = 0.5; R(xx - dir * 8 + (dir > 0 ? 0 : 7), yy, 8, 1, '#ff3b4a'); g.globalAlpha = 1;
    glow(xx + (dir > 0 ? 7 : 0), yy, '#ffe9a8', 6, 0.6);
  }
}
function drawRain(view, tm) {
  g.globalAlpha = 0.28;
  for (let i = 0; i < 70; i++) {
    const sd = (i * 7919) % 1000 / 1000, sd2 = (i * 104729) % 1000 / 1000, spd = 160 + sd * 90;
    const X = Math.round(((sd2 * (view.W + 60) - tm * 38) % (view.W + 60) + view.W + 60) % (view.W + 60)) - 10;
    const Y = Math.round(((sd * view.H + tm * spd) % (view.H + 20)) - 10);
    line(X, Y, X - 1, Y + 4, 1, '#9ec7ff');
  }
  g.globalAlpha = 1;
}
function drawSteam(view, tm) {                           // slow rising vapour + drifting dust
  for (let i = 0; i < 26; i++) {
    const sd = (i * 7919) % 1000 / 1000, sd2 = (i * 104729) % 1000 / 1000;
    const X = Math.round(((sd2 * (view.W + 40) - view.cpx * 0.9) % (view.W + 40) + view.W + 40) % (view.W + 40)) - 20;
    const Y = Math.round(view.H - ((sd * view.H + tm * (8 + sd * 10)) % (view.H + 20)));
    g.globalAlpha = 0.18 + 0.12 * sd; px(X + Math.round(Math.sin(tm + i) * 2), Y, '#cfefff');
  }
  g.globalAlpha = 1;
}
function drawShafts(view, tm) {                          // cold light shafts from ceiling lamps (parallax 0.4)
  for (let k = 0; k < 4; k++) {
    const X = Math.round(((k * 190 + 40 - view.cpx * 0.4) % (view.W + 200) + view.W + 200) % (view.W + 200)) - 100;
    const flick = ((tm * 0.7 + k * 0.37) % 1) < 0.03 ? 0.2 : 1;
    g.globalAlpha = 0.045 * flick;
    for (let s = 0; s < 18; s++) R(X - s * 1.2, s * 10, 14 + s * 2.4, 10, '#bff6ff');
    g.globalAlpha = 1;
    R(X, 0, 14, 2, '#eafcff'); glow(X + 7, 2, '#bff6ff', 14, 0.5 * flick);
  }
}
function drawCorePulse(view, tm) {
  const X = Math.round(view.W * 0.62 - view.cpx * 0.05), Y = Math.round(view.gy * 0.42), p = 0.5 + 0.5 * Math.sin(tm * 2.2);
  glow(X, Y, '#19ff9c', 70, 0.25 + 0.15 * p); glow(X, Y, '#2fe6ff', 40, 0.35 + 0.2 * p);
  disc(X, Y, 15, '#04150f'); disc(X, Y, 12, '#0a3a28'); disc(X, Y, 8 + Math.round(p * 2), '#19ff9c'); disc(X, Y, 4, '#d8fff0');
  for (let k = 0; k < 3; k++) {                           // orbit rings
    const a = tm * (0.6 + k * 0.35) + k * 2, rr = 20 + k * 7;
    for (let i = 0; i < 24; i++) { const b = a + i / 24 * Math.PI * 2; if (i % 3 === 0) px(X + Math.cos(b) * rr, Y + Math.sin(b) * rr * 0.45, k === 1 ? '#2fe6ff' : '#19ff9c'); }
  }
}
function drawDataStreams(view, tm) {
  for (let i = 0; i < 34; i++) {
    const sd = (i * 7919) % 1000 / 1000, sd2 = (i * 104729) % 1000 / 1000, par = 0.15 + sd * 0.4;
    const X = Math.round(((sd2 * (view.W + 40) - view.cpx * par) % (view.W + 40) + view.W + 40) % (view.W + 40)) - 20;
    const head = Math.round((sd * view.H + tm * (30 + sd * 50)) % (view.H + 60)) - 30;
    const col = i % 3 ? '#19ff9c' : '#2fe6ff';
    for (let k = 0; k < 9; k++) {
      const y = head - k * 4; if (y < 0 || y > view.gy + 30) continue;
      g.globalAlpha = (1 - k / 9) * (0.25 + par);
      R(X, y, 1, 2, k === 0 ? '#e8fff6' : col);
    }
  }
  g.globalAlpha = 1;
}

/* ------------------------------------------------------------------ theme table */
const WIN = ['#2fe6ff', '#ffc43d', '#ff3d9d', '#8fd8ff', '#ffd98a'];
export const THEMES = {
  district: {
    name: 'NEON DISTRICT', bg: '#05070f',
    sky: districtSky,
    layers: () => [
      buildStrip({ seed: 11, w: 720, h: 270, par: 0.08, dy: -34, hMin: 120, hMax: 250, wMin: 44, wMax: 96, body: '#1a2152', edge: '#2d3a85', win: 0.05, wx: 6, wy: 7, winCols: ['#4a5cc8', '#6d4cc8'], fog: '#6a2c8a', fogA: 0.55, bottom: '#2a1d5e', beacon: true, signs: 0 }),
      buildStrip({ seed: 23, w: 640, h: 230, par: 0.18, dy: -18, hMin: 70, hMax: 200, wMin: 30, wMax: 66, body: '#141b45', edge: '#27337a', win: 0.12, wx: 5, wy: 6, winCols: WIN, fog: '#4c2380', fogA: 0.5, bottom: '#1b1650', beacon: true, signs: 0.2, signScale: 1 }),
      buildStrip({ seed: 37, w: 600, h: 190, par: 0.34, dy: 2, hMin: 60, hMax: 160, wMin: 28, wMax: 58, body: '#0f1536', edge: '#1f2b66', win: 0.16, wx: 5, wy: 6, winCols: WIN, fog: '#321a64', fogA: 0.45, bottom: '#120f36', beacon: true, signs: 0.4, signScale: 1 }),
      buildStrip({ seed: 51, w: 560, h: 150, par: 0.55, dy: 22, hMin: 46, hMax: 120, wMin: 26, wMax: 54, body: '#0a0e26', edge: '#18225a', win: 0.14, wx: 5, wy: 6, winCols: WIN, fog: '#1e1248', fogA: 0.4, bottom: '#0a0c24', beacon: false, signs: 0.35, signScale: 2 }),
    ],
    ambient: (view, tm, i) => { if (i === 1) drawCars(view, tm); },
    overlay: drawRain,
    plat: { top: '#2fe6ff', top2: '#1f93a8', top3: '#7ff2ff', base: '#0c1327', tiles: ['#101a31', '#12203a', '#0e1830', '#111d36'], seamL: '#1b2c4d', seamD: '#080d1b', rivet: '#2c4170',
      hazard: '#e8b200', conduit: ['#ff3d9d', '#2fe6ff'], pipe: '#17233f', pipeL: '#2a3d6a', screen: '#2fe6ff', glow: '#2fe6ff', lamp: '#ff3d9d' },
  },
  complex: {
    name: 'SECURITY COMPLEX', bg: '#06090d',
    sky: complexSky,
    layers: () => [
      buildFacility({ seed: 13, w: 720, h: 260, par: 0.1, dy: -30, hMin: 150, hMax: 250, wMin: 60, wMax: 120, body: '#0f1c22', edge: '#25424c', stripes: 0.15, lamps: 0.25, screens: 0.2, pipes: 3, pipeCol: '#1a2c33', fog: '#0c2a33', fogA: 0.5, bottom: '#0b1d24' }),
      buildFacility({ seed: 29, w: 640, h: 210, par: 0.22, dy: -10, hMin: 90, hMax: 190, wMin: 40, wMax: 90, body: '#0d171c', edge: '#2a4a55', stripes: 0.3, lamps: 0.35, screens: 0.35, pipes: 4, pipeCol: '#22343c', fog: '#0a222a', fogA: 0.45, bottom: '#09161b' }),
      buildFacility({ seed: 43, w: 560, h: 160, par: 0.45, dy: 18, hMin: 50, hMax: 140, wMin: 34, wMax: 70, body: '#0a1216', edge: '#2d4f59', stripes: 0.45, lamps: 0.3, screens: 0.3, pipes: 3, pipeCol: '#2b3d44', fog: '#071a20', fogA: 0.4, bottom: '#070f12' }),
    ],
    ambient: (view, tm, i) => { if (i === 0) drawShafts(view, tm); },
    overlay: drawSteam,
    plat: { top: '#e6f6ff', top2: '#5fb8c8', top3: '#ffffff', base: '#0c1418', tiles: ['#121c21', '#141f25', '#10191e', '#131d22'], seamL: '#24363e', seamD: '#060a0c', rivet: '#3b5660',
      hazard: '#f2b705', conduit: ['#2fe6ff', '#f2b705'], pipe: '#1b2a30', pipeL: '#33505a', screen: '#ff3b4a', glow: '#bff6ff', lamp: '#f2b705' },
  },
  core: {
    name: 'CYBER CORE', bg: '#010303',
    sky: coreSky,
    layers: () => [
      buildRacks({ seed: 17, w: 640, h: 240, par: 0.12, dy: -24, hMin: 60, hMax: 170, wMin: 20, wMax: 36, body: '#06110d', edge: '#12352a', leds: 0.08, led: '#19ff9c', fog: '#03140e', fogA: 0.6, bottom: '#020a07' }),
      buildRacks({ seed: 31, w: 600, h: 190, par: 0.3, dy: 0, hMin: 70, hMax: 180, wMin: 18, wMax: 30, body: '#071510', edge: '#164036', leds: 0.12, led: '#2fe6ff', fog: '#021009', fogA: 0.5, bottom: '#020805' }),
      buildRacks({ seed: 47, w: 560, h: 150, par: 0.52, dy: 20, hMin: 40, hMax: 130, wMin: 16, wMax: 28, body: '#050e0b', edge: '#1a4a3c', leds: 0.15, led: '#19ff9c', fog: '#010805', fogA: 0.45, bottom: '#010604' }),
    ],
    ambient: (view, tm, i) => { if (i === 1) drawCorePulse(view, tm); if (i === 2) drawDataStreams(view, tm); },
    overlay: null,
    plat: { top: '#19ff9c', top2: '#0f8a5a', top3: '#c8ffe8', base: '#030a08', tiles: ['#06110d', '#071410', '#050f0b', '#06130f'], seamL: '#0f2e22', seamD: '#010403', rivet: '#1f5a44',
      hazard: '#19ff9c', conduit: ['#19ff9c', '#2fe6ff'], pipe: '#08201a', pipeL: '#1a4a3c', screen: '#19ff9c', glow: '#19ff9c', lamp: '#2fe6ff' },
  },
};
export const THEME_NAMES = Object.keys(THEMES);
