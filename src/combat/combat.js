import { ACCENT, EN } from '../art/art.js';
import { Feel } from './feel.js';
import { SFX } from '../core/audio.js';
import { Game } from '../core/game.js';
import { bullets, enemies, enemyBullets } from '../core/state.js';
import { filterInPlace, rnd } from '../core/util.js';
import { FX, PT } from '../effects/fx.js';
import { setState } from '../enemies/enemies.js';
import { PARRY_WINDOW, player } from '../player/player.js';
import { HUD } from '../ui/hud.js';

/* =====================================================================
   Combat resolution: hit detection, damage, feedback (hit-stop, shake,
   sparks, knockback), parry / block, projectiles and the hit-chain counter.
   One hit per enemy per swing; blade boxes are the same size as the slash FX.
   ===================================================================== */
export const dbgBoxes = [];         // hitboxes shown with F4

export function hurtbox(e) { return { x0: e.x - e.hw, x1: e.x + e.hw, y0: e.y, y1: e.y + e.h }; }

/* ------------------------------------------------------------------ damage to enemies */
export function damageEnemy(e, dmg, o) {
  if (!e.alive) return false;
  if (e.state === 'stagger') dmg += 1;                                  // parried enemies are wide open
  e.hp -= dmg; e.flash = 0.09; e.shake = 0.12;
  e.stun = e.armor || e.state === 'stagger' ? 0 : (o.stun === undefined ? 0.3 : o.stun);
  e.kvx = o.dirX * o.kb * (e.armor ? 0.3 : 1);
  Game.addCombo();
  FX.hitSparks(o.x, o.y, o.dirX, o.power, o.c1, o.c2);
  if (o.power >= 2) for (let i = 0; i < 3; i++) FX.puff(o.x, o.y, o.dirX * rnd(1, 4), rnd(0, 2), 0.25, '#b9c8ee', 2);
  Feel.stop(o.hs); Feel.kick(o.shake, o.dirX);
  SFX.play('hit', o.power);
  if (e.hp <= 0) { killEnemy(e, o); return true; }
  return false;
}

export function killEnemy(e, o) {
  e.alive = false; Game.kills++;
  HUD.setKills(Game.kills, enemies.length);
  const big = e.kind === 'warden', cy = e.y + e.h * 0.5;
  FX.debris(e.x, cy, big ? 24 : 13, [EN.g2, EN.g3, EN.r1, EN.r2, big ? EN.am : EN.g1], big ? 11 : 9);
  FX.disc(e.x, cy, big ? 22 : 14, 0.18, '#ffffff');
  FX.ring(e.x, cy, 4, big ? 60 : 38, 0.3, EN.r2); FX.ring(e.x, cy, 2, big ? 40 : 24, 0.22, '#ffffff');
  FX.burst(e.x, cy, big ? 34 : 20, EN.r2, 13);
  for (let i = 0; i < 5; i++) FX.puff(e.x + rnd(-0.4, 0.4), cy + rnd(-0.4, 0.6), rnd(-2, 2), rnd(1, 3), 0.5, '#4a5570', rnd(3, 5));
  Feel.stop(Math.max(o.hs, big ? 0.14 : 0.1)); Feel.kick(Math.max(o.shake, 3) + (big ? 3 : 1.5), o.dirX);
  Feel.screenFlash(big ? 0.4 : 0.18, '#ffe6c8');
  SFX.play('kill');
  if (Game.kills >= enemies.length) HUD.toast('ALL HOSTILES DOWN — REACH THE PORTAL', '#ffe06b', 2.2);
}

