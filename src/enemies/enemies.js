import { EN } from '../art/art.js';
import { hurtPlayer } from '../combat/combat.js';
import { Feel } from '../combat/feel.js';
import { SFX } from '../core/audio.js';
import { Game } from '../core/game.js';
import { enemies, enemyBullets } from '../core/state.js';
import { DEG, clamp, rnd } from '../core/util.js';
import { FX } from '../effects/fx.js';
import { ARENAS, PLAT, SPAWNS } from '../levels/stage1.js';
import { segmentAt } from '../levels/world.js';
import { player } from '../player/player.js';
import { HUD } from '../ui/hud.js';

/* =====================================================================
   Enemy AI. Every enemy runs a readable loop so players can react:
     patrol → alert ("!") → windup (glowing telegraph, tele 0..1) → attack → recover
   Gunner / Turret / Warden shoot parryable bolts, Enforcer lunges and Drone
   swoops (parry = stagger). Poise (combat.js) prevents stun-locks.
   HP: a full blade combo (2+2+3) kills a gunner / enforcer on the finisher.

   Kinds
     gunner    walks its platform, aimed bolt (aim locks late in the windup)
     enforcer  chases, telegraphed lunge (late windup is armoured)
     drone     flies at hover height, telegraphed swoop at where you WERE when the aim locked
     turret    stationary, telegraphed aimed bolt; blade / blink only clank off it —
               destroy it with the cannon or by parry-reflecting its own bolts
     warden    boss (WARDEN // CORE SENTINEL): bolt fan, ground slam (jump the shockwaves),
               charge (red line telegraph; jump or BLINK through it — it crashes into the wall
               and is EXPOSED), OVERDRIVE at 50 % (faster windups, chained patterns), death sequence
   Pose fields for the renderer: anim, tele, flash, facing, aim (rad, +up, relative to facing),
   attack ('bolt'|'slam'|'charge'), phase2, exposed, chargeX0/chargeX1 (telegraph line), deadT, mount.
   ===================================================================== */
export const ENEMY_DEF = {
  gunner:   { hp: 5,  hw: 0.55, h: 1.9, speed: 1.5, aggro: 14, sight: 3.3 },
  enforcer: { hp: 6,  hw: 0.55, h: 2.0, speed: 1.8, aggro: 11, sight: 3.3 },
  warden:   { hp: 70, hw: 1.4,  h: 4.6, speed: 1.3, aggro: 40, sight: 6 },          // drawn at 1.7x (≈112 px)
  drone:    { hp: 3,  hw: 0.5,  h: 0.9, speed: 2.2, aggro: 11, sight: 7, fly: true },
  turret:   { hp: 4,  hw: 0.55, h: 1.1, speed: 0,   aggro: 13, sight: 8, fixed: true, bladeProof: true },
};
export const BOSS = {
  slamRange: 5.5, chargeSpeed: 17, chargeDmg: 2, crashStun: 1.4, crashStunP2: 1.1, slamExpose: 0.8,
  windup: { bolt: 0.8, slam: 0.75, charge: 0.95 }, windupP2: { bolt: 0.55, slam: 0.5, charge: 0.65 },
  pattern: ['bolt', 'charge', 'bolt', 'slam'], patternP2: ['charge', 'bolt', 'slam', 'charge', 'bolt'],
  exposedMul: 1.5, armoredMul: 0.5, deathTime: 2.2, muzzleY: 2.7, staggerImmune: 4,
  weights: { slam: 3, bolt: 2, charge: 2 }, slamGap: 2,              // R2-003: weighted pick, never twice in a row, ≥2 other attacks between slams
};
const TURRET_AIM_MIN = -60 * DEG, TURRET_AIM_MAX = 80 * DEG;

function platAt(x, y) {
  for (const p of PLAT) if (p[2] === y && x >= p[0] && x <= p[1]) return p;
  return y === 0 ? segmentAt(x) : [x - 2, x + 2, y];
}

