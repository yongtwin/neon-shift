import { ACCENT, EN } from '../art/art.js';
import { Feel } from './feel.js';
import { SFX } from '../core/audio.js';
import { Game } from '../core/game.js';
import { bullets, enemies, enemyBullets } from '../core/state.js';
import { filterInPlace, rnd } from '../core/util.js';
import { FX, PT } from '../effects/fx.js';
import { BOSS, ENEMY_DEF, setState, startBossDeath, totalEnemies } from '../enemies/enemies.js';
import { streetTop } from '../levels/world.js';
import { BOSS_KILL_HITSTOP, GUARD, KILL_HITSTOP, PARRY_HOLD_AFTER, PARRY_WINDOW, PERFECT_WINDOW, cancelSwing, player } from '../player/player.js';
import { HUD } from '../ui/hud.js';

/* =====================================================================
   Combat resolution: hit detection, damage, hit reactions (hit-stop, shake,
   sparks, impact star, knock-back + pop, flinch / poise), parry / block /
   guard meter, projectiles and the hit-chain counter.

   Poise (REVIEW R-002): a normal hit makes the enemy flinch (stun) and
   interrupts its windup, but after FLINCH_MAX flinches inside FLINCH_RESET s
   the enemy gains HYPER_ARMOR s of super-armour (counted after the flinch
   ends) and counter-attacks. Late enforcer windups (tele > 0.6) are armoured.
   So pressure is rewarded but an enemy can never be stun-locked.
   ===================================================================== */
export const FLINCH_MAX = 2, FLINCH_RESET = 1.2, HYPER_ARMOR = 1.0;          // R2-004: the 2nd flinch in a row breaks poise
export const dbgBoxes = [];         // hitboxes shown with F4 (only recorded while F4 is on)

const _hb = { x0: 0, x1: 0, y0: 0, y1: 0 };
export function hurtbox(e, out = _hb) { out.x0 = e.x - e.hw; out.x1 = e.x + e.hw; out.y0 = e.y; out.y1 = e.y + e.h; return out; }
export const isArmored = e => e.armor || e.armorT > 0 || e.state === 'stagger' || (e.kind === 'enforcer' && e.state === 'windup' && e.tele > 0.6);

/* ------------------------------------------------------------------ damage to enemies */
/* o: { src:'blade'|'blink'|'bullet'|'lance'|'reflect', dirX, kb, kvy, stun, hs, shake, power, x, y, c1, c2 } */
let clankT = 0;
export function damageEnemy(e, dmg, o) {
  if (!e.alive || e.dying) return false;
  if (ENEMY_DEF[e.kind].bladeProof && (o.src === 'blade' || o.src === 'blink')) {   // turrets: armour plate, use the cannon / a reflect
    FX.hitSparks(o.x, o.y, -o.dirX, 0, '#c8cbd8', '#ffffff'); Feel.stop(0.03); Feel.kick(1.2, o.dirX); SFX.play('block');
    if (Game.time - clankT > 1.2) { clankT = Game.time; FX.text('ARMORED', e.x, e.y + e.h + 0.8, '#c8cbd8', 0.8); }
    e.flash = 0.05;
    return false;
  }
  if (e.kind === 'warden') {                                            // boss: armoured front, exposed after a crash / slam / parry
    const back = o.dirX === e.facing && (o.src === 'blade' || o.src === 'blink');
    const mul = e.exposed > 0 || e.state === 'stagger' ? BOSS.exposedMul : back || o.src !== 'blade' ? 1 : BOSS.armoredMul;
    dmg = dmg * mul;                                                    // fractional on the boss (bar is continuous)
    if (mul < 1 && Game.time - clankT > 1.5) { clankT = Game.time; FX.text('ARMOR', e.x, e.y + e.h + 0.8, '#c8cbd8', 0.7); }
  }
  if (e.state === 'stagger' && e.kind !== 'warden') dmg += 1;           // parried enemies are wide open (not the boss: R2-001)
  e.hp -= dmg;
  e.flash = o.power >= 3 ? 0.16 : 0.12;
  e.shake = (o.hs || 0) + 0.08;                                         // victim jitters through the hit-stop
  const armored = isArmored(e);
  if (!armored) {
    e.stun = o.stun === undefined ? 0.25 : o.stun;
    e.flinchN++; e.flinchT = FLINCH_RESET;
    if (e.flinchN >= FLINCH_MAX) { e.flinchN = 0; e.armorT = HYPER_ARMOR; e.counter = true; e.stun = Math.min(e.stun, 0.08); }   // counter-attack almost at once
  }
  e.kvx = o.dirX * o.kb * (e.armor ? 0.3 : armored ? 0.5 : 1);
  if (o.kvy && !e.armor) e.vy = Math.max(e.vy || 0, o.kvy);
  Game.addCombo();
  FX.hitSparks(o.x, o.y, o.dirX, o.power, o.c1, o.c2);
  FX.impact(o.x, o.y, o.dirX, o.power, o.c1);
  if (o.power >= 2) for (let i = 0; i < 3; i++) FX.puff(o.x, o.y, o.dirX * rnd(1, 4), rnd(0, 2), 0.25, '#b9c8ee', 2);
  Feel.stop(o.hs); Feel.kick(o.shake, o.dirX);
  SFX.play('hit', o.power);
  if (e.hp <= 0) { if (e.kind === 'warden') startBossDeath(e); else killEnemy(e, o); return true; }
  return false;
}

