import { ACCENT } from '../art/art.js';
import { ninjaAnchors } from '../art/ninja.js';
import { CHIPS, syncSlots, unlockChip } from '../chips/chips.js';
import { bladeHitCheck, blinkHit, hurtPlayer, killPlayer } from '../combat/combat.js';
import { resetArenaOnDeath } from '../enemies/enemies.js';
import { Feel } from '../combat/feel.js';
import { SFX } from '../core/audio.js';
import { Game } from '../core/game.js';
import { Aim, inputAimDown, inputAimUp, inputAttackHeld, inputLeft, inputRight, inputShieldHeld, pressed } from '../core/input.js';
import { bullets, enemies, enemyBullets } from '../core/state.js';
import { DEG, PPU, TAU, clamp, rnd } from '../core/util.js';
import { FX, PT } from '../effects/fx.js';
import { CHECKPOINTS, EXIT_X, HAZARDS, PICKUPS, PLAT, WORLD_W } from '../levels/stage1.js';
import { LASER_HALF, safeLandingX } from '../levels/world.js';
import { HUD } from '../ui/hud.js';

/* =====================================================================
   Player controller. Runs on the FIXED simulation tick (core/game.js TICK),
   so every number below is frame-rate independent.

   Movement: gravity 34 · jump 13.8 (release cuts to 50 %) · double jump ·
   run 12.2 · dash 28 for 0.2 s · fall speed capped at 24.

   Blade swing = anticipation (wind) → active → recovery.
     - facing is locked from swing start to the end of the active window
     - presses at ANY time during a swing are queued and chain into the next
       step at the swing's cancel point; presses before a swing are buffered
     - holding J auto-swings, but every held swing restarts the combo at step 1,
       so the finisher only comes from presses (no infinite held loop)
     - a lunge impulse carries the body into the hit; ground speed is clamped
       during wind/active and reduced in recovery; recovery is cancelled by
       jump / dash / blink / swap / turning around

   Gameplay anchors (shoulder / muzzle / scarf root) are constants here, never
   read from the art pose (REVIEW R-016): the renderer draws to match them.
   ===================================================================== */
export const TICK_HZ = 120;
export const MOVE = { gravity: 34, jump: 13.8, jumpCut: 0.5, maxFall: 24, run: 12.2, dash: 28, dashTime: 0.2, dashCd: 0.78, dashInv: 0.12,
  accelGround: 18, accelAir: 11, coyote: 0.1, jumpBuf: 0.12, tapTime: 0.03 };
export const PARRY_WINDOW = 0.2, PERFECT_WINDOW = 0.08, PARRY_WHIFF_CD = 0.4, PARRY_HOLD_AFTER = 0.12;
export const PARRY_COOLDOWN = PARRY_WHIFF_CD;            // legacy name
export const GUARD = { max: 3, costBolt: 1, costMelee: 1, costContact: 0.5, regen: 1.0, regenDelay: 0.5, breakTime: 0.7, afterBreak: 1, release: 0.08 };
export const ATK_BUFFER = 0.2;                           // press before a swing can start (dash, cooldown, hit-stop)
export const COMBO_WINDOW = 0.3;                         // after a swing fully ends, the next press continues the chain
export const SCARF_N = 9;

/* blade combo. Times in seconds. box = [behind, ahead, bottom, top] in world units relative to the feet
   (mirrored by facing). lunge = distance carried forward during wind+active. kb = enemy knock-back speed
   (≈ kb / 9 units of travel), kvy = upward pop. stun = enemy flinch time. hs = hit-stop. shake = art-px. */
export const SWING = [
  { wind: 0.05, act: 0.07, rec: 0.14, cancel: 0.15, dmg: 2, kb: 10, kvy: 0, stun: 0.22, hs: 0.05, shake: 2, lunge: 0.8, power: 1, box: [-0.2, 2.6, 0.1, 2.2], groundMul: 0.25, recMul: 0.5 },
  { wind: 0.05, act: 0.07, rec: 0.14, cancel: 0.15, dmg: 2, kb: 11, kvy: 0, stun: 0.22, hs: 0.06, shake: 3, lunge: 0.8, power: 1, box: [-0.3, 2.6, 0.0, 2.4], groundMul: 0.25, recMul: 0.5 },
  { wind: 0.09, act: 0.09, rec: 0.24, cancel: null, dmg: 3, kb: 26, kvy: 5, stun: 0.5,  hs: 0.09, shake: 5, lunge: 1.5, power: 3, box: [-0.4, 3.0, -0.1, 2.7], groundMul: 0.15, recMul: 0.35 },
];
SWING.forEach(S => { S.dur = S.wind + S.act + S.rec; });
export const KILL_HITSTOP = 0.12, BOSS_KILL_HITSTOP = 0.2;
/* slash arc parameters: [startDeg, endDeg, radiusPx, widthPx, centre ox (u), centre oy (u)]. The arcs sweep through
   the hit box at enemy-chest height (1-2 horizontal, 3 overhead) instead of over everyone's heads. */
export const SLASH_FX = [
  [80, -50, 32, 9, 0.35, 0.95],
  [-55, 75, 32, 9, 0.35, 1.05],
  [150, -70, 40, 13, 0.45, 1.15],
];