export function makeEnemy(spec, i) {
  const d = ENEMY_DEF[spec.kind], y = spec.y || 0;
  let minX, maxX;
  if (d.fly) { const r = spec.range === undefined ? 3 : spec.range; minX = spec.x - r; maxX = spec.x + r; }
  else if (d.fixed) { minX = maxX = spec.x; }
  else { const seg = platAt(spec.x, y); minX = seg[0] + 1.3; maxX = seg[1] - 1.3; if (minX > maxX) minX = maxX = spec.x; }
  return {
    id: i, kind: spec.kind, x: spec.x, y, prevX: spec.x, prevY: y, facing: -1, dir: -1, hp: d.hp, maxhp: d.hp, hw: d.hw, h: d.h,
    minX, maxX, homeX: spec.x, state: 'patrol', st: 0, anim: d.fly ? 'idle' : 'walk', t: i * 0.7, walk: i * 1.3,
    pause: 0, cooldown: 1 + (i % 3) * 0.4, tele: 0, flash: 0, stun: 0, kvx: 0, recoil: 0, muzzle: 0, shake: 0,
    alive: true, shots: 0, shotT: 0, lungeHit: false, lostT: 0, armor: spec.kind === 'warden',
    vy: 0, baseY: y, flinchN: 0, flinchT: 0, armorT: 0, counter: false, aim: 0, mount: spec.mount || 'floor',
    attack: '', phase2: false, exposed: 0, impact: 0, dieU: 0, staggerImmune: 0, lastAtk: '', sinceSlam: 9, arenaId: spec.arenaId || null, pat: 0, dying: false, deadT: 0, tx: 0, ty: 0,
    sight: y > 0 && !d.fly ? Math.max(d.sight, y + 2.5) : d.sight,
  };
}
/** every enemy of the stage, arena waves included (so the HUD total never jumps) */
export function totalEnemies() { return SPAWNS.length + ARENAS.reduce((n, a) => n + a.wave.length, 0); }
let idSeq = 0;
const nextId = () => idSeq++;
export function spawnEnemies() { enemies.length = 0; idSeq = 0; SPAWNS.forEach(s => enemies.push(makeEnemy(s, nextId()))); }
export const bossEnemy = () => enemies.find(e => e.kind === 'warden') || null;

/* fire a bolt along angle `ang` (rad, +up, relative to facing) from (x0, y0) */
function boltFrom(e, x0, y0, ang, speed, dmg = 1) {
  enemyBullets.push({ x: x0, y: y0, vx: e.facing * Math.cos(ang) * speed, vy: Math.sin(ang) * speed, life: 2.4, dmg, reflected: false, owner: e });
  e.recoil = 1; e.muzzle = 0.08;
  FX.hitSparks(x0, y0, e.facing, 0, '#ff6a5a', '#ffd27a');
  SFX.play('eshoot');
}
export function enemyShoot(e, speed, yOff, xOff, vy = 0) {
  enemyBullets.push({ x: e.x + e.facing * xOff, y: e.y + yOff, vx: e.facing * speed, vy, life: 2.1, dmg: 1, reflected: false, owner: e });
  e.recoil = 1; e.muzzle = 0.08;
  FX.hitSparks(e.x + e.facing * (xOff + 0.4), e.y + yOff, e.facing, 0, '#ff6a5a', '#ffd27a');
  SFX.play('eshoot');
}

export function setState(e, s) { e.state = s; e.st = 0; e.tele = 0; }

export function wardenSlam(e) {                                         // ground shockwaves both ways — jump them (or guard)
  for (const dir of [-1, 1]) enemyBullets.push({ x: e.x + dir * 0.9, y: 0.35 + e.baseY, vx: dir * 11, vy: 0, life: 1.6, dmg: 1, wave: true, owner: e });
  FX.dust(e.x - 0.8, e.baseY, 8, -1); FX.dust(e.x + 0.8, e.baseY, 8, 1);
  FX.ring(e.x, e.baseY + 0.3, 4, 40, 0.3, EN.r2); Feel.kick(5);
  SFX.play('hit', 3);
}

