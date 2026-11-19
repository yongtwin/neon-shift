import { EN } from '../art/art.js';
import { hurtPlayer } from '../combat/combat.js';
import { Feel } from '../combat/feel.js';
import { SFX } from '../core/audio.js';
import { Game } from '../core/game.js';
import { enemies, enemyBullets } from '../core/state.js';
import { clamp } from '../core/util.js';
import { FX } from '../effects/fx.js';
import { ARENAS, SPAWNS } from '../levels/stage1.js';
import { segmentAt } from '../levels/world.js';
import { player } from '../player/player.js';
import { HUD } from '../ui/hud.js';

/* =====================================================================
   Enemy AI. Every enemy runs the same readable loop so players can react:
     patrol → alert ("!") → windup (glowing telegraph) → attack → recover
   Gunner / Warden shoot (parryable bolts), Enforcer lunges (parry = stagger).
   Being hit interrupts a windup (except the armoured Warden and late enforcer
   windups), but poise (combat.js FLINCH_MAX / HYPER_ARMOR) grants super-armour
   after repeated flinches and the enemy counter-attacks: no stun-lock.
   HP is tuned so a full blade combo (2+2+3) kills a gunner / enforcer and the
   finisher is the hit that lands the kill.
   ===================================================================== */
export const ENEMY_DEF = {
  gunner:   { hp: 5,  hw: 0.55, h: 1.9, speed: 1.5,  aggro: 14, sight: 3.3 },
  enforcer: { hp: 6,  hw: 0.55, h: 2.0, speed: 1.8,  aggro: 11, sight: 3.3 },
  warden:   { hp: 24, hw: 0.9, h: 2.5, speed: 1.1,  aggro: 16, sight: 3.6 },
};

export function makeEnemy(spec, i) {
  const d = ENEMY_DEF[spec.kind], seg = segmentAt(spec.x);
  return {
    id: i, kind: spec.kind, x: spec.x, y: 0, facing: -1, dir: -1, hp: d.hp, maxhp: d.hp, hw: d.hw, h: d.h,
    minX: seg[0] + 1.3, maxX: seg[1] - 1.3, state: 'patrol', st: 0, anim: 'walk', t: i * 0.7, walk: i * 1.3,
    pause: 0, cooldown: 1 + (i % 3) * 0.4, tele: 0, flash: 0, stun: 0, kvx: 0, recoil: 0, muzzle: 0, shake: 0,
    alive: true, shots: 0, shotT: 0, lungeHit: false, lostT: 0, armor: spec.kind === 'warden',
    vy: 0, baseY: 0, flinchN: 0, flinchT: 0, armorT: 0, counter: false,
  };
}
/** every enemy of the stage, arena waves included (so the HUD total never jumps) */
export function totalEnemies() { return SPAWNS.length + ARENAS.reduce((n, a) => n + a.wave.length, 0); }
export function spawnEnemies() { enemies.length = 0; SPAWNS.forEach((s, i) => enemies.push(makeEnemy(s, i))); }

export function enemyShoot(e, speed, yOff, xOff, vy = 0) {
  enemyBullets.push({ x: e.x + e.facing * xOff, y: e.y + yOff, vx: e.facing * speed, vy, life: 2.1, dmg: 1, reflected: false, owner: e });
  e.recoil = 1; e.muzzle = 0.08;
  FX.hitSparks(e.x + e.facing * (xOff + 0.4), e.y + yOff, e.facing, 0, '#ff6a5a', '#ffd27a');
  SFX.play('eshoot');
}

export function setState(e, s) { e.state = s; e.st = 0; e.tele = 0; }

export function wardenSlam(e) {                                               // ground shockwaves both ways — jump them (or guard)
  for (const dir of [-1, 1]) enemyBullets.push({ x: e.x + dir * 0.9, y: 0.35, vx: dir * 11, vy: 0, life: 1.4, dmg: 1, wave: true, owner: e });
  FX.dust(e.x - 0.8, 0, 8, -1); FX.dust(e.x + 0.8, 0, 8, 1);
  FX.ring(e.x, 0.3, 4, 40, 0.3, EN.r2); Feel.kick(5);
  SFX.play('hit', 3);
}

