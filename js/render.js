'use strict';
/* =====================================================================
   Renderer. Everything is drawn into a low-resolution canvas (≈270px tall)
   that CSS scales up with nearest-neighbour filtering. Background layers,
   platforms and props are generated procedurally ONCE (seeded) and then
   blitted, so the per-frame cost is a few dozen drawImage calls.
   ===================================================================== */
const view = { W: 480, H: 270, css: 3, gy: 200, camX: 3, camY: 0, cpx: 0, cpy: 0, sky: null, vig: null };
let screenEl = null, screenCtx = null, gameEl = null, heroCtx = null;
const ART = { layers: [], plats: [], props: {}, ready: false };

const sx = wx => Math.round(wx * PPU) - view.cpx + (view.W >> 1);
const sy = wy => view.gy + view.cpy - Math.round(wy * PPU);

/* ------------------------------------------------------------------ sizing */
function resizeView() {
  const dpr = window.devicePixelRatio || 1;
  const cw = Math.max(1, gameEl.clientWidth), ch = Math.max(1, gameEl.clientHeight);
  const zq = /[?&]zoom=(\d+)/.exec(location.search);                  // dev override: ?zoom=4
  const dev = zq ? +zq[1] : Math.max(2, Math.round(ch * dpr / 270));  // device pixels per art pixel (integer → crisp)
  const css = dev / dpr;
  view.css = css;
  view.W = Math.min(760, Math.ceil(cw / css)); view.H = Math.ceil(ch / css);
  screenEl.width = view.W; screenEl.height = view.H;
  screenEl.style.width = (view.W * css) + 'px'; screenEl.style.height = (view.H * css) + 'px';
  screenCtx.imageSmoothingEnabled = false;
  view.gy = Math.round(view.H * 0.74);
  buildSky(); buildVignette();
}

function buildSky() {
  const [c, x] = makeCanvas(view.W, view.H);
  const r = seeded(99);
  withCtx(x, () => {
    const stops = ['#05071a', '#080b24', '#0c1030', '#120f3a', '#1a1044', '#27134f', '#3a1558', '#561862', '#701b66'];
    const bandH = Math.ceil((view.gy + 40) / stops.length);
    for (let i = 0; i < stops.length; i++) R(0, i * bandH, view.W, bandH + 1, stops[i]);
    R(0, stops.length * bandH, view.W, view.H, stops[stops.length - 1]);
    for (let i = 0; i < 90; i++) {                                  // stars
      const sxp = (r() * view.W) | 0, syp = (r() * view.gy * 0.7) | 0, b = r();
      px(sxp, syp, b > 0.85 ? '#ffffff' : b > 0.5 ? '#9aa8ff' : '#4a5496');
    }
    const mx = (view.W * 0.76) | 0, my = (view.gy * 0.27) | 0;       // big hazy moon
    glow(mx, my, '#ff3d9d', 60, 0.5); glow(mx, my, '#7a5cff', 44, 0.4);
    disc(mx, my, 24, '#c9b7ff'); disc(mx, my, 22, '#d9ccff');
    disc(mx + 6, my - 4, 5, '#b8a4f0'); disc(mx - 8, my + 7, 4, '#b8a4f0'); disc(mx - 3, my - 11, 3, '#bba8f4');
    for (let yy = -24; yy <= 24; yy += 1) {                           // dark crescent shading
      const hw = Math.round(Math.sqrt(24 * 24 - yy * yy));
      R(mx + hw - 7, my + yy, 7, 1, 'rgba(60,30,120,0.35)');
    }
  });
  view.sky = c;
}
function buildVignette() {
  const [c, x] = makeCanvas(view.W, view.H);
  const grad = x.createRadialGradient(view.W / 2, view.H * 0.5, view.H * 0.35, view.W / 2, view.H * 0.5, view.H * 0.95);
  grad.addColorStop(0, 'rgba(0,0,0,0)'); grad.addColorStop(1, 'rgba(2,4,12,0.55)');
  x.fillStyle = grad; x.fillRect(0, 0, view.W, view.H);
  view.vig = c;
}