/* ------------------------------------------------------------------ shared per-tick part */
export function updateEnemy(e, dt) {
  if (!e.alive) return;
  const d = ENEMY_DEF[e.kind], p = player;
  e.prevX = e.x; e.prevY = e.y;
  e.t += dt; e.st += dt;
  e.flash = Math.max(0, e.flash - dt); e.recoil = Math.max(0, e.recoil - dt / 0.16); e.muzzle = Math.max(0, e.muzzle - dt);
  e.shake = Math.max(0, e.shake - dt); e.cooldown -= dt; e.exposed = Math.max(0, e.exposed - dt); e.staggerImmune = Math.max(0, e.staggerImmune - dt);
  if (e.flinchT > 0) { e.flinchT -= dt; if (e.flinchT <= 0) e.flinchN = 0; }
  if (e.armorT > 0 && e.stun <= 0) e.armorT = Math.max(0, e.armorT - dt);   // super-armour counts down after the flinch

  if (e.dying) { updateBossDeath(e, dt); return; }

  /* knock-back (≈ kvx / 9 units) with a wall bounce at the segment ends, plus a vertical pop */
  if (d.fixed) e.kvx = 0;
  else if (Math.abs(e.kvx) > 0.15) {
    const nx = e.x + e.kvx * dt;
    if (!d.fly && (nx < e.minX || nx > e.maxX) && Math.abs(e.kvx) > 5) {
      FX.hitSparks(nx < e.minX ? e.minX - e.hw : e.maxX + e.hw, e.y + e.h * 0.4, -Math.sign(e.kvx), 0, EN.r2, '#ffffff');
      e.kvx = -e.kvx * 0.3;
    }
    e.x = d.fly ? nx : clamp(nx, e.minX, e.maxX); e.kvx *= Math.exp(-dt * 9);
  } else e.kvx = 0;
  const A = Game.arena;
  if (A && d.fly && inArena(e, A)) e.x = clamp(e.x, A.x0 + 0.8, A.x1 - 0.8);   // R2-007: flyers stay inside the lockdown
  if (!d.fly && !d.fixed && (e.vy || e.y > e.baseY)) {
    e.vy -= 34 * dt; e.y += e.vy * dt;
    if (e.y <= e.baseY) { if (e.vy < -4) FX.dust(e.x, e.baseY, 4, 0); e.y = e.baseY; e.vy = 0; }
  }

  const dxp = p.x - e.x, dist = Math.abs(dxp), dy = Math.abs(p.y - e.y);
  const sees = !p.dead && dist < d.aggro && dy < e.sight;

  /* contact damage — stunned / staggered enemies, turrets and idle drones are harmless */
  if (!d.fixed && !d.fly && !p.dead && dist < e.hw + 0.4 && dy < Math.min(1.6, e.h) && e.stun <= 0 && e.state !== 'stagger' && e.state !== 'stun')
    hurtPlayer(e.state === 'charge' ? BOSS.chargeDmg : 1, e.x, e.state === 'charge' ? { melee: e } : { contact: e });

  if (e.kind === 'warden' && !e.phase2 && e.hp <= e.maxhp / 2) {          // boss phase 2: OVERDRIVE
    e.phase2 = true; e.flash = 0.3; e.cooldown = 0.5; e.pat = 0;
    if (e.state !== 'charge') setState(e, 'alert');
    FX.ring(e.x, e.y + 1.2, 4, 60, 0.4, EN.r1);
    Feel.screenFlash(0.3, '#ff6a5a'); Feel.kick(5); SFX.play('charge');
    HUD.toast('WARDEN // OVERDRIVE', '#ff6a5a', 1.6);
  }

  if (e.stun > 0) {                                                      // flinch (hit reaction)
    e.stun -= dt; e.anim = 'hit';
    if (d.fly) hover(e, dt, 2);
    if (e.stun <= 0) {
      if (e.counter && sees) counterAttack(e, dist);                     // poise broke: armoured counter-attack
      else { setState(e, sees ? 'alert' : 'patrol'); e.cooldown = Math.max(e.cooldown, 0.5); }
      e.counter = false;
    }
    return;
  }
  if (e.kind === 'drone') return updateDrone(e, dt, dxp, dist, sees);
  if (e.kind === 'turret') return updateTurret(e, dt, dxp, dist, sees);
  if (e.kind === 'warden') return updateWarden(e, dt, dxp, dist, sees);
  updateGround(e, dt, d, dxp, dist, sees);
}

