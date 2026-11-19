import { R, disc, g, glow, line, makeCanvas, mix, px, withCtx } from './pixel.js';
import { DEG, clamp, easeOutBack, lerp, smooth } from '../core/util.js';

/* =====================================================================
   Procedural pixel-art characters.

   Instead of hand-keyed sprite sheets the ninja and the robots are built
   from a tiny skeleton (hip / chest / head / two-bone legs and arms) that is
   rasterised every frame as chunky outlined pixel limbs. That gives smooth
   run cycles, attack keyframes, a somersault double-jump and animated
   chip transformations from a few dozen lines, and every pixel lands on the
   art grid so it stays crisp.

   Local pose space: x = forward, y = up, origin = centre of the feet.
   ===================================================================== */
export const PAL = {
  ol: '#04060c',                                           // outline
  s0: '#101a36', s1: '#22326a', s2: '#33489a', s3: '#5572d0', // suit (blue steel)
  p0: '#3c4a78', p1: '#8092c4', p2: '#c4d0f2',             // armour plates
  mg0: '#8f1259', mg1: '#ff3d9d', mg2: '#ffa6d6',          // scarf
  wh: '#ffffff',
};
export const ACCENT = {           // one accent colour per chip: visor, core, arm glow
  blade:  { d: '#0e7f9c', m: '#2fe6ff', l: '#d6fdff', name: 'CYAN' },
  cannon: { d: '#b8700c', m: '#ffc43d', l: '#fff3b8', name: 'AMBER' },
  shield: { d: '#5a3fc0', m: '#a58bff', l: '#ece4ff', name: 'VIOLET' },
  blink:  { d: '#a3146f', m: '#ff4fc0', l: '#ffd0f0', name: 'PINK' },
};
export const EN = {               // enemy palette: gunmetal + hot red / amber
  o: '#06070d', g0: '#1d2340', g1: '#323f6c', g2: '#4c5e98', g3: '#8294cc',
  r0: '#7a1224', r1: '#ff3b4a', r2: '#ffb347', am: '#ffb02e', am0: '#8a5400', wh: '#ffffff',
};

/* ------------------------------------------------------------------ transform helpers */
export let _ox = 0, _oy = 0, _f = 1, _rc = 1, _rs = 0, _rotOn = false, _pv = 18, OV = null, TX = 0, TY = 0;

export function T(x, y) {                         // local pose space -> screen pixels (TX,TY)
  if (_rotOn) { const dy = y - _pv, rx = x * _rc - dy * _rs, ry = x * _rs + dy * _rc; x = rx; y = ry + _pv; }
  TX = _ox + _f * x; TY = _oy - y;
}
export function ovc(c) { return OV ? (c === PAL.ol && OV.keepOutline ? c : OV.fill) : c; }
export function L(x0, y0, x1, y1, t, c) {
  if (c == null) return;
  T(x0, y0); const ax = TX, ay = TY; T(x1, y1);
  line(ax, ay, TX, TY, t, ovc(c));
}
export function D(x, y, r, c) { T(x, y); disc(TX, TY, r, ovc(c)); }
export function P1(x, y, c) { T(x, y); px(TX, TY, ovc(c)); }
export function LA(cx, cy, r, a0, a1, t, c) {      // arc in local space
  const n = Math.max(4, Math.ceil(Math.abs(a1 - a0) * r / 1.2));
  for (let i = 0; i <= n; i++) {
    const a = a0 + (a1 - a0) * (i / n);
    T(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    g.fillStyle = ovc(c); g.fillRect(Math.round(TX) - (t >> 1), Math.round(TY) - (t >> 1), t, t);
  }
}
export function GL(x, y, color, r, a) { if (OV) return; T(x, y); glow(TX, TY, color, r, a); }

/* limb chain: outline pass first, then fill, then a 1px rim-light on the forward edge */
export const KN = { x: 0, y: 0 };
export function ik2(hx, hy, fx, fy, l1, l2, bend) {            // bend +1: knee forward (for legs hanging down)
  let dx = fx - hx, dy = fy - hy, d = Math.hypot(dx, dy);
  const mx = l1 + l2 - 0.05;
  if (d > mx) { dx *= mx / d; dy *= mx / d; d = mx; }
  if (d < 1) d = 1;
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d), h2 = l1 * l1 - a * a, h = h2 > 0 ? Math.sqrt(h2) : 0;
  const ux = dx / d, uy = dy / d;
  KN.x = hx + ux * a + (-uy) * h * bend; KN.y = hy + uy * a + ux * h * bend;
}
export function limb(ax, ay, bx, by, cx, cy, t1, t2, fill, edge, hi) {
  L(ax, ay, bx, by, t1 + 2, edge); L(bx, by, cx, cy, t2 + 2, edge);
  L(ax, ay, bx, by, t1, fill); L(bx, by, cx, cy, t2, fill);
  if (hi) { L(ax + 1, ay, bx + 1, by, 1, hi); L(bx + 1, by, cx + 1, cy, 1, hi); }
}