export function updateEnemy(e, dt) {
  if (!e.alive) return;
  const d = ENEMY_DEF[e.kind], p = player;
  e.t += dt; e.st += dt;
  e.flash = Math.max(0, e.flash - dt); e.recoil = Math.max(0, e.recoil - dt / 0.16); e.muzzle = Math.max(0, e.muzzle - dt);
  e.shake = Math.max(0, e.shake - dt); e.cooldown -= dt;
  if (e.flinchT > 0) { e.flinchT -= dt; if (e.flinchT <= 0) e.flinchN = 0; }
  if (e.armorT > 0 && e.stun <= 0) e.armorT = Math.max(0, e.armorT - dt);   // super-armour counts down after the flinch

  /* knock-back (≈ kvx / 9 units) with a wall bounce at the segment ends, plus a vertical pop */
  if (Math.abs(e.kvx) > 0.15) {
    const nx = e.x + e.kvx * dt;
    if ((nx < e.minX || nx > e.maxX) && Math.abs(e.kvx) > 5) {
      FX.hitSparks(nx < e.minX ? e.minX - e.hw : e.maxX + e.hw, e.y + e.h * 0.4, -Math.sign(e.kvx), 0, EN.r2, '#ffffff');
      e.kvx = -e.kvx * 0.3;
    }
    e.x = clamp(nx, e.minX, e.maxX); e.kvx *= Math.exp(-dt * 9);
  } else e.kvx = 0;
  if (e.vy || e.y > e.baseY) {
    e.vy -= 34 * dt; e.y += e.vy * dt;
    if (e.y <= e.baseY) { if (e.vy < -4) FX.dust(e.x, e.baseY, 4, 0); e.y = e.baseY; e.vy = 0; }
  }

  const dxp = p.x - e.x, dist = Math.abs(dxp), dy = Math.abs(p.y - e.y);
  const sees = !p.dead && dist < d.aggro && dy < d.sight;

  /* contact damage (v0.3 rule) — stunned/staggered enemies are harmless */
  if (!p.dead && dist < 0.95 && dy < 1.6 && e.stun <= 0 && e.state !== 'stagger') hurtPlayer(1, e.x, { contact: e });

  if (e.kind === 'warden' && !e.phase2 && e.hp <= e.maxhp / 2) {          // boss phase 2: OVERDRIVE
    e.phase2 = true; e.flash = 0.3; e.cooldown = 0.6; setState(e, 'alert');
    FX.text('OVERDRIVE', e.x, e.y + e.h + 1, EN.r2, 1.2); FX.ring(e.x, e.y + 1.2, 4, 60, 0.4, EN.r1);
    Feel.screenFlash(0.3, '#ff6a5a'); Feel.kick(5); SFX.play('charge');
  }

  if (e.stun > 0) {                                                      // flinch (hit reaction)
    e.stun -= dt; e.anim = 'hit';
    if (e.stun <= 0) {
      if (e.counter && sees) counterAttack(e, dist);                     // poise broke: armoured counter-attack
      else { setState(e, sees ? 'alert' : 'patrol'); e.cooldown = Math.max(e.cooldown, 0.5); }
      e.counter = false;
    }
    return;
  }

  const face = () => { e.facing = dxp >= 0 ? 1 : -1; };

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
      else if (ready && e.kind === 'warden' && dist < 4.5) { setState(e, 'windup'); e.attack = 'slam'; SFX.play('charge'); }
      else if (ready && dist > 2) { setState(e, 'windup'); e.attack = 'shoot'; SFX.play('charge'); }
      else if (ready && e.kind === 'gunner') { e.kvx = -e.facing * 11; e.cooldown = 0.35; }   // too close: hop back to make room (R-022)
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
      const dur = e.kind === 'warden' ? (e.phase2 ? 0.5 : 0.7) : 0.5;
      e.anim = 'windup'; e.tele = clamp(e.st / dur, 0, 1);
      if (e.tele < 0.65) face();                                           // aim locks late → readable and fair
      if (e.st >= dur) {
        if (e.kind === 'enforcer') { setState(e, 'lunge'); e.lungeHit = false; }
        else if (e.attack === 'slam') { wardenSlam(e); e.cooldown = e.phase2 ? 0.8 : 1.3; setState(e, 'alert'); }
        else { setState(e, 'fire'); e.shots = e.kind === 'warden' ? (e.phase2 ? 2 : 3) : 1; e.shotT = 0; }
      }
      break;
    }
    case 'fire': {
      e.anim = 'fire';
      e.shotT -= dt;
      if (e.shots > 0 && e.shotT <= 0) {
        if (e.kind === 'warden' && e.phase2) { for (let k = -2; k <= 2; k++) enemyShoot(e, 13, 1.5, 1.5, k * 2.4); e.shotT = 0.35; }
        else if (e.kind === 'warden') { enemyShoot(e, 14.5, 1.5, 1.5); e.shotT = 0.15; }
        else { enemyShoot(e, 13, 1.1, 1.15); e.shotT = 0.15; }
        e.shots--;
      }
      if (e.shots <= 0 && e.st > 0.28) { e.cooldown = e.kind === 'warden' ? 1.5 : 1.15 + (e.x % 3) * 0.2; setState(e, 'alert'); }
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
      e.anim = 'hit'; e.flash = (Math.floor(e.t * 20) % 2) ? 0.04 : 0;
      if (e.st >= 1.1) { e.cooldown = 0.8; setState(e, 'alert'); }
      break;
    }
  }
}