/* ------------------------------------------------------------------ gunner / enforcer */
function updateGround(e, dt, d, dxp, dist, sees) {
  const p = player, face = () => { e.facing = dxp >= 0 ? 1 : -1; };
  switch (e.state) {
    case 'patrol': {
      if (e.pause > 0) { e.pause -= dt; e.anim = 'idle'; }
      else {
        e.facing = e.dir; e.x += e.dir * d.speed * dt; e.walk += dt * d.speed * 2.6; e.anim = 'walk';
        if (e.x <= e.minX) { e.x = e.minX; e.dir = 1; e.pause = 0.7; } else if (e.x >= e.maxX) { e.x = e.maxX; e.dir = -1; e.pause = 0.7; }
      }
      if (sees) { setState(e, 'alert'); SFX.play('warn'); }
      break;
    }
    case 'alert': {
      face(); e.anim = 'alert';
      e.lostT = sees ? 0 : e.lostT + dt;
      if (e.lostT > 1.8) { setState(e, 'patrol'); break; }
      const ready = e.st > 0.38 && e.cooldown <= 0 && sees;
      if (e.kind === 'enforcer') { if (ready) setState(e, 'chase'); }
      else if (ready && dist > 2) { setState(e, 'windup'); e.attack = 'bolt'; SFX.play('charge'); }
      else if (ready) { e.kvx = -e.facing * 11; e.cooldown = 0.35; }    // too close: hop back to make room (R-022)
      break;
    }
    case 'chase': {                                                        // enforcer closes the gap
      face(); e.anim = 'chase';
      e.lostT = sees ? 0 : e.lostT + dt;
      if (e.lostT > 1.5) { setState(e, 'patrol'); break; }
      if (dist > 2.6) { e.x = clamp(e.x + e.facing * 5.4 * dt, e.minX, e.maxX); e.walk += dt * 15; }
      if (dist < 3.4 && e.cooldown <= 0) { setState(e, 'windup'); SFX.play('charge'); }
      break;
    }
    case 'windup': {
      const dur = 0.5;
      e.anim = 'windup'; e.tele = clamp(e.st / dur, 0, 1);
      if (e.tele < 0.65) {                                                 // aim locks late → readable and fair
        face();
        const sy = e.y + 1.1, ty = p.y + 1.0;
        e.aim = clamp(Math.atan2(ty - sy, Math.max(1, Math.abs(p.x - e.x))), -40 * DEG, 40 * DEG);
      }
      if (e.st >= dur) {
        if (e.kind === 'enforcer') { setState(e, 'lunge'); e.lungeHit = false; }
        else { setState(e, 'fire'); e.shots = 1; e.shotT = 0; }
      }
      break;
    }
    case 'fire': {
      e.anim = 'fire';
      e.shotT -= dt;
      if (e.shots > 0 && e.shotT <= 0) { boltFrom(e, e.x + e.facing * 1.15, e.y + 1.1, Math.abs(e.aim) < 4 * DEG ? 0 : e.aim, 13); e.shotT = 0.15; e.shots--; }
      if (e.shots <= 0 && e.st > 0.28) { e.cooldown = 1.15 + (e.homeX % 3) * 0.2; setState(e, 'alert'); }
      break;
    }
    case 'lunge': {
      e.anim = 'lunge';
      e.x = clamp(e.x + e.facing * 15 * dt, e.minX, e.maxX);
      e.walk += dt * 20;
      if (!e.lungeHit && !p.dead && (p.x - e.x) * e.facing > -0.4 && (p.x - e.x) * e.facing < 2.3 && Math.abs(p.y - e.y) < 1.7) {
        e.lungeHit = true; hurtPlayer(1, e.x, { melee: e });
      }
      if (e.st >= 0.22) setState(e, 'recover');
      break;
    }
    case 'recover': {
      e.anim = 'recover';
      if (e.st >= 0.6) { e.cooldown = 0.9; setState(e, sees ? 'chase' : 'patrol'); }
      break;
    }
    case 'stagger': {                                                     // parried: wide open for a punish
      e.anim = 'stagger'; e.flash = (Math.floor(e.t * 20) % 2) ? 0.04 : 0;
      if (e.st >= 1.1) { e.cooldown = 0.8; setState(e, 'alert'); }
      break;
    }
  }
}