/* ------------------------------------------------------------------ background strips */
const SIGN_TEXT = ['BAR', 'NOODLE', 'SYNTH', 'HOTEL', 'CYBER', '24H', 'ARCADE', 'NEXUS', 'TECH', 'CLINIC', 'OPEN', 'DRONE', 'RAMEN', 'CHIP', 'NEON', 'SHIFT'];
const SIGN_COL = ['#2fe6ff', '#ff3d9d', '#ffc43d', '#a58bff', '#4dff9d'];

function buildStrip(o) {
  const [c, x] = makeCanvas(o.w, o.h), r = seeded(o.seed), lights = [];
  withCtx(x, () => {
    let bx = 0;
    while (bx < o.w) {
      let bw = Math.round(o.wMin + r() * (o.wMax - o.wMin));
      if (bx + bw > o.w || o.w - (bx + bw) < o.wMin * 0.6) bw = o.w - bx;
      const bh = Math.round(o.hMin + r() * (o.hMax - o.hMin)), top = o.h - bh;
      const body = mix(o.body, o.edge, r() * 0.18);
      R(bx, top, bw, bh, body);
      R(bx + bw - 3, top, 3, bh, mix(body, '#000000', 0.25));          // shaded side
      R(bx, top, bw, 1, o.edge);
      if (r() < 0.5) R(bx, top + 1, bw, 1, mix(o.edge, body, 0.55));
      /* windows */
      const chance = o.win * (0.25 + 1.5 * r());
      for (let wy = top + 7; wy < o.h - 4; wy += o.wy) for (let wx = bx + 4; wx < bx + bw - 6; wx += o.wx)
        if (r() < chance) R(wx, wy, 2, o.wy > 5 ? 3 : 2, o.winCols[(r() * o.winCols.length) | 0]);
      /* roof clutter */
      const roof = r();
      if (roof < 0.28) { const ah = 8 + ((r() * 16) | 0), ax = bx + 3 + ((r() * (bw - 6)) | 0); R(ax, top - ah, 1, ah, o.edge); if (o.beacon) lights.push({ x: ax, y: top - ah, color: '#ff3b4a', r: 5, kind: 'beacon', ph: r() * 6 }); }
      else if (roof < 0.5) { R(bx + 4, top - 4, Math.min(10, bw - 8), 4, mix(body, o.edge, 0.4)); R(bx + 4, top - 4, Math.min(10, bw - 8), 1, o.edge); }
      else if (roof < 0.62) { const tw = 8; R(bx + 6, top - 9, tw, 7, mix(body, '#000', 0.2)); R(bx + 6, top - 9, tw, 1, o.edge); R(bx + 7, top - 2, 1, 2, o.edge); R(bx + 12, top - 2, 1, 2, o.edge); }
      /* neon sign */
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
    /* atmospheric fog: stronger toward the bottom */
    const bands = 8;
    for (let i = 0; i < bands; i++) {
      const y0 = Math.round(o.h * (0.25 + 0.75 * i / bands));
      g.globalAlpha = o.fogA * ((i + 1) / bands); R(0, y0, o.w, o.h - y0, o.fog); g.globalAlpha = 1;
    }
  });
  return { c, w: o.w, h: o.h, lights, par: o.par, dy: o.dy, bottom: o.bottom };
}

function buildBackground() {
  const WIN = ['#2fe6ff', '#ffc43d', '#ff3d9d', '#8fd8ff', '#ffd98a'];
  ART.layers = [
    buildStrip({ seed: 11, w: 720, h: 270, par: 0.08, dy: -34, hMin: 120, hMax: 250, wMin: 44, wMax: 96, body: '#1a2152', edge: '#2d3a85', win: 0.05, wx: 6, wy: 7, winCols: ['#4a5cc8', '#6d4cc8'], fog: '#6a2c8a', fogA: 0.55, bottom: '#2a1d5e', beacon: true, signs: 0 }),
    buildStrip({ seed: 23, w: 640, h: 230, par: 0.18, dy: -18, hMin: 70, hMax: 200, wMin: 30, wMax: 66, body: '#141b45', edge: '#27337a', win: 0.12, wx: 5, wy: 6, winCols: WIN, fog: '#4c2380', fogA: 0.5, bottom: '#1b1650', beacon: true, signs: 0.2, signScale: 1 }),
    buildStrip({ seed: 37, w: 600, h: 190, par: 0.34, dy: 2, hMin: 60, hMax: 160, wMin: 28, wMax: 58, body: '#0f1536', edge: '#1f2b66', win: 0.16, wx: 5, wy: 6, winCols: WIN, fog: '#321a64', fogA: 0.45, bottom: '#120f36', beacon: true, signs: 0.4, signScale: 1 }),
    buildStrip({ seed: 51, w: 560, h: 150, par: 0.55, dy: 22, hMin: 46, hMax: 120, wMin: 26, wMax: 54, body: '#0a0e26', edge: '#18225a', win: 0.14, wx: 5, wy: 6, winCols: WIN, fog: '#1e1248', fogA: 0.4, bottom: '#0a0c24', beacon: false, signs: 0.35, signScale: 2 }),
  ];
}

/* ------------------------------------------------------------------ platforms */
function buildPlatformSprite(x1, x2, py, idx) {
  const w = Math.round((x2 - x1) * PPU), r = seeded(500 + idx * 31);
  const ground = py === 0, h = ground ? 260 : 30;
  const [c, x] = makeCanvas(w, h);
  withCtx(x, () => {
    if (ground) {
      R(0, 0, w, h, '#0c1327');
      const cols = ['#101a31', '#12203a', '#0e1830', '#111d36'];
      for (let ty = 8; ty < h; ty += 20) for (let tx = 0; tx < w; tx += 20) {
        const col = cols[(r() * cols.length) | 0];
        R(tx, ty, 20, 20, col); R(tx, ty, 20, 1, '#1b2c4d'); R(tx, ty + 19, 20, 1, '#080d1b'); R(tx + 19, ty, 1, 20, '#080d1b');
        if (r() < 0.55) { px(tx + 2, ty + 2, '#2c4170'); px(tx + 17, ty + 2, '#2c4170'); px(tx + 2, ty + 16, '#1d2c4d'); px(tx + 17, ty + 16, '#1d2c4d'); }
        if (r() < 0.07) { R(tx + 4, ty + 6, 12, 8, '#070b17'); for (let s = 0; s < 4; s++) R(tx + 5, ty + 7 + s * 2, 10, 1, '#16213b'); }       // vents
        if (r() < 0.05) { R(tx + 6, ty + 5, 8, 10, '#06222c'); R(tx + 7, ty + 7, 6, 1, '#2fe6ff'); R(tx + 7, ty + 10, 4, 1, '#1b8aa0'); R(tx + 7, ty + 12, 5, 1, '#2fe6ff'); }  // screens
      }
      for (let k = 0; k < Math.max(2, w / 160); k++) {                           // glowing conduit strips
        const ty = 8 + 20 * (2 + ((r() * 8) | 0)) + 9, tx = (r() * w * 0.7) | 0, len = 50 + ((r() * 160) | 0);
        const col = r() < 0.5 ? '#ff3d9d' : '#2fe6ff';
        x.globalAlpha = 0.22; R(tx, ty - 2, len, 5, col); x.globalAlpha = 1; R(tx, ty, len, 1, col);
      }
      for (let k = 0; k < w / 120; k++) {                                        // hazard bands
        const tx = (r() * (w - 60)) | 0, ty = 28;
        if (r() < 0.45) for (let i = 0; i < 48; i++) { R(tx + i, ty, 1, 6, ((i + 6) >> 2) % 2 ? '#e8b200' : '#10131f'); }
      }
      for (let k = 0; k < w / 90; k++) { const tx = (r() * w) | 0; R(tx, 8, 4, h, '#17233f'); R(tx, 8, 1, h, '#2a3d6a'); R(tx + 3, 8, 1, h, '#0a1020'); }   // pipes
      R(0, 0, w, 3, '#2fe6ff'); R(0, 3, w, 1, '#1f93a8'); R(0, 4, w, 2, '#143a52'); R(0, 6, w, 2, '#0e2036');
      for (let i = 0; i < 6; i++) { x.globalAlpha = 0.07 * (i + 1); R(0, 60 + i * 34, w, 34, '#02040a'); x.globalAlpha = 1; }
      R(0, 0, 1, h, '#1f93a8'); R(w - 1, 0, 1, h, '#1f93a8'); R(1, 0, 1, h, '#0b1426'); R(w - 2, 0, 1, h, '#0b1426');
    } else {
      R(0, 6, w, 15, '#0f172d'); R(0, 6, w, 1, '#1b2c4d'); R(0, 20, w, 1, '#070b17');
      for (let tx = 10; tx < w - 10; tx += 20) { R(tx, 9, 1, 9, '#1a2745'); }
      for (let i = 0; i < w; i++) { if ((i >> 3) % 2) R(i, 17, 1, 3, '#d9a400'); else R(i, 17, 1, 3, '#0a0d18'); }
      R(0, 3, w, 3, '#2fe6ff'); R(0, 6, w, 1, '#1b8aa0'); R(0, 2, w, 1, '#7ff2ff');
      for (let tx = 14; tx < w - 8; tx += 26) { R(tx, 22, 3, 3, '#ff3d9d'); x.globalAlpha = 0.35; R(tx - 1, 22, 5, 5, '#ff3d9d'); x.globalAlpha = 1; }
      R(0, 6, 2, 15, '#0a1224'); R(w - 2, 6, 2, 15, '#0a1224');
      x.globalAlpha = 0.18; R(2, 21, w - 4, 4, '#ff3d9d'); x.globalAlpha = 1;
    }
  });
  return { c, x1, x2, py, ground, topOff: ground ? 3 : 4 };
}

/* ------------------------------------------------------------------ props */
function buildProp(d) {
  const r = seeded(d.seed), col = d.hue ? '#ff3d9d' : '#2fe6ff';
  let w = 24, h = 24, light = null;
  const draw = fn => { const [c, x] = makeCanvas(w, h); withCtx(x, () => fn(x)); return { c, w, h, light, type: d.type }; };
  switch (d.type) {
    case 'lamp': w = 30; h = 58; light = { x: 24, y: 6, color: d.hue ? '#ff3d9d' : '#7ff2ff', r: 22 };
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

function buildArt() {
  buildBackground();
  ART.plats = PLAT.map((p, i) => buildPlatformSprite(p[0], p[1], p[2], i));
  for (const d of DECOR) d.sprite = buildProp(d);
  ART.chipIcons = {}; for (const id of CHIP_ORDER) ART.chipIcons[id] = makeChipIcon(id);
  ART.ready = true;
}

/* ------------------------------------------------------------------ frame */
function tileXs(par, sw, cb) {
  const x0 = -((((view.cpx * par) % sw) + sw) % sw);
  for (let xx = Math.round(x0); xx < view.W; xx += sw) cb(xx);
}
function drawStrip(L) {
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

function drawCars() {
  const tm = Game.time, par = 0.28;
  for (let i = 0; i < 5; i++) {
    const sp = 14 + i * 7, dir = i % 2 ? -1 : 1, len = view.W + 160;
    let xx = ((tm * sp * dir + i * 137) % len + len) % len - 80;
    const yy = view.gy - 70 - i * 17 + Math.round(view.cpy * par);
    R(xx, yy, 7, 2, '#0a0e22'); R(xx + (dir > 0 ? 6 : 0), yy, 1, 2, '#ffe9a8');
    px(xx + (dir > 0 ? 0 : 6), yy, '#ff3b4a');
    g.globalAlpha = 0.5; R(xx - dir * 8 + (dir > 0 ? 0 : 7), yy, 8, 1, '#ff3b4a'); g.globalAlpha = 1;
    glow(xx + (dir > 0 ? 7 : 0), yy, '#ffe9a8', 6, 0.6);
  }
}

function drawPlatforms() {
  for (const P of ART.plats) {
    const X = sx(P.x1), Y = sy(P.py);
    if (X > view.W + 4 || X + P.c.width < -4) continue;
    g.drawImage(P.c, X, Y);
    if (P.ground) { g.globalAlpha = 0.2; R(X + 1, Y - 2, P.c.width - 2, 2, '#2fe6ff'); g.globalAlpha = 0.08; R(X + 1, Y - 5, P.c.width - 2, 3, '#2fe6ff'); g.globalAlpha = 1; }
    else { g.globalAlpha = 0.16; R(X + 2, Y - 2, P.c.width - 4, 2, '#7ff2ff'); g.globalAlpha = 1; }
  }
}

function drawProps() {
  const tm = Game.time;
  for (const d of DECOR) {
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

function drawCheckpoints() {
  const tm = Game.time;
  for (const cp of CHECKPOINTS.slice(1)) {
    const X = sx(cp), Y = sy(0), on = player.checkpoint >= cp;
    if (X < -30 || X > view.W + 30) continue;
    R(X - 1, Y - 44, 3, 44, '#15203b'); R(X - 1, Y - 44, 1, 44, '#2a3d6a');
    R(X - 4, Y - 48, 9, 5, '#0a0f1e'); R(X - 4, Y - 48, 9, 1, on ? '#2fe6ff' : '#34498c');
    R(X - 2, Y - 46, 5, 2, on ? '#7ff2ff' : '#26385f');
    if (on) { glow(X, Y - 46, '#2fe6ff', 20, 0.7 + 0.2 * Math.sin(tm * 4)); g.globalAlpha = 0.12; R(X - 2, 0, 5, Y - 46, '#2fe6ff'); g.globalAlpha = 1; }
    else glow(X, Y - 46, '#34498c', 8, 0.4);
  }
}

function drawPickups() {
  const tm = Game.time;
  for (const pk of PICKUPS) {
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

function drawPortal() {
  const tm = Game.time, X = sx(EXIT_X), Y = sy(0);
  if (X < -60 || X > view.W + 60) return;
  const done = Game.kills >= enemies.length;
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

function drawForeground() {
  const par = 1.38;
  for (const f of FG) {
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

function drawRain() {
  const tm = Game.time;
  g.globalAlpha = 0.28;
  for (let i = 0; i < 70; i++) {
    const sd = (i * 7919) % 1000 / 1000, sd2 = (i * 104729) % 1000 / 1000;
    const spd = 160 + sd * 90;
    const X = Math.round(((sd2 * (view.W + 60) - tm * 38 - 0) % (view.W + 60) + view.W + 60) % (view.W + 60)) - 10;
    const Y = Math.round(((sd * view.H + tm * spd) % (view.H + 20)) - 10);
    line(X, Y, X - 1, Y + 4, 1, '#9ec7ff');
  }
  g.globalAlpha = 1;
}

function drawShadow(wx, wy, wpx) {
  const X = sx(wx), Y = sy(wy);
  g.globalAlpha = 0.32; R(X - (wpx >> 1), Y - 1, wpx, 3, '#000000'); R(X - (wpx >> 1) + 2, Y - 2, wpx - 4, 1, '#000000'); g.globalAlpha = 1;
}

function drawEnemyEntity(e) {
  const X = sx(e.x) + (e.shake > 0 ? ((Math.random() * 3) | 0) - 1 : 0), Y = sy(e.y);
  if (X < -60 || X > view.W + 60) return;
  drawShadow(e.x, e.y, e.kind === 'warden' ? 26 : 18);
  drawEnemy(e, X, Y);
  const top = Y - (e.kind === 'warden' ? 56 : 46);
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

function drawEnemyBullet(b) {
  const X = sx(b.x), Y = sy(b.y);
  for (let k = 1; k <= 3; k++) { g.globalAlpha = 0.5 / k; R(X - Math.sign(b.vx) * k * 3 - 1, Y - 1, 3, 3, '#ff6a5a'); }
  g.globalAlpha = 1;
  disc(X, Y, 3, '#0a0508'); disc(X, Y, 2, '#ff3b4a'); px(X, Y, '#fff0c8'); px(X - 1, Y - 1, '#ffb347');
  glow(X, Y, '#ff3b4a', 11, 0.8);
}
function drawPlayerBullet(b) {
  const X = sx(b.x), Y = sy(b.y), s = Math.sign(b.vx), refl = b.reflected;
  const c1 = refl ? ACCENT.shield.m : '#ffc43d', c2 = refl ? '#ffffff' : '#fff3b8';
  g.globalAlpha = 0.45; R(X - s * 14 - (s < 0 ? 0 : 0), Y - 1, 14, 3, c1); g.globalAlpha = 1;
  R(X - 6, Y - 2, 12, 5, '#05070e'); R(X - 5, Y - 1, 10, 3, c1); R(X - 4, Y, 9, 1, c2);
  glow(X, Y, c1, 14, 0.85);
}

function drawPlayerEntity() {
  const p = player;
  const X = sx(p.x), Y = sy(p.y);
  if (p.onGround && !p.dead) { drawShadow(p.x, p.y, 16); glow(X, Y, ACCENT[p.chip].m, 14, 0.18); }
  if (p.dead && p.deadT > 0.45) return;                                         // disintegrated
  const blinkOff = p.inv > 0 && p.inv < 90 && !p.dead && p.hurtT <= 0 && ((p.inv * 18) | 0) % 2 === 0 && p.dash <= 0;
  const ov = null;
  if (blinkOff) g.globalAlpha = 0.45;
  drawPlayer(p, X, Y, ov);
  g.globalAlpha = 1;
}

function drawBoxes() {
  g.globalAlpha = 0.9;
  const rect = (x0, y0, x1, y1, c) => { const a = sx(x0), b = sy(y1), w = sx(x1) - a, h = sy(y0) - b; R(a, b, w, 1, c); R(a, b + h, w, 1, c); R(a, b, 1, h, c); R(a + w, b, 1, h, c); };
  for (const bx of dbgBoxes) rect(bx.x0, bx.y0, bx.x1, bx.y1, '#ffff00');
  for (const e of enemies) if (e.alive) { const h = hurtbox(e); rect(h.x0, h.y0, h.x1, h.y1, '#ff4040'); }
  rect(player.x - 0.35, player.y, player.x + 0.35, player.y + 1.7, '#40ff80');
  g.globalAlpha = 1;
}

function renderFrame() {
  const tm = Game.time;
  view.cpx = Math.round(view.camX * PPU) + FX.shakeX;
  view.cpy = Math.round(view.camY * PPU) + FX.shakeY;
  g = screenCtx;
  g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  g.drawImage(view.sky, 0, 0);
  for (let i = 0; i < 6; i++) { const a = ((tm * 0.7 + i * 1.7) % 3) < 0.12 ? 1 : 0; if (a) px((i * 97 + 13) % view.W, 12 + (i * 31) % 60, '#ffffff'); }
  drawStrip(ART.layers[0]); drawStrip(ART.layers[1]); drawCars(); drawStrip(ART.layers[2]); drawStrip(ART.layers[3]);
  drawPlatforms();
  drawProps();
  drawCheckpoints(); drawPortal(); drawPickups();
  for (const e of enemies) if (e.alive) drawEnemyEntity(e);
  FX.drawBelow();
  drawPlayerEntity();
  FX.drawSlashes(); FX.drawBeams();
  for (const b of bullets) drawPlayerBullet(b);
  for (const b of enemyBullets) drawEnemyBullet(b);
  FX.drawParticles();
  FX.drawTexts();
  drawForeground();
  drawRain();
  if (Game.showBoxes) drawBoxes();
  g.drawImage(view.vig, 0, 0);
  if (player.hp <= 2 && player.hp > 0 && Game.running) {                          // low-integrity warning pulse
    g.globalAlpha = 0.07 + 0.06 * Math.sin(tm * 6); R(0, 0, view.W, 4, '#ff2d5f'); R(0, view.H - 4, view.W, 4, '#ff2d5f'); R(0, 0, 4, view.H, '#ff2d5f'); R(view.W - 4, 0, 4, view.H, '#ff2d5f'); g.globalAlpha = 1;
  }
  FX.drawScreenFlash(view.W, view.H);
}

/* title-screen hero: the ninja idling in the menu panel */
function drawHero() {
  if (!heroCtx) return;
  const prev = g;
  heroCtx.clearRect(0, 0, 72, 84);
  g = heroCtx;
  const sc = new Float32Array(SCARF_N * 2), tm = Game.time;
  for (let i = 0; i < SCARF_N; i++) { sc[i * 2] = -4 - i * 3 - Math.sin(tm * 3 + i) * 1.5; sc[i * 2 + 1] = -33 + i * 1.2 + Math.sin(tm * 4 + i * 0.8) * 1.6; }
  const chip = CHIP_ORDER[((tm / 2.2) | 0) % CHIP_ORDER.length];
  drawPlayer({ facing: 1, anim: 'idle', t: tm, run: 0, chip, atkStep: 0, atkU: 0, shieldAmt: chip === 'shield' ? 0.6 : 0, parryT: 0, blockFlash: 0, recoil: 0, muzzle: 0, xf: 1, rot: 0, warpU: 0, scarf: sc }, 30, 74);
  g = prev;
}