/* ------------------------------------------------------------------ player pose */
export const Q = { hipH: 17, lean: 1, ffx: 5, ffy: 0, bfx: -4, bfy: 0, sx: 0, sy: 0, hx: 0, hy: 0, bhx: 0, bhy: 0 };
export const KK = [0, 0, 0, 0];
export const BLADE_KF = [   // [u, handDX, handDY, bladeAngleDeg, bladeLen] relative to the shoulder
  [[0, -5, 3, 150, 18], [.12, -6, 4, 160, 18], [.3, 9, -1, 15, 31], [.55, 11, -4, -35, 27], [1, 7, -6, 25, 20]],
  [[0, 8, -7, -40, 20], [.12, 9, -8, -55, 20], [.3, 8, 2, 40, 31], [.55, 2, 6, 115, 27], [1, 7, -6, 25, 20]],
  [[0, -2, 10, 100, 20], [.2, -3, 12, 115, 20], [.38, 10, -6, -60, 38], [.7, 11, -7, -75, 33], [1, 7, -6, 25, 20]],
];
export function kf(tab, u, out) {
  u = clamp(u, 0, 1);
  let i = 0; while (i < tab.length - 2 && u > tab[i + 1][0]) i++;
  const a = tab[i], b = tab[i + 1], t = smooth(clamp((u - a[0]) / ((b[0] - a[0]) || 1), 0, 1));
  for (let k = 0; k < 4; k++) out[k] = lerp(a[k + 1], b[k + 1], t);
}

export function poseOf(p) {
  const st = p.anim, ph = p.run || 0, t = p.t || 0;
  let hipH = 17, lean = 1, ffx = 5, ffy = 0, bfx = -4, bfy = 0;
  if (st === 'run') {
    const s1 = Math.sin(ph), c1 = Math.cos(ph);
    hipH = 16 - 1.8 * Math.abs(s1); lean = 4;
    ffx = 9 * s1 + 1; ffy = Math.max(0, c1) * 7.5;
    bfx = -9 * s1 + 1; bfy = Math.max(0, -c1) * 7.5;
  } else if (st === 'jump') { hipH = 15.5; ffx = 5; ffy = 6; bfx = -5; bfy = 2; }
  else if (st === 'fall') { hipH = 16.5; lean = 0; ffx = 3; ffy = 1.5; bfx = -4; bfy = 3.5; }
  else if (st === 'dash') { hipH = 14; lean = 9; ffx = -3; ffy = 3; bfx = -9; bfy = 0; }
  else if (st === 'hurt') { hipH = 16; lean = -3; ffx = 6; ffy = 3; bfx = -5; }
  else if (st === 'dead') { hipH = 15; lean = -5; ffx = 7; ffy = 2; bfx = -6; }
  else { hipH = 17 - (((t * 1.6) % 1) < 0.5 ? 0 : 1); ffx = 6; bfx = -5; }          // idle breathing

  const grounded = st === 'idle' || st === 'run';
  if (p.atkStep) {                                           // lunge into the swing
    const k = Math.sin(Math.PI * clamp(p.atkU, 0, 1));
    lean += (p.atkStep === 3 ? 6 : 3) * k;
    if (grounded) { ffx = lerp(ffx, 8, k * 0.8); bfx = lerp(bfx, -6, k * 0.8); ffy *= 1 - k; bfy *= 1 - k; hipH -= 1.5 * k; }
  }
  if (p.warpU > 0) { const w = p.warpU; lean += 8 * w; hipH -= 3.5 * w; ffx = lerp(ffx, 8, w); bfx = lerp(bfx, -8, w); ffy *= 1 - w; bfy *= 1 - w; }
  if (p.shieldAmt > 0.3) { hipH -= 1; ffx = lerp(ffx, 6, p.shieldAmt); bfx = lerp(bfx, -5, p.shieldAmt); }
  if (p.recoil > 0) lean -= 2 * p.recoil;
  if (p.landT > 0) hipH -= 2.5 * Math.min(1, p.landT / 0.1);

  Q.hipH = hipH; Q.lean = lean; Q.ffx = ffx; Q.ffy = ffy; Q.bfx = bfx; Q.bfy = bfy;
  Q.sx = lean + 0.5; Q.sy = hipH + 9;                         // shoulder
  Q.hx = lean * 1.2 + 1.5; Q.hy = hipH + 17.5 + (st === 'dash' ? -2 : 0);   // head centre
  Q.bhx = Q.sx - 2; Q.bhy = Q.sy - 9;                         // back hand
  if (st === 'run') {
    const s1 = Math.sin(ph);
    Q.bhx = Q.sx + 5 * s1; Q.bhy = Q.sy - 8 + Math.abs(Math.cos(ph)) * 1.5;
  } else if (st === 'jump') { Q.bhx = Q.sx - 5; Q.bhy = Q.sy - 2; }
  else if (st === 'fall') { Q.bhx = Q.sx - 4; Q.bhy = Q.sy + 3; }
  else if (st === 'dash') { Q.bhx = Q.sx - 7; Q.bhy = Q.sy - 3; }
  else if (st === 'hurt' || st === 'dead') { Q.bhx = Q.sx - 6; Q.bhy = Q.sy + 4; }
  return Q;
}

/* weapon arm target (hand position + weapon parameters) */
export const W = { hx: 0, hy: 0, ang: 0, len: 0 };
export function weaponArm(p) {
  const st = p.anim, S = Q, xf = p.xf === undefined ? 1 : p.xf, ext = easeOutBack(clamp(xf, 0, 1));
  let hx, hy, ang = 0, len = 0;
  switch (p.chip) {
    case 'blade':
      if (p.atkStep) { kf(BLADE_KF[p.atkStep - 1], p.atkU, KK); hx = S.sx + KK[0]; hy = S.sy + KK[1]; ang = KK[2]; len = KK[3]; }
      else if (st === 'run') { hx = S.sx - 1; hy = S.sy - 7; ang = 168; len = 20; }
      else if (st === 'dash') { hx = S.sx - 4; hy = S.sy - 4; ang = 188; len = 22; }
      else if (st === 'jump' || st === 'fall') { hx = S.sx + 5; hy = S.sy - 3; ang = 55; len = 20; }
      else if (st === 'hurt' || st === 'dead') { hx = S.sx + 3; hy = S.sy + 5; ang = 110; len = 14; }
      else { hx = S.sx + 7; hy = S.sy - 6; ang = 28; len = 20; }
      len *= ext;
      break;
    default: {                                                          // cannon: the arm tracks the aim angle
      if (st === 'dash') { hx = S.sx - 4; hy = S.sy - 5; ang = 180; }
      else {
        const a = p.aim || 0, c = Math.cos(a), s = Math.sin(a);
        hx = S.sx + c * 6.5; hy = S.sy + s * 6.5 - 1; ang = a / DEG;
        if (p.recoil > 0) { hx -= c * p.recoil * 3; hy -= s * p.recoil * 3; }
      }
      len = 14 * ext;
    }
  }
  W.hx = hx; W.hy = hy; W.ang = ang; W.len = len;
  return W;
}