/* ------------------------------------------------------------------ drone */
function hover(e, dt, k = 4) {                                         // ease back toward hover height with a gentle bob
  const ty = e.baseY + Math.sin(e.t * 2.4 + e.homeX) * 0.25;
  e.y += (ty - e.y) * Math.min(1, dt * k);
}
function updateDrone(e, dt, dxp, dist, sees) {
  const p = player, face = () => { e.facing = dxp >= 0 ? 1 : -1; };
  const aimAt = () => { e.aim = clamp(Math.atan2(p.y + 1 - (e.y + 0.4), Math.max(0.5, Math.abs(p.x - e.x))), -80 * DEG, 30 * DEG); };
  switch (e.state) {
    case 'patrol': {
      e.anim = 'idle'; hover(e, dt);
      e.facing = e.dir; e.x += e.dir * ENEMY_DEF.drone.speed * dt; e.walk += dt * 4;
      if (e.x <= e.minX) { e.x = e.minX; e.dir = 1; } else if (e.x >= e.maxX) { e.x = e.maxX; e.dir = -1; }
      if (sees) { setState(e, 'alert'); SFX.play('warn'); }
      break;
    }
    case 'alert': {
      face(); aimAt(); e.anim = 'alert'; hover(e, dt);
      const hx = clamp(p.x - e.facing * 3.5, e.minX - 1.5, e.maxX + 1.5);       // drift to a striking position
      e.x += clamp(hx - e.x, -1, 1) * 2.4 * dt;
      e.lostT = sees ? 0 : e.lostT + dt;
      if (e.lostT > 2) { setState(e, 'patrol'); break; }
      if (e.st > 0.45 && e.cooldown <= 0 && sees) { setState(e, 'windup'); SFX.play('charge'); }
      break;
    }
    case 'windup': {                                                      // rears back; the target point locks at tele 0.7
      e.anim = 'windup'; e.tele = clamp(e.st / 0.6, 0, 1); hover(e, dt);
      e.y += dt * 0.6;
      if (e.tele < 0.7) { face(); aimAt(); e.tx = p.x; e.ty = Math.max(0.3, p.y + 0.6); }
      if (e.st >= 0.6) { setState(e, 'swoop'); e.lungeHit = false; }
      break;
    }
    case 'swoop': {
      e.anim = 'swoop';
      const vx = e.tx - e.x, vy = e.ty - e.y, d = Math.hypot(vx, vy) || 1, sp = 13 * dt;
      if (d > sp) { e.x += vx / d * sp; e.y += vy / d * sp; }
      if (!e.lungeHit && !p.dead && Math.abs(p.x - e.x) < 0.8 && e.y < p.y + 1.6 && e.y + e.h > p.y + 0.2) { e.lungeHit = true; hurtPlayer(1, e.x, { melee: e }); }
      if (d <= sp || e.st > 0.7) setState(e, 'recover');
      break;
    }
    case 'recover': {                                                     // climb back to its lane
      e.anim = 'walk'; hover(e, dt, 2.5);
      e.x += clamp(e.homeX - e.x, -1, 1) * 2 * dt;
      if (e.st > 0.8) { e.cooldown = 1.5; setState(e, sees ? 'alert' : 'patrol'); }
      break;
    }
    case 'stagger': {                                                     // parried: sags, wide open
      e.anim = 'hit'; e.y = Math.max(0.4, e.y - dt * 1.5); e.flash = (Math.floor(e.t * 20) % 2) ? 0.04 : 0;
      if (e.st >= 1.0) { e.cooldown = 0.8; setState(e, 'recover'); }
      break;
    }
    default: setState(e, 'alert');
  }
}

/* ------------------------------------------------------------------ turret */
function updateTurret(e, dt, dxp, dist, sees) {
  const p = player;
  const track = () => {
    e.facing = dxp >= 0 ? 1 : -1;
    e.aim = clamp(Math.atan2(p.y + 1.0 - (e.y + 0.5), Math.max(0.3, Math.abs(dxp))), TURRET_AIM_MIN, TURRET_AIM_MAX);
  };
  switch (e.state) {
    case 'patrol': case 'alert': {
      e.anim = sees ? 'alert' : 'idle';
      if (sees) track();
      if (sees && e.cooldown <= 0) { setState(e, 'windup'); SFX.play('charge'); }
      break;
    }
    case 'windup': {                                                      // dotted laser sight grows; aim locks at tele 0.75
      e.anim = 'windup'; e.tele = clamp(e.st / 0.8, 0, 1);
      if (e.tele < 0.75) track();
      if (e.st >= 0.8) {
        const L = 0.875, c = Math.cos(e.aim), s = Math.sin(e.aim);
        boltFrom(e, e.x + e.facing * c * L, e.y + 0.5 + s * L, e.aim, 12);
        setState(e, 'fire');
      }
      break;
    }
    case 'fire': { e.anim = 'fire'; if (e.st > 0.25) { e.cooldown = Game.arena ? 1.4 : 1.8; setState(e, 'alert'); } break; }
    default: setState(e, 'alert');
  }
}

