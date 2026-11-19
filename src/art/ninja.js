/* =====================================================================
   ninja.js — NEON//SHIFT protagonist rasteriser (ES module).

   drawNinja(ctx, pose, x, y [, ov]) draws the cyber-ninja with its feet
   centred on screen pixel (x, y). The body is built from a small skeleton,
   rasterised into a 1x pixel buffer with per-material 3-tone shading, a
   hand-authored helmet, and per-part 1-px outlines (see ninja-pixel.js).
   Frames are cached by a quantised pose key, so steady-state cost is one
   drawImage + a few additive glow blits + the live scarf.

   Pose object (same fields as the legacy drawPlayer pose):
     facing ±1, anim idle|run|jump|fall|dash|hurt|dead, t (s), run (rad phase),
     chip 'blade'|'cannon', atkStep 0..3, atkU 0..1, aim (rad, +up), recoil 0..1,
     muzzle (s, >0 = flash), charge 0..1, shieldAmt 0..1, parryT, blockFlash,
     hasShield, hasBlink, warpU 0..1, rot (rad), landT, flash, xf 0..1,
     deadT / deadU, scarf Float32Array of [dx,dy] screen offsets from the feet.
   Local space: x forward, y up, origin = centre of the feet.
   ===================================================================== */
import { PixBuf, rgb, capsule, disc, poly, line, stamp, compositeGroup, toCanvas } from './ninja-pixel.js';

/* ------------------------------------------------------------------ palette */
export const NINJA_PAL = {
  ol: '#070812',
  suit: ['#101330', '#1e2550', '#323d7c'],               // undersuit (matte indigo)
  suitB: ['#0b0d26', '#161b3e', '#252e62'],              // back limbs: one step darker
  armour: ['#36437c', '#5e73b8', '#a3b7f0', '#eef3ff'], // plates: dark / mid / light / spec
  armourB: ['#232c56', '#394888', '#5c70b0'],
  metal: ['#3b3348', '#6f6681', '#b9b0c8'],              // joints / pistons (warm grey)
  mg: ['#8f1259', '#ff3d9d', '#ffa6d6'],                 // scarf / sash magenta
  white: '#ffffff',
};
export const NINJA_ACCENT = {                            // matches legacy ACCENT
  blade: { d: '#0e7f9c', m: '#2fe6ff', l: '#d6fdff' },
  cannon: { d: '#b8700c', m: '#ffc43d', l: '#fff3b8' },
  shield: { d: '#5a3fc0', m: '#a58bff', l: '#ece4ff' },
  blink: { d: '#a3146f', m: '#ff4fc0', l: '#ffd0f0' },
};

const P = {};                                             // packed colours
for (const k of ['suit', 'suitB', 'armour', 'armourB', 'metal', 'mg']) P[k] = NINJA_PAL[k].map(c => rgb(c));
P.ol = rgb(NINJA_PAL.ol); P.white = rgb('#ffffff');
const ACC = {};
for (const k in NINJA_ACCENT) { const a = NINJA_ACCENT[k]; ACC[k] = { d: rgb(a.d), m: rgb(a.m), l: rgb(a.l), hex: a }; }

/* tone sets with rim light (index 3) */
const T_SUIT = [P.suit[0], P.suit[1], P.suit[2], rgb('#6a80e0')];
const T_SUITB = [P.suitB[0], P.suitB[1], P.suitB[2], rgb('#3a4890')];
const T_ARM = [P.armour[0], P.armour[1], P.armour[2], rgb('#8fa6f4')];
const T_ARMB = [P.armourB[0], P.armourB[1], P.armourB[2], rgb('#5266b0')];
const T_MET = [P.metal[0], P.metal[1], P.metal[2]];

/* ------------------------------------------------------------------ buffer geometry */
const BW = 144, BH = 112, OX = 72, OY = 92;                // feet centre inside the frame buffer
const MAIN = new PixBuf(BW, BH), LAY = new PixBuf(BW, BH);

/* ------------------------------------------------------------------ helmet pixel map (facing right) */
const HEAD_MAP = [
  '.......aabbbb...',
  '.....aabbccccb..',
  '....abbcccddccb.',
  '...aabbbcccccccb',
  '.mmaabbooooooobb',
  'mnmaa.xovvvvwWWo',
  '.n.aaxvoxvvvvwwo',
  '...kaa.ooooooooa',
  '...kkaasbbbbcba.',
  '....kkassbbbba..',
  '.....kksssaaa...',
  '.......kkkk.....',
];
function headPal(A, visor) {
  return {
    a: P.armour[0], b: P.armour[1], c: P.armour[2], d: P.armour[3],
    k: P.suit[0], s: P.suit[1], o: P.ol, m: P.mg[1], n: P.mg[0],
    x: visor ? A.d : P.suit[1], v: visor ? A.m : P.suit[2], w: visor ? A.l : P.suit[2], W: visor ? P.white : P.armour[1],
  };
}

/* ------------------------------------------------------------------ math helpers */
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = t => t * t * (3 - 2 * t);
const DEG = Math.PI / 180;
const easeOutBack = t => { const c = 1.7; t -= 1; return 1 + (c + 1) * t * t * t + c * t * t; };

/* local -> buffer, with optional whole-body rotation (somersault / death) */
let RC = 1, RS = 0, ROT = false, PVX = 0, PVY = 22;
function bx(x, y) { if (ROT) { const dx = x - PVX, dy = y - PVY; x = PVX + dx * RC - dy * RS; } return OX + x; }
function by(x, y) { if (ROT) { const dx = x - PVX, dy = y - PVY; y = PVY + dx * RS + dy * RC; } return OY - y; }
function tp(x, y) { return [bx(x, y), by(x, y)]; }
function cap(x0, y0, x1, y1, r0, r1, T) { capsule(LAY, bx(x0, y0), by(x0, y0), bx(x1, y1), by(x1, y1), r0, r1, T); }
function dsk(x, y, r, T) { disc(LAY, bx(x, y), by(x, y), r, T); }
function pol(pts, T, bev) { const o = []; for (let i = 0; i < pts.length; i += 2) o.push(bx(pts[i], pts[i + 1]), by(pts[i], pts[i + 1])); poly(LAY, o, T, bev); }
function ln(x0, y0, x1, y1, c) { line(LAY, bx(x0, y0), by(x0, y0), bx(x1, y1), by(x1, y1), c); }
function px1(x, y, c) { LAY.set(Math.floor(bx(x, y)), Math.floor(by(x, y)), c); }
function commit(ol = P.ol) { compositeGroup(MAIN, LAY, ol); }