export const CHARGE_GLOW = 0.25, CHARGE_MIN = 0.6, CHARGE_FULL = 1.0;   // hold J with the cannon
export const CANNON = { speed: 31, life: 1.2, dmg: 1, cd: 0.3, recoil: 2.5, lanceSpeed: 27, lanceCd: 0.45 };
export const BLINK = { dist: 5.3, cd: 1.6, inv: 0.22, dmg: 3 };

/* gameplay anchors (world units from the feet, x forward) */
export const ANCHOR = { shoulder: { x: 0.08, y: 1.68 }, muzzleLen: 1.2, chest: { x: 0.1, y: 1.2 } };   // matches the phase-2 ninja (B)

export const player = {
  x: 3, y: 0, vx: 0, vy: 0, w: 0.7, facing: 1, onGround: true, airJumps: 0, prevX: 3, prevY: 0,
  hp: 6, maxhp: 6, inv: 0, dash: 0, dashCd: 0, checkpoint: 0,
  chip: 'blade', unlocked: new Set(['blade']), equip: { rarm: 'blade', larm: null, legs: null, core: null },
  cd: { blade: 0, cannon: 0, shield: 0, blink: 0 }, cdMax: { blade: 0, cannon: 0, shield: 0, blink: 0 },          // filled from the chip registry in resetPlayer (no import-time cycle)
  atkStep: 0, atkT: 0, atkU: 0, atkDur: 0, atkPhase: '', atkPhaseU: 0, atkFacing: 1, atkHits: [], atkFx: false, atkQueued: false, atkHeld: false,
  comboStep: 0, comboWin: 0, atkBuf: 0, lungeT: 0, lungeV: 0,
  shielding: false, shieldHeldPrev: false, shieldRel: 0, shieldAmt: 0, parryT: 0, parryArmed: false, parryCd: 0, blockFlash: 0,
  guard: GUARD.max, guardMax: GUARD.max, guardIdle: 0, guardBreakT: 0,
  anim: 'idle', t: 0, run: 0, rot: 0, flipT: 0, warpU: 0, recoil: 0, muzzle: 0, xf: 1, flash: 0, hurtT: 0, landT: 0,
  dead: false, deadT: 0, burst: false, pit: false, ghostT: 0, px: 3, py: 0, scarf: new Float32Array(SCARF_N * 2),
  hasShield: false, hasBlink: false, aim: 0, aimMode: 'auto', aimTarget: null, blinkBuf: 0, blinkDir: 1,
  coyote: 0, jumpBuf: 0, tapT: 0, tapDir: 0, charging: false, chargeT: 0, charge: 0, critT: 0,
};

export function resetPlayer() {
  const p = player;
  Object.assign(p, {
    x: 3, y: 0, vx: 0, vy: 0, prevX: 3, prevY: 0, facing: 1, onGround: true, airJumps: 0, hp: p.maxhp, inv: 0, dash: 0, dashCd: 0, checkpoint: 0,
    chip: 'blade', atkStep: 0, atkT: 0, atkU: 0, atkPhase: '', atkPhaseU: 0, atkFacing: 1, atkQueued: false, atkHeld: false, comboStep: 0, comboWin: 0, atkBuf: 0,
    lungeT: 0, lungeV: 0, shielding: false, shieldHeldPrev: false, shieldRel: 0, shieldAmt: 0, parryT: 0, parryArmed: false, parryCd: 0, blockFlash: 0,
    guard: GUARD.max, guardIdle: 0, guardBreakT: 0,
    anim: 'idle', rot: 0, flipT: 0, warpU: 0, recoil: 0, muzzle: 0, xf: 1, flash: 0,
    hurtT: 0, landT: 0, dead: false, deadT: 0, burst: false, pit: false, ghostT: 0, px: 3, py: 0, aim: 0, aimTarget: null, blinkBuf: 0,
    coyote: 0, jumpBuf: 0, tapT: 0, tapDir: 0, charging: false, chargeT: 0, charge: 0, critT: 0,
  });
  syncSlots();
  p.atkHits.length = 0;
  for (const k in p.cd) p.cd[k] = 0;
  for (const id in CHIPS) p.cdMax[id] = CHIPS[id].cool;
  resetScarf();
}
export function resetScarf() {
  const s = player.scarf;
  for (let i = 0; i < SCARF_N; i++) { s[i * 2] = -4 - i * 3; s[i * 2 + 1] = -34 + i * 0.4; }
}

/* ------------------------------------------------------------------ actions */
export function doJump(fromGround) {
  const p = player;
  p.vy = MOVE.jump; p.onGround = false; p.coyote = 0; p.airJumps = fromGround ? 0 : p.airJumps + 1;
  if (p.atkStep && p.atkPhase === 'rec') cancelSwing();
  if (fromGround) { FX.dust(p.x, p.y, 4, -p.facing); SFX.play('jump'); }
  else {                                                              // double jump = somersault + air ring
    p.flipT = 0.36;
    FX.ring(p.x, p.y + 0.4, 2, 16, 0.2, ACCENT[p.chip].m);
    FX.burst(p.x, p.y + 0.3, 6, '#74f8fa', 6);
    SFX.play('jump2');
  }
}

