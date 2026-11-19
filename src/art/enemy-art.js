/* =====================================================================
   enemy-art.js — hostile robots (Gunner, Enforcer, Warden, Drone, Turret).

   They use the same software rasteriser as the ninja (ninja-pixel.js), but
   follow their own visual rules so they never read as "another ninja":
     · warm industrial gunmetal + hazard yellow/black, hostile red/orange glow
     · digitigrade (backward-knee) legs, boxy masses, mono / twin red optics
     · every attack has a readable telegraph pose with a growing hot glow
   Frames are cached by a quantised pose key.

   drawEnemyArt(ctx, e, x, y [, ov]) draws enemy `e` with its feet (or mount
   point) at screen pixel (x, y). Fields read (all optional except kind):
     kind gunner|enforcer|warden|drone|turret, facing ±1,
     anim idle|walk|chase|alert|windup|fire|lunge|recover|hit|stagger|swoop|dead,
     t, walk (phase rad), tele 0..1, muzzle, recoil, flash, attack ('slam'|'bolt'|'charge'),
     phase2, aim (rad, turret/drone), mount ('floor'|'wall'|'ceiling', turret), deadU / deadT.
   ===================================================================== */
import { PixBuf, rgb, capsule, disc, poly, line, compositeGroup, toCanvas } from './ninja-pixel.js';

export const ENEMY_PAL = {
  ol: '#0a0709',
  metal: ['#2f2c3a', '#4f4a5e', '#7a7390', '#bdb5d0'],
  metalB: ['#1d1b25', '#312e3c', '#4a4658'],
  hazard: ['#8a5a00', '#f2b705', '#ffe27a'], black: '#141218',
  red: ['#7a0f1c', '#ff2d3a', '#ffb0a0'],
  orange: ['#a33a00', '#ff7a1a', '#ffd2a0'],
  white: '#ffffff',
};
const C = {};
for (const k of ['metal', 'metalB', 'hazard', 'red', 'orange']) C[k] = ENEMY_PAL[k].map(c => rgb(c));
C.ol = rgb(ENEMY_PAL.ol); C.k = rgb(ENEMY_PAL.black); C.w = rgb('#ffffff');
const T_M = [C.metal[0], C.metal[1], C.metal[2], rgb('#a0627a')];
const T_MB = [C.metalB[0], C.metalB[1], C.metalB[2]];
const T_MH = [C.metal[1], C.metal[2], C.metal[3]];          // light metal (plates facing camera)
const T_Y = [C.hazard[0], C.hazard[1], C.hazard[2]];
const T_K = [C.k, C.metal[0], C.metal[1]];

const BW = 240, BH = 196, OX = 120, OY = 160;
let SC = 1;                                                  // per-kind draw scale (Warden = boss scale)
const MAIN = new PixBuf(BW, BH), LAY = new PixBuf(BW, BH);
const DEG = Math.PI / 180;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;

/* local (x fwd, y up) -> buffer, with optional rotation around (PVX, PVY) */
let ROT = false, RC = 1, RS = 0, PVX = 0, PVY = 0, FLIPY = false;
function bx(x, y) { if (ROT) { const dx = x - PVX, dy = y - PVY; x = PVX + dx * RC - dy * RS; } return OX + x * SC; }
function by(x, y) { if (ROT) { const dx = x - PVX, dy = y - PVY; y = PVY + dx * RS + dy * RC; } return FLIPY ? OY + y * SC : OY - y * SC; }
function setRot(a, px = 0, py = 0) { ROT = !!a; RC = Math.cos(a); RS = Math.sin(a); PVX = px; PVY = py; }
const cap = (x0, y0, x1, y1, r0, r1, T) => capsule(LAY, bx(x0, y0), by(x0, y0), bx(x1, y1), by(x1, y1), r0 * SC, r1 * SC, T);
const dsk = (x, y, r, T) => disc(LAY, bx(x, y), by(x, y), r * SC, T);
function pol(pts, T, bev) { const o = []; for (let i = 0; i < pts.length; i += 2) o.push(bx(pts[i], pts[i + 1]), by(pts[i], pts[i + 1])); poly(LAY, o, T, bev); }
const ln = (x0, y0, x1, y1, c) => line(LAY, bx(x0, y0), by(x0, y0), bx(x1, y1), by(x1, y1), c);
const px1 = (x, y, c) => LAY.set(Math.floor(bx(x, y)), Math.floor(by(x, y)), c);
const commit = (ol = C.ol) => compositeGroup(MAIN, LAY, ol);
const hazard = (x, y) => (((x + y) >> 1) & 1) ? C.hazard[1] : C.k;   // diagonal warning stripes
function ik(ax, ay, tx, ty, l1, l2, bend) {
  let dx = tx - ax, dy = ty - ay, d = Math.hypot(dx, dy);
  const mx = l1 + l2 - 0.05; if (d > mx) { dx *= mx / d; dy *= mx / d; d = mx; } if (d < 0.5) d = 0.5;
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, l1 * l1 - a * a)), ux = dx / d, uy = dy / d;
  return { x: ax + ux * a - uy * h * bend, y: ay + uy * a + ux * h * bend, ex: ax + dx, ey: ay + dy };
}