export function killEnemy(e, o) {
  e.alive = false; Game.kills++;
  HUD.setKills(Game.stageKills, totalEnemies());
  const big = e.kind === 'warden', cy = e.y + e.h * 0.5;
  FX.debris(e.x, cy, big ? 24 : 13, [EN.g2, EN.g3, EN.r1, EN.r2, big ? EN.am : EN.g1], big ? 11 : 9);
  FX.disc(e.x, cy, big ? 22 : 14, 0.18, '#ffffff');
  FX.ring(e.x, cy, 4, big ? 60 : 38, 0.3, EN.r2); FX.ring(e.x, cy, 2, big ? 40 : 24, 0.22, '#ffffff');
  FX.burst(e.x, cy, big ? 34 : 20, EN.r2, 13);
  for (let i = 0; i < 5; i++) FX.puff(e.x + rnd(-0.4, 0.4), cy + rnd(-0.4, 0.6), rnd(-2, 2), rnd(1, 3), 0.5, '#4a5570', rnd(3, 5));
  Feel.stop(Math.max(o.hs || 0, big ? BOSS_KILL_HITSTOP : KILL_HITSTOP)); Feel.kick(Math.max(o.shake || 0, 3) + (big ? 3 : 1.5), o.dirX);
  Feel.screenFlash(big ? 0.4 : 0.18, '#ffe6c8');
  SFX.play('kill');
  if (Game.stageKills >= totalEnemies()) HUD.toast('ALL HOSTILES DOWN — REACH THE PORTAL', '#ffe06b', 2.2);
}

/* ------------------------------------------------------------------ blade / blink */
export function bladeHitCheck(S, step) {
  const p = player, f = p.atkFacing;                                    // facing locked at swing start (R-015)
  const x0 = f > 0 ? p.x + S.box[0] : p.x - S.box[1], x1 = f > 0 ? p.x + S.box[1] : p.x - S.box[0];
  const y0 = p.y + S.box[2], y1 = p.y + S.box[3];
  if (Game.showBoxes) { dbgBoxes.push({ x0, x1, y0, y1, t: 0.1 }); if (dbgBoxes.length > 12) dbgBoxes.shift(); }
  const A = ACCENT.blade;
  for (const e of enemies) {
    if (!e.alive || e.dying || p.atkHits.includes(e.id)) continue;
    const h = hurtbox(e);
    if (h.x1 > x0 && h.x0 < x1 && h.y1 > y0 && h.y0 < y1) {
      p.atkHits.push(e.id);
      const ix = e.x - f * e.hw * 0.6, iy = e.y + e.h * 0.55, crit = p.critT > 0;
      if (crit) { p.critT = 0; FX.text('CRITICAL!', e.x, e.y + e.h + 0.9, '#ffe06b', 0.8); Feel.screenFlash(0.18, '#fff3b8'); }
      damageEnemy(e, S.dmg + (crit ? (e.kind === 'warden' ? 1 : 3) : 0), { src: 'blade', dirX: f, kb: S.kb * (crit ? 1.5 : 1), kvy: crit ? Math.max(S.kvy, 4) : S.kvy, stun: S.stun + (crit ? 0.15 : 0),
        hs: S.hs + (crit ? 0.04 : 0), shake: S.shake + (crit ? 2 : 0), power: crit ? 3 : S.power, x: ix, y: iy, c1: crit ? '#ffe06b' : A.m, c2: A.l });
      if (step === 3) Feel.screenFlash(0.1, '#ffffff');
    }
  }
}