export function doDash() {
  const p = player;
  p.dash = MOVE.dashTime; p.dashCd = MOVE.dashCd; p.inv = Math.max(p.inv, MOVE.dashInv);
  p.vx = p.facing * MOVE.dash; p.ghostT = 0;
  p.shielding = false; cancelSwing(); p.lungeT = 0;
  FX.dust(p.x, p.y, 5, -p.facing);
  Feel.kick(0.8, p.facing * 0.3);
  SFX.play('dash');
}

export function snapshot() {                                          // frozen copy of the visual state (afterimages)
  const p = player;
  return { x: p.x, y: p.y, facing: p.facing, anim: p.anim, t: p.t, run: p.run, chip: p.chip, atkStep: p.atkStep, atkU: p.atkU, atkPhase: p.atkPhase,
    shieldAmt: p.shieldAmt, parryT: 0, blockFlash: 0, recoil: p.recoil, muzzle: 0, xf: 1, rot: p.rot, warpU: p.warpU, scarf: p.scarf.slice(),
    hasShield: p.hasShield, hasBlink: p.hasBlink, aim: p.aim };
}

/* ------------------------------------------------------------------ aiming (cannon, keyboard / gamepad) */
const _sh = { x: 0, y: 0 }, _mz = { x: 0, y: 0, dx: 0, dy: 0 };
export function shoulderWorld() { _sh.x = player.x + player.facing * ANCHOR.shoulder.x; _sh.y = player.y + ANCHOR.shoulder.y; return _sh; }
export function updateAim(dt) {
  const p = player, sh = shoulderWorld();
  let ang = 0;
  p.aimTarget = null;
  if (Aim.pad) {                                                        // gamepad right stick: free aim
    p.aimMode = 'manual';
    if (!p.atkStep) { if (Aim.padX > 0.2) p.facing = 1; else if (Aim.padX < -0.2) p.facing = -1; }
    ang = Math.atan2(Aim.padY, Math.max(0.05, Math.abs(Aim.padX)));
  } else if (inputAimUp() || inputAimDown()) {                          // I / S (or arrows / stick): 8-way
    p.aimMode = 'manual';
    const moving = inputLeft() || inputRight();
    ang = inputAimUp() ? (moving ? 45 : 85) * DEG : (moving || p.onGround ? -45 : -85) * DEG;
  } else {                                                              // default: lock the closest enemy ahead
    p.aimMode = 'auto';
    let best = null, bd = 15;
    for (const e of enemies) {
      if (!e.alive || e.dying) continue;
      const dx = (e.x - p.x) * p.facing, dy = e.y + e.h * 0.55 - sh.y;
      if (dx < 0.4 || Math.abs(dy) > dx * 3) continue;                  // ahead, within ~70 degrees
      const d = Math.hypot(dx, dy);
      if (d < bd) { bd = d; best = e; }
    }
    if (best) { p.aimTarget = best; ang = Math.atan2(best.y + best.h * 0.55 - sh.y, Math.abs(best.x - sh.x)); }
  }
  ang = clamp(ang, -85 * DEG, 85 * DEG);
  p.aim += (ang - p.aim) * Math.min(1, dt * 28);
}

/* ------------------------------------------------------------------ blade */
function swingPhase(S, t) {
  if (t < S.wind) return ['wind', t / S.wind];
  if (t < S.wind + S.act) return ['act', (t - S.wind) / S.act];
  return ['rec', Math.min(1, (t - S.wind - S.act) / S.rec)];
}
export function cancelSwing() {
  const p = player;
  if (!p.atkStep) return;
  if (p.atkStep < 3) { p.comboWin = COMBO_WINDOW; } else { p.comboWin = 0; p.comboStep = 0; }
  p.atkStep = 0; p.atkU = 0; p.atkPhase = ''; p.atkPhaseU = 0; p.lungeT = 0;
}
export function startSwing(step, held = false) {
  const p = player, S = SWING[step - 1];
  p.comboStep = step; p.atkStep = step; p.atkT = 0; p.atkU = 0; p.atkDur = S.dur; p.atkPhase = 'wind'; p.atkPhaseU = 0;
  p.atkFx = false; p.atkHits.length = 0; p.atkQueued = false; p.atkHeld = held;
  p.atkFacing = p.facing; p.comboWin = 0;
  p.cd.blade = S.dur; p.cdMax.blade = S.dur; p.heldGap = held ? S.dur * 0.3 : 0;
  p.lungeT = S.wind + S.act; p.lungeV = S.lunge / p.lungeT;
  if (p.onGround && p.atkFacing * p.vx > p.lungeV) p.vx = p.atkFacing * p.lungeV;   // R2-010: a running swing commits too
  SFX.play('slash', step);
}
export function updateSwing(dt) {
  const p = player;
  if (!p.atkStep) return;
  const S = SWING[p.atkStep - 1];
  p.atkT += dt; p.atkU = clamp(p.atkT / S.dur, 0, 1);
  [p.atkPhase, p.atkPhaseU] = swingPhase(S, p.atkT);
  if (!p.atkFx && p.atkT >= S.wind - 0.02) {                          // the arc appears just before the active window
    p.atkFx = true;
    const a = SLASH_FX[p.atkStep - 1], A = ACCENT.blade, f = p.atkFacing, life = p.atkStep === 3 ? 0.22 : 0.16;
    FX.slash({ kind: p.atkStep, follow: p, ox: a[4], oy: a[5], x: p.x + f * a[4], y: p.y + a[5], f, a0: a[0] * DEG, a1: a[1] * DEG, r: a[2], w: a[3],
      life, max: life, c1: A.m, c2: '#ffffff' });
    if (p.atkStep === 3) FX.dust(p.x + f, p.y, 5, f);
  }
  if (p.atkPhase === 'act') bladeHitCheck(S, p.atkStep);
  if (p.atkQueued && S.cancel !== null && p.atkT >= S.cancel) { startSwing(p.atkStep + 1); return; }   // chain
  if (p.atkT >= S.dur) {
    const step = p.atkStep, queued = p.atkQueued;
    p.atkStep = 0; p.atkU = 0; p.atkPhase = ''; p.atkPhaseU = 0; p.cd.blade = 0;
    if (step === 3) { p.comboStep = 0; p.comboWin = 0; if (queued) p.atkBuf = ATK_BUFFER; }   // finisher ends the chain
    else p.comboWin = COMBO_WINDOW;
  }
}