/* after the poise breaks the enemy acts at once, under super-armour */
function counterAttack(e, dist) {
  e.facing = player.x >= e.x ? 1 : -1; e.cooldown = 0;
  if (e.kind === 'enforcer') { setState(e, dist < 3.6 ? 'windup' : 'chase'); if (dist < 3.6) SFX.play('charge'); }
  else if (dist > 2) { setState(e, 'windup'); e.attack = 'shoot'; SFX.play('charge'); }
  else { setState(e, 'alert'); e.kvx = -e.facing * 11; e.st = 0.4; }
  FX.ring(e.x, e.y + e.h * 0.6, 2, 18, 0.2, EN.r2);
}

export function updateEnemies(dt) { for (const e of enemies) updateEnemy(e, dt); }

/* ------------------------------------------------------------------ lockdown arenas */
export function resetArenas() { for (const a of ARENAS) { a.spawned = false; a.cleared = false; a.wallT = 0; } Game.arena = null; }
export function updateArenas(dt) {
  const p = player;
  for (const a of ARENAS) a.wallT = Math.max(0, a.wallT - dt);
  if (!Game.arena) {
    if (p.dead) return;
    for (const a of ARENAS) {
      if (a.cleared || p.x < a.trigger || p.x > a.x1) continue;
      if (!enemies.some(e => e.alive && e.x > a.x0 && e.x < a.x1) && a.spawned) { a.cleared = true; continue; }
      Game.arena = a; a.wallT = 0.4;
      if (!a.spawned) {
        a.spawned = true;
        for (const w of a.wave) {
          const e = makeEnemy(w, enemies.length); e.state = 'alert'; e.cooldown = 0.8; e.flash = 0.2;
          enemies.push(e); FX.ring(e.x, 1, 3, 26, 0.3, EN.r1); FX.bits(e.x, 1, EN.r1, 12);
        }
        HUD.setKills(Game.kills, totalEnemies());
      }
      HUD.toast(a.title, '#ff6a5a', 1.8); SFX.play('warn'); Feel.kick(2);
      break;
    }
    return;
  }
  const a = Game.arena;
  p.x = clamp(p.x, a.x0 + 0.4, a.x1 - 0.4);                             // laser walls
  for (const b of enemyBullets) if (b.x < a.x0 || b.x > a.x1) b.life = 0;
  if (!enemies.some(e => e.alive && e.x > a.x0 && e.x < a.x1)) {
    a.cleared = true; Game.arena = null; a.wallT = 0.5;
    HUD.toast(a.boss ? 'WARDEN DOWN — EXTRACTION OPEN' : 'AREA CLEAR', '#2fe6ff', 2); SFX.play('check');
    FX.ring(a.x0, 2, 3, 30, 0.4, '#2fe6ff'); FX.ring(a.x1, 2, 3, 30, 0.4, '#2fe6ff');
  }
}