/* ------------------------------------------------------------------ shared parts */
/** digitigrade leg: hip -> knee (backward) -> ankle -> toe pad on the ground */
function digiLeg(hx, hy, fx, fy, len, back, r = 2.4) {
  const ax = fx - 1.5, ay = fy + 4;                        // raised ankle
  const k = ik(hx, hy, ax, ay, len, len * 0.9, -1);        // knee points backwards
  const Tm = back ? T_MB : T_M;
  cap(hx, hy, k.x, k.y, r + 0.6, r, Tm);
  cap(k.x, k.y, k.ex, k.ey, r * 0.75, r * 0.6, back ? T_MB : T_MH);
  cap(k.ex, k.ey, fx + 3, fy + 1, 1.3, 1.3, Tm);            // metatarsal
  pol([fx - 3, fy, fx + 5.5, fy, fx + 4.5, fy + 2.2, fx - 2, fy + 2.4], back ? T_MB : T_M);  // toe pad
  dsk(k.x, k.y, r * 0.7, back ? [C.metalB[0], C.metalB[1], C.metalB[1]] : T_Y);  // hazard knee joint
}
function walkFeet(q, stride, lift) {
  const ph = q.walk, s = Math.sin(ph), c = Math.cos(ph);
  if (q.anim === 'walk' || q.anim === 'chase') return { ff: [stride * s + 1, Math.max(0, c) * lift], bf: [-stride * s - 1, Math.max(0, -c) * lift], bob: -Math.abs(s) * 1.2 };
  if (q.anim === 'lunge') return { ff: [9, 0], bf: [-9, 0], bob: -3 };
  if (q.anim === 'windup') return { ff: [5, 0], bf: [-6, 0], bob: -1.5 };
  return { ff: [4, 0], bf: [-4, 0], bob: q.anim === 'idle' || q.anim === 'alert' ? -q.bob : 0 };
}
function glowAt(S, x, y, col, r, a) { S.glows.push([bx(x, y), by(x, y), col, Math.round(r * SC), a]); }
function optic(S, x, y, len, hot, tele) {                  // horizontal red visor slit
  ln(x - 0.5, y, x + len, y, hot ? C.orange[2] : C.red[1]);
  px1(x + len, y, C.w);
  glowAt(S, x + len * 0.6, y, hot ? ENEMY_PAL.orange[1] : ENEMY_PAL.red[1], 6 + Math.round(tele * 6), 0.7);
}

/* ------------------------------------------------------------------ GUNNER: squat rifle trooper, mono-eye */
function gunner(q, S) {
  const { ff, bf, bob } = walkFeet(q, 4, 3);
  const hip = 15 + bob, hot = q.anim === 'windup' || q.anim === 'fire' || q.anim === 'alert';
  const lean = q.anim === 'fire' ? -2 - q.rec * 2 : q.anim === 'hit' ? -4 : 1;
  digiLeg(-1.5, hip, bf[0], bf[1], 7.5, true); commit();
  // backpack + antenna (behind)
  pol([lean - 11, hip + 4, lean - 5, hip + 3, lean - 5, hip + 15, lean - 10, hip + 14], T_M);
  ln(lean - 9, hip + 14, lean - 10, hip + 22, C.metal[2]);
  px1(lean - 10, hip + 22.5, (q.tf & 1) ? C.red[1] : C.red[0]);
  commit();
  // torso: boxy, with hazard chest plate
  pol([-5.5, hip, 5.5, hip, lean + 6.5, hip + 12, lean - 5, hip + 13.5], T_M, 1.3);
  pol([-5, hip + 0.5, 5.5, hip + 0.5, 5.8, hip + 3.5, -5, hip + 3.5], hazard);
  ln(-5, hip + 1.5, 5, hip + 1.5, C.metal[0]);
  commit();
  digiLeg(1.5, hip, ff[0], ff[1], 7.5, false); commit();
  // head: low dome with a single slit optic
  const hx = lean + 2, hy = hip + 16.5;
  pol([hx - 4.5, hy - 2.5, hx + 5, hy - 2.5, hx + 5.5, hy + 1.5, hx + 2, hy + 4.2, hx - 3.5, hy + 3.8], T_M, 1.2);
  pol([hx - 0.5, hy - 1.4, hx + 5.8, hy - 1.4, hx + 5.8, hy + 1, hx - 0.5, hy + 1], C.k);
  commit();
  optic(S, hx, hy - 0.2, 5, hot, q.tele);
  // rifle arm
  const kick = q.rec * 3, ax = lean + 9 - kick, ay = hip + 8 + (q.anim === 'hit' ? 3 : 0);
  const k = ik(lean + 1, hip + 11, ax, ay, 5, 5, -1);
  cap(lean + 1, hip + 11, k.x, k.y, 2.4, 2, T_M); cap(k.x, k.y, ax, ay, 2, 1.8, T_MH);
  pol([lean - 6, hip + 13.5, lean + 2, hip + 14.5, lean + 3.5, hip + 10.5, lean - 5, hip + 9], T_MH);   // pauldron
  pol([ax - 7, ay - 1.5, ax + 9, ay - 1.5, ax + 9, ay + 2.5, ax - 7, ay + 2.5], T_M);                    // rifle body
  pol([ax + 9, ay - 0.5, ax + 15, ay - 0.5, ax + 15, ay + 1.6, ax + 9, ay + 1.6], T_MH);                 // barrel
  pol([ax - 3, ay - 1.5, ax, ay - 1.5, ax - 1, ay - 5, ax - 3.5, ay - 5], T_M);                           // grip/mag
  ln(ax - 5, ay + 1.5, ax + 7, ay + 1.5, hot ? C.orange[1] : C.orange[0]);                               // charge strip
  commit();
  S.muzzle = [ax + 16, ay + 0.5];
}