/* ------------------------------------------------------------------ cannon */
export function muzzleWorld() {
  const p = player, sh = shoulderWorld(), c = Math.cos(p.aim), s = Math.sin(p.aim), L = ANCHOR.muzzleLen;
  _mz.x = sh.x + p.facing * c * L; _mz.y = sh.y + s * L; _mz.dx = p.facing * c; _mz.dy = s;
  return _mz;
}
function snapAim() {
  const p = player;
  if (!p.aimTarget) return;
  const sh = shoulderWorld(), e = p.aimTarget;
  p.aim = clamp(Math.atan2(e.y + e.h * 0.55 - sh.y, Math.abs(e.x - sh.x)), -85 * DEG, 85 * DEG);
}
export function fireCannon() {
  const p = player, f = p.facing;
  snapAim();
  const m = muzzleWorld();
  p.cd.cannon = CANNON.cd; p.cdMax.cannon = CANNON.cd; p.muzzle = 0.1; p.recoil = 1;
  bullets.push({ x: m.x, y: m.y, px: m.x, py: m.y, vx: m.dx * CANNON.speed, vy: m.dy * CANNON.speed, life: CANNON.life, dmg: CANNON.dmg, trail: 0 });
  p.vx -= m.dx * CANNON.recoil;
  Feel.kick(1.5, -f * 0.5);
  for (let i = 0; i < 7; i++) FX.spark(m.x, m.y, Math.atan2(m.dy, m.dx) + rnd(-0.5, 0.5), rnd(6, 13), rnd(0.08, 0.16), i % 2 ? '#ffe078' : '#ffffff', { g: 6, sz: 2 });
  FX.disc(m.x, m.y, 5, 0.06, '#ffffff');
  FX.add(PT.CHIP, p.x + f * 0.3, p.y + 1.2, -f * rnd(1, 3), rnd(3, 5), 0.4, '#ffc43d', { g: 24, sz: 1 });
  SFX.play('shoot');
}
export function fireCharged(k) {                                       // hold J: piercing plasma lance
  const p = player, f = p.facing;
  snapAim();
  const m = muzzleWorld();
  p.cd.cannon = CANNON.lanceCd; p.cdMax.cannon = CANNON.lanceCd; p.muzzle = 0.16; p.recoil = 1;
  bullets.push({ x: m.x, y: m.y, px: m.x, py: m.y, vx: m.dx * CANNON.lanceSpeed, vy: m.dy * CANNON.lanceSpeed, life: 1.3, dmg: Math.round(2 + 2 * k), trail: 0, big: true, pierce: true, hits: [] });
  p.vx -= m.dx * (5 + 5 * k);
  Feel.kick(3 + k, -f); Feel.screenFlash(0.12 * (0.5 + k), '#fff3b8'); Feel.stop(0.03 + 0.03 * k);
  FX.ring(m.x, m.y, 3, 16 + 10 * k, 0.2, '#ffc43d'); FX.disc(m.x, m.y, 6 + 4 * k, 0.08, '#ffffff');
  for (let i = 0; i < 10; i++) FX.spark(m.x, m.y, Math.atan2(m.dy, m.dx) + rnd(-0.7, 0.7), rnd(8, 16), rnd(0.1, 0.22), i % 2 ? '#ffc43d' : '#ffffff', { g: 6, sz: 2 });
  SFX.play('lance');
}

