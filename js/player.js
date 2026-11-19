'use strict';
/* =====================================================================
   Player controller.
   Movement constants are the v0.3 values (confirmed working):
     gravity 34 · jump 13.8 · double jump · run 12.2 · dash 28 for .2s
   Attacks never lock movement; swings add a small forward lunge only.

   v0.5 body slots: R-ARM weapon (Blade/Cannon, swappable), L-ARM Shield and
   LEGS Blink each have their own button and work at the same time.
   `player.chip` = the weapon currently on the R-ARM.
   ===================================================================== */
const MOVE = { gravity: 34, jump: 13.8, run: 12.2, dash: 28, dashTime: 0.2, dashCd: 0.78, accelGround: 18, accelAir: 11 };
const PARRY_WINDOW = 0.2, PARRY_COOLDOWN = 0.55;
const SCARF_N = 9;

const SWING = [   // blade combo: slash → reverse slash → finisher
  { dur: 0.22, cd: 0.22, act: [0.06, 0.15], fx: 0.05, dmg: 2, kb: 7,  hs: 0.05,  shake: 2.2, lunge: 6,  box: [-0.2, 2.7, -0.1, 2.3] },
  { dur: 0.22, cd: 0.22, act: [0.06, 0.15], fx: 0.05, dmg: 2, kb: 8,  hs: 0.055, shake: 2.6, lunge: 6,  box: [-0.3, 2.7, -0.2, 2.4] },
  { dur: 0.34, cd: 0.42, act: [0.10, 0.22], fx: 0.09, dmg: 3, kb: 14, hs: 0.085, shake: 4.8, lunge: 12, box: [-0.5, 3.4, -0.3, 2.7] },
];
const SLASH_FX = [   // arc parameters: [startDeg, endDeg, radiusPx, widthPx]
  [150, -35, 48, 9], [-50, 150, 48, 9], [135, -80, 64, 13],
];

const player = {
  x: 3, y: 0, vx: 0, vy: 0, w: 0.7, facing: 1, onGround: true, airJumps: 0,
  hp: 6, maxhp: 6, inv: 0, dash: 0, dashCd: 0, checkpoint: 0,
  chip: 'blade', unlocked: new Set(['blade']),
  cd: { blade: 0, cannon: 0, shield: 0, blink: 0 }, cdMax: { blade: 0.22, cannon: 0.3, shield: 0.55, blink: 1.6 },
  atkStep: 0, atkT: 0, atkU: 0, atkDur: 0, atkHits: [], atkFx: false, comboStep: 0, comboWin: 0, atkBuf: 0,
  shielding: false, shieldPrev: false, shieldAmt: 0, parryT: 0, blockFlash: 0,
  anim: 'idle', t: 0, run: 0, rot: 0, flipT: 0, warpU: 0, recoil: 0, muzzle: 0, xf: 1, flash: 0, hurtT: 0, landT: 0,
  dead: false, deadT: 0, burst: false, ghostT: 0, px: 3, py: 0, scarf: new Float32Array(SCARF_N * 2),
  hasShield: false, hasBlink: false, aim: 0, aimMode: 'auto', aimTarget: null, blinkBuf: 0,
};

function resetPlayer() {
  const p = player;
  Object.assign(p, {
    x: 3, y: 0, vx: 0, vy: 0, facing: 1, onGround: true, airJumps: 0, hp: p.maxhp, inv: 0, dash: 0, dashCd: 0, checkpoint: 0,
    chip: 'blade', atkStep: 0, atkT: 0, atkU: 0, comboStep: 0, comboWin: 0, atkBuf: 0, shielding: false, shieldPrev: false,
    shieldAmt: 0, parryT: 0, blockFlash: 0, anim: 'idle', rot: 0, flipT: 0, warpU: 0, recoil: 0, muzzle: 0, xf: 1, flash: 0,
    hurtT: 0, landT: 0, dead: false, deadT: 0, ghostT: 0, px: 3, py: 0, aim: 0, aimTarget: null, blinkBuf: 0,
  });
  syncSlots();
  p.atkHits.length = 0;
  for (const k in p.cd) p.cd[k] = 0;
  resetScarf();
}
function resetScarf() {
  const s = player.scarf;
  for (let i = 0; i < SCARF_N; i++) { s[i * 2] = -4 - i * 3; s[i * 2 + 1] = -34 + i * 0.4; }
}