/* two-bone IK, bend +1 = joint on the +normal side */
function ik(ax, ay, tx, ty, l1, l2, bend) {
  let dx = tx - ax, dy = ty - ay, d = Math.hypot(dx, dy);
  const mx = l1 + l2 - 0.05;
  if (d > mx) { dx *= mx / d; dy *= mx / d; d = mx; }
  if (d < 0.5) d = 0.5;
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const ux = dx / d, uy = dy / d;
  return { x: ax + ux * a - uy * h * bend, y: ay + uy * a + ux * h * bend, ex: ax + dx, ey: ay + dy };
}

/* ------------------------------------------------------------------ animation data */
/* run cycle: one foot over the cycle [phase, x, y, toe angle deg] (other foot +0.5) */
const RUN_FOOT = [
  [0, 11, 0, 12], [0.125, 6, 0, 0], [0.25, 0, 0, 0], [0.375, -7, 1, -30],
  [0.5, -13, 6, -60], [0.625, -9, 12, -75], [0.75, 1, 11, -30], [0.875, 9, 6, 15],
];
const RUN_HIP = [20.4, 19.2, 20.2, 21.4, 20.4, 19.2, 20.2, 21.4];

/* blade swings: [u, handDX, handDY (rel. front shoulder), blade angle deg (0 fwd, 90 up), length] */
const GUARD = [6, -8, -22, 24];
const BLADE_KF = [
  [[0, -4, 4, 155, 22], [0.14, -6, 6, 168, 22], [0.3, 11, 1, 10, 32], [0.5, 11, -5, -48, 30], [1, ...GUARD]],
  [[0, 8, -10, -70, 22], [0.14, 7, -12, -84, 22], [0.3, 10, 5, 62, 32], [0.5, 4, 10, 118, 30], [1, ...GUARD]],
  [[0, -3, 11, 115, 24], [0.16, -5, 13, 128, 24], [0.34, 13, 0, -14, 40], [0.56, 12, -8, -72, 38], [1, ...GUARD]],
];
function kf(tab, u) {
  u = clamp(u, 0, 1);
  let i = 0; while (i < tab.length - 2 && u > tab[i + 1][0]) i++;
  const a = tab[i], b = tab[i + 1], t = smooth(clamp((u - a[0]) / ((b[0] - a[0]) || 1), 0, 1));
  return [lerp(a[1], b[1], t), lerp(a[2], b[2], t), lerp(a[3], b[3], t), lerp(a[4], b[4], t)];
}
function cyc(tab, ph) {                                     // cyclic keyframe lookup with linear blend
  ph = ((ph % 1) + 1) % 1;
  const n = tab.length; let i = Math.floor(ph * n) % n; const j = (i + 1) % n;
  const t = ph * n - Math.floor(ph * n);
  return [lerp(tab[i][1], tab[j][1], t), lerp(tab[i][2], tab[j][2], t), lerp(tab[i][3], tab[j][3], t)];
}

/* ------------------------------------------------------------------ pose quantisation (cache key) */
function quant(p) {
  const st = p.anim || 'idle', t = p.t || 0;
  const q = {
    st, chip: p.chip === 'cannon' ? 'cannon' : 'blade', frame: 0,
    atk: p.atkStep && p.chip !== 'cannon' && st !== 'dead' ? p.atkStep : 0, atkU: 0,
    aim: 0, rec: 0, muz: 0, chg: 0, chgP: 0,
    sh: p.hasShield ? Math.round(clamp(p.shieldAmt || 0, 0, 1) * 4) / 4 : 0,
    parry: p.hasShield && p.parryT > 0 ? 1 : 0, blk: p.hasShield && p.blockFlash > 0 ? 1 : 0,
    blink: p.hasBlink ? 1 : 0, warp: Math.round(clamp(p.warpU || 0, 0, 1) * 3) / 3,
    rot: Math.round((p.rot || 0) / (Math.PI / 8)) % 16, land: p.landT > 0 ? Math.min(2, Math.ceil(p.landT / 0.05)) : 0,
    flash: p.flash > 0 ? 1 : 0, xf: p.xf === undefined ? 1 : Math.round(clamp(p.xf, 0, 1) * 6) / 6,
    fl: Math.floor(t * 18) % 3, dead: 0,
  };
  if (st === 'idle') q.frame = Math.floor(t / 0.4) % 4;
  else if (st === 'run') q.frame = Math.floor((((p.run || 0) / (2 * Math.PI)) % 1 + 1) % 1 * 8) % 8;
  else if (st === 'dead') q.dead = p.deadU !== undefined ? (p.deadU < 0.5 ? 0 : 1) : ((p.deadT || 0) < 0.22 ? 0 : 1);
  if (q.atk) q.atkU = Math.round(clamp(p.atkU || 0, 0, 1) * 20) / 20;
  if (q.chip === 'cannon') {
    q.aim = Math.round((p.aim || 0) / (7.5 * DEG)) * 7.5 * DEG;
    q.rec = Math.round(clamp(p.recoil || 0, 0, 1) * 3) / 3;
    q.muz = p.muzzle > 0 ? (p.muzzle > 0.05 ? 2 : 1) : 0;
    q.chg = Math.round(clamp(p.charge || 0, 0, 1) * 4) / 4;
    q.chgP = q.chg >= 1 ? Math.floor(t * 20) % 2 : Math.floor(t * 10) % 2;
  }
  if (!(q.warp > 0 || st === 'jump' || st === 'fall' || st === 'dash' || st === 'run') || !q.blink) q.fl = 0;
  return q;
}
function keyOf(q, ov) {
  return [q.st, q.chip, q.frame, q.atk, q.atkU, q.aim.toFixed(3), q.rec, q.muz, q.chg, q.chgP, q.sh, q.parry, q.blk,
    q.blink, q.warp, q.rot, q.land, q.flash, q.xf, q.fl, q.dead, ov ? ov.fill : ''].join('|');
}