/* ------------------------------------------------------------------ ENFORCER: lean melee hunter, heat machete */
function enforcer(q, S) {
  const { ff, bf, bob } = walkFeet(q, 5, 4);
  const A = q.anim, hip = 18 + bob;
  const lean = A === 'lunge' ? 9 : A === 'windup' ? -3 : A === 'chase' ? 6 : A === 'hit' ? -6 : A === 'stagger' ? -3 : 2;
  const hot = A === 'windup' || A === 'lunge' || A === 'chase' || A === 'alert';
  // tattered war-cloth (red, behind)
  const cl = A === 'chase' || A === 'lunge' ? 1 : 0;
  pol([-3, hip + 3, 1, hip + 3, -6 - cl * 4, hip - 9 + cl * 4, -9 - cl * 5, hip - 6 + cl * 5], [C.red[0], C.red[0], C.red[1]]);
  commit();
  digiLeg(-1.5, hip, bf[0], bf[1], 9, true, 2); commit();
  // back claw arm
  cap(lean - 2, hip + 12, lean - 5, hip + 5, 1.6, 1.4, T_MB);
  ln(lean - 5, hip + 5, lean - 4, hip + 2, C.metalB[2]); ln(lean - 5, hip + 5, lean - 7, hip + 3, C.metalB[2]);
  commit();
  // torso: narrow waist, wide hunched shoulders
  pol([-2.5, hip, 2.5, hip, lean + 5, hip + 12, lean + 1, hip + 14.5, lean - 6, hip + 12.5], T_M, 1.2);
  ln(lean - 3, hip + 4, lean + 3.5, hip + 4, C.red[1]);
  pol([-3, hip - 0.5, 3, hip - 0.5, 3, hip + 2, -3, hip + 2], hazard);
  commit();
  digiLeg(1.5, hip, ff[0], ff[1], 9, false, 2); commit();
  // head: forward wedge with twin eyes, two swept horns
  const hx = lean + 3, hy = hip + 16.5;
  pol([hx - 4, hy - 2, hx + 1, hy - 3.2, hx + 7, hy - 0.8, hx + 3, hy + 3.5, hx - 3.5, hy + 3], T_M, 1.1);
  cap(hx - 2, hy + 2.5, hx - 7, hy + 7, 0.9, 0.5, T_MH); cap(hx, hy + 3, hx - 3, hy + 8.5, 0.9, 0.5, T_MH);
  commit();
  px1(hx + 3, hy + 0.5, hot ? C.orange[2] : C.red[1]); px1(hx + 5, hy - 0.2, hot ? C.orange[2] : C.red[1]);
  px1(hx + 4, hy + 0.2, C.red[0]);
  glowAt(S, hx + 4, hy, hot ? ENEMY_PAL.orange[1] : ENEMY_PAL.red[1], 7, 0.7);
  // machete arm
  let bxp, byp, ang, len;
  if (A === 'windup') { bxp = lean + 2; byp = hip + 19; ang = 100 + q.tele * 15; len = 14 + q.tele * 4; }
  else if (A === 'lunge') { bxp = lean + 11; byp = hip + 10; ang = 2; len = 20; }
  else if (A === 'stagger' || A === 'hit') { bxp = lean + 3; byp = hip + 13; ang = 130; len = 12; }
  else if (A === 'recover') { bxp = lean + 8; byp = hip + 4; ang = -40; len = 15; }
  else { bxp = lean + 7; byp = hip + 5; ang = -25; len = 14; }
  const k = ik(lean + 1, hip + 12, bxp, byp, 5.5, 5.5, -1);
  cap(lean + 1, hip + 12, k.x, k.y, 2.2, 1.8, T_M); cap(k.x, k.y, bxp, byp, 1.9, 2.3, T_MH);
  dsk(lean + 1, hip + 12.5, 2.4, T_MH);
  commit();
  const a = ang * DEG, dx = Math.cos(a), dy = Math.sin(a), nx = -dy, ny = dx;
  const x0 = bxp + dx * 1.5, y0 = byp + dy * 1.5, white = A === 'windup' && (q.tf & 1);
  pol([x0 + nx * 1.2, y0 + ny * 1.2, x0 + dx * len + nx * 2.4, y0 + dy * len + ny * 2.4, x0 + dx * (len + 2), y0 + dy * (len + 2),
    x0 + dx * len * 0.6 - nx * 1.6, y0 + dy * len * 0.6 - ny * 1.6, x0 - nx * 1.2, y0 - ny * 1.2],
    white ? [C.orange[2], C.w, C.w] : [C.orange[0], C.red[1], C.orange[1]]);
  ln(x0 + dx * 2 + nx * 0.4, y0 + dy * 2 + ny * 0.4, x0 + dx * (len - 1) + nx * 1.4, y0 + dy * (len - 1) + ny * 1.4, hot ? C.orange[2] : C.orange[1]);
  commit(C.red[0]);
  glowAt(S, x0 + dx * len * 0.5, y0 + dy * len * 0.5, ENEMY_PAL.red[1], 8 + Math.round(q.tele * 8), 0.5 + q.tele * 0.4);
}