/* ------------------------------------------------------------------ blink (LEGS) */
export function blinkTarget() {
  const p = player, f = p.facing;
  let lo = 1, hi = Math.min(WORLD_W - 2, EXIT_X);
  const a = Game.arena;
  if (a) { lo = Math.max(lo, a.x0 + 0.4); hi = Math.min(hi, a.x1 - 0.4); }       // laser walls stop the warp
  const want = clamp(p.x + f * BLINK.dist, lo, hi);
  return safeLandingX(p.x, want, p.y, lo, hi);                                   // never ends over a pit
}
export function doBlink() {
  const p = player, old = p.x, f = p.facing;
  const next = blinkTarget();
  p.cd.blink = BLINK.cd; p.cdMax.blink = BLINK.cd; p.blinkDir = f;
  const A = ACCENT.blink, snap = snapshot();
  FX.ghost(snap, A.m, 0.34, 0.75);                                      // where you were
  for (let i = 1; i <= 3; i++) {                                         // fading echoes along the path
    const s = snapshot(); s.x = old + (next - old) * (i / 4); FX.ghost(s, A.m, 0.12 + i * 0.07, 0.5 - i * 0.08);
  }
  FX.beam(old, p.y + 1.1, next, p.y + 1.1, A.m, '#ffffff', 0.2, 5);
  for (let i = 1; i <= 3; i++) FX.chevron(old + (next - old) * (i / 4), p.y + 1.1, Math.sign(next - old) || f, A.l, 0.22);   // direction read
  FX.ring(old, p.y + 1.1, 2, 18, 0.2, A.l);
  FX.ring(next, p.y + 1.1, 3, 26, 0.26, '#ffffff');
  FX.burst(next, p.y + 1.1, 16, A.m, 11);
  p.x = next; p.vy = Math.max(p.vy, 1.6); p.inv = Math.max(p.inv, BLINK.inv); p.warpU = 1;
  cancelSwing();
  Feel.kick(2.4, f * 0.6);
  SFX.play('blink');
  blinkHit(old, next);
}

/* ------------------------------------------------------------------ shield (L-ARM) */
function updateShield(dt) {
  const p = player, held = inputShieldHeld();
  p.parryCd = Math.max(0, p.parryCd - dt);
  if (p.guardBreakT > 0) {
    p.guardBreakT = Math.max(0, p.guardBreakT - dt);
    if (p.guardBreakT === 0) p.guard = Math.max(p.guard, GUARD.afterBreak);
  }
  const can = p.hasShield && p.guardBreakT <= 0 && p.dash <= 0;
  const edge = pressed.shield || (held && !p.shieldHeldPrev);
  pressed.shield = false; p.shieldHeldPrev = held;
  if (p.parryT > 0) {
    p.parryT = Math.max(0, p.parryT - dt);
    if (p.parryT === 0 && p.parryArmed) { p.parryArmed = false; p.parryCd = PARRY_WHIFF_CD - PARRY_WINDOW; }   // whiff: next parry press ≥ 0.4 s after the last
  }
  if (can && edge && p.parryCd <= 0 && !p.parryArmed) {               // every fresh press opens a parry window (even while held)
    p.parryT = PARRY_WINDOW; p.parryArmed = true; p.cd.shield = PARRY_WINDOW; p.cdMax.shield = PARRY_WINDOW;
    SFX.play('swap');
  }
  p.shieldRel = held ? GUARD.release : Math.max(0, p.shieldRel - dt);   // 80 ms lowering grace: release+press re-times a parry without dropping guard
  const want = can && (held || p.shieldRel > 0 || p.parryT > 0);
  p.shielding = want;
  if (!held) { p.guardIdle += dt; if (p.guardIdle > GUARD.regenDelay && p.guardBreakT <= 0) p.guard = Math.min(GUARD.max, p.guard + GUARD.regen * dt); }
  else p.guardIdle = 0;
  p.shieldAmt = clamp(p.shieldAmt + (want ? 1 : -1) * dt / 0.09, 0, 1);
}