/* ------------------------------------------------------------------ skeleton */
function skeleton(q) {
  const st = q.st, S = {};
  let hip = 21, lean = 4, ff = [5, 0, 0], bf = [-4, 0, 0], rise = 0, headTilt = 0, headDX = 0;
  let bh = [-2, -9];                                         // back hand rel. back shoulder
  if (st === 'run') {
    const ph = q.frame / 8;
    ff = cyc(RUN_FOOT, ph); bf = cyc(RUN_FOOT, ph + 0.5); hip = RUN_HIP[q.frame]; lean = 12;
    bh = [ff[0] * 0.55 - 1, -7.5 + Math.abs(ff[0]) * 0.12];
  } else if (st === 'jump') { hip = 21.5; lean = 6; ff = [6, 9, 20]; bf = [-6, 4, -40]; bh = [-6, 2]; }
  else if (st === 'fall') { hip = 22; lean = 0; ff = [4, 1, -15]; bf = [-6, 4, -35]; bh = [-5, 5]; }
  else if (st === 'dash') { hip = 15.5; lean = 38; ff = [9, 3, 0]; bf = [-17, 2, -60]; bh = [-8, -1]; headDX = 1; }
  else if (st === 'hurt') { hip = 19; lean = -30; ff = [9, 3, 25]; bf = [-4, 0, 0]; bh = [-6, 8]; headTilt = 1; headDX = -2.5; }
  else if (st === 'dead') {
    if (q.dead === 0) { hip = 12; lean = 22; ff = [8, 0, 0]; bf = [-11, 0, -80]; bh = [2, -9]; headTilt = 2; }
    else { hip = 21; lean = 0; ff = [3, 0, 0]; bf = [-3, 0, 0]; bh = [3, -8]; headTilt = 2; }
  } else { rise = [0, 1, 2, 1][q.frame]; hip -= [0, 0.4, 0.6, 0.4][q.frame]; ff = [6, 0, 0]; bf = [-6, 0, 0]; bh = [-4, -8.5 + rise * 0.5]; }

  if (q.rot && (st === 'jump' || st === 'fall')) {           // somersault: compact tuck, rotated as a whole
    hip = 19; lean = 18; ff = [6, 12, 40]; bf = [1, 10, 10]; bh = [5, -3]; S.tuck = true;
  }
  if (st !== 'dead') hip += 1.8;                                // leg-length tuning: straighter, longer legs
  const grounded = st === 'idle' || st === 'run';
  if (q.atk) {
    const k = Math.sin(Math.PI * q.atkU);
    lean += (q.atk === 3 ? 16 : 8) * k;
    if (grounded) { ff = [lerp(ff[0], 9, k), ff[1] * (1 - k), ff[2] * (1 - k)]; bf = [lerp(bf[0], -8, k), bf[1] * (1 - k), bf[2] * (1 - k)]; hip -= (q.atk === 3 ? 3 : 1.5) * k; }
  }
  if (q.warp > 0) { const w = q.warp; lean += 28 * w; hip -= 3.5 * w; ff = [lerp(ff[0], 9, w), ff[1] * (1 - w) + 3 * w, 0]; bf = [lerp(bf[0], -12, w), lerp(bf[1], 3, w), -60 * w]; }
  if (q.sh > 0 && grounded) { hip -= 1.2 * q.sh; ff = [lerp(ff[0], 7, q.sh), ff[1], ff[2]]; bf = [lerp(bf[0], -6, q.sh), bf[1], bf[2]]; lean += 4 * q.sh; }
  if (q.parry) { lean += 8; hip -= 1; }
  if (q.rec > 0) lean -= 9 * q.rec;
  if (q.land) hip -= q.land * 1.3;

  const L = lean * DEG, ux = Math.sin(L), uy = Math.cos(L), vx = uy, vy = -ux;    // spine up / forward
  S.hip = hip; S.lean = lean; S.ux = ux; S.uy = uy; S.vx = vx; S.vy = vy;
  S.at = (vo, uo) => [vo * vx + uo * ux, hip + vo * vy + uo * uy];               // torso frame -> local
  const tl = 13 + rise * 0.6;
  [S.shFx, S.shFy] = S.at(1, tl - 2.2 + rise * 0.4);
  [S.shBx, S.shBy] = S.at(-1.5, tl - 2.2 + rise * 0.4);
  [S.hdx, S.hdy] = S.at(1.6 + headDX, tl + 5.3 + rise * 0.4);
  S.headTilt = headTilt;
  S.ff = ff; S.bf = bf; S.bh = bh; S.rise = rise;
  return S;
}

/* ------------------------------------------------------------------ body parts */
function drawLeg(S, side, foot, T_s, T_a, back, A, q, thrust) {
  const hx = S.vx * side * 1.2, hy = S.hip + S.vy * side * 1.2;
  const [fx, fy, fa] = foot, ax = fx - 0.5, ay = fy + 3.2;
  const k = ik(hx, hy, ax, ay, 10.8, 10.6, 1);
  const kx = k.x, ky = k.y, ex = k.ex, ey = k.ey;
  // thigh + armour plate
  cap(hx, hy, kx, ky, 3.3, 2.5, T_s);
  const tdx = kx - hx, tdy = ky - hy, tl = Math.hypot(tdx, tdy) || 1, tnx = -tdy / tl, tny = tdx / tl;  // tnx/tny: forward normal
  const fs = tnx >= 0 ? 1 : -1;
  cap(hx + tdx * 0.2 + tnx * fs * 0.9, hy + tdy * 0.2 + tny * fs * 0.9, hx + tdx * 0.82 + tnx * fs * 0.9, hy + tdy * 0.82 + tny * fs * 0.9, 2.2, 1.8, back ? T_ARMB : T_ARM);
  // shin (greave)
  cap(kx, ky, ex, ey, 2.6, 1.9, T_a);
  // calf piston (behind the shin)
  const sdx = ex - kx, sdy = ey - ky, sl = Math.hypot(sdx, sdy) || 1, bnx = sdy / sl, bny = -sdx / sl;
  const bs = bnx <= 0 ? 1 : -1;                              // backward normal
  const p0x = kx + bnx * bs * 2.6 + sdx / sl * 1.5, p0y = ky + bny * bs * 2.6 + sdy / sl * 1.5;
  const p1x = ex + bnx * bs * 2.4 - sdx / sl * 1.5, p1y = ey + bny * bs * 2.4 - sdy / sl * 1.5;
  cap(p0x, p0y, p1x, p1y, 0.9, 0.9, back ? P.metal[0] : P.metal[1]);
  ln(p0x, p0y, lerp(p0x, p1x, 0.55), lerp(p0y, p1y, 0.55), back ? P.metal[1] : P.metal[2]);
  // blink thruster pod on the calf
  if (q.blink) {
    const mx = lerp(kx, ex, 0.62) + bnx * bs * 2.8, my = lerp(ky, ey, 0.62) + bny * bs * 2.8;
    cap(mx + sdx / sl * -2, my + sdy / sl * -2, mx + sdx / sl * 2.2, my + sdy / sl * 2.2, 1.9, 1.6, back ? T_MET.map((c, i) => i ? T_MET[i - 1] : c) : T_MET);
    const nzx = mx + sdx / sl * 2.8 + bnx * bs * 0.6, nzy = my + sdy / sl * 2.8 + bny * bs * 0.6;
    dsk(nzx, nzy, 1.1, thrust > 0.2 ? A.blink.l : A.blink.d);
    S.nozzles = S.nozzles || []; S.nozzles.push([nzx, nzy, back]);
  }
  // knee joint
  dsk(kx, ky, 2.3, back ? [P.metal[0], P.metal[0], P.metal[1]] : T_MET);
  if (!back) px1(kx + 1.1, ky + 0.2, A.cur.m);
  // boot (rotated around the ankle by the toe angle)
  const c = Math.cos(fa * DEG), s = Math.sin(fa * DEG);
  const B = [-2.8, -3.2, 5, -3.2, 5, -1.9, 2, 0.4, -0.4, 1.2, -2.6, 0.6];
  const o = [];
  for (let i = 0; i < B.length; i += 2) o.push(ex + B[i] * c - B[i + 1] * s, ey + B[i] * s + B[i + 1] * c);
  pol(o, back ? T_ARMB : T_ARM);
  const tx = ex + 4.2 * c + 2.6 * s, ty = ey + 4.2 * s - 2.6 * c;           // toe light
  px1(tx, ty, back ? A.cur.d : A.cur.m);
  if (!back) ln(ex - 2.5 * c + 2.6 * s, ey - 2.5 * s - 2.6 * c, ex + 4.8 * c + 2.6 * s, ey + 4.8 * s - 2.6 * c, P.suit[0]);  // sole line
  S['knee' + (back ? 'B' : 'F')] = [kx, ky];
}