/* ------------------------------------------------------------------ WARDEN: boss-scale security mech */
function warden(q, S) {
  const { ff, bf, bob } = walkFeet(q, 4, 3);
  const A = q.anim, atk = q.attack, p2 = q.p2, hot = A === 'windup' || A === 'fire';
  const slamUp = A === 'windup' && atk === 'slam', charge = A === 'windup' && atk === 'charge', impact = q.impact;
  let hip = 22 + bob - (charge ? 3 + 4 * q.tele : 0) - (slamUp ? 1 : 0) - (impact ? 5 : 0);
  const lean = charge ? 16 : impact ? 10 : A === 'fire' ? -3 : A === 'hit' ? -4 : slamUp ? -4 : 1;
  glowAt(S, 0, hip + 12, ENEMY_PAL.red[1], 30, 0.07 + 0.12 * q.tele + (p2 ? 0.06 : 0));   // hostile aura
  const coreC = p2 ? ((q.tf & 1) ? C.orange[2] : C.red[1]) : C.red[1];
  // pillar legs (straight, armoured)
  const leg = (sx, f, back) => {
    const T1 = back ? T_MB : T_M;
    const k = ik(sx, hip, f[0], f[1] + 3, 11, 10, 1);
    cap(sx, hip, k.x, k.y, 4.4, 3.8, T1);
    cap(k.x, k.y, k.ex, k.ey, 3.8, 3.4, back ? T_MB : T_MH);
    pol([f[0] - 5, f[1], f[0] + 6.5, f[1], f[0] + 5.5, f[1] + 3.5, f[0] - 4.5, f[1] + 4], T1);
    pol([k.x - 3, k.y - 2, k.x + 3.5, k.y - 2, k.x + 3.5, k.y + 2.5, k.x - 3, k.y + 2.5], back ? T_MB : hazard);
  };
  leg(-3, bf, true); commit();
  // back arm (fist)
  const backFist = slamUp ? [lean - 3, hip + 34 + q.tele * 3] : impact ? [lean + 9, 4] : charge ? [lean + 8, hip + 6] : [lean - 9, hip + 8];
  cap(lean - 6, hip + 19, backFist[0], backFist[1], 3.4, 3, T_MB);
  pol([backFist[0] - 4, backFist[1] - 4, backFist[0] + 4, backFist[1] - 4, backFist[0] + 4.5, backFist[1] + 4, backFist[0] - 4, backFist[1] + 4], T_MB);
  commit();
  // shoulder launch pods (open + glowing during bolt windup/fire)
  const open = (A === 'windup' && atk !== 'slam' && atk !== 'charge') || A === 'fire';
  pol([lean - 14, hip + 20, lean - 4, hip + 20, lean - 3, hip + 31, lean - 13, hip + 32], T_M, 1.2);
  for (let i = 0; i < 3; i++) {
    const tx = lean - 12 + i * 3;
    pol([tx, hip + 31, tx + 2.2, hip + 31, tx + 2.2 + (open ? 1 : 0), hip + 33 + (open ? 2 : 0), tx + (open ? 1 : 0), hip + 33 + (open ? 2 : 0)], open ? [C.orange[0], C.orange[1], C.orange[2]] : T_K);
  }
  pol([lean - 13, hip + 22, lean - 5, hip + 22, lean - 5, hip + 24, lean - 13, hip + 24], hazard);
  commit();
  if (open) glowAt(S, lean - 9, hip + 34, ENEMY_PAL.orange[1], 10 + Math.round(q.tele * 8), 0.5 + q.tele * 0.5);
  // torso: massive trapezoid, hazard belt, reactor core
  pol([-8, hip - 1, 8, hip - 1, lean + 12, hip + 15, lean + 8, hip + 22, lean - 9, hip + 22, lean - 11, hip + 12], T_M, 1.4);
  pol([-8.5, hip - 1.5, 8.5, hip - 1.5, 9, hip + 2.5, -9, hip + 2.5], hazard);
  pol([lean + 1, hip + 7, lean + 9, hip + 7, lean + 10, hip + 17, lean + 2, hip + 18], T_MH, 1.2);
  commit();
  if (q.exp) {                                                  // vulnerable window: chest plates open, core exposed
    pol([lean + 0.5, hip + 6, lean + 10.5, hip + 6, lean + 11, hip + 18, lean + 1, hip + 19], C.k);
    dsk(lean + 5.5, hip + 12, 4.4, C.orange[0]); dsk(lean + 5.5, hip + 12, 3.4, (q.tf & 1) ? C.w : C.orange[2]); dsk(lean + 5.5, hip + 12, 1.6, C.w);
    glowAt(S, lean + 5.5, hip + 12, '#ffd2a0', 22, 0.9);
  } else { dsk(lean + 5, hip + 12, 3, C.red[0]); dsk(lean + 5, hip + 12, 2, coreC); px1(lean + 5, hip + 12.6, C.w); }
  if (q.stun && !q.exp) { dsk(lean + 5, hip + 12, 3.2, C.w); glowAt(S, lean + 5, hip + 12, '#ffffff', 16, 0.8); }
  if (p2) for (const vx of [-6, -3]) ln(lean + vx, hip + 14, lean + vx, hip + 19, (q.tf & 1) ? C.orange[1] : C.red[1]);   // overdrive vents
  commit(null);
  glowAt(S, lean + 5, hip + 12, ENEMY_PAL.red[1], p2 ? 16 : 11, 0.6 + q.tele * 0.4);
  // head sunk between the shoulders
  const hx = lean + 3, hy = hip + 25;
  pol([hx - 5, hy - 3, hx + 5, hy - 3, hx + 6, hy + 2, hx + 2, hy + 4.5, hx - 4, hy + 4], T_M, 1.1);
  pol([hx - 1, hy - 1, hx + 6.5, hy - 1, hx + 6.5, hy + 1.6, hx - 1, hy + 1.6], C.k);
  commit();
  optic(S, hx, hy, 6, hot || p2, q.tele);
  leg(3, ff, false); commit();
  // front arm: heavy fist-cannon
  const kick = q.rec * 4;
  let fx, fy;
  if (slamUp) { fx = lean + 6; fy = hip + 36 + q.tele * 3; }
  else if (impact) { fx = lean + 15; fy = 4; }
  else if (charge) { fx = lean + 16; fy = hip + 9; }
  else { fx = lean + 14 - kick; fy = hip + 12; }
  const k = ik(lean + 3, hip + 19, fx, fy, 8, 8, -1);
  fx = k.ex; fy = k.ey;
  cap(lean + 3, hip + 19, k.x, k.y, 3.6, 3.2, T_M); dsk(k.x, k.y, 2.6, T_Y);
  const ang = Math.atan2(fy - k.y, fx - k.x), dx = Math.cos(ang), dy = Math.sin(ang), nx = -dy, ny = dx;
  const G = (a, b) => [fx + dx * a + nx * b, fy + dy * a + ny * b];
  pol([...G(-5, -4.5), ...G(6, -4), ...G(6, 4), ...G(-5, 4.8)], T_MH, 1.3);
  pol([...G(6, -2.4), ...G(10.5, -2.2), ...G(10.5, 2.2), ...G(6, 2.4)], T_M);
  ln(...G(-3, 3), ...G(5, 3), C.orange[hot ? 1 : 0]);
  pol([...G(-6.5, -3.5), ...G(-4.5, -3.5), ...G(-4.5, 3.5), ...G(-6.5, 3.5)], hazard);
  commit();
  S.muzzle = G(11.5, 0);
  if (slamUp) glowAt(S, fx, fy, ENEMY_PAL.orange[1], 12 + Math.round(q.tele * 8), 0.4 + q.tele * 0.6);
  if (impact) {                                              // ground impact burst under the fists
    for (let i = -14; i <= 14; i += 2) { const h = 3 + ((i * 7 + q.tf) % 5 + 5) % 5; ln(lean + 12 + i, 0, lean + 12 + i * 1.4, h, (i & 2) ? C.orange[1] : C.hazard[2]); }
    dsk(lean + 12, 1.5, 4, C.w);
    commit(null);
    glowAt(S, lean + 12, 2, ENEMY_PAL.orange[1], 22, 1);
  }
  if (charge) glowAt(S, lean + 6, hip + 8, ENEMY_PAL.red[1], 18, 0.4 + 0.5 * q.tele);
}