export function drawBlade(hx, hy, angDeg, len, A, p) {
  if (len < 1) return;
  const a = angDeg * DEG, dx = Math.cos(a), dy = Math.sin(a);
  L(hx - dx * 2, hy - dy * 2, hx + dx * 3, hy + dy * 3, 3, PAL.p1);          // hilt / emitter
  const bx = hx + dx * 3, by = hy + dy * 3, ex = bx + dx * len, ey = by + dy * len;
  if (!OV) g.globalAlpha *= 0.45;
  L(bx, by, ex, ey, 5, A.m);
  if (!OV) g.globalAlpha /= 0.45;
  L(bx, by, ex, ey, 3, A.m);
  L(bx, by, ex, ey, 1, A.l);
  P1(ex, ey, A.l);
  GL((bx + ex) / 2, (by + ey) / 2, A.m, Math.min(13, 4 + (len >> 2)), 0.3);
}

export function drawCannon(hx, hy, angDeg, len, A, p) {
  const a = angDeg * DEG, dx = Math.cos(a), dy = Math.sin(a), nx = -dy, ny = dx;
  const x0 = hx - dx * 4, y0 = hy - dy * 4, x1 = hx + dx * 7, y1 = hy + dy * 7;
  L(x0, y0, x1, y1, 7, PAL.ol); L(x0, y0, x1, y1, 5, PAL.p0);
  L(x0 + nx, y0 + ny, x1 + nx, y1 + ny, 1, PAL.p1);
  const bx = hx + dx * 7, by = hy + dy * 7, ex = bx + dx * len, ey = by + dy * len;
  L(bx, by, ex, ey, 5, PAL.ol); L(bx, by, ex, ey, 3, PAL.p1);
  L(bx + dx, by + dy, ex, ey, 1, A.m);
  for (const k of [-1, 3, 7]) {                                              // energy coils
    const cx = hx + dx * k, cy = hy + dy * k;
    L(cx + nx * 3, cy + ny * 3, cx - nx * 3, cy - ny * 3, 1, A.m);
  }
  D(ex, ey, 1, A.l);
  GL(ex, ey, A.m, 5, 0.35 + 0.3 * (p.muzzle > 0 ? 1 : 0));
  if (p.charge > 0 && !OV) {                                                 // charging plasma orb
    const full = p.charge >= 1, pulse = ((p.t * (full ? 20 : 10)) | 0) % 2;
    const r = 1 + Math.round(p.charge * 4) + (full && pulse ? 1 : 0);
    T(ex + dx * 2, ey + dy * 2); disc(TX, TY, r + 1, A.d); disc(TX, TY, r, pulse ? PAL.wh : A.l);
    glow(TX, TY, A.m, 8 + Math.round(p.charge * 10), 0.4 + 0.5 * p.charge);
  }
  if (p.muzzle > 0) {                                                        // muzzle flash star
    const m = clamp(p.muzzle / 0.1, 0, 1), s = 4 + 6 * m;
    L(ex, ey, ex + dx * (s + 4), ey + dy * (s + 4), 3, A.l);
    L(ex - nx * s * 0.7, ey - ny * s * 0.7, ex + nx * s * 0.7, ey + ny * s * 0.7, 1, A.l);
    L(ex + dx * 2 - nx * s * 0.5, ey + dy * 2 - ny * s * 0.5, ex + dx * (s + 2), ey + dy * (s + 2), 1, A.m);
    L(ex + dx * 2 + nx * s * 0.5, ey + dy * 2 + ny * s * 0.5, ex + dx * (s + 2), ey + dy * (s + 2), 1, A.m);
    GL(ex + dx * 3, ey + dy * 3, A.l, 12, 0.8 * m);
  }
}

export function drawShield(hx, hy, R, p, A) {
  const s = p.shieldAmt || 0, parry = p.parryT > 0, hit = p.blockFlash > 0;
  const half = lerp(38, 62, s) * DEG;
  const cx = hx + 4 + 3 * s - R, cy = hy;                                    // arc centre sits behind the arm
  const bright = parry ? PAL.wh : hit ? A.l : A.m;
  if (!OV) {
    g.globalAlpha *= (0.14 + 0.2 * s + (parry ? 0.3 : 0) + (hit ? 0.25 : 0));
    for (let a = -half; a <= half; a += 0.08) {                              // hard-light fill, scan-lined
      T(cx + Math.cos(a) * (R - 1), cy + Math.sin(a) * R);
      const x1 = TX; T(cx + Math.cos(half) * R, cy + Math.sin(a) * R);
      line(x1, TY, TX, TY, 1, A.m);
    }
    g.globalAlpha /= (0.14 + 0.2 * s + (parry ? 0.3 : 0) + (hit ? 0.25 : 0));
  }
  LA(cx, cy, R + 1, -half, half, 3, PAL.ol);
  LA(cx, cy, R, -half, half, 3, A.d);
  LA(cx, cy, R, -half, half, 1, bright);
  LA(cx, cy, R - 3, -half * 0.75, half * 0.75, 1, A.m);
  if (s > 0.4) {                                                             // hex node details
    for (const k of [-0.5, 0, 0.5]) { T(cx + Math.cos(half * k) * R, cy + Math.sin(half * k) * R); if (!OV) px(TX, TY, A.l); }
  }
  GL(cx + R, cy, parry ? PAL.wh : A.m, 9 + (s * 5 | 0), 0.18 + 0.2 * s + (parry ? 0.5 : 0) + (hit ? 0.3 : 0));
  L(hx, hy, cx + R - 2, cy, 3, PAL.p1);                                      // emitter bracket
}