function drawTorso(S, A, q) {
  const at = S.at, pts = (arr) => { const o = []; for (let i = 0; i < arr.length; i += 2) o.push(...at(arr[i], arr[i + 1])); return o; };
  // back module (spine reactor) — chip colour readable from behind
  pol(pts([-6.4, 7, -4, 7, -3.6, 12.6, -6.6, 12]), T_MET);
  px1(...at(-5.6, 9.6), A.m); px1(...at(-5.6, 10.6), A.l);
  // abdomen (segmented undersuit)
  cap(...at(0, 2.5), ...at(0.3, 7.5), 3.6, 3.9, T_SUIT);
  ln(...at(-2.6, 4.4), ...at(3, 4.4), P.suit[0]);
  // belt + sash
  pol(pts([-4.4, 0.4, 4.2, 0.4, 4.4, 3, -4.6, 3]), T_MET);
  ln(...at(-4.2, 1.6), ...at(4.2, 1.6), P.mg[1]);
  px1(...at(3.6, 1.6), P.mg[2]);
  // chest armour
  pol(pts([-4.8, 6.4, -5.6, 11, -4.2, 13.6, 1.8, 14.1, 5.2, 11.6, 5.3, 8.2, 3.4, 5.6, -3.2, 5.4]), T_ARM, 1.3);
  ln(...at(0.4, 13.2), ...at(1.6, 7.2), P.armour[0]);                       // centre seam
  ln(...at(-4.4, 8), ...at(-1, 6.6), P.armour[0]);                          // rib plate
  // chest core
  const [cx, cy] = at(3.1, 10.2);
  dsk(cx, cy, 1.25, A.d); px1(cx, cy, A.m); px1(cx + 0.9, cy + 0.9, A.l);
  // armoured collar
  pol(pts([-3.8, 12.6, 2.4, 12.8, 3.4, 15.4, -2.6, 16.2]), T_ARM);
  ln(...at(-2.8, 15.5), ...at(2.6, 15), P.armour[2]);
  S.core = [cx, cy];
}

function drawHead(S, A, q) {
  const visor = !(q.st === 'dead' && q.dead === 1);
  const [hx, hy] = [S.hdx, S.hdy];
  // swept antenna fin
  cap(hx - 3.5, hy + 3, hx - 9, hy + 5.5, 1.1, 0.6, T_ARM);
  px1(hx - 9.2, hy + 5.6, A.m);
  let ang = 0;
  if (S.headTilt === 1) ang = -0.55; else if (S.headTilt === 2) ang = 0.35;
  if (ROT) ang -= Math.atan2(RS, RC);
  const pal = headPal(q.st === 'hurt' ? { d: P.white, m: P.white, l: P.white } : A, visor);
  stamp(LAY, HEAD_MAP, pal, bx(hx, hy), by(hx, hy), ang);
  S.visor = [hx + 5, hy];
}

function drawBackArm(S, A, q) {
  const amt = q.sh, sx = S.shBx, sy = S.shBy;
  let tx = sx + S.bh[0], ty = sy + S.bh[1];
  if (amt > 0) { tx = lerp(tx, sx + 11.5, amt); ty = lerp(ty, sy - 2, amt); }
  if (q.parry) { tx = sx + 12.5; ty = sy - 1; }
  const k = ik(sx, sy, tx, ty, 6.6, 6.6, 1);
  cap(sx, sy, k.x, k.y, 2.1, 1.8, T_SUITB);
  cap(k.x, k.y, k.ex, k.ey, 2.0, 2.3, T_ARMB);
  dsk(k.x, k.y, 1.5, [P.metal[0], P.metal[0], P.metal[1]]);
  dsk(k.ex, k.ey, 1.5, P.suitB[1]);
  if (q.sh > 0 || q.parry) {                                  // shield emitter ring on the wrist
    const mx = lerp(k.x, k.ex, 0.6), my = lerp(k.y, k.ey, 0.6);
    dsk(mx, my, 1.4, ACC.shield.m); px1(mx, my, ACC.shield.l);
  }
  S.handB = [k.ex, k.ey];
}