/* ------------------------------------------------------------------ chips / body slots */
const WEAPONS = ['blade', 'cannon'];
function syncSlots() { player.hasShield = player.unlocked.has('shield'); player.hasBlink = player.unlocked.has('blink'); }

function switchChip(id, silent) {                                       // R-ARM weapon swap (Blade <-> Cannon)
  const p = player;
  if (!WEAPONS.includes(id) || !p.unlocked.has(id) || p.chip === id || p.dead) return;
  p.chip = id; p.xf = 0;
  p.atkStep = 0; p.atkU = 0; p.muzzle = 0; p.recoil = 0;
  HUD.setActive(id, true);
  if (silent) return;
  const A = ACCENT[id], hx = p.x + p.facing * 0.4, hy = p.y + 1.2;
  FX.bits(hx, hy, A.m, 12);
  FX.ring(hx, hy, 3, 20, 0.22, A.m);
  FX.disc(hx, hy, 6, 0.1, '#ffffff');
  FX.text(CHIP_INFO[id].name, p.x, p.y + 2.9, A.m, 0.7);
  FX.kick(1.2);
  SFX.play('xform');
}
function swapWeapon() {
  const p = player;
  if (!p.unlocked.has('cannon')) { HUD.toast('NO SECOND WEAPON YET', '#8ea3c4', 1.2); return; }
  switchChip(p.chip === 'blade' ? 'cannon' : 'blade');
}
function cycleChipDir() { swapWeapon(); }

const UNLOCK_HINT = {
  cannon: '[Q] swaps BLADE / CANNON  ·  cannon auto-aims, hold [I] up / [S] down to steer',
  shield: 'hold [L] to guard while you fight  ·  tap it right before a hit to PARRY',
  blink:  '[K] warps through enemies with any weapon',
};
function unlockChip(id) {
  const p = player;
  if (p.unlocked.has(id)) return;
  p.unlocked.add(id); saveUnlocked(p.unlocked); syncSlots();
  HUD.setUnlocked(p.unlocked);
  if (WEAPONS.includes(id)) switchChip(id);                              // a new weapon is equipped straight away
  const A = ACCENT[id];
  HUD.toast(`◈ ${CHIP_INFO[id].slot} UPGRADE: ${CHIP_INFO[id].name}`, A.m, 2.2);
  HUD.hint(UNLOCK_HINT[id], A.m);
  const oy = id === 'blink' ? 0.3 : 1.1;                                 // burst on the body part that changed
  FX.ring(p.x, p.y + oy, 4, 40, 0.4, A.m); FX.ring(p.x, p.y + oy, 2, 28, 0.3, '#ffffff');
  FX.burst(p.x, p.y + oy, 26, A.m, 11); FX.bits(p.x, p.y + oy, A.l, 14);
  FX.screenFlash(0.25, A.l);
  SFX.play('pickup');
}

/* ------------------------------------------------------------------ actions */
function nudge(dir, amt) {
  const p = player;
  if (p.dead) return;
  p.facing = dir; p.vx = dir * 8; p.x = clamp(p.x + dir * amt, 0.5, WORLD_W - 2);
}

function doJump() {
  const p = player;
  if (!(p.onGround || p.airJumps < 1)) return;
  const fromGround = p.onGround;
  p.vy = MOVE.jump; p.onGround = false; p.airJumps = fromGround ? 0 : p.airJumps + 1;
  if (fromGround) { FX.dust(p.x, p.y, 4, -p.facing); SFX.play('jump'); }
  else {                                                              // double jump = somersault + air ring
    p.flipT = 0.36;
    FX.ring(p.x, p.y + 0.4, 2, 16, 0.2, ACCENT[p.chip].m);
    FX.burst(p.x, p.y + 0.3, 6, '#74f8fa', 6);
    SFX.play('jump2');
  }
}

function doDash() {
  const p = player;
  p.dash = MOVE.dashTime; p.dashCd = MOVE.dashCd; p.inv = Math.max(p.inv, 0.16);
  p.vx = p.facing * MOVE.dash; p.ghostT = 0;
  p.shielding = false; p.atkStep = 0;
  FX.dust(p.x, p.y, 5, -p.facing);
  FX.kick(0.8, p.facing * 0.3);
  SFX.play('dash');
}