/* ------------------------------------------------------------------ the ninja */
export function drawPlayer(p, ox, oy, ov) {
  OV = ov || null;
  _ox = Math.round(ox); _oy = Math.round(oy); _f = p.facing;
  const rot = p.rot || 0; _rotOn = rot !== 0; if (_rotOn) { _rc = Math.cos(rot); _rs = Math.sin(rot); _pv = 17; }
  const A = ACCENT[p.chip] || ACCENT.blade;
  const prevAlpha = g.globalAlpha;
  if (ov && ov.alpha !== undefined) g.globalAlpha = prevAlpha * ov.alpha;
  const q = poseOf(p), hipH = q.hipH, lean = q.lean;
  const flash = p.flash > 0 && !OV;
  const tint = flash ? PAL.wh : null;
  const SU = flash ? '#cfd8ff' : PAL.s1, SU2 = flash ? '#e6ecff' : PAL.s2, PL = flash ? '#ffffff' : PAL.p0;
  const OLn = PAL.ol;

  /* ---- scarf (world-space chain, drawn first so it sits behind the body) ---- */
  if (p.scarf) {
    const sc = p.scarf, n = sc.length >> 1;
    for (let i = 0; i < n - 1; i++) {
      const w = i < 2 ? 3 : i < 5 ? 2 : 1;
      line(_ox + sc[i * 2], _oy + sc[i * 2 + 1], _ox + sc[i * 2 + 2], _oy + sc[i * 2 + 3], w, OV ? OV.fill : (i % 2 ? PAL.mg0 : PAL.mg1));
    }
    if (!OV) { line(_ox + sc[0], _oy + sc[1] - 1, _ox + sc[4], _oy + sc[5] - 1, 1, PAL.mg2); }
  }

  /* ---- blink thrusters live on the legs (LEGS slot) ---- */
  const air = p.anim === 'jump' || p.anim === 'fall' || p.anim === 'dash';
  const AB = ACCENT.blink, AS = ACCENT.shield;
  const thrust = p.hasBlink ? (p.warpU > 0 ? 1 : air ? 0.7 : p.anim === 'run' ? 0.35 : 0.15) : 0;

  /* ---- back arm (L-ARM slot: raises the shield) + back leg ---- */
  const sh = p.hasShield ? (p.shieldAmt || 0) : 0;
  const bhx = lerp(Q.bhx, Q.sx + 8, sh), bhy = lerp(Q.bhy, Q.sy - 1, sh);
  ik2(Q.sx - 1, Q.sy, bhx, bhy, 5, 5, -1);
  limb(Q.sx - 1, Q.sy, KN.x, KN.y, bhx, bhy, 3, 3, PAL.s0, OLn, null);
  D(bhx, bhy, 1, p.hasShield ? AS.m : PAL.s2);

  ik2(-1, hipH, Q.bfx, Q.bfy + 1, 8, 8, 1);
  limb(-1, hipH, KN.x, KN.y, Q.bfx, Q.bfy + 1, 5, 3, PAL.s0, OLn, null);
  L(Q.bfx - 2, Q.bfy + 1, Q.bfx + 3, Q.bfy + 1, 3, OLn); L(Q.bfx - 1, Q.bfy + 1, Q.bfx + 3, Q.bfy + 1, 1, PAL.s0);
  if (thrust > 0) thrusterFx(Q.bfx, Q.bfy, thrust, AB, p);

  /* ---- torso ---- */
  L(0, hipH - 1, lean, hipH + 9, 11, OLn);
  L(0, hipH - 1, lean, hipH + 9, 9, SU);
  L(lean * 0.3 + 1, hipH + 3, lean + 1, hipH + 9, 7, PL);                      // chest plate
  L(lean * 0.3 + 3, hipH + 3, lean + 3, hipH + 9, 1, flash ? PAL.wh : PAL.p1);
  L(-2, hipH + 2, lean - 2, hipH + 8, 1, PAL.s3);                              // back rim light
  L(-2, hipH + 8, lean - 2, hipH + 10, 3, SU2);                                // back shoulder guard
  P1(lean + 1, hipH + 6, flash ? PAL.wh : A.l); P1(lean + 2, hipH + 6, A.m);   // chest core
  P1(lean + 1, hipH + 5, A.m); P1(lean + 2, hipH + 5, A.d);
  GL(lean + 2, hipH + 6, A.m, 5, 0.4);
  L(-3, hipH + 1, lean + 3, hipH + 1, 3, OLn);                                 // belt + sash
  L(-3, hipH + 1, lean + 3, hipH + 1, 1, PAL.mg1);
  L(-3, hipH, -5 - (p.anim === 'run' ? 2 : 0), hipH - 4, 1, PAL.mg0);

  /* ---- head ---- */
  const hx = q.hx, hy = q.hy;
  L(hx - 1, hy - 3, lean - 1, hipH + 10, 3, SU);                               // neck
  D(hx, hy, 5, OLn); D(hx, hy, 4, flash ? '#dfe6ff' : PAL.s2);                 // hood
  L(hx - 3, hy + 3, hx + 1, hy + 4, 1, PAL.s3); L(hx - 4, hy + 1, hx - 4, hy + 2, 1, PAL.s3);   // hood rim light
  L(hx - 2, hy - 3, hx - 1, hy - 3, 1, PAL.s1);                                // hood shade
  D(hx + 2, hy, 3, OLn); D(hx + 2, hy, 2, PAL.s0);                             // dark face mask
  L(hx + 1, hy, hx + 5, hy, 1, A.m); L(hx + 1, hy + 1, hx + 5, hy + 1, 1, A.m); // visor
  L(hx + 3, hy, hx + 5, hy, 1, A.l); P1(hx + 5, hy + 1, A.l);
  L(hx - 1, hy + 4, hx + 3, hy + 4, 1, PAL.p1);                                // forehead guard
  GL(hx + 4, hy, A.m, 5, 0.5);
  L(hx - 5, hy + 2, hx - 3, hy + 2, 3, PAL.mg1); L(hx - 5, hy + 1, hx - 4, hy + 1, 1, PAL.mg0);   // headband knot

  /* ---- front leg ---- */
  ik2(1, hipH, Q.ffx, Q.ffy + 1, 8, 8, 1);
  limb(1, hipH, KN.x, KN.y, Q.ffx, Q.ffy + 1, 5, 3, SU, OLn, flash ? PAL.wh : PAL.s3);
  D(KN.x + 1, KN.y, 2, OLn); D(KN.x + 1, KN.y, 1, PAL.p1); P1(KN.x + 2, KN.y, A.m);   // knee armour
  L(KN.x + 1, KN.y - 1, Q.ffx + 1, Q.ffy + 3, 1, A.m);                         // greave stripe
  L(Q.ffx - 2, Q.ffy + 1, Q.ffx + 4, Q.ffy + 1, 5, OLn);
  L(Q.ffx - 1, Q.ffy + 1, Q.ffx + 4, Q.ffy + 1, 3, flash ? PAL.wh : PAL.s0);
  L(Q.ffx - 1, Q.ffy, Q.ffx + 4, Q.ffy, 1, A.m);                               // glowing sole
  if (thrust > 0) thrusterFx(Q.ffx, Q.ffy, thrust, AB, p);

  /* ---- hard-light shield projected by the far arm (drawn in front of the body) ---- */
  if (sh > 0.05) drawShield(bhx, bhy, lerp(9, 17, sh) * (0.4 + 0.6 * sh), p, AS);

  /* ---- weapon arm (front) ---- */
  const w = weaponArm(p);
  ik2(Q.sx, Q.sy, w.hx, w.hy, 5.5, 5.5, -1);
  if (p.chip === 'cannon') {
    limb(Q.sx, Q.sy, KN.x, KN.y, w.hx, w.hy, 5, 5, SU, OLn, PAL.s3);
  } else {
    limb(Q.sx, Q.sy, KN.x, KN.y, w.hx, w.hy, 5, 5, SU, OLn, PAL.s3);
    L(KN.x + (w.hx - KN.x) * 0.35, KN.y + (w.hy - KN.y) * 0.35, w.hx, w.hy, 3, flash ? PAL.wh : PAL.p0);   // bracer
  }
  D(Q.sx, Q.sy, 3, OLn); D(Q.sx, Q.sy, 2, flash ? PAL.wh : PAL.p0);            // pauldron
  L(Q.sx - 1, Q.sy + 2, Q.sx + 1, Q.sy + 2, 1, PAL.p1);

  if (p.chip === 'blade') drawBlade(w.hx, w.hy, w.ang, w.len, A, p);
  else drawCannon(w.hx, w.hy, w.ang, w.len, A, p);
  D(w.hx, w.hy, 1, flash ? PAL.wh : A.m);                                      // glowing hand

  /* ---- transformation flash on the changed limb ---- */
  if (p.xf !== undefined && p.xf < 1 && !OV) {
    const k = 1 - p.xf;
    T(w.hx, w.hy); disc(TX, TY, 3 + 7 * k | 0, mix(A.m, PAL.wh, k));
    glow(TX, TY, A.l, 20, k);
  }
  g.globalAlpha = prevAlpha;
  OV = null; _rotOn = false;
}