function drawFrontArmBlade(S, A, q) {
  const sx = S.shFx, sy = S.shFy;
  let hd;
  const st = q.st;
  if (q.atk) hd = kf(BLADE_KF[q.atk - 1], q.atkU);
  else if (S.tuck) hd = [4, -4, 200, 20];
  else if (st === 'run') hd = [-3, -6, 198, 22];
  else if (st === 'dash') hd = [-6, -3, 184, 26];
  else if (st === 'jump') hd = [-2, -5, 212, 22];
  else if (st === 'fall') hd = [6, -1, 42, 22];
  else if (st === 'hurt') hd = [-3, 6, 150, 16];
  else if (st === 'dead') hd = q.dead ? [5, -6, 0, 0] : [6, -9, -80, 6];
  else hd = [GUARD[0], GUARD[1] + S.rise * 0.6, GUARD[2] + S.rise * 4, GUARD[3]];
  const len = hd[3] * easeOutBack(clamp(q.xf, 0, 1));
  const k = ik(sx, sy, sx + hd[0], sy + hd[1], 6.4, 6.4, -1);
  S.blade = { hx: k.ex, hy: k.ey, ang: hd[2], len };
  // upper arm, elbow, energised gauntlet
  cap(sx, sy, k.x, k.y, 2.2, 1.9, T_SUIT);
  dsk(k.x, k.y, 1.7, T_MET);
  cap(k.x, k.y, k.ex, k.ey, 2.1, 2.6, T_ARM);
  const gx = lerp(k.x, k.ex, 0.55), gy = lerp(k.y, k.ey, 0.55);
  ln(lerp(k.x, k.ex, 0.3), lerp(k.y, k.ey, 0.3), k.ex, k.ey, A.m);           // energy seam: the forearm IS the sword
  px1(gx, gy, A.l);
  dsk(k.ex, k.ey, 1.7, T_SUIT);
  drawPauldron(S, A);
}

function drawPauldron(S, A) {
  const sx = S.shFx, sy = S.shFy;
  pol([sx - 3.6, sy + 2.2, sx + 1.4, sy + 3.6, sx + 4.4, sy + 1.4, sx + 3.6, sy - 2.6, sx - 2.4, sy - 3.2], T_ARM, 1.2);
  ln(sx - 2.6, sy + 0.4, sx + 3.4, sy + 1.2, A.m);
}

function drawBlade(S, A, q) {
  const b = S.blade; if (!b || b.len < 2) return;
  const a = b.ang * DEG, dx = Math.cos(a), dy = Math.sin(a), nx = -dy, ny = dx;   // n = spine side
  const x0 = b.hx + dx * 1.5, y0 = b.hy + dy * 1.5, L = b.len;
  const w = L > 30 ? 1.25 : 1;
  pol([x0 + nx * 1.1, y0 + ny * 1.1, x0 + dx * L * 0.82 + nx * 1.0 * w, y0 + dy * L * 0.82 + ny * 1.0 * w,
    x0 + dx * L, y0 + dy * L, x0 + dx * L * 0.45 - nx * 2.3 * w, y0 + dy * L * 0.45 - ny * 2.3 * w,
    x0 - nx * 1.7, y0 - ny * 1.7], [A.m, A.m, A.l]);
  ln(x0 + dx * 2, y0 + dy * 2, x0 + dx * (L - 4), y0 + dy * (L - 4), P.white);
  // emitter guard (tsuba)
  cap(b.hx - nx * 2.6, b.hy - ny * 2.6, b.hx + nx * 2.6, b.hy + ny * 2.6, 1.0, 1.0, T_MET);
  S.glows.push([x0 + dx * L * 0.5, y0 + dy * L * 0.5, A.hex.m, 6 + (L >> 2), 0.35]);
  S.tip = [x0 + dx * L, y0 + dy * L];
}

/* blade smear: crescent swept by the tip around the shoulder between u-Δ and u */
function drawSmear(S, A, q) {
  if (!q.atk) return;
  const u = q.atkU, tab = BLADE_KF[q.atk - 1];
  const s0 = tab[1][0], s1 = tab[3][0] + 0.06;
  if (u < s0 + 0.04 || u > s1) return;
  const sx = S.shFx, sy = S.shFy;
  const tipAt = uu => { const h = kf(tab, uu); const a = h[2] * DEG; return [h[0] + Math.cos(a) * (h[3] + 1.5), h[1] + Math.sin(a) * (h[3] + 1.5)]; };
  const n = 10, span = Math.min(u - s0, 0.2), fade = u > tab[3][0] ? 1 - (u - tab[3][0]) / 0.06 : 1;
  const thick = (q.atk === 3 ? 13 : 9) * fade;
  const cx = bx(sx, sy), cy = by(sx, sy), rotA = ROT ? Math.atan2(RS, RC) : 0;
  const ang = [], rad = [];
  for (let i = 0; i <= n; i++) {
    const [x, y] = tipAt(u - span + span * i / n);
    ang.push(Math.atan2(-y, x) - rotA); rad.push(Math.hypot(x, y));
  }
  for (let i = 1; i <= n; i++) if (Math.abs(ang[i] - ang[i - 1]) > Math.PI) ang[i] += ang[i] < ang[i - 1] ? 2 * Math.PI : -2 * Math.PI;
  const a0 = Math.min(ang[0], ang[n]), a1 = Math.max(ang[0], ang[n]);
  if (a1 - a0 < 0.15) return;
  const dir = ang[n] > ang[0] ? 1 : -1, R = Math.max(...rad) + 2;
  for (let y = Math.floor(cy - R); y <= cy + R; y++) for (let x = Math.floor(cx - R); x <= cx + R; x++) {
    const ex = x + 0.5 - cx, ey = y + 0.5 - cy, r = Math.hypot(ex, ey);
    let a = Math.atan2(ey, ex);
    while (a < a0 - 0.01) a += 2 * Math.PI;
    while (a > a1 + 0.01) a -= 2 * Math.PI;
    if (a < a0 || a > a1) continue;
    const f = dir > 0 ? (a - ang[0]) / (ang[n] - ang[0]) : (ang[0] - a) / (ang[0] - ang[n]);  // 0 tail .. 1 lead
    const fi = clamp(f * n, 0, n - 0.001), i0 = Math.floor(fi), ro = lerp(rad[i0], rad[i0 + 1], fi - i0);
    const w = Math.max(1, thick * Math.pow(f, 0.8));
    const d = ro - r;
    if (d < -0.5 || d > w) continue;
    let c;
    if (d < 0.6) c = P.white; else if (d < 1.8) c = A.l; else if (d < w * 0.6) c = A.m;
    else c = ((x + y) & 1) ? A.d : 0;
    if (f < 0.18 && ((x + y) & 1)) c = 0;                     // dithered tail
    if (c) LAY.set(x, y, c);
  }
  S.glows.push([cx - OX + Math.cos((a0 + a1) / 2) * R * 0.8, OY - cy - Math.sin((a0 + a1) / 2) * R * 0.8, A.hex.m, 14, 0.35]);
}