function snapshot() {                                                  // frozen copy of the visual state (afterimages)
  const p = player;
  return { x: p.x, y: p.y, facing: p.facing, anim: p.anim, t: p.t, run: p.run, chip: p.chip, atkStep: p.atkStep, atkU: p.atkU,
    shieldAmt: p.shieldAmt, parryT: 0, blockFlash: 0, recoil: p.recoil, muzzle: 0, xf: 1, rot: p.rot, warpU: p.warpU, scarf: p.scarf.slice(),
    hasShield: p.hasShield, hasBlink: p.hasBlink, aim: p.aim };
}

/* ------------------------------------------------------------------ aiming (cannon, keyboard / gamepad) */
function shoulderWorld() { poseOf(player); return { x: player.x + player.facing * Q.sx / PPU, y: player.y + Q.sy / PPU }; }
function updateAim(dt) {
  const p = player, sh = shoulderWorld();
  let ang = 0;
  p.aimTarget = null;
  if (Aim.pad) {                                                        // gamepad right stick: free aim
    p.aimMode = 'manual';
    if (Aim.padX > 0.2) p.facing = 1; else if (Aim.padX < -0.2) p.facing = -1;
    ang = Math.atan2(Aim.padY, Math.max(0.05, Math.abs(Aim.padX)));
  } else if (inputAimUp() || inputAimDown()) {                          // I / S (or arrows / stick): 8-way
    p.aimMode = 'manual';
    const moving = inputLeft() || inputRight();
    ang = inputAimUp() ? (moving ? 45 : 85) * DEG : (moving || p.onGround ? -45 : -85) * DEG;
  } else {                                                              // default: lock the closest enemy ahead
    p.aimMode = 'auto';
    let best = null, bd = 15;
    for (const e of enemies) {
      if (!e.alive) continue;
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

function startSwing() {
  const p = player;
  const step = p.comboWin > 0 ? (p.comboStep % 3) + 1 : 1, S = SWING[step - 1];
  p.comboStep = step; p.atkStep = step; p.atkT = 0; p.atkU = 0; p.atkDur = S.dur; p.atkFx = false; p.atkHits.length = 0;
  p.cd.blade = S.cd; p.cdMax.blade = S.cd; p.comboWin = S.cd + 0.4;
  p.vx += p.facing * S.lunge;                                          // forward step-in, movement stays free
  SFX.play('slash', step);
}
function updateSwing(dt) {
  const p = player;
  if (!p.atkStep) return;
  p.atkT += dt; p.atkU = clamp(p.atkT / p.atkDur, 0, 1);
  const S = SWING[p.atkStep - 1];
  if (!p.atkFx && p.atkT >= S.fx) {
    p.atkFx = true;
    const a = SLASH_FX[p.atkStep - 1], A = ACCENT.blade;
    FX.slash({ kind: p.atkStep, follow: p, ox: 0.2, oy: 1.25, x: p.x, y: p.y + 1.25, f: p.facing, a0: a[0] * DEG, a1: a[1] * DEG, r: a[2], w: a[3],
      life: p.atkStep === 3 ? 0.24 : 0.18, max: p.atkStep === 3 ? 0.24 : 0.18, c1: A.m, c2: '#ffffff' });
    if (p.atkStep === 3) FX.dust(p.x + p.facing, p.y, 5, p.facing);
  }
  if (p.atkT >= S.act[0] && p.atkT <= S.act[1]) bladeHitCheck(S, p.atkStep);
  if (p.atkT >= S.act[0] - 0.02 && p.atkT <= S.act[1] + 0.05) bladeDeflect(S, p.atkStep);   // the blade also bats bolts back
  if (p.atkT >= p.atkDur) {
    if (p.atkStep === 3) p.comboWin = 0;                               // finisher ends the chain
    p.atkStep = 0; p.atkU = 0;
  }
}

function muzzleWorld() {
  const p = player, sh = shoulderWorld(), c = Math.cos(p.aim), s = Math.sin(p.aim), L = 27 / PPU;
  return { x: sh.x + p.facing * c * L, y: sh.y + s * L, dx: p.facing * c, dy: s };
}
function fireCannon() {
  const p = player, f = p.facing;
  if (p.aimTarget) {                                                     // snap the shot onto the locked target
    const sh = shoulderWorld(), e = p.aimTarget;
    p.aim = clamp(Math.atan2(e.y + e.h * 0.55 - sh.y, Math.abs(e.x - sh.x)), -85 * DEG, 85 * DEG);
  }
  const m = muzzleWorld();
  p.cd.cannon = 0.30; p.cdMax.cannon = 0.30; p.muzzle = 0.1; p.recoil = 1;
  bullets.push({ x: m.x, y: m.y, vx: m.dx * 31, vy: m.dy * 31, life: 1.2, dmg: 1, trail: 0 });
  p.vx -= m.dx * 2.5;
  FX.kick(1.4, -f * 0.5);
  for (let i = 0; i < 6; i++) FX.spark(m.x, m.y, Math.atan2(m.dy, m.dx) + rnd(-0.5, 0.5), rnd(6, 12), rnd(0.08, 0.16), i % 2 ? '#ffe078' : '#ffffff', { g: 6 });
  FX.disc(m.x, m.y, 4, 0.06, '#ffffff');
  FX.add(PT.CHIP, p.x + f * 0.3, p.y + 1.2, -f * rnd(1, 3), rnd(3, 5), 0.4, '#ffc43d', { g: 24, sz: 1 });
  SFX.play('shoot');
}

function doBlink() {
  const p = player, old = p.x, f = p.facing;
  const next = Math.min(139, Math.max(1, old + f * 5.3));
  p.cd.blink = 1.6; p.cdMax.blink = 1.6;
  const A = ACCENT.blink, snap = snapshot();
  FX.ghost(snap, A.m, 0.34, 0.75);                                      // where you were
  for (let i = 1; i <= 3; i++) {                                         // fading echoes along the path
    const s = snapshot(); s.x = old + (next - old) * (i / 4); FX.ghost(s, A.m, 0.12 + i * 0.07, 0.5 - i * 0.08);
  }
  FX.beam(old, p.y + 1.1, next, p.y + 1.1, A.m, '#ffffff', 0.2, 5);
  FX.ring(old, p.y + 1.1, 2, 18, 0.2, A.l);
  FX.ring(next, p.y + 1.1, 3, 26, 0.26, '#ffffff');
  FX.burst(next, p.y + 1.1, 16, A.m, 11);
  p.x = next; p.vy = Math.max(p.vy, 1.6); p.inv = Math.max(p.inv, 0.22); p.warpU = 1;
  p.atkStep = 0;
  FX.kick(2.4, f * 0.6);
  SFX.play('blink');
  blinkHit(old, next);
}

/* ------------------------------------------------------------------ per-frame update */
function updatePlayer(dt) {
  const p = player;
  p.t += dt;
  p.inv = Math.max(0, p.inv - dt); p.dashCd = Math.max(0, p.dashCd - dt);
  p.hurtT = Math.max(0, p.hurtT - dt); p.flash = Math.max(0, p.flash - dt);
  p.landT = Math.max(0, p.landT - dt); p.warpU = Math.max(0, p.warpU - dt / 0.22);
  p.muzzle = Math.max(0, p.muzzle - dt); p.recoil = Math.max(0, p.recoil - dt / 0.14);
  p.parryT = Math.max(0, p.parryT - dt); p.blockFlash = Math.max(0, p.blockFlash - dt);
  p.comboWin = Math.max(0, p.comboWin - dt); p.atkBuf = Math.max(0, p.atkBuf - dt);
  p.xf = Math.min(1, p.xf + dt / 0.28); p.blinkBuf = Math.max(0, p.blinkBuf - dt);
  for (const k in p.cd) p.cd[k] = Math.max(0, p.cd[k] - dt);
  if (p.flipT > 0) { p.flipT = Math.max(0, p.flipT - dt); p.rot = p.atkStep ? 0 : -(1 - p.flipT / 0.36) * TAU; if (p.flipT === 0) p.rot = 0; }

  if (p.dead) { updateDeath(dt); finishFrame(dt); return; }

  const left = inputLeft(), right = inputRight(), held = inputAttackHeld(), shieldHeld = inputShieldHeld();
  const dir = (right ? 1 : 0) - (left ? 1 : 0);
  if (dir) p.facing = dir;

  if (pressed.jump) doJump();
  pressed.jump = false;
  if (pressed.dash && p.dashCd <= 0) doDash();
  pressed.dash = false;
  if (pressed.attack) p.atkBuf = 0.16;
  pressed.attack = false;
  if (pressed.blink) p.blinkBuf = 0.16;
  pressed.blink = false;

  updateAim(dt);

  /* ---- L-ARM: shield (independent of the weapon) ---- */
  const wantShield = p.hasShield && shieldHeld && p.dash <= 0;
  if (wantShield && !p.shieldPrev && p.cd.shield <= 0) { p.parryT = PARRY_WINDOW; p.cd.shield = PARRY_COOLDOWN; p.cdMax.shield = PARRY_COOLDOWN; SFX.play('swap'); }
  p.shielding = wantShield; p.shieldPrev = wantShield;
  p.shieldAmt = clamp(p.shieldAmt + (wantShield ? 1 : -1) * dt / 0.09, 0, 1);

  /* ---- LEGS: blink ---- */
  if (p.blinkBuf > 0 && p.hasBlink && p.cd.blink <= 0 && p.dash <= 0) { doBlink(); p.blinkBuf = 0; }
  else if (p.blinkBuf > 0 && !p.hasBlink) { p.blinkBuf = 0; HUD.toast('LEGS SLOT EMPTY — FIND THE BLINK CHIP', '#8ea3c4', 1.2); }

  /* ---- R-ARM: weapon ---- */
  if (p.dash <= 0) {
    if (p.chip === 'blade' && (p.atkBuf > 0 || held) && p.cd.blade <= 0) { startSwing(); p.atkBuf = 0; }
    else if (p.chip === 'cannon' && (p.atkBuf > 0 || held) && p.cd.cannon <= 0) { fireCannon(); p.atkBuf = 0; }
  }
  updateSwing(dt);

  /* ---- horizontal motion (v0.3 feel) ---- */
  const speedMul = p.shielding ? 0.6 : 1;
  if (p.dash > 0) {
    p.dash -= dt; p.vx = p.facing * MOVE.dash;
    p.ghostT -= dt;
    if (p.ghostT <= 0) { p.ghostT = 0.035; FX.ghost(snapshot(), ACCENT[p.chip].m, 0.2, 0.55); }
    if (Math.random() < 0.6) FX.add(PT.CHIP, p.x - p.facing * 0.4, p.y + rnd(0.2, 1.6), -p.facing * rnd(2, 5), rnd(-1, 1), 0.2, ACCENT[p.chip].l, { sz: 1 });
  } else {
    const target = dir * MOVE.run * speedMul;
    p.vx += (target - p.vx) * Math.min(1, dt * (p.onGround ? MOVE.accelGround : MOVE.accelAir));
  }

  /* ---- integrate + platform landing (one-way from above) ---- */
  const prevY = p.y, wasGround = p.onGround, preVy = p.vy;
  p.x = clamp(p.x + p.vx * dt, 0.5, WORLD_W - 2);
  p.vy -= MOVE.gravity * dt; p.y += p.vy * dt; p.onGround = false;
  for (const [x1, x2, py] of PLAT) {
    if (p.x + p.w / 2 > x1 && p.x - p.w / 2 < x2 && prevY >= py - 0.08 && p.y <= py && p.vy <= 0) {
      p.y = py; p.vy = 0; p.onGround = true; p.airJumps = 0;
    }
  }
  if (p.onGround && !wasGround) {
    p.landT = 0.1;
    if (preVy < -7) { FX.dust(p.x, p.y, 6, 0); SFX.play('land'); }
  }
  if (p.y < -8) pitFall();

  finishFrame(dt);
}

function finishFrame(dt) {
  const p = player;
  /* animation state */
  let a = 'idle';
  if (p.dead) a = 'dead';
  else if (p.hurtT > 0) a = 'hurt';
  else if (p.dash > 0) a = 'dash';
  else if (!p.onGround) a = p.vy > 0.5 ? 'jump' : 'fall';
  else if (Math.abs(p.vx) > 1.4) a = 'run';
  p.anim = a;
  if (a === 'run') p.run += dt * (10 + Math.abs(p.vx) * 1.4);
  updateScarf(dt);
  p.px = p.x; p.py = p.y;
}

function updateScarf(dt) {
  const p = player, sc = p.scarf;
  poseOf(p);
  const dx = (p.x - p.px) * PPU, dy = -(p.y - p.py) * PPU;
  for (let i = 1; i < SCARF_N; i++) { sc[i * 2] -= dx; sc[i * 2 + 1] -= dy; }   // scarf lives in the world frame → natural lag
  sc[0] = p.facing * (Q.hx - 4); sc[1] = -(Q.hy + 1);
  const k = Math.min(1, dt * 15), tm = Game.time, seg = 3.2;
  for (let i = 1; i < SCARF_N; i++) {
    const wob = Math.sin(tm * 9 + i * 0.9) * 0.7 * (i / SCARF_N);
    const tx = sc[(i - 1) * 2] - p.facing * seg * 0.85 + wob, ty = sc[(i - 1) * 2 + 1] + 0.9 + Math.cos(tm * 7 + i) * 0.6 * (i / SCARF_N);
    sc[i * 2] += (tx - sc[i * 2]) * k; sc[i * 2 + 1] += (ty - sc[i * 2 + 1]) * k;
    let vx = sc[i * 2] - sc[(i - 1) * 2], vy = sc[i * 2 + 1] - sc[(i - 1) * 2 + 1];     // keep fixed segment length
    const d = Math.hypot(vx, vy) || 1;
    sc[i * 2] = sc[(i - 1) * 2] + vx / d * seg; sc[i * 2 + 1] = sc[(i - 1) * 2 + 1] + vy / d * seg;
  }
}

function updateDeath(dt) {
  const p = player;
  p.deadT += dt; p.vx *= Math.exp(-dt * 6);
  p.x = clamp(p.x + p.vx * dt, 0.5, WORLD_W - 2);
  p.vy -= MOVE.gravity * dt; p.y += p.vy * dt;
  for (const [x1, x2, py] of PLAT) if (p.x > x1 && p.x < x2 && p.y <= py && p.vy <= 0 && p.y > py - 1) { p.y = py; p.vy = 0; p.onGround = true; }
  p.rot = -clamp(p.deadT / 0.35, 0, 1) * 1.45;
  if (!p.burst && p.deadT > 0.45) {                                     // the suit disintegrates into pixels
    p.burst = true;
    FX.debris(p.x, p.y + 0.6, 14, [ACCENT.blade.m, '#ff3d9d', '#16203d', '#ffffff'], 8);
    FX.ring(p.x, p.y + 0.8, 3, 34, 0.35, '#ff3d9d'); FX.disc(p.x, p.y + 0.8, 10, 0.14, '#ffffff');
    FX.kick(5); SFX.play('die');
  }
  if (p.deadT > 1.15) respawn();
}

function respawn() {
  const p = player;
  p.dead = false; p.burst = false; p.deadT = 0; p.rot = 0;
  p.hp = p.maxhp; p.x = p.checkpoint + 2; p.y = 1; p.vx = 0; p.vy = 3; p.inv = 2.2; p.hurtT = 0;
  p.atkStep = 0; p.dash = 0; p.shielding = false;
  bullets.length = 0; enemyBullets.length = 0;
  resetScarf();
  FX.ring(p.x, p.y + 1, 2, 30, 0.35, '#ff8cbb'); FX.bits(p.x, p.y + 1.1, '#ff8cbb', 14);
  HUD.setHealth(p.hp, p.maxhp, false);
  HUD.toast('SYSTEM REBOOT // CHECKPOINT', '#ff8cbb');
  SFX.play('reboot');
  Game.snapCamera();
}

function pitFall() {
  const p = player;
  if (p.dead) return;
  const lost = p.inv <= 0;
  if (lost) { p.hp -= 1; HUD.setHealth(p.hp, p.maxhp, true); FX.screenFlash(0.35, '#ff3d6d'); SFX.play('hurt'); }
  if (p.hp <= 0) { p.hp = 0; killPlayer(); p.x = p.checkpoint + 2; p.y = 2; p.vy = 0; return; }
  p.x = p.checkpoint + 2; p.y = 4; p.vx = 0; p.vy = 0; p.inv = 1.5;
  Game.snapCamera();
}

function checkWorldTriggers() {
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