export function thrusterFx(fx, fy, k, A, p) {
  if (OV) return;
  const fl = 0.6 + 0.4 * Math.random();
  D(fx - 2, fy + 3, 1, A.l);                                                    // ankle vent
  L(fx - 3, fy + 3, fx - 3 - (3 + 9 * k) * fl, fy + 3 - (p.anim === 'fall' ? 0 : 0), 3, A.d);
  L(fx - 3, fy + 3, fx - 3 - (2 + 8 * k) * fl, fy + 3, 1, A.l);
  GL(fx - 4, fy + 3, A.m, 5 + (k * 3 | 0), 0.4 + 0.25 * k);
}

/* ------------------------------------------------------------------ enemies */
export function enemyPose(e, hip, thigh, shin, stride, lift) {
  const ph = e.walk || 0;
  let ffx = 3, ffy = 0, bfx = -3, bfy = 0;
  if (e.anim === 'walk' || e.anim === 'chase') {
    const s1 = Math.sin(ph), c1 = Math.cos(ph);
    ffx = stride * s1 + 1; ffy = Math.max(0, c1) * lift; bfx = -stride * s1 - 1; bfy = Math.max(0, -c1) * lift;
    hip -= 1.2 * Math.abs(s1);
  } else if (e.anim === 'windup') { ffx = 5; bfx = -5; hip -= 1.5; }
  else if (e.anim === 'lunge') { ffx = 8; bfx = -8; hip -= 3; }
  else if (e.anim === 'hit') { ffx = 5; bfx = -4; ffy = 2; }
  return { hip, ffx, ffy, bfx, bfy, thigh, shin };
}