/* ------------------------------------------------------------------ DRONE: flying sentry, swoops */
function drone(q, S) {
  const A = q.anim, hot = A === 'windup' || A === 'fire' || A === 'swoop' || A === 'alert';
  const cy = 12 + (A === 'idle' || A === 'alert' ? q.bob : 0);
  const tilt = A === 'dead' ? (q.dead === 2 ? 70 : 35) : A === 'swoop' ? -28 : A === 'hit' ? 18 : A === 'windup' ? -8 : A === 'walk' || A === 'chase' ? -10 : 0;
  setRot(tilt * DEG, 0, cy);
  // rotor arms + blurred rotors
  for (const s of [-1, 1]) {
    cap(s * 3, cy + 2, s * 9, cy + 4.5, 1.2, 1, T_M);
    dsk(s * 9, cy + 4.5, 1.4, T_MH);
  }
  commit();
  const rf = q.tf % 3;
  for (const s of [-1, 1]) {
    const w = [7, 4, 6][(rf + (s > 0 ? 1 : 0)) % 3];
    ln(s * 9 - w, cy + 6, s * 9 + w, cy + 6, C.metal[3]);
    if (rf === 0) ln(s * 9 - w + 2, cy + 6.6, s * 9 + w - 2, cy + 6.6, C.metal[2]);
  }
  commit(null);
  // hull: flattened lens with hazard band, under-slung twin gun
  pol([-7, cy, -4.5, cy + 4, 5, cy + 4, 8.5, cy + 0.5, 6, cy - 3.5, -4.5, cy - 3.5], T_M, 1.3);
  pol([-6, cy - 3.6, 5.5, cy - 3.6, 4.5, cy - 2, -5, cy - 2], hazard);
  const gk = q.rec * 2;
  pol([-1 - gk, cy - 3.5, 7 - gk, cy - 4.5, 7 - gk, cy - 6.5, -1 - gk, cy - 6], T_MH);
  commit();
  // big eye lens
  dsk(4.8, cy + 0.6, 2.6, C.k);
  dsk(5.3, cy + 0.6, 1.7, hot ? C.orange[1] : C.red[1]);
  px1(5.8, cy + 1.2, C.w);
  commit(null);
  glowAt(S, 5.5, cy + 0.6, hot ? ENEMY_PAL.orange[1] : ENEMY_PAL.red[1], 7 + Math.round(q.tele * 7), 0.7 + q.tele * 0.3);
  S.muzzle = [bx(8 - gk, cy - 5.5) - OX, OY - by(8 - gk, cy - 5.5)];
  setRot(0);
}