/* ------------------------------------------------------------------ WARDEN // CORE SENTINEL */
/* R2-003: weighted choice with anti-repeat. Proximity only tilts the weights; slam needs ≥ slamGap
   other attacks since the last one, and the same attack never comes twice in a row. */
export function chooseBossAttack(e, dist) {
  const W = BOSS.weights, w = {
    slam: e.sinceSlam >= BOSS.slamGap ? W.slam * (dist < BOSS.slamRange ? 1.5 : 0.4) : 0,
    bolt: W.bolt * (dist > 4 ? 1.4 : 0.8),
    charge: W.charge * (dist > 6 ? 1.4 : 0.9),
  };
  if (e.lastAtk) w[e.lastAtk] = 0;
  const tot = w.slam + w.bolt + w.charge;
  let r = Math.random() * tot, atk = 'bolt';
  for (const k of ['slam', 'bolt', 'charge']) { if (r < w[k]) { atk = k; break; } r -= w[k]; }
  e.sinceSlam = atk === 'slam' ? 0 : e.sinceSlam + 1; e.lastAtk = atk;
  (e.atkLog || (e.atkLog = [])).push(atk);
  return atk;
}
function wardenWindup(e, attack) {
  setState(e, 'windup'); e.attack = attack; SFX.play(attack === 'slam' ? 'charge' : 'warn');
  if (attack === 'charge') {
    e.facing = player.x >= e.x ? 1 : -1;
    const a = Game.arena;
    e.chargeX0 = e.x; e.chargeX1 = e.facing > 0 ? (a ? a.x1 - 1 : e.maxX) : (a ? a.x0 + 1 : e.minX);
  }
}
function updateWarden(e, dt, dxp, dist, sees) {
  e.impact = Math.max(0, (e.impact || 0) - dt / 0.4);                  // 1 → 0 right after a slam lands (renderer)
  const face = () => { e.facing = dxp >= 0 ? 1 : -1; };
  const W = e.phase2 ? BOSS.windupP2 : BOSS.windup;
  switch (e.state) {
    case 'patrol': case 'intro': {
      e.anim = 'idle';
      if (sees) { setState(e, 'alert'); e.cooldown = 1.2; SFX.play('warn'); }
      break;
    }
    case 'alert': {                                                       // stalk the player between attacks
      face(); e.anim = 'walk';
      if (dist > 3) { e.x = clamp(e.x + e.facing * ENEMY_DEF.warden.speed * dt, e.minX, e.maxX); e.walk += dt * 3.4; }
      else e.anim = 'alert';
      if (e.cooldown <= 0 && e.st > 0.3) wardenWindup(e, chooseBossAttack(e, dist));
      break;
    }
    case 'windup': {
      const dur = W[e.attack] || 0.7;
      e.anim = 'windup'; e.tele = clamp(e.st / dur, 0, 1);
      if (e.attack !== 'charge' && e.tele < 0.65) face();
      if (e.attack === 'charge' && e.tele < 0.5) {                        // the line re-aims until halfway, then commits
        face(); const a = Game.arena;
        e.chargeX1 = e.facing > 0 ? (a ? a.x1 - 1 : e.maxX) : (a ? a.x0 + 1 : e.minX);
      }
      if (e.st >= dur) {
        if (e.attack === 'slam') {
          wardenSlam(e); e.impact = 1; e.exposed = BOSS.slamExpose; e.cooldown = e.phase2 ? 0.55 : 1.1;
          if (e.phase2) { setState(e, 'windup'); e.attack = 'bolt'; e.st = 0.15; e.lastAtk = 'bolt'; e.sinceSlam = 1; }    // OVERDRIVE: slam chains into a fan
          else setState(e, 'recover');
        } else if (e.attack === 'charge') { setState(e, 'charge'); e.lungeHit = false; e.attack = 'charge'; Feel.kick(3, e.facing); SFX.play('dash'); }
        else { setState(e, 'fire'); e.shots = 2; e.shotT = 0; }
      }
      break;
    }
    case 'fire': {                                                        // bolt fan: 3 (5 in OVERDRIVE), two volleys
      e.anim = 'fire';
      e.shotT -= dt;
      if (e.shots > 0 && e.shotT <= 0) {
        const n = e.phase2 ? 5 : 3, base = clamp(Math.atan2(player.y + 1 - (e.y + BOSS.muzzleY), Math.max(1, dist)), -35 * DEG, 10 * DEG);
        for (let k = 0; k < n; k++) boltFrom(e, e.x + e.facing * 2, e.y + BOSS.muzzleY, base + (k - (n - 1) / 2) * 9 * DEG, 13);
        e.shotT = 0.45; e.shots--;
      }
      if (e.shots <= 0 && e.st > 0.5) { e.cooldown = e.phase2 ? 0.7 : 1.2; setState(e, 'alert'); }
      break;
    }
    case 'charge': {                                                      // rush along the telegraphed line
      e.anim = 'charge'; e.attack = 'charge'; e.tele = 1; e.walk += dt * 22;
      e.x += e.facing * BOSS.chargeSpeed * dt;
      if ((e.chargeX1 - e.x) * e.facing <= 0 || e.st > 3) {                           // crash into the arena wall → EXPOSED
        e.x = e.chargeX1; setState(e, 'stun'); e.exposed = e.phase2 ? BOSS.crashStunP2 : BOSS.crashStun;
        Feel.kick(6, e.facing); Feel.stop(0.08); SFX.play('hit', 3);
        FX.hitSparks(e.x + e.facing * e.hw, e.y + 1.2, -e.facing, 3, EN.r2, '#ffffff'); FX.debris(e.x + e.facing, e.y + 1.4, 10, [EN.g2, EN.r2, '#ffffff'], 7);
        FX.text('EXPOSED', e.x, e.y + e.h + 0.8, '#ffe06b', 1.0);
      }
      break;
    }
    case 'stun': {
      e.anim = 'stun'; e.flash = (Math.floor(e.t * 16) % 2) ? 0.03 : 0;
      if (e.st >= (e.phase2 ? BOSS.crashStunP2 : BOSS.crashStun)) { e.cooldown = e.phase2 ? 0.15 : 0.5; setState(e, 'alert'); if (e.phase2) wardenWindup(e, 'bolt'); }
      break;
    }
    case 'recover': { e.anim = 'slam'; if (e.st >= BOSS.slamExpose) setState(e, 'alert'); break; }
    case 'stagger': { e.anim = 'stagger'; e.exposed = Math.max(e.exposed, 0.1); if (e.st >= 1.1) { e.cooldown = 0.6; setState(e, 'alert'); } break; }
    default: setState(e, 'alert');
  }
}

