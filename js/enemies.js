'use strict';
/* =====================================================================
   Enemy AI. Every enemy runs the same readable loop so players can react:
     patrol → alert ("!") → windup (glowing telegraph) → attack → recover
   Gunner / Warden shoot (parryable bolts), Enforcer lunges (parry = stagger).
   Being hit interrupts a windup (except the armoured Warden) so aggressive
   play suppresses enemy fire.
   ===================================================================== */
let enemies = [];

function makeEnemy(spec, i) {
  const d = ENEMY_DEF[spec.kind], seg = segmentAt(spec.x);
  return {
    id: i, kind: spec.kind, x: spec.x, y: 0, facing: -1, dir: -1, hp: d.hp, maxhp: d.hp, hw: d.hw, h: d.h,
    minX: seg[0] + 1.3, maxX: seg[1] - 1.3, state: 'patrol', st: 0, anim: 'walk', t: i * 0.7, walk: i * 1.3,
    pause: 0, cooldown: 1 + (i % 3) * 0.4, tele: 0, flash: 0, stun: 0, kvx: 0, recoil: 0, muzzle: 0, shake: 0,
    alive: true, shots: 0, shotT: 0, lungeHit: false, lostT: 0, armor: spec.kind === 'warden',
  };
}
function spawnEnemies() { enemies = SPAWNS.map(makeEnemy); }

function enemyShoot(e, speed, yOff, xOff) {
  enemyBullets.push({ x: e.x + e.facing * xOff, y: e.y + yOff, vx: e.facing * speed, life: 2.1, dmg: 1, reflected: false, owner: e });
  e.recoil = 1; e.muzzle = 0.08;
  FX.hitSparks(e.x + e.facing * (xOff + 0.4), e.y + yOff, e.facing, 0, '#ff6a5a', '#ffd27a');
  SFX.play('eshoot');
}

function setState(e, s) { e.state = s; e.st = 0; e.tele = 0; }

function updateEnemy(e, dt) {
  if (!e.alive) return;
  const d = ENEMY_DEF[e.kind], p = player;
  e.t += dt; e.st += dt;
  e.flash = Math.max(0, e.flash - dt); e.recoil = Math.max(0, e.recoil - dt / 0.16); e.muzzle = Math.max(0, e.muzzle - dt);
  e.shake = Math.max(0, e.shake - dt); e.cooldown -= dt;

  if (Math.abs(e.kvx) > 0.15) { e.x = clamp(e.x + e.kvx * dt, e.minX, e.maxX); e.kvx *= Math.exp(-dt * 9); } else e.kvx = 0;

  const dxp = p.x - e.x, dist = Math.abs(dxp), dy = Math.abs(p.y - e.y);
  const sees = !p.dead && dist < d.aggro && dy < d.sight;

  /* contact damage (v0.3 rule) — stunned/staggered enemies are harmless */
  if (!p.dead && dist < 0.95 && dy < 1.6 && e.stun <= 0 && e.state !== 'stagger') hurtPlayer(1, e.x);

  if (e.stun > 0) {                                                      // flinch (hit reaction)
    e.stun -= dt; e.anim = 'hit';
    if (e.stun <= 0) { setState(e, sees ? 'alert' : 'patrol'); e.cooldown = Math.max(e.cooldown, 0.5); }
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
      else if (ready && dist > 2) { setState(e, 'windup'); SFX.play('charge'); }
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
      const dur = e.kind === 'warden' ? 0.7 : e.kind === 'enforcer' ? 0.5 : 0.5;
      e.anim = 'windup'; e.tele = clamp(e.st / dur, 0, 1);
      if (e.tele < 0.65) face();                                           // aim locks late → readable and fair
      if (e.st >= dur) {
        if (e.kind === 'enforcer') { setState(e, 'lunge'); e.lungeHit = false; }
        else { setState(e, 'fire'); e.shots = e.kind === 'warden' ? 3 : 1; e.shotT = 0; }
      }
      break;
    }
    case 'fire': {
      e.anim = 'fire';
      e.shotT -= dt;
      if (e.shots > 0 && e.shotT <= 0) {
        if (e.kind === 'warden') enemyShoot(e, 14.5, 1.5, 1.5); else enemyShoot(e, 13, 1.1, 1.15);
        e.shots--; e.shotT = 0.15;
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

function updateEnemies(dt) { for (const e of enemies) updateEnemy(e, dt); }