/* ------------------------------------------------------------------ blade / blink */
export function bladeHitCheck(S, step) {
  const p = player, f = p.facing;
  const x0 = f > 0 ? p.x + S.box[0] : p.x - S.box[1], x1 = f > 0 ? p.x + S.box[1] : p.x - S.box[0];
  const y0 = p.y + S.box[2], y1 = p.y + S.box[3];
  dbgBoxes.push({ x0, x1, y0, y1, t: 0.1 });
  if (dbgBoxes.length > 12) dbgBoxes.shift();
  const A = ACCENT.blade;
  for (const e of enemies) {
    if (!e.alive || p.atkHits.includes(e.id)) continue;
    const h = hurtbox(e);
    if (h.x1 > x0 && h.x0 < x1 && h.y1 > y0 && h.y0 < y1) {
      p.atkHits.push(e.id);
      const ix = e.x - f * e.hw * 0.6, iy = e.y + e.h * 0.55, crit = p.critT > 0;
      if (crit) { p.critT = 0; FX.text('CRITICAL!', e.x, e.y + e.h + 0.9, '#ffe06b', 0.8); Feel.screenFlash(0.18, '#fff3b8'); }
      damageEnemy(e, S.dmg + (crit ? 3 : 0), { dirX: f, kb: S.kb * (crit ? 1.5 : 1), hs: S.hs + (crit ? 0.04 : 0), shake: S.shake + (crit ? 3 : 0), power: step === 3 || crit ? 3 : 1, x: ix, y: iy, c1: crit ? '#ffe06b' : A.m, c2: A.l });
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
  const p = player, f = p.facing, lo = Math.min(a, b) - 1, hi = Math.max(a, b) + 1, A = ACCENT.blink;
  for (const e of enemies) {
    if (!e.alive) continue;
    if (e.x > lo && e.x < hi && Math.abs(e.y - p.y) < 2.4)
      damageEnemy(e, 3, { dirX: f, kb: 10, hs: 0.08, shake: 3.5, power: 2, x: e.x, y: e.y + e.h * 0.55, c1: A.m, c2: A.l });
  }
}

/* ------------------------------------------------------------------ player being hit / defending */
export const PERFECT_WINDOW = 0.08;
export function defendCheck(srcX) {
  const p = player;
  if (!p.shielding) return null;
  if ((srcX - p.x) * p.facing < -0.5) return null;                      // shield only covers the front
  return p.parryT > 0 ? 'parry' : 'block';
}

export function hurtPlayer(dmg, srcX, o = {}) {
  const p = player;
  if (p.dead) return 'ignored';
  const def = defendCheck(srcX);
  if (def && !o.bullet && !o.melee) {                                   // plain body contact: absorb quietly, no effect spam
    if (p.blockFlash <= 0) doBlock(o);
    return 'block';
  }
  if (def === 'parry') { doParry(o); return 'parry'; }
  if (def === 'block') { doBlock(o); return 'block'; }
  if (p.inv > 0) return 'ignored';

  p.hp -= dmg; p.inv = 1.05; p.hurtT = 0.28; p.flash = 0.14; p.dash = 0; p.atkStep = 0; p.shielding = false;
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
  p.hp = 0; p.dead = true; p.deadT = 0; p.burst = false; p.inv = 99; p.dash = 0; p.atkStep = 0; p.shielding = false;
  p.vx = k * 3; p.vy = 6; p.flash = 0.2;
  HUD.setHealth(0, p.maxhp, false);
  Game.resetCombo();
  Feel.stop(0.12);
}

export function doParry(o) {
  const p = player, f = p.facing, A = ACCENT.shield, x = p.x + f * 1.1, y = p.y + 1.05;
  const perfect = p.parryT > PARRY_WINDOW - PERFECT_WINDOW;              // first 80 ms of the window
  p.parryT = Math.max(p.parryT, 0.12); p.inv = Math.max(p.inv, 0.35); p.blockFlash = 0.18;
  p.critT = 2.0;                                                         // next blade hit is a CRITICAL
  FX.ring(x, y, 4, perfect ? 52 : 34, 0.28, '#ffffff'); FX.ring(x, y, 2, 22, 0.2, A.m);
  FX.disc(x, y, perfect ? 15 : 11, 0.12, '#ffffff'); FX.burst(x, y, perfect ? 30 : 18, A.l, 13);
  FX.text(perfect ? 'PERFECT PARRY!' : 'PARRY!', p.x, p.y + 2.8, perfect ? '#ffe06b' : '#ffffff', 0.9);
  Feel.stop(0.1); Feel.kick(perfect ? 4.5 : 3.2, -f * 0.5); Feel.screenFlash(perfect ? 0.35 : 0.22, '#d8ccff');
  if (perfect) Game.slowmo(0.45);
  SFX.play('parry');
  if (o.bullet) reflectBullet(o.bullet, perfect ? 6 : 3, A);            // reflect the bolt back at its shooter
  if (o.melee) {
    const e = o.melee;
    e.kvx = -e.facing * 9; e.stun = 0; setState(e, 'stagger'); e.flash = 0.1; e.lungeHit = true;
    FX.text('STAGGER', e.x, e.y + e.h + 0.7, EN.r2, 0.8);
    Feel.stop(0.13); Feel.kick(4.5, f);
  }
}

export function doBlock(o) {
  const p = player, f = p.facing, A = ACCENT.shield, x = p.x + f * 1.1, y = p.y + 1.05;
  p.blockFlash = 0.14; p.vx -= f * 4;
  FX.hitSparks(x, y, -f, 1, A.m, A.l); FX.ring(x, y, 2, 14, 0.16, A.l);
  Feel.stop(0.035); Feel.kick(1.6, -f * 0.4);
  SFX.play('block');
  if (o.bullet) o.bullet.life = 0;
  if (o.melee) { const e = o.melee; e.kvx = -e.facing * 6; setState(e, 'recover'); e.lungeHit = true; }
}

/* ------------------------------------------------------------------ projectiles */
export function updateBullets(dt) {
  const A = ACCENT.cannon;
  for (const b of bullets) {
    b.x += b.vx * dt; b.y += (b.vy || 0) * dt; b.life -= dt; b.trail -= dt;
    if (b.y < -3) b.life = 0;
    if (b.trail <= 0) { const sp = Math.hypot(b.vx, b.vy || 0) || 1; b.trail = 0.018; FX.add(PT.CHIP, b.x - b.vx / sp * 0.5, b.y - (b.vy || 0) / sp * 0.5, 0, 0, 0.14, b.reflected ? '#ece4ff' : '#ffb347', { sz: 1 }); }
    for (const e of enemies) {
      if (!e.alive || b.life <= 0 || (b.hits && b.hits.includes(e.id))) continue;
      const h = hurtbox(e), pad = b.big ? 0.5 : 0.3;
      if (b.x > h.x0 - pad && b.x < h.x1 + pad && b.y > h.y0 - pad && b.y < h.y1 + pad) {
        const dir = Math.sign(b.vx);
        if (b.pierce) {                                                  // charged lance: passes through, hits each enemy once
          b.hits.push(e.id);
          damageEnemy(e, b.dmg, { dirX: dir, kb: 10, hs: 0.08, shake: 4, power: 3, x: b.x, y: b.y, c1: A.m, c2: '#ffffff', stun: 0.4 });
          FX.ring(b.x, b.y, 3, 20, 0.18, '#ffffff'); SFX.play('bolt');
          continue;
        }
        const c1 = b.reflected ? '#ffffff' : A.m, c2 = b.reflected ? ACCENT.blade.l : A.l;
        damageEnemy(e, b.dmg, { dirX: dir, kb: b.reflected ? 8 : 3.5, hs: b.reflected ? 0.07 : 0.03, shake: b.reflected ? 3 : 1.2, power: b.reflected ? 2 : 1, x: b.x, y: b.y, c1, c2, stun: b.reflected ? 0.3 : 0.18 });
        FX.ring(b.x, b.y, 2, 12, 0.14, c2);
        b.life = 0; SFX.play('bolt');
      }
    }
  }
  filterInPlace(bullets, b => b.life > 0);

  for (const b of enemyBullets) {
    b.x += b.vx * dt; b.y += (b.vy || 0) * dt; b.life -= dt;
    if (b.wave && Math.random() < 0.5) FX.add(PT.CHIP, b.x, 0.1, rnd(-1, 1), rnd(1, 4), 0.25, '#ff6a5a', { g: 14, sz: 1 });
    if (b.life > 0 && Math.abs(b.x - player.x) < 0.7 && Math.abs(b.y - (player.y + 1)) < 0.95) {
      const r = hurtPlayer(b.dmg, b.x - Math.sign(b.vx) * 0.5, { bullet: b });
      if (r === 'hit') b.life = 0;                                      // 'ignored' (i-frames) lets the bolt pass through
    }
  }
  filterInPlace(enemyBullets, b => b.life > 0);
}

export function updateDebugBoxes(dt) { for (let i = dbgBoxes.length - 1; i >= 0; i--) { dbgBoxes[i].t -= dt; if (dbgBoxes[i].t <= 0) dbgBoxes.splice(i, 1); } }