/* ------------------------------------------------------------------ TURRET: floor / wall / ceiling emplacement */
function turret(q, S) {
  const A = q.anim, hot = A === 'windup' || A === 'fire';
  // base (in mount space: floor = y up from the mount point)
  pol([-9, 0, 9, 0, 7, 5, -7, 5], hazard);
  pol([-6, 5, 6, 5, 5, 8, -5, 8], T_M, 1.1);
  commit();
  dsk(0, 10, 5, T_M);                                         // pivot dome
  commit();
  // barrel rotates to aim (in mount space)
  // aim is in world space (rad, +up); convert into mount space
  let a = q.mount === 'wall' ? q.aim + Math.PI / 2 : q.mount === 'ceiling' ? -q.aim : q.aim;
  if (A === 'dead') a = -0.5;
  const dx = Math.cos(a), dy = Math.sin(a), nx = -dy, ny = dx, kick = q.rec * 2.5;
  const at = (u, v) => [dx * (u - kick) + nx * v, 10 + dy * (u - kick) + ny * v];
  pol([...at(-3, -3.2), ...at(7, -3), ...at(7, 3), ...at(-3, 3.4)], T_MH, 1.2);
  pol([...at(7, -1.6), ...at(15, -1.4), ...at(15, 1.4), ...at(7, 1.6)], T_M);
  pol([...at(14, -2.4), ...at(16.5, -2.4), ...at(16.5, 2.4), ...at(14, 2.4)], T_MH);
  commit();
  const [ex, ey] = at(1.5, 0.4);
  dsk(ex, ey, 1.5, hot ? C.orange[1] : C.red[1]); px1(ex + 0.4, ey + 0.4, C.w);
  if (A === 'windup') {                                         // dotted laser sight
    for (let d = 18; d < 18 + 26 * q.tele; d += 2) { const [lx, ly] = at(d + kick, 0); px1(lx, ly, (d & 2) ? C.red[1] : C.red[0]); }
  }
  commit(null);
  glowAt(S, ex, ey, hot ? ENEMY_PAL.orange[1] : ENEMY_PAL.red[1], 6 + Math.round(q.tele * 6), 0.7);
  const [mx, my] = at(17.5 + kick, 0);
  S.muzzle = [bx(mx, my) - OX, OY - by(mx, my)];
}