/* send an enemy bolt back toward its shooter (or straight back if it is gone) */
export function reflectBullet(b, dmg, A) {
  b.life = 0;
  let dx = -Math.sign(b.vx || 1), dy = 0;
  const o = b.owner;
  if (o && o.alive) { const tx = o.x - b.x, ty = o.y + o.h * 0.55 - b.y, d = Math.hypot(tx, ty) || 1; dx = tx / d; dy = ty / d; }
  bullets.push({ x: b.x, y: b.y, vx: dx * 24, vy: dy * 24, life: 1.4, dmg, reflected: true, trail: 0, big: dmg >= 6 });
  FX.ring(b.x, b.y, 2, 18, 0.2, '#ffffff'); FX.disc(b.x, b.y, 7, 0.09, '#ffffff');
  FX.hitSparks(b.x, b.y, Math.sign(dx) || 1, 1, A.m, A.l);
}

export function blinkHit(a, b) {
  const p = player, f = Math.sign(b - a) || p.facing, lo = Math.min(a, b) - 1, hi = Math.max(a, b) + 1, A = ACCENT.blink;
  for (const e of enemies) {
    if (!e.alive || e.dying) continue;
    if (e.x > lo && e.x < hi && e.y < p.y + 2.4 && e.y + e.h > p.y - 0.4)
      damageEnemy(e, 3, { src: 'blink', dirX: f, kb: 14, kvy: 3, stun: 0.35, hs: 0.08, shake: 3.5, power: 2, x: e.x, y: e.y + e.h * 0.55, c1: A.m, c2: A.l });
  }
}

/* ------------------------------------------------------------------ player being hit / defending */
export { PERFECT_WINDOW };
export function defendCheck(srcX) {
  const p = player;
  if (!p.shielding) return null;
  if ((srcX - p.x) * p.facing < -0.5) return null;                      // shield only covers the front
  return p.parryT > 0 ? 'parry' : 'block';
}

/* o: { bullet } | { melee: enemy } | { contact: enemy } */
export function hurtPlayer(dmg, srcX, o = {}) {
  const p = player;
  if (p.dead) return 'ignored';
  const def = o.hazard ? null : defendCheck(srcX);                     // the shield does not stop lasers / spikes
  if (def && o.contact) {                                               // body contact into a raised shield: knock apart.
    if (p.blockFlash <= 0) doBlock(o, GUARD.costContact);               // contact is NEVER a parry (R2-001): only bolts / telegraphed melee
    return 'block';
  }
  if (def === 'parry') { doParry(o); return 'parry'; }
  if (def === 'block') { doBlock(o, o.melee ? GUARD.costMelee : GUARD.costBolt); return 'block'; }
  if (p.inv > 0) return 'ignored';

  p.hp -= dmg; p.inv = 1.05; p.hurtT = 0.28; p.flash = 0.14; p.dash = 0; p.shielding = false; p.coyote = 0; p.charging = false;
  cancelSwing();
  const k = p.x >= srcX ? 1 : -1;
  p.vx = k * 7; p.vy = 7; p.onGround = false;
  FX.burst(p.x, p.y + 1.1, 12, '#ff5791', 9);
  FX.disc(p.x, p.y + 1.1, 8, 0.1, '#ffffff');
  Feel.stop(0.08); Feel.kick(4.5, k); Feel.screenFlash(0.32, '#ff2d5f');
  SFX.play('hurt');
  Game.resetCombo();
  HUD.setHealth(p.hp, p.maxhp, true);
  if (p.hp <= 0) killPlayer(k);
  return 'hit';
}

export function killPlayer(k = -player.facing) {
  const p = player;
  if (!p.dead) { Game.onPlayerDeath(); p.deathArena = Game.arena; }
  p.hp = 0; p.dead = true; p.deadT = 0; p.burst = false; p.inv = 99; p.dash = 0; p.shielding = false; p.charging = false;
  cancelSwing();
  p.vx = k * 3; p.vy = 6; p.flash = 0.2;
  HUD.setHealth(0, p.maxhp, false);
  Game.resetCombo();
  Feel.stop(0.12);
}

/* Parry rules (REVIEW R-023): a fresh shield press opens a 0.2 s window; the first 80 ms are PERFECT.
   A successful parry costs no guard (it refunds 1), leaves the window open for at least PARRY_HOLD_AFTER s
   so the rest of a burst can be parried too (those are never perfect), and has no lockout.
   A window that expires without parrying anything = whiff → 0.4 s before the next parry. */