export function drawEnemy(e, ox, oy, ov) {
  OV = ov || null; _rotOn = false;
  _ox = Math.round(ox); _oy = Math.round(oy); _f = e.facing;
  const prevAlpha = g.globalAlpha;
  if (e.kind === 'enforcer') drawEnforcer(e);
  else if (e.kind === 'warden') drawWarden(e);
  else drawGunner(e);
  g.globalAlpha = prevAlpha; OV = null;
}

export function enemyLegs(po, tFront, tBack, fill, hi) {
  const hip = po.hip;
  ik2(-1, hip, po.bfx, po.bfy + 1, po.thigh, po.shin, -1);
  limb(-1, hip, KN.x, KN.y, po.bfx, po.bfy + 1, tBack, 3, EN.g0, EN.o, null);
  L(po.bfx - 2, po.bfy + 1, po.bfx + 3, po.bfy + 1, 3, EN.o); L(po.bfx - 1, po.bfy + 1, po.bfx + 3, po.bfy + 1, 1, EN.g0);
  ik2(1, hip, po.ffx, po.ffy + 1, po.thigh, po.shin, -1);
  limb(1, hip, KN.x, KN.y, po.ffx, po.ffy + 1, tFront, 3, fill, EN.o, hi);
  L(po.ffx - 2, po.ffy + 1, po.ffx + 4, po.ffy + 1, 5, EN.o); L(po.ffx - 1, po.ffy + 1, po.ffx + 4, po.ffy + 1, 3, EN.g1);
}

export function drawGunner(e) {
  const A = e.anim, fl = e.flash > 0 && !OV, tele = e.tele || 0;
  const po = enemyPose(e, 14, 7, 7, 4, 3);
  const bob = A === 'idle' || A === 'alert' ? ((((e.t || 0) * 2) % 1) < 0.5 ? 0 : -1) : 0;
  const lean = A === 'windup' ? -2 : A === 'fire' ? -3 : A === 'hit' ? -4 : 1;
  const hip = po.hip + bob;
  const eye = A === 'alert' || A === 'windup' || A === 'fire' ? EN.r2 : EN.r1;
  const body = fl ? EN.wh : EN.g1, plate = fl ? EN.wh : EN.g2;

  /* back pack + antenna */
  L(-5, hip + 3, -5, hip + 10, 3, EN.o); L(-5, hip + 3, -5, hip + 10, 1, EN.g0);
  L(-4, hip + 11, -5, hip + 17, 1, EN.g3);
  const blink = (((e.t || 0) * 3) % 1) < 0.5;
  if (!OV) P1(-5, hip + 18, blink ? EN.r1 : EN.r0);
  enemyLegs(po, 5, 3, body, EN.g3);
  /* back arm */
  L(lean - 1, hip + 9, lean - 3, hip + 2, 3, EN.o); L(lean - 1, hip + 9, lean - 3, hip + 2, 1, EN.g0);
  /* torso */
  L(0, hip, lean, hip + 9, 11, EN.o); L(0, hip, lean, hip + 9, 9, body);
  L(lean + 1, hip + 3, lean + 1, hip + 9, 5, plate); L(lean + 2, hip + 3, lean + 2, hip + 9, 1, EN.g3);
  L(lean - 3, hip + 2, lean + 3, hip + 2, 1, EN.g0);
  if (!OV) { P1(lean + 1, hip + 6, eye); P1(lean + 2, hip + 6, eye); GL(lean + 2, hip + 6, EN.r1, 7, 0.45); }
  /* head */
  const hx = lean + 2, hy = hip + 15;
  D(hx, hy, 5, EN.o); D(hx, hy, 4, plate);
  L(hx - 3, hy + 3, hx + 1, hy + 4, 1, EN.g3);
  L(hx - 1, hy, hx + 5, hy, 3, EN.o);
  L(hx, hy, hx + 5, hy, 1, eye); L(hx + 1, hy + 1, hx + 5, hy + 1, 1, eye);
  GL(hx + 4, hy, A === 'alert' || A === 'windup' ? EN.r2 : EN.r1, 9, 0.75);
  /* rifle arm */
  const kick = e.recoil > 0 ? e.recoil * 3 : 0;
  const hx2 = lean + 9 - kick, hy2 = hip + 8 + (A === 'hit' ? 3 : 0);
  ik2(lean + 1, hip + 9, hx2, hy2, 5, 5, -1);
  limb(lean + 1, hip + 9, KN.x, KN.y, hx2, hy2, 5, 3, body, EN.o, EN.g3);
  L(hx2 - 6, hy2, hx2 + 8, hy2, 5, EN.o); L(hx2 - 5, hy2, hx2 + 7, hy2, 3, EN.g0);
  L(hx2 + 3, hy2 + 1, hx2 + 7, hy2 + 1, 1, EN.g3);
  L(hx2 + 8, hy2, hx2 + 12, hy2, 3, EN.o); L(hx2 + 8, hy2, hx2 + 12, hy2, 1, EN.g3);
  L(hx2 - 2, hy2 + 3, hx2 - 2, hy2 + 5, 3, EN.g0);
  const mx = hx2 + 13;
  if (tele > 0 && !OV) {                                                    // charge-up telegraph
    const r = 1 + Math.round(tele * 3), pulse = (((e.t || 0) * 14) % 1) < 0.5;
    T(mx, hy2); disc(TX, TY, r, pulse ? EN.wh : EN.r2);
    glow(TX, TY, EN.r1, 8 + Math.round(tele * 8), 0.5 + tele * 0.5);
    L(hx2 + 1, hy2 + 1, hx2 + 8, hy2 + 1, 1, EN.r1);
  }
  if (e.muzzle > 0 && !OV) {
    T(mx + 1, hy2); disc(TX, TY, 4, EN.wh); glow(TX, TY, EN.r2, 14, 0.9);
    L(mx, hy2, mx + 9, hy2, 3, EN.r2);
  }
  D(hx2, hy2, 1, EN.g3);
}