/* ------------------------------------------------------------------ frame build + cache */
function quant(e) {
  const t = e.t || 0;
  let anim = e.anim || 'idle', attack = e.attack || '', tele = e.tele || 0;
  // normalise boss / generic aliases: warden 'slam' | 'charge' are telegraphed attack poses
  if (anim === 'slam' || anim === 'charge') { attack = anim; anim = 'windup'; if (!e.tele) tele = 1; }
  const stun = anim === 'stun';
  if (stun) anim = 'stagger';
  const dying = anim === 'dying';
  if (dying) anim = 'dead';
  const deadU = e.deadU !== undefined ? e.deadU : e.dieU !== undefined ? e.dieU : dying && e.st !== undefined ? clamp(e.st / 1.8, 0, 1)
    : e.deadT !== undefined ? clamp(e.deadT / 0.5, 0, 1) : 1;
  const impact = e.impact > 0 || (e.kind === 'warden' && attack === 'slam' && e.state === 'alert' && (e.st || 0) < 0.3) ? 1 : 0;
  return {
    kind: e.kind || 'gunner', anim, walk: Math.round(((e.walk || 0) % (Math.PI * 2)) / (Math.PI / 4)) * (Math.PI / 4),
    bob: Math.floor(t * 2) % 2, tf: Math.floor(t * 14) % 6,
    tele: Math.round(clamp(tele, 0, 1) * 5) / 5, mz: e.muzzle > 0 ? 1 : 0, rec: Math.round(clamp(e.recoil || 0, 0, 1) * 3) / 3,
    flash: e.flash > 0 ? 1 : 0, attack, p2: e.phase2 ? 1 : 0, exp: e.exposed ? 1 : 0, stun: stun ? 1 : 0, impact,
    boom: e.kind === 'warden' && anim === 'dead' ? Math.min(7, Math.floor(deadU * 8)) : -1,
    aim: Math.round((e.aim || 0) / (7.5 * DEG)) * 7.5 * DEG, mount: e.mount || 'floor',
    dead: anim === 'dead' ? (deadU < 0.5 ? 1 : 2) : 0,
  };
}
const keyOf = q => [q.kind, q.anim, q.walk.toFixed(2), q.bob, q.tf, q.tele, q.mz, q.rec, q.flash, q.attack, q.p2, q.exp, q.stun, q.impact, q.boom, q.aim.toFixed(3), q.mount, q.dead].join('|');

function tint(B, r, g, b, k) {
  const d = B.d, u8 = new Uint8Array(d.buffer);
  for (let i = 0; i < d.length; i++) {
    if (!d[i] || d[i] === C.ol) continue;
    const o = i * 4; u8[o] += (r - u8[o]) * k; u8[o + 1] += (g - u8[o + 1]) * k; u8[o + 2] += (b - u8[o + 2]) * k;
  }
}

/* hostile rim: a thin warm-red halo along the top/back edges (the player's halo is cool blue) */
const RIM_TOP = rgb('#ff5a4a', 80), RIM_SIDE = rgb('#ff5a4a', 55);
function rimHalo(B) {
  const w = B.w, h = B.h, d = B.d;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x; if (d[i]) continue;
    if (d[i + w] === C.ol) d[i] = RIM_TOP;
    else if (d[i - 1] === C.ol) d[i] = RIM_SIDE;
  }
}

/* boss death: 8 stages — shaking, darkening, chained explosions, final white blast + collapse */
const BOOMS = [[-6, 30], [8, 18], [-2, 42], [10, 36], [-10, 14], [4, 26], [0, 24]];
function wardenBoom(q, S) {
  const k = q.boom;
  tint(MAIN, 30, 12, 16, Math.min(0.6, k * 0.08));
  for (let i = 0; i <= Math.min(k, BOOMS.length - 1); i++) {
    const [x, y] = BOOMS[i], age = k - i, r = (age === 0 ? 4 : age === 1 ? 7 : 5) * SC;
    const X = OX + x * SC, Y = OY - y * SC;
    if (age <= 1) { disc(LAY, X, Y, r + 2, C.red[1]); disc(LAY, X, Y, r, C.orange[1]); disc(LAY, X, Y, r * 0.55, age ? C.hazard[2] : C.w); S.glows.push([X, Y, ENEMY_PAL.orange[1], 18 + age * 6, 0.9]); }
    else { for (let j = 0; j < 7; j++) { const a = j * 0.9 + i; LAY.set(X + Math.cos(a) * (r + age * 2), Y + Math.sin(a) * (r + age * 2), (j & 1) ? rgb('#3a2a2e') : rgb('#5a4048')); } }
  }
  if (k >= 7) { disc(LAY, OX, OY - 26 * SC, 22 * SC, rgb('#ffffff', 200)); S.glows.push([OX, OY - 26 * SC, '#ffffff', 50, 1]); }
  compositeGroup(MAIN, LAY, null);
}

const RIM2 = rgb('#ff3b2a', 60);
function rimHalo2(B) {                                         // boss: a second, wider hostile halo ring
  const w = B.w, h = B.h, d = B.d, add = [];
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x; if (d[i]) continue;
    const n = d[i + 1] || d[i - 1] || d[i + w] || d[i - w];
    if (n === RIM_TOP || n === RIM_SIDE) add.push(i);
  }
  for (const i of add) d[i] = RIM2;
}