export function doParry(o) {
  const p = player, f = p.facing, A = ACCENT.shield, x = p.x + f * 1.1, y = p.y + 1.05;
  const perfect = p.parryT > PARRY_WINDOW - PERFECT_WINDOW;
  p.parryArmed = false;
  p.parryT = Math.max(p.parryT, PARRY_HOLD_AFTER); p.inv = Math.max(p.inv, 0.35); p.blockFlash = 0.18;
  p.guard = Math.min(GUARD.max, p.guard + 1);
  p.critT = 2.0;                                                         // next blade hit is a CRITICAL
  FX.ring(x, y, 4, perfect ? 52 : 34, 0.28, '#ffffff'); FX.ring(x, y, 2, 22, 0.2, A.m);
  FX.disc(x, y, perfect ? 15 : 11, 0.12, '#ffffff'); FX.burst(x, y, perfect ? 30 : 18, A.l, 13);
  FX.impact(x, y, f, perfect ? 3 : 2, '#ffffff');
  FX.text(perfect ? 'PERFECT PARRY!' : 'PARRY!', p.x, p.y + 2.8, perfect ? '#ffe06b' : '#ffffff', 0.9);
  Feel.stop(0.1); Feel.kick(perfect ? 4.5 : 3.2, -f * 0.5); Feel.screenFlash(perfect ? 0.35 : 0.22, '#d8ccff');
  if (perfect) Feel.slowmo(0.45);
  SFX.play(perfect ? 'parryPerfect' : 'parry');
  if (o.bullet) reflectBullet(o.bullet, perfect ? 6 : 3, A);            // reflect the bolt back at its shooter
  const e = o.melee;
  if (e && e.kind === 'warden' && (e.staggerImmune || 0) > 0) {          // boss: one stagger per STAGGER_IMMUNE s
    e.lungeHit = true; FX.text('RESIST', e.x, e.y + e.h + 0.7, '#c8cbd8', 0.8); p.vx = -f * 8;
  } else if (e) {
    e.kvx = -e.facing * 9; e.stun = 0; setState(e, 'stagger'); e.flash = 0.1; e.lungeHit = true;
    if (e.kind === 'warden') e.staggerImmune = BOSS.staggerImmune;
    FX.text('STAGGER', e.x, e.y + e.h + 0.7, EN.r2, 0.8);
    Feel.stop(0.13); Feel.kick(4.5, f);
  }
}

/* Block: dull, heavy, costs guard. 3 bolt / lunge blocks (6 contacts) empty the meter → GUARD BREAK. */
export function doBlock(o, cost = GUARD.costBolt) {
  const p = player, f = p.facing, A = ACCENT.shield, x = p.x + f * 1.1, y = p.y + 1.05;
  p.blockFlash = 0.14; p.vx -= f * 4;
  p.guard = Math.max(0, p.guard - cost); p.guardIdle = 0;
  FX.hitSparks(x, y, -f, 0, '#8a7fb8', '#d0c8f0'); FX.ring(x, y, 2, 12, 0.14, A.d);
  Feel.stop(0.04); Feel.kick(1.8, -f * 0.4);
  SFX.play('block');
  if (o.bullet) o.bullet.life = 0;
  if (o.melee && o.melee.state === 'charge') {                         // the Warden charge cannot be blocked (R2-009): guard shatters
    o.melee.lungeHit = true; p.guard = 0; p.vx = -f * 9; p.vy = 6; p.onGround = false; guardBreak(); p.inv = Math.max(p.inv, 0.3);
    return;
  }
  if (o.melee) { const e = o.melee; e.kvx = -e.facing * 7; setState(e, 'recover'); e.lungeHit = true; }
  if (o.contact) {                                                      // knock apart (R-021); never stuns the boss
    const e = o.contact; p.vx = -f * 6;
    if (e.kind !== 'warden') { e.kvx = f * 10; e.stun = Math.max(e.stun, 0.3); }
  }
  if (p.guard <= 0) guardBreak();
}