function drawFrontArmCannon(S, A, q) {
  const sx = S.shFx, sy = S.shFy;
  let aim = q.aim;
  if (q.st === 'dash') aim = Math.PI;
  else if (q.st === 'hurt' || q.st === 'dead') aim = -1.0;
  const dx = Math.cos(aim), dy = Math.sin(aim), nx = -dy, ny = dx;
  const flip = dx < -0.2 ? -1 : 1;                             // keep the vents on top when aiming backwards
  const rb = q.rec * 3;
  const ex = sx + dx * (4.5 - rb) + 0.6 * nx * -flip, ey = sy + dy * (4.5 - rb) - 1.3 + 0.6 * ny * -flip;
  cap(sx, sy, ex, ey, 2.3, 2.0, T_SUIT);
  // cannon housing replaces the forearm
  const at = (a, b) => [ex + dx * a + nx * b * flip, ey + dy * a + ny * b * flip];
  const Q = (arr, T, bev) => { const o = []; for (let i = 0; i < arr.length; i += 2) o.push(...at(arr[i], arr[i + 1])); pol(o, T, bev); };
  Q([-3.8, -4.2, -3.8, 4, 1, 5.2, 11, 4.4, 11.6, -4, 1, -5], T_ARM, 1.3);       // main housing
  Q([-2, 4.8, 6, 5.2, 6.8, 7.2, -1, 7], T_MET);                                     // top vent rail
  Q([11, -2.6, 16.5, -2.3, 16.5, 2.3, 11, 2.8], T_MET);                               // barrel
  Q([16, -3.5, 18.6, -3.5, 18.6, 3.5, 16, 3.5], T_ARM);                               // muzzle collar
  for (const k of [5.5, 7.5, 9.5]) { const [a0x, a0y] = at(k, -3.8), [a1x, a1y] = at(k + 0.4, 4.2); ln(a0x, a0y, a1x, a1y, A.m); }  // energy coils
  { const [a0x, a0y] = at(-2.5, -1), [a1x, a1y] = at(9.5, -1); ln(a0x, a0y, a1x, a1y, P.armour[0]); }
  { const [a0x, a0y] = at(10.8, 0), [a1x, a1y] = at(17.6, 0); ln(a0x, a0y, a1x, a1y, A.d); }     // bore
  const [cex, cey] = at(1.6, -0.6); dsk(cex, cey, 2.3, A.d); dsk(cex, cey, 1.5, A.m); px1(cex + 0.5, cey + 0.5, A.l);   // plasma cell
  const [mx, my] = at(19.2, 0);
  const [elx, ely] = at(-3.2, 0);
  dsk(elx, ely, 2, T_MET);                                                            // elbow mount
  S.muzzle = [mx, my, dx, dy];
  S.glows.push([mx, my, A.hex.m, 5, 0.35]);
  drawPauldron(S, A);
}

function drawCannonFx(S, A, q) {
  if (!S.muzzle) return;
  const [mx, my, dx, dy] = S.muzzle, nx = -dy, ny = dx;
  if (q.chg > 0) {
    const r = 1 + q.chg * 3.5 + (q.chg >= 1 && q.chgP ? 1 : 0);
    dsk(mx + dx * (r + 0.5), my + dy * (r + 0.5), r + 1, A.d);
    dsk(mx + dx * (r + 0.5), my + dy * (r + 0.5), r, q.chgP ? P.white : A.l);
    S.glows.push([mx + dx * 2, my + dy * 2, A.hex.m, 8 + Math.round(q.chg * 10), 0.4 + 0.5 * q.chg]);
  }
  if (q.muz) {
    const s = q.muz === 2 ? 1 : 0.6;
    const pts = [];
    const spikes = [[0, 11], [0.5, 3], [1.2, 6], [2, 3], [2.6, 5.5]];
    for (const sg of [1, -1]) for (const [a, l] of (sg > 0 ? spikes : spikes.slice().reverse())) {
      const ang = Math.atan2(dy, dx) + a * sg * 0.55;
      pts.push(mx + Math.cos(ang) * l * s * (a === 0 ? 1 : 1), my + Math.sin(ang) * l * s);
    }
    pol(pts, A.m);
    pol([mx + nx * 2.2 * s, my + ny * 2.2 * s, mx + dx * 7 * s, my + dy * 7 * s, mx - nx * 2.2 * s, my - ny * 2.2 * s], A.l);
    dsk(mx + dx, my + dy, 1.6 * s + 0.4, P.white);
    S.glows.push([mx + dx * 3, my + dy * 3, A.hex.l, 14, 0.85 * s]);
  }
}

function drawShield(S, A, q) {
  const amt = Math.max(q.sh, q.parry ? 1 : 0); if (amt <= 0) return;
  const [hx, hy] = S.handB;
  const R = q.parry ? 30 : 27, half = lerp(16, q.parry ? 42 : 37, amt) * DEG;
  const cx = bx(hx, hy) + 5.5 + 2.5 * amt - R, cy = by(hx, hy) + 1;
  const hot = q.parry || q.blk;
  const rim = q.parry ? P.white : hot ? A.l : A.l, mid = q.parry ? A.l : A.m;
  const fillA = q.parry ? 170 : hot ? 140 : 105;
  const fill = rgb(q.parry ? '#ffffff' : NINJA_ACCENT.shield.m, fillA), fill2 = rgb(NINJA_ACCENT.shield.m, Math.round(fillA * 0.45));
  for (let y = Math.floor(cy - R); y <= cy + R; y++) for (let x = Math.floor(cx); x <= cx + R + 1; x++) {
    const ex = x + 0.5 - cx, ey = y + 0.5 - cy, r = Math.hypot(ex, ey), a = Math.atan2(ey, ex);
    if (Math.abs(a) > half) continue;
    const d = R - r, edgeA = half - Math.abs(a);
    if (d < 0 || d > 6.5) continue;
    let c;
    if (d < 1) c = rim;
    else if (edgeA * R < 1.2) c = mid;                          // end caps
    else if (d < 2) c = mid;
    else if (d < 4.2) c = (y & 1) ? fill : fill2;               // scan-lined hard light
    else if (d < 5) c = A.d;
    else c = ((x + y) & 1) && (y % 3 === 0) ? fill2 : 0;
    if (c) LAY.set(x, y, c);
  }
  // hex nodes
  for (const k of [-0.6, 0, 0.6]) { const a = half * k; LAY.set(Math.floor(cx + Math.cos(a) * (R - 3)), Math.floor(cy + Math.sin(a) * (R - 3)), rim); }
  if (q.parry) {                                              // parry burst: four-point star
    const sx = cx + R + 1, sy = cy;
    poly(LAY, [sx - 8, sy, sx, sy - 1.4, sx + 8, sy, sx, sy + 1.4], P.white);
    poly(LAY, [sx - 1.4, sy, sx, sy - 11, sx + 1.4, sy, sx, sy + 11], P.white);
  }
  S.glows.push([cx + R - OX, OY - cy, A.hex.m, 12 + Math.round(amt * 6), 0.25 + 0.2 * amt + (q.parry ? 0.6 : 0) + (q.blk ? 0.3 : 0)]);
}