/* ------------------------------------------------------------------ per-tick update */
export function updatePlayer(dt) {
  const p = player;
  p.prevX = p.x; p.prevY = p.y;
  p.t += dt;
  p.inv = Math.max(0, p.inv - dt); p.dashCd = Math.max(0, p.dashCd - dt);
  p.hurtT = Math.max(0, p.hurtT - dt); p.flash = Math.max(0, p.flash - dt);
  p.landT = Math.max(0, p.landT - dt); p.warpU = Math.max(0, p.warpU - dt / 0.22);
  p.muzzle = Math.max(0, p.muzzle - dt); p.recoil = Math.max(0, p.recoil - dt / 0.14);
  p.blockFlash = Math.max(0, p.blockFlash - dt);
  p.comboWin = Math.max(0, p.comboWin - dt); p.atkBuf = Math.max(0, p.atkBuf - dt);
  p.xf = Math.min(1, p.xf + dt / 0.28); p.blinkBuf = Math.max(0, p.blinkBuf - dt);
  p.jumpBuf = Math.max(0, p.jumpBuf - dt); p.critT = Math.max(0, p.critT - dt); p.tapT = Math.max(0, p.tapT - dt);
  if (!p.atkStep) p.heldGap = Math.max(0, (p.heldGap || 0) - dt);
  for (const k in p.cd) if (k !== 'shield') p.cd[k] = Math.max(0, p.cd[k] - dt);
  p.cd.shield = Math.max(0, p.parryT > 0 ? p.parryT : p.parryCd);
  if (p.flipT > 0) { p.flipT = Math.max(0, p.flipT - dt); p.rot = p.atkStep ? 0 : -(1 - p.flipT / 0.36) * TAU; if (p.flipT === 0) p.rot = 0; }

  if (p.dead) { updateDeath(dt); finishFrame(dt); return; }

  const left = inputLeft(), right = inputRight(), held = inputAttackHeld();
  if (pressed.tap) { p.tapDir = pressed.tap; p.tapT = MOVE.tapTime; pressed.tap = 0; }
  let dir = (right ? 1 : 0) - (left ? 1 : 0);
  if (!dir && p.tapT > 0) dir = p.tapDir;
  const broken = p.guardBreakT > 0;
  const locked = p.atkStep && p.atkPhase !== 'rec';                    // facing locked through wind + active
  if (dir && !locked) {
    if (p.atkStep && dir !== p.facing) cancelSwing();                  // turning around cancels recovery
    p.facing = dir;
  }

  /* jump with coyote time and a landing buffer; releasing jump while rising cuts the arc */
  /* the cut is applied BEFORE a new jump starts, so it only shortens a jump begun in an earlier tick
     (release + re-press inside one tick must still give a full jump — QA D-1) */
  if (pressed.jumpCut && p.vy > 0 && !p.onGround) p.vy *= MOVE.jumpCut;
  pressed.jumpCut = false;
  if (pressed.jump) p.jumpBuf = MOVE.jumpBuf;
  pressed.jump = false;
  if (p.jumpBuf > 0 && !broken) {
    if (p.onGround || p.coyote > 0) { doJump(true); p.jumpBuf = 0; }
    else if (p.airJumps < 1) { doJump(false); p.jumpBuf = 0; }
  }
  if (pressed.dash && p.dashCd <= 0 && !broken) doDash();
  pressed.dash = false;
  if (pressed.attack) { if (p.atkStep) p.atkQueued = true; else p.atkBuf = p.chip === 'cannon' ? Math.max(ATK_BUFFER, p.cd.cannon + 0.05) : ATK_BUFFER; }   // R2-011b
  pressed.attack = false;
  if (pressed.blink) p.blinkBuf = 0.16;
  pressed.blink = false;

  updateAim(dt);
  updateShield(dt);

  /* ---- LEGS: blink ---- */
  if (p.blinkBuf > 0 && p.hasBlink && p.cd.blink <= 0 && p.dash <= 0 && !broken) { doBlink(); p.blinkBuf = 0; }
  else if (p.blinkBuf > 0 && !p.hasBlink) { p.blinkBuf = 0; HUD.toast('LEGS SLOT EMPTY — FIND THE BLINK CHIP', '#8ea3c4', 1.2); }

  /* ---- dash-cancel: attacking out of a dash keeps some of its momentum ---- */
  if (p.dash > 0 && p.atkBuf > 0 && p.dash < MOVE.dashTime - 0.05) { p.dash = 0; p.vx = p.facing * 14; }

  /* ---- R-ARM: weapon ---- */
  if (p.dash <= 0 && !broken) {
    if (p.chip === 'blade') {
      if (!p.atkStep && p.cd.blade <= 0) {
        if (p.atkBuf > 0) { startSwing(p.comboWin > 0 && p.comboStep > 0 && p.comboStep < 3 ? p.comboStep + 1 : 1); p.atkBuf = 0; }
        else if (held && p.heldGap <= 0) startSwing(1, true);          // held J: repeated opening slash, never the finisher, 30 % slower
      }
    } else if (p.chip === 'cannon') {                                   // tap = shot, hold = charge, release = lance
      if (p.atkBuf > 0 && p.cd.cannon <= 0 && !p.charging) { fireCannon(); p.atkBuf = 0; p.charging = true; p.chargeT = 0; }
      if (p.charging) {
        if (held) {
          const was = p.chargeT; p.chargeT += dt;
          if (was < CHARGE_GLOW && p.chargeT >= CHARGE_GLOW) SFX.play('charge');
          if (was < CHARGE_MIN && p.chargeT >= CHARGE_MIN) { SFX.play('warn'); const m = muzzleWorld(); FX.ring(m.x, m.y, 2, 12, 0.18, '#ffffff'); }
          if (p.chargeT > CHARGE_GLOW && Math.random() < dt * 30) { const m = muzzleWorld(); FX.bits(m.x, m.y, '#ffc43d', 1); }
        } else {
          if (p.chargeT >= CHARGE_MIN) fireCharged(clamp((p.chargeT - CHARGE_MIN) / (CHARGE_FULL - CHARGE_MIN), 0, 1));
          p.charging = false; p.chargeT = 0;
        }
      }
    }
  }
  if (p.chip !== 'cannon' || broken) { p.charging = false; p.chargeT = 0; }
  p.charge = p.charging ? clamp((p.chargeT - CHARGE_GLOW) / (CHARGE_FULL - CHARGE_GLOW), 0, 1) : 0;
  updateSwing(dt);

  /* ---- horizontal motion ---- */
  let speedMul = p.shielding ? 0.6 : 1;
  if (broken) speedMul = 0.35;
  if (p.atkStep && p.onGround) { const S = SWING[p.atkStep - 1]; speedMul *= p.atkPhase === 'rec' ? S.recMul : S.groundMul; }
  if (p.dash > 0) {
    p.dash -= dt; p.vx = p.facing * MOVE.dash;
    p.ghostT -= dt;
    if (p.ghostT <= 0) { p.ghostT = 0.035; FX.ghost(snapshot(), ACCENT[p.chip].m, 0.2, 0.55); }
    if (Math.random() < dt * 36) FX.add(PT.CHIP, p.x - p.facing * 0.4, p.y + rnd(0.2, 1.6), -p.facing * rnd(2, 5), rnd(-1, 1), 0.2, ACCENT[p.chip].l, { sz: 1 });
  } else if (p.lungeT > 0 && p.atkStep) {                               // swing lunge: a timed impulse the run lerp cannot erase
    p.lungeT -= dt;
    const f = p.atkFacing;
    p.vx = f * Math.max(p.lungeV, f * p.vx - dt * 40);
    for (const e of enemies) {                                          // the lunge stops at the target's body instead of running into it
      if (e.alive && Math.abs(e.y - p.y) < 1.6 && (e.x - p.x) * f > 0 && (e.x - p.x) * f < e.hw + 0.55) { p.vx = 0; p.lungeT = 0; break; }
    }
  } else {
    const target = dir * MOVE.run * speedMul;
    p.vx += (target - p.vx) * Math.min(1, dt * (p.onGround ? MOVE.accelGround : MOVE.accelAir));
  }

  /* ---- integrate + platform landing (one-way from above; highest valid platform wins) ---- */
  const prevY = p.y, wasGround = p.onGround, preVy = p.vy, x0 = p.x;
  p.x = clamp(p.x + p.vx * dt, 0.5, WORLD_W - 2);
  laserWalls(x0);
  p.vy = Math.max(-MOVE.maxFall, p.vy - MOVE.gravity * dt); p.y += p.vy * dt; p.onGround = false;
  let land = -Infinity;
  for (const [x1, x2, py] of PLAT) {
    if (p.x + p.w / 2 > x1 && p.x - p.w / 2 < x2 && prevY >= py - 0.08 && p.y <= py && p.vy <= 0 && py > land) land = py;
  }
  if (land > -Infinity) { p.y = land; p.vy = 0; p.onGround = true; p.airJumps = 0; }
  if (p.onGround) p.coyote = MOVE.coyote; else p.coyote = Math.max(0, p.coyote - dt);
  if (p.onGround && !wasGround) {
    p.landT = 0.1;
    if (preVy < -7) { FX.dust(p.x, p.y, 6, 0); SFX.play('land'); }
  }
  if (p.y < -8) pitFall();
  hazardContact();

  finishFrame(dt);
}