export function guardBreak() {
  const p = player, f = p.facing, A = ACCENT.shield;
  p.guard = 0; p.guardBreakT = GUARD.breakTime; p.shielding = false; p.parryT = 0; p.parryArmed = false;
  p.vx = -f * 7; p.charging = false;
  cancelSwing();
  FX.text('GUARD BREAK', p.x, p.y + 2.8, '#ff8cbb', 0.9);
  FX.debris(p.x + f * 1.1, p.y + 1.05, 10, [A.m, A.l, '#ffffff'], 7);
  Feel.stop(0.09); Feel.kick(4, -f); Feel.screenFlash(0.25, '#a58bff');
  SFX.play('guardbreak');
}

/* ------------------------------------------------------------------ projectiles */
function bulletBlocked(b) {                                             // street, pit floor, laser walls
  if (b.y < -3) return true;
  if (b.y <= streetTop(b.x) + 0.05 && (b.vy || 0) <= 0) return true;
  const a = Game.arena;
  return !!(a && (b.x < a.x0 || b.x > a.x1));
}
export function updateBullets(dt) {
  const A = ACCENT.cannon;
  for (const b of bullets) {
    b.x += b.vx * dt; b.y += (b.vy || 0) * dt; b.life -= dt; b.trail -= dt;
    if (b.life > 0 && bulletBlocked(b)) { b.life = 0; FX.hitSparks(b.x, Math.max(b.y, 0.1), -Math.sign(b.vx) || 1, 0, A.m, '#ffffff'); FX.disc(b.x, Math.max(b.y, 0.1), 4, 0.06, '#ffffff'); continue; }
    if (b.trail <= 0) { const sp = Math.hypot(b.vx, b.vy || 0) || 1; b.trail = 0.018; FX.add(PT.CHIP, b.x - b.vx / sp * 0.5, b.y - (b.vy || 0) / sp * 0.5, 0, 0, 0.14, b.reflected ? '#ece4ff' : '#ffb347', { sz: 1 }); }
    for (const e of enemies) {
      if (!e.alive || e.dying || b.life <= 0 || (b.hits && b.hits.includes(e.id))) continue;
      const h = hurtbox(e), pad = b.big ? 0.5 : 0.3;
      if (b.x > h.x0 - pad && b.x < h.x1 + pad && b.y > h.y0 - pad && b.y < h.y1 + pad) {
        const dir = Math.sign(b.vx) || 1;
        if (b.pierce) {                                                  // charged lance: passes through, hits each enemy once
          b.hits.push(e.id);
          damageEnemy(e, b.dmg, { src: 'lance', dirX: dir, kb: 14, kvy: 2, stun: 0.4, hs: 0.08, shake: 4, power: 3, x: b.x, y: b.y, c1: A.m, c2: '#ffffff' });
          FX.ring(b.x, b.y, 3, 20, 0.18, '#ffffff'); SFX.play('bolt');
          continue;
        }
        const c1 = b.reflected ? '#ffffff' : A.m, c2 = b.reflected ? ACCENT.blade.l : A.l;
        damageEnemy(e, b.dmg, { src: b.reflected ? 'reflect' : 'bullet', dirX: dir, kb: b.reflected ? 10 : 5, stun: b.reflected ? 0.3 : 0.15, hs: b.reflected ? 0.07 : 0.03, shake: b.reflected ? 3 : 1.5, power: b.reflected ? 2 : 1, x: b.x, y: b.y, c1, c2 });
        FX.ring(b.x, b.y, 2, 12, 0.14, c2);
        b.life = 0; SFX.play('bolt');
      }
    }
  }
  filterInPlace(bullets, b => b.life > 0);

  const p = player;
  for (const b of enemyBullets) {
    b.x += b.vx * dt; b.y += (b.vy || 0) * dt; b.life -= dt;
    if (b.wave && Math.random() < dt * 30) FX.add(PT.CHIP, b.x, 0.1, rnd(-1, 1), rnd(1, 4), 0.25, '#ff6a5a', { g: 14, sz: 1 });
    if (b.life > 0 && Math.abs(b.x - p.x) < 0.7 && Math.abs(b.y - (p.y + 1)) < 0.95) {
      const r = hurtPlayer(b.dmg, b.x - Math.sign(b.vx) * 0.5, { bullet: b });
      if (r === 'hit') b.life = 0;                                      // 'ignored' (i-frames) lets the bolt pass through
    }
  }
  filterInPlace(enemyBullets, b => b.life > 0);
}

export function updateDebugBoxes(dt) { for (let i = dbgBoxes.length - 1; i >= 0; i--) { dbgBoxes[i].t -= dt; if (dbgBoxes[i].t <= 0) dbgBoxes.splice(i, 1); } }