function drawThrusters(S, A, q, thrust) {
  if (!S.nozzles || thrust <= 0.2) return;
  const fl = [1, 0.75, 0.9][q.fl];
  const warp = q.warp > 0 || q.st === 'dash';
  for (const [nx, ny, back] of S.nozzles) {
    const dx = warp ? -1 : -0.35, dy = warp ? 0 : -1, l = (warp ? 6 + 10 * thrust : 3 + 6 * thrust) * fl * (back ? 0.8 : 1);
    const px = -dy, py = dx;
    pol([nx + px * 1.8, ny + py * 1.8, nx + dx * l, ny + dy * l, nx - px * 1.8, ny - py * 1.8], A.blink.m);
    pol([nx + px * 1, ny + py * 1, nx + dx * l * 0.6, ny + dy * l * 0.6, nx - px * 1, ny - py * 1], A.blink.l);
    dsk(nx, ny, 0.9, P.white);
    S.glows.push([nx + dx * l * 0.3, ny + dy * l * 0.3, A.blink.hex.m, 6 + Math.round(thrust * 4), 0.35 + 0.3 * thrust]);
  }
}

/* ------------------------------------------------------------------ frame builder + cache */
const CACHE = new Map();
const CACHE_MAX = 900;

function buildFrame(q, ov) {
  MAIN.clear(); LAY.clear();
  const A = ACC[q.chip];
  const AX = { cur: A, blink: ACC.blink };
  const S = skeleton(q); S.glows = [];
  ROT = false; PVX = 0; PVY = 22;
  if (q.rot) { ROT = true; PVY = 27; const r = q.rot * Math.PI / 8; RC = Math.cos(r); RS = Math.sin(r); }
  if (q.st === 'dead' && q.dead === 1) { ROT = true; RC = Math.cos(1.5); RS = Math.sin(1.5); PVX = 0; PVY = 6.5; }

  const air = q.st === 'jump' || q.st === 'fall' || q.st === 'dash';
  const thrust = q.blink ? (q.warp > 0 ? 1 : air ? 0.7 : q.st === 'run' ? 0.3 : 0) : 0;

  // 1. back arm (L-ARM)
  drawBackArm(S, A, q); commit();
  // 2. back leg (+ pod) — flames from the pods go behind everything
  drawLeg(S, -1, S.bf, T_SUITB, T_ARMB, true, AX, q, thrust); commit();
  // 3. torso
  drawTorso(S, A, q); commit();
  // 4. head
  drawHead(S, A, q); commit();
  // 5. front leg
  drawLeg(S, 1, S.ff, T_SUIT, T_ARM, false, AX, q, thrust); commit();
  // thruster flames (unoutlined, behind the arms)
  drawThrusters(S, AX, q, thrust); commit(null);
  // 6. shield (hard light, no outline)
  drawShield(S, ACC.shield, q); commit(null);
  // 7. smear behind the sword arm
  if (q.chip === 'blade') { drawSmear(S, A, q); commit(null); }
  // 8. weapon arm (R-ARM)
  if (q.chip === 'blade') { drawFrontArmBlade(S, A, q); commit(); drawBlade(S, A, q); commit(A.d); }
  else { drawFrontArmCannon(S, A, q); commit(); drawCannonFx(S, A, q); commit(null); }
  ROT = false;

  if (q.st === 'hurt' && !ov) tintBuf(MAIN, 255, 48, 80, 0.42);
  if (!ov) backlight(MAIN);
  // flash / silhouette overlays
  if (q.flash || ov) {
    const c = ov ? rgb(ov.fill) : rgb('#eef2ff'), d = MAIN.d;
    for (let i = 0; i < d.length; i++) if (d[i] && (ov || d[i] !== P.ol)) d[i] = c;
  }
  const cv = makeCanvas(BW, BH);
  toCanvas(MAIN, cv);
  // glows: convert local -> buffer coordinates now
  const glows = S.glows.map(([x, y, c, r, a]) => {
    return [OX + x, OY - y, c, r, a];
  });
  if (S.core) glows.push([OX + S.core[0], OY - S.core[1], NINJA_ACCENT[q.chip].m, 5, 0.4]);
  if (S.visor && !(q.st === 'dead')) glows.push([OX + S.visor[0], OY - S.visor[1], NINJA_ACCENT[q.chip].m, 6, 0.45]);
  return { cv, glows: ov || q.rot ? [] : glows };
}

/* red damage tint on everything except the outline / pure white */
function tintBuf(B, r, gg, b, k) {
  const d = B.d, u8 = new Uint8Array(d.buffer);
  for (let i = 0; i < d.length; i++) {
    const c = d[i]; if (!c || c === P.ol || c === P.white) continue;
    const o = i * 4;
    u8[o] = u8[o] + (r - u8[o]) * k; u8[o + 1] = u8[o + 1] + (gg - u8[o + 1]) * k; u8[o + 2] = u8[o + 2] + (b - u8[o + 2]) * k;
  }
}
/* 1-px soft back/top light outside the outline: makes the dark silhouette pop on dark streets */
const BACK_RIM = rgb('#7f8cff', 120), TOP_RIM = rgb('#b7c4ff', 90);
function backlight(B) {
  const w = B.w, h = B.h, d = B.d, A = c => c >>> 24;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x; if (d[i]) continue;
    if (A(d[i + 1]) === 255 && d[i + 1] === P.ol) d[i] = BACK_RIM;          // left of the silhouette (= behind)
    else if (A(d[i + w]) === 255 && d[i + w] === P.ol) d[i] = TOP_RIM;      // above the silhouette
  }
}

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
}

export function getNinjaFrame(pose, ov) {
  const q = quant(pose), key = keyOf(q, ov);
  let f = CACHE.get(key);
  if (!f) {
    if (CACHE.size >= CACHE_MAX) CACHE.delete(CACHE.keys().next().value);
    f = buildFrame(q, ov); CACHE.set(key, f);
  }
  return f;
}
export function ninjaCacheSize() { return CACHE.size; }
export function clearNinjaCache() { CACHE.clear(); }