/* laser gates are walls (only BLINK, which teleports, gets past); timed beams just hurt */
function laserWalls(x0) {
  const p = player;
  for (const h of HAZARDS) {
    if (h.type !== 'laser' || !h.solid || p.y >= h.y1 || p.y + 1.7 <= h.y0) continue;
    const side = x0 < h.x ? -1 : 1;
    if ((x0 - h.x) * (p.x - h.x) <= 0 || Math.abs(p.x - h.x) < LASER_HALF) {
      p.x = h.x + side * LASER_HALF; p.vx = side * 6;
      hurtPlayer(1, h.x, { hazard: true });
    }
  }
}
function hazardContact() {
  const p = player;
  if (p.dead) return;
  for (const h of HAZARDS) {
    if (h.type === 'laser' && h.on && !h.solid && Math.abs(p.x - h.x) < LASER_HALF && p.y < h.y1 && p.y + 1.7 > h.y0) {
      if (hurtPlayer(1, h.x, { hazard: true }) === 'hit') FX.hitSparks(h.x, p.y + 1, p.x >= h.x ? 1 : -1, 1, '#ff3b4a', '#fff0c8');
    } else if (h.type === 'spikes' && p.onGround && p.y === (h.y || 0) && p.x > h.x0 && p.x < h.x1) {
      hurtPlayer(1, p.x - p.facing, { hazard: true });
      p.vy = 10; p.onGround = false; p.coyote = 0;                        // always bounce off, even with i-frames
      FX.hitSparks(p.x, p.y + 0.1, 1, 0, '#8a8fa3', '#ff3b4a');
    }
  }
}

export function finishFrame(dt) {
  const p = player;
  let a = 'idle';
  if (p.dead) a = 'dead';
  else if (p.hurtT > 0 || p.guardBreakT > 0) a = 'hurt';
  else if (p.dash > 0) a = 'dash';
  else if (!p.onGround) a = p.vy > 0.5 ? 'jump' : 'fall';
  else if (Math.abs(p.vx) > 1.4 && !p.atkStep) a = 'run';
  p.anim = a;
  if (a === 'run') p.run += dt * (10 + Math.abs(p.vx) * 1.4);
  updateScarf(dt);
  p.px = p.x; p.py = p.y;
}