function buildFrame(q, ov) {
  MAIN.clear(); LAY.clear(); setRot(0); FLIPY = false;
  const S = { glows: [] };
  const kind = q.kind;
  let D = q.dead;
  SC = kind === 'warden' ? 1.7 : 1;
  if (q.boom >= 0) D = 0;                                       // the boss has its own explosion sequence
  if (D) {                                                     // death: topple + darken + sparks
    const fall = D === 1 ? 0.35 : kind === 'warden' ? 0.5 : 1.25;
    if (kind !== 'turret') setRot(fall, kind === 'drone' ? 0 : -4, 0);
  } else if (q.anim === 'hit' || q.anim === 'stagger') {
    if (kind !== 'turret' && kind !== 'drone') setRot(0.12, 0, 0);
  }
  if (kind === 'turret' && q.mount === 'ceiling') FLIPY = true;
  if (kind === 'turret' && q.mount === 'wall') setRot(-Math.PI / 2, 0, 0);
  const fn = { gunner, enforcer, warden, drone, turret }[kind] || gunner;
  // the drawing functions manage their own groups; global rotation is kept for death/hit
  const keepRot = ROT, rc = RC, rs = RS, pvx = PVX, pvy = PVY;
  const prevSetRot = setRot;
  fn(q, S);
  ROT = keepRot; RC = rc; RS = rs; PVX = pvx; PVY = pvy;
  // muzzle flash (in local unrotated space is fine: flashes only happen when standing)
  if (q.mz && S.muzzle && !D) {
    const [mx, my] = S.muzzle;
    const big = kind === 'warden' ? 1.5 : 1;
    const X = OX + mx * SC, Y = FLIPY ? OY + my * SC : OY - my * SC;
    disc(LAY, X, Y, 3 * big, C.orange[1]); disc(LAY, X, Y, 2 * big, C.w);
    line(LAY, X, Y, X + 8 * big, Y, C.orange[2]);
    compositeGroup(MAIN, LAY, null);
    S.glows.push([X, Y, ENEMY_PAL.orange[1], 14, 0.9]);
  }
  if (q.boom >= 0) wardenBoom(q, S);
  if (!ov && !D) { rimHalo(MAIN); if (kind === 'warden') rimHalo2(MAIN); }
  if (D) {
    tint(MAIN, 10, 8, 14, D === 2 ? 0.55 : 0.3);
    S.glows = [];
    if (!ov) for (let i = 0; i < 6; i++) { const r = ((i * 7919 + q.tf * 131) % 97) / 97; MAIN.set(OX - 10 + Math.floor(r * 22), OY - 4 - Math.floor(((i * 37) % 23)), i & 1 ? C.orange[1] : C.hazard[2]); }
  }
  if (q.flash || ov) {
    const c = ov ? rgb(ov.fill) : rgb('#ffffff'), d = MAIN.d;
    for (let i = 0; i < d.length; i++) if (d[i] && (ov || d[i] !== C.ol)) d[i] = c;
  }
  ROT = false; FLIPY = false; SC = 1;
  const cv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(BW, BH) : Object.assign(document.createElement('canvas'), { width: BW, height: BH });
  toCanvas(MAIN, cv);
  void prevSetRot;
  return { cv, glows: ov || q.flash ? [] : S.glows };
}

const CACHE = new Map(), CACHE_MAX = 700;
const GLOW = new Map();
function glowSprite(col, r) {
  const k = col + r; let s = GLOW.get(k); if (s) return s;
  s = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(r * 2 + 1, r * 2 + 1) : Object.assign(document.createElement('canvas'), { width: r * 2 + 1, height: r * 2 + 1 });
  const x = s.getContext('2d'), n = parseInt(col.slice(1), 16), bands = Math.max(3, Math.min(6, Math.round(r / 3)));
  for (let i = 0; i < bands; i++) {
    x.fillStyle = `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${0.08 + i * 0.012})`;
    x.beginPath(); x.arc(r + 0.5, r + 0.5, Math.max(1, r * (1 - i / bands)), 0, Math.PI * 2); x.fill();
  }
  GLOW.set(k, s); return s;
}

export function drawEnemyArt(ctx, e, x, y, ov) {
  const q = quant(e), key = keyOf(q) + (ov ? '|' + ov.fill : '');
  let f = CACHE.get(key);
  if (!f) { if (CACHE.size >= CACHE_MAX) CACHE.delete(CACHE.keys().next().value); f = buildFrame(q, ov); CACHE.set(key, f); }
  const prevA = ctx.globalAlpha;
  if (ov && ov.alpha !== undefined) ctx.globalAlpha = prevA * ov.alpha;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.translate(Math.round(x), Math.round(y)); ctx.scale((e.facing || 1) < 0 ? -1 : 1, 1);
  ctx.drawImage(f.cv, -OX, -OY);
  if (f.glows.length) {
    ctx.globalCompositeOperation = 'lighter';
    for (const [gx, gy, col, r, a] of f.glows) { ctx.globalAlpha = prevA * Math.min(1, a); ctx.drawImage(glowSprite(col, r), Math.round(gx - OX) - r, Math.round(gy - OY) - r); }
  }
  ctx.restore();
  ctx.globalAlpha = prevA;
}
/** visual height in px (for health bars / "!" markers) */
export const ENEMY_HEIGHT = { gunner: 42, enforcer: 46, warden: 112, drone: 24, turret: 28 };
export function enemyCacheSize() { return CACHE.size; }