export function drawEnforcer(e) {
  const A = e.anim, fl = e.flash > 0 && !OV, tele = e.tele || 0;
  const chasing = A === 'chase' || A === 'lunge' || A === 'windup';
  const po = enemyPose(e, 16, 8, 8, 5, 4);
  const bob = A === 'idle' || A === 'alert' ? ((((e.t || 0) * 2) % 1) < 0.5 ? 0 : -1) : 0;
  const hip = po.hip + bob;
  const lean = A === 'lunge' ? 7 : A === 'windup' ? -2 : chasing ? 4 : A === 'hit' ? -5 : A === 'stagger' ? -2 : 1;
  const body = fl ? EN.wh : EN.g1, plate = fl ? EN.wh : EN.g2;
  const eye = A === 'alert' || A === 'windup' || A === 'lunge' || A === 'chase' ? EN.r2 : EN.r1;

  /* cape-like tail + legs */
  L(-1, hip + 4, -6, hip - 3 - (chasing ? 1 : 0), 3, EN.r0);
  enemyLegs(po, 5, 3, body, EN.g3);
  L(lean - 1, hip + 11, lean - 4, hip + 3, 3, EN.o); L(lean - 1, hip + 11, lean - 4, hip + 3, 1, EN.g0);
  /* torso (slim) */
  L(0, hip, lean, hip + 11, 9, EN.o); L(0, hip, lean, hip + 11, 7, body);
  L(lean + 1, hip + 4, lean + 1, hip + 11, 3, plate);
  L(lean - 2, hip + 3, lean + 3, hip + 3, 1, EN.r1);
  if (!OV) { P1(lean + 1, hip + 8, eye); GL(lean + 1, hip + 8, EN.r1, 6, 0.45); }
  /* head: angular helm with twin antenna */
  const hx = lean + 2, hy = hip + 17;
  D(hx, hy, 5, EN.o); D(hx, hy, 4, plate);
  L(hx - 3, hy + 2, hx - 6, hy + 8, 1, EN.g3); L(hx - 1, hy + 4, hx - 3, hy + 9, 1, EN.g3);
  L(hx, hy + 4, hx + 4, hy + 4, 1, EN.r1);
  L(hx - 1, hy, hx + 5, hy, 3, EN.o); L(hx, hy, hx + 5, hy, 1, eye); L(hx + 1, hy - 1, hx + 4, hy - 1, 1, eye);
  GL(hx + 4, hy, eye, 8, 0.7);
  /* blade arm */
  let bx, by, ang, len;
  if (A === 'windup') { bx = lean + 2; by = hip + 17; ang = 95; len = 16 + tele * 10; }
  else if (A === 'lunge') { bx = lean + 10; by = hip + 11; ang = 4; len = 30; }
  else if (A === 'stagger' || A === 'hit') { bx = lean + 3; by = hip + 14; ang = 125; len = 12; }
  else if (A === 'recover') { bx = lean + 7; by = hip + 5; ang = -35; len = 18; }
  else { bx = lean + 6; by = hip + 5; ang = -22; len = 16; }
  ik2(lean + 1, hip + 11, bx, by, 5, 5, -1);
  limb(lean + 1, hip + 11, KN.x, KN.y, bx, by, 5, 3, body, EN.o, EN.g3);
  D(lean + 1, hip + 11, 2, fl ? EN.wh : EN.g3);
  const a = ang * DEG, dx = Math.cos(a), dy = Math.sin(a);
  L(bx - dx * 2, by - dy * 2, bx + dx * 3, by + dy * 3, 3, EN.g3);
  const hot = A === 'windup' && (((e.t || 0) * 16) % 1) < 0.5;
  const c0 = hot ? EN.wh : EN.r1, c1 = hot ? EN.r2 : EN.r2;
  if (!OV) g.globalAlpha *= 0.45;
  L(bx + dx * 3, by + dy * 3, bx + dx * (3 + len), by + dy * (3 + len), 5, EN.r1);
  if (!OV) g.globalAlpha /= 0.45;
  L(bx + dx * 3, by + dy * 3, bx + dx * (3 + len), by + dy * (3 + len), 3, c0);
  L(bx + dx * 3, by + dy * 3, bx + dx * (3 + len), by + dy * (3 + len), 1, c1);
  GL(bx + dx * (3 + len / 2), by + dy * (3 + len / 2), EN.r1, 8 + (tele * 8 | 0), 0.5 + tele * 0.4);
}