/** called by combat when the boss reaches 0 HP: a 2.2 s collapse with explosions, then the real kill */
export function startBossDeath(e) {
  e.dying = true; e.deadT = 0; e.dieU = 0; e.hp = 0; e.anim = 'dying'; e.state = 'dying'; e.kvx = 0; e.attack = '';
  enemyBullets.length = 0;
  Feel.slowmo(0.8); Feel.screenFlash(0.5, '#ffffff'); Feel.kick(6);
  HUD.toast('WARDEN // CORE FAILURE', '#ffe06b', 2.2);
  SFX.play('kill');
}
function updateBossDeath(e, dt) {
  e.deadT += dt; e.anim = 'dying'; e.dieU = Math.min(1, e.deadT / BOSS.deathTime);
  if (Math.floor((e.deadT - dt) / 0.18) !== Math.floor(e.deadT / 0.18)) {
    const x = e.x + rnd(-1, 1), y = e.y + rnd(0.4, 2.4);
    FX.debris(x, y, 6, [EN.g2, EN.r1, EN.r2, '#ffffff'], 8); FX.ring(x, y, 2, 26, 0.25, EN.r2); FX.disc(x, y, 10, 0.12, '#ffffff');
    Feel.kick(3 + 2 * Math.random()); SFX.play('hit', 2);
  }
  if (e.deadT >= BOSS.deathTime) {
    e.alive = false; e.dying = false; Game.kills++;
    HUD.setKills(Game.stageKills, totalEnemies());
    FX.debris(e.x, e.y + 1.2, 30, [EN.g2, EN.g3, EN.r1, EN.r2, EN.am], 13); FX.ring(e.x, e.y + 1.2, 4, 80, 0.5, '#ffffff'); FX.burst(e.x, e.y + 1.2, 40, EN.r2, 15);
    Feel.stop(0.2); Feel.kick(8); Feel.screenFlash(0.7, '#ffe6c8'); SFX.play('kill');
    Game.bossDefeated();
  }
}