/* ------------------------------------------------------------------ glow sprites (stepped radial, additive) */
const GLOW = new Map();
function glowSprite(col, r) {
  const k = col + r; let s = GLOW.get(k); if (s) return s;
  s = makeCanvas(r * 2 + 1, r * 2 + 1);
  const x = s.getContext('2d'), n = parseInt(col.slice(1), 16);
  const bands = Math.max(3, Math.min(6, Math.round(r / 3)));
  for (let i = 0; i < bands; i++) {
    x.fillStyle = `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${0.08 + i * 0.012})`;
    x.beginPath(); x.arc(r + 0.5, r + 0.5, Math.max(1, r * (1 - i / bands)), 0, Math.PI * 2); x.fill();
  }
  GLOW.set(k, s); return s;
}

/* ------------------------------------------------------------------ scarf (live: it is world-space physics) */
function scarfLine(ctx, x0, y0, x1, y1, t, c) {
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1, o = t >> 1;
  let e = dx + dy; ctx.fillStyle = c;
  for (let k = 0; k < 200; k++) {
    ctx.fillRect(x0 - o, y0 - o, t, t);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * e; if (e2 >= dy) { e += dy; x0 += sx; } if (e2 <= dx) { e += dx; y0 += sy; }
  }
}
function drawScarf(ctx, sc, x, y, ov) {
  const n = sc.length >> 1; if (n < 2) return;
  const W = i => i < 3 ? 3 : i < 7 ? 2 : 1;
  // second, shorter tail splitting off below the first (knotted-headband look)
  const m = Math.min(n, 8), dy = i => (i - 2) * 0.9;
  for (let i = 2; i < m - 1; i++) scarfLine(ctx, x + sc[i * 2], y + sc[i * 2 + 1] + dy(i), x + sc[i * 2 + 2], y + sc[i * 2 + 3] + dy(i + 1), 4, ov ? ov.fill : NINJA_PAL.ol);
  for (let i = 2; i < m - 1; i++) scarfLine(ctx, x + sc[i * 2], y + sc[i * 2 + 1] + dy(i), x + sc[i * 2 + 2], y + sc[i * 2 + 3] + dy(i + 1), 2, ov ? ov.fill : NINJA_PAL.mg[0]);
  for (let i = 0; i < n - 1; i++) scarfLine(ctx, x + sc[i * 2], y + sc[i * 2 + 1], x + sc[i * 2 + 2], y + sc[i * 2 + 3], W(i) + 2, ov ? ov.fill : NINJA_PAL.ol);
  for (let i = 0; i < n - 1; i++) scarfLine(ctx, x + sc[i * 2], y + sc[i * 2 + 1], x + sc[i * 2 + 2], y + sc[i * 2 + 3], W(i), ov ? ov.fill : (i % 3 === 2 ? NINJA_PAL.mg[0] : NINJA_PAL.mg[1]));
  if (!ov) for (let i = 0; i < Math.min(4, n - 1); i++) scarfLine(ctx, x + sc[i * 2], y + sc[i * 2 + 1] - 1, x + sc[i * 2 + 2], y + sc[i * 2 + 3] - 1, 1, NINJA_PAL.mg[2]);
}

/* ------------------------------------------------------------------ public API */
/**
 * Draw the ninja with feet centred at screen pixel (x, y).
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} pose  see header
 * @param {number} x
 * @param {number} y
 * @param {{fill:string, alpha?:number}} [ov]  silhouette overlay (after-images)
 */
export function drawNinja(ctx, pose, x, y, ov) {
  x = Math.round(x); y = Math.round(y);
  const f = pose.facing < 0 ? -1 : 1;
  const prevA = ctx.globalAlpha;
  if (ov && ov.alpha !== undefined) ctx.globalAlpha = prevA * ov.alpha;
  if (pose.scarf) drawScarf(ctx, pose.scarf, x, y, ov);
  const fr = getNinjaFrame(pose, ov);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.translate(x, y); ctx.scale(f, 1);
  ctx.drawImage(fr.cv, -OX, -OY);
  if (fr.glows.length) {
    ctx.globalCompositeOperation = 'lighter';
    for (const [gx, gy, col, r, a] of fr.glows) {
      ctx.globalAlpha = prevA * Math.min(1, a);
      ctx.drawImage(glowSprite(col, r), Math.round(gx - OX) - r, Math.round(gy - OY) - r);
    }
  }
  ctx.restore();
  // transformation flash (live, ~0.28 s): accent silhouette pop + shockring + 4 rays at the weapon forearm
  if (pose.xf !== undefined && pose.xf < 1 && !ov) {
    const k = 1 - pose.xf, A = NINJA_ACCENT[pose.chip === 'cannon' ? 'cannon' : 'blade'];
    if (k > 0.45) drawNinja(ctx, Object.assign({}, pose, { xf: 1, scarf: null }), x, y, { fill: A.l, alpha: (k - 0.45) * 1.6 });
    const sh = ninjaAnchors(pose).shoulder, hx = x + f * Math.round(sh.x + 7), hy = y - Math.round(sh.y - 5);
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = prevA * k; ctx.drawImage(glowSprite(A.m, 24), hx - 24, hy - 24);
    ctx.globalAlpha = prevA * Math.min(1, k * 1.5);
    const rr = Math.round(4 + 16 * (1 - k)), n = 28;                 // expanding pixel ring
    ctx.fillStyle = A.l;
    for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; ctx.fillRect(Math.round(hx + Math.cos(a) * rr), Math.round(hy + Math.sin(a) * rr), 1, 1); }
    const r = Math.round(4 + 12 * k);
    ctx.fillRect(hx - r, hy, r * 2 + 1, 1); ctx.fillRect(hx, hy - r, 1, r * 2 + 1);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(hx - 1, hy - 1, 3, 3);
    ctx.restore();
  }
  ctx.globalAlpha = prevA;
}

/** Local-space anchor points (x fwd, y up, from the feet) for gameplay/VFX integration. */
export function ninjaAnchors(pose) {
  const q = quant(pose), S = skeleton(q);
  const [nx, ny] = S.at(-1.2, 15.2);                          // scarf root: back of the collar
  return { shoulder: { x: S.shFx, y: S.shFy }, head: { x: S.hdx, y: S.hdy }, scarf: { x: nx, y: ny }, height: 46 };
}
export const NINJA_FRAME = { w: BW, h: BH, ox: OX, oy: OY };