export function drawWarden(e) {
  const A = e.anim, fl = e.flash > 0 && !OV, tele = e.tele || 0;
  const po = enemyPose(e, 19, 9, 9, 4, 3);
  const bob = A === 'idle' || A === 'alert' ? ((((e.t || 0) * 1.4) % 1) < 0.5 ? 0 : -1) : 0;
  const hip = po.hip + bob, lean = A === 'windup' ? -2 : A === 'fire' ? -3 : 1;
  const body = fl ? EN.wh : EN.g1, plate = fl ? EN.wh : EN.g2, trim = fl ? EN.wh : EN.am;
  const eye = A === 'alert' || A === 'windup' || A === 'fire' ? EN.r2 : EN.r1;

  enemyLegs(po, 7, 5, body, EN.g3);
  L(-2, hip + 1, 3, hip + 1, 7, EN.o); L(-2, hip + 1, 3, hip + 1, 5, trim);       // armoured hips
  /* back pods (twin shoulder cannons) */
  const open = tele > 0 || A === 'fire';
  L(lean - 7, hip + 15, lean - 7, hip + 24, 7, EN.o); L(lean - 7, hip + 15, lean - 7, hip + 24, 5, EN.g0);
  L(lean - 7, hip + 23, lean - 7 + (open ? 4 : 0), hip + 28 + (open ? 2 : 0), 3, trim);
  /* torso */
  L(0, hip + 2, lean, hip + 14, 17, EN.o); L(0, hip + 2, lean, hip + 14, 15, body);
  L(lean + 1, hip + 5, lean + 1, hip + 15, 9, plate); L(lean + 3, hip + 5, lean + 3, hip + 15, 1, EN.g3);
  L(lean - 4, hip + 6, lean + 5, hip + 6, 1, trim);
  L(lean - 4, hip + 4, lean + 5, hip + 4, 1, trim);
  if (!OV) { D(lean + 1, hip + 11, 2, eye); GL(lean + 1, hip + 11, EN.r1, 12, 0.6 + tele * 0.4); }
  /* head sunk into the chest */
  const hx = lean + 3, hy = hip + 20;
  D(hx, hy, 5, EN.o); D(hx, hy, 4, plate);
  L(hx - 3, hy + 3, hx + 3, hy + 4, 1, trim);
  L(hx - 1, hy, hx + 5, hy, 3, EN.o); L(hx, hy, hx + 5, hy, 1, eye); L(hx, hy - 1, hx + 4, hy - 1, 1, eye);
  GL(hx + 4, hy, EN.r1, 10, 0.8);
  /* front pod + main cannon arm */
  L(lean + 6, hip + 15, lean + 6, hip + 23, 7, EN.o); L(lean + 6, hip + 15, lean + 6, hip + 23, 5, plate);
  L(lean + 7, hip + 22, lean + 7 + (open ? 3 : 0), hip + 28 + (open ? 3 : 0), 3, trim);
  const kick = e.recoil > 0 ? e.recoil * 4 : 0;
  const hx2 = lean + 11 - kick, hy2 = hip + 11;
  ik2(lean + 3, hip + 14, hx2, hy2, 7, 7, -1);
  limb(lean + 3, hip + 14, KN.x, KN.y, hx2, hy2, 7, 5, body, EN.o, EN.g3);
  L(hx2 - 4, hy2, hx2 + 10, hy2, 9, EN.o); L(hx2 - 3, hy2, hx2 + 9, hy2, 7, EN.g0);
  L(hx2 + 2, hy2 + 2, hx2 + 8, hy2 + 2, 1, trim);
  L(hx2 + 10, hy2, hx2 + 16, hy2, 5, EN.o); L(hx2 + 10, hy2, hx2 + 16, hy2, 3, EN.g3);
  const mx = hx2 + 17;
  if (tele > 0 && !OV) {
    const r = 2 + Math.round(tele * 4), pulse = (((e.t || 0) * 14) % 1) < 0.5;
    T(mx, hy2); disc(TX, TY, r, pulse ? EN.wh : EN.r2); glow(TX, TY, EN.r1, 10 + Math.round(tele * 10), 0.5 + tele * 0.5);
  }
  if (e.muzzle > 0 && !OV) { T(mx + 1, hy2); disc(TX, TY, 5, EN.wh); glow(TX, TY, EN.r2, 18, 0.9); L(mx, hy2, mx + 10, hy2, 3, EN.r2); }
}

/* ------------------------------------------------------------------ chip icons (16x16, used by HUD + world pickups) */
export function makeChipIcon(id) {
  const [c, x] = makeCanvas(16, 16);
  const A = ACCENT[id];
  withCtx(x, () => {
    if (id === 'blade') {
      line(2, 14, 13, 3, 5, PAL.ol); line(2, 14, 13, 3, 3, A.m); line(3, 13, 13, 3, 1, A.l);
      line(2, 9, 7, 14, 3, PAL.ol); line(3, 9, 7, 13, 1, PAL.p2); line(1, 15, 3, 13, 3, PAL.p1);
    } else if (id === 'cannon') {
      R(1, 5, 9, 6, PAL.ol); R(2, 6, 7, 4, PAL.p1); R(2, 6, 7, 1, PAL.p2);
      R(10, 6, 5, 4, PAL.ol); R(10, 7, 5, 2, A.m); R(14, 7, 1, 2, A.l);
      R(4, 5, 1, 6, A.m); R(7, 5, 1, 6, A.m);
      R(2, 10, 4, 5, PAL.ol); R(3, 10, 2, 4, PAL.p0);
    } else if (id === 'shield') {
      const pts = [[8, 0], [14, 3], [14, 10], [8, 15], [2, 10], [2, 3]];
      for (let i = 0; i < 6; i++) { const a = pts[i], b = pts[(i + 1) % 6]; line(a[0], a[1], b[0], b[1], 3, PAL.ol); }
      for (let i = 0; i < 6; i++) { const a = pts[i], b = pts[(i + 1) % 6]; line(a[0], a[1], b[0], b[1], 1, A.m); }
      x.globalAlpha = 0.35; for (let yy = 3; yy < 12; yy++) R(4, yy, 8, 1, A.m); x.globalAlpha = 1;
      line(8, 4, 8, 11, 1, A.l); line(5, 6, 11, 6, 1, A.l);
    } else {
      const bolt = [[10, 0], [4, 9], [8, 9], [5, 15], [12, 6], [8, 6], [11, 0]];
      for (let i = 0; i < bolt.length - 1; i++) line(bolt[i][0], bolt[i][1], bolt[i + 1][0], bolt[i + 1][1], 3, PAL.ol);
      for (let i = 0; i < bolt.length - 1; i++) line(bolt[i][0], bolt[i][1], bolt[i + 1][0], bolt[i + 1][1], 1, A.m);
      px(10, 1, A.l); px(5, 14, A.l);
    }
  });
  return c;
}