/* after the poise breaks the enemy acts at once, under super-armour */
function counterAttack(e, dist) {
  e.facing = player.x >= e.x ? 1 : -1; e.cooldown = 0;
  if (e.kind === 'enforcer') { setState(e, dist < 3.6 ? 'windup' : 'chase'); if (dist < 3.6) SFX.play('charge'); }
  else if (e.kind === 'drone') { setState(e, 'windup'); SFX.play('charge'); }
  else if (dist > 2) { setState(e, 'windup'); e.attack = 'bolt'; SFX.play('charge'); }
  else { setState(e, 'alert'); e.kvx = -e.facing * 11; e.st = 0.4; }
  FX.ring(e.x, e.y + e.h * 0.6, 2, 18, 0.2, EN.r2);
}

export function updateEnemies(dt) { for (const e of enemies) updateEnemy(e, dt); }
/* arena membership by id (wave members) or by home position (pre-placed), never by where knock-back left them (R2-007) */
export const inArena = (e, a) => e.arenaId ? e.arenaId === a.id : e.homeX > a.x0 && e.homeX < a.x1;
const liveIn = a => enemies.some(e => e.alive && inArena(e, a));

/** R2-006: dying inside a lockdown resets it — its wave respawns at full HP (boss included), kills of it are refunded */
export function resetArenaOnDeath(a) {
  if (!a) return;
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    if (e.arenaId !== a.id) continue;
    if (!e.alive) Game.kills = Math.max(0, Game.kills - 1);
    enemies.splice(i, 1);
  }
  for (const e of enemies) if (!e.arenaId && inArena(e, a) && e.alive) { e.hp = e.maxhp; e.stun = 0; e.armorT = 0; e.flinchN = 0; setState(e, 'patrol'); }
  a.spawned = false; a.cleared = false; a.wallT = 0;
  enemyBullets.length = 0;
  HUD.setKills(Game.stageKills, totalEnemies()); HUD.setBoss(null);
}

/* ------------------------------------------------------------------ lockdown arenas */
export function resetArenas() { for (const a of ARENAS) { a.spawned = false; a.cleared = false; a.wallT = 0; } Game.arena = null; }
export function updateArenas(dt) {
  const p = player;
  for (const a of ARENAS) a.wallT = Math.max(0, a.wallT - dt);
  if (!Game.arena) {
    if (p.dead) return;
    for (const a of ARENAS) {
      if (a.cleared || p.x < a.trigger || p.x > a.x1) continue;
      if (a.spawned && !liveIn(a)) { a.cleared = true; continue; }
      Game.arena = a; a.wallT = 0.4;
      if (!a.spawned) {
        a.spawned = true;
        for (const w of a.wave) {
          const e = makeEnemy({ ...w, arenaId: a.id }, nextId()); e.flash = 0.2;
          e.minX = Math.max(e.minX, a.x0 + 0.8); e.maxX = Math.min(e.maxX, a.x1 - 0.8);
          if (e.kind === 'warden') { e.state = 'intro'; e.cooldown = 1.5; e.facing = -1; }
          else { e.state = 'alert'; e.cooldown = 0.8; }
          enemies.push(e); FX.ring(e.x, e.y + 1, 3, 26, 0.3, EN.r1); FX.bits(e.x, e.y + 1, EN.r1, 12);
        }
        HUD.setKills(Game.stageKills, totalEnemies());
      }
      HUD.toast(a.title, '#ff6a5a', 1.8); SFX.play('warn'); Feel.kick(2);
      break;
    }
    return;
  }
  const a = Game.arena;
  if (p.x < a.x0 + 0.4 || p.x > a.x1 - 0.4) { p.x = clamp(p.x, a.x0 + 0.4, a.x1 - 0.4); p.vx = 0; }   // laser walls
  for (const b of enemyBullets) if (b.x < a.x0 || b.x > a.x1) b.life = 0;
  if (!liveIn(a)) {
    a.cleared = true; Game.arena = null; a.wallT = 0.5;
    HUD.toast(a.boss ? 'WARDEN DOWN — EXTRACTION OPEN' : 'AREA CLEAR', '#2fe6ff', 2); SFX.play('check');
    FX.ring(a.x0, 2, 3, 30, 0.4, '#2fe6ff'); FX.ring(a.x1, 2, 3, 30, 0.4, '#2fe6ff');
  }
}