function updateScarf(dt) {                                              // cosmetic cloth: lives in the world frame
  const p = player, sc = p.scarf;
  const dx = (p.x - p.px) * PPU, dy = -(p.y - p.py) * PPU;
  for (let i = 1; i < SCARF_N; i++) { sc[i * 2] -= dx; sc[i * 2 + 1] -= dy; }
  const root = ninjaAnchors(p).scarf;                                // cosmetic only: the cloth follows the art's collar
  sc[0] = p.facing * root.x; sc[1] = -root.y;
  const k = Math.min(1, dt * 15), tm = Game.time, seg = 3.2;
  for (let i = 1; i < SCARF_N; i++) {
    const wob = Math.sin(tm * 9 + i * 0.9) * 0.7 * (i / SCARF_N);
    const tx = sc[(i - 1) * 2] - p.facing * seg * 0.85 + wob, ty = sc[(i - 1) * 2 + 1] + 0.9 + Math.cos(tm * 7 + i) * 0.6 * (i / SCARF_N);
    sc[i * 2] += (tx - sc[i * 2]) * k; sc[i * 2 + 1] += (ty - sc[i * 2 + 1]) * k;
    const vx = sc[i * 2] - sc[(i - 1) * 2], vy = sc[i * 2 + 1] - sc[(i - 1) * 2 + 1];
    const d = Math.hypot(vx, vy) || 1;
    sc[i * 2] = sc[(i - 1) * 2] + vx / d * seg; sc[i * 2 + 1] = sc[(i - 1) * 2 + 1] + vy / d * seg;
  }
}

function updateDeath(dt) {
  const p = player;
  p.deadT += dt;
  if (!p.pit) {
    p.vx *= Math.exp(-dt * 6);
    p.x = clamp(p.x + p.vx * dt, 0.5, WORLD_W - 2);
    p.vy = Math.max(-MOVE.maxFall, p.vy - MOVE.gravity * dt); p.y += p.vy * dt;
    for (const [x1, x2, py] of PLAT) if (p.x + p.w / 2 > x1 && p.x - p.w / 2 < x2 && p.y <= py && p.vy <= 0 && p.y > py - 1) { p.y = py; p.vy = 0; p.onGround = true; }
    p.rot = -clamp(p.deadT / 0.35, 0, 1) * 1.45;
    if (!p.burst && p.deadT > 0.45) {                                     // the suit disintegrates into pixels
      p.burst = true;
      FX.debris(p.x, p.y + 0.6, 14, [ACCENT.blade.m, '#ff3d9d', '#16203d', '#ffffff'], 8);
      FX.ring(p.x, p.y + 0.8, 3, 34, 0.35, '#ff3d9d'); FX.disc(p.x, p.y + 0.8, 10, 0.14, '#ffffff');
      Feel.kick(5); SFX.play('die');
    }
  } else { p.vx = 0; p.vy = 0; p.burst = true; }                          // fell into a pit: off-screen, just wait
  if (p.deadT > 1.15) respawn();
}

export function respawn() {
  const p = player;
  p.dead = false; p.burst = false; p.pit = false; p.deadT = 0; p.rot = 0;
  p.hp = p.maxhp; p.x = p.checkpoint + 2; p.y = 1; p.vx = 0; p.vy = 3; p.inv = 2.2; p.hurtT = 0;
  p.prevX = p.x; p.prevY = p.y; p.px = p.x; p.py = p.y;
  cancelSwing(); p.comboWin = 0; p.comboStep = 0; p.dash = 0; p.shielding = false; p.guard = GUARD.max; p.guardBreakT = 0; p.charging = false;
  bullets.length = 0; enemyBullets.length = 0;
  resetArenaOnDeath(p.deathArena); p.deathArena = null;                  // R2-006: the arena you died in resets (boss: full HP)
  Game.arena = null;                                                     // walls drop on death; re-entering re-locks
  resetScarf();
  FX.ring(p.x, p.y + 1, 2, 30, 0.35, '#ff8cbb'); FX.bits(p.x, p.y + 1.1, '#ff8cbb', 14);
  HUD.setHealth(p.hp, p.maxhp, false);
  HUD.toast('SYSTEM REBOOT // CHECKPOINT', '#ff8cbb');
  SFX.play('reboot');
  Game.snapCamera();
}

/* falling into a pit is a death: it goes through killPlayer → respawn like any other death */
export function pitFall() {
  const p = player;
  if (p.dead) return;
  Feel.screenFlash(0.35, '#ff3d6d'); SFX.play('hurt');
  killPlayer(0);
  p.pit = true; p.vx = 0; p.vy = 0;
}

export function checkWorldTriggers() {
  const p = player;
  for (const cp of CHECKPOINTS) {
    if (p.x >= cp + 1 && cp > p.checkpoint) {
      p.checkpoint = cp; HUD.toast('CHECKPOINT SAVED', '#2fe6ff', 1.3); SFX.play('check');
      FX.ring(cp, 1.5, 2, 26, 0.4, '#2fe6ff');
    }
  }
  for (const pk of PICKUPS) {
    if (!p.unlocked.has(pk.id) && Math.abs(p.x - pk.x) < 1.25 && Math.abs(p.y + 0.9 - pk.y) < 2) unlockChip(pk.id);
  }
}

