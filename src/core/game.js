import { CHIP_ORDER, cycleChipDir, swapWeapon, switchChip } from '../chips/chips.js';
import { updateBullets, updateDebugBoxes } from '../combat/combat.js';
import { Feel } from '../combat/feel.js';
import { SFX } from './audio.js';
import { pollGamepad, pressed } from './input.js';
import { S, bullets, enemies, enemyBullets } from './state.js';
import { $, PPU, clamp, rnd } from './util.js';
import { FX } from '../effects/fx.js';
import { resetArenas, spawnEnemies, updateArenas, updateEnemies } from '../enemies/enemies.js';
import { DECOR, EXIT_X, WORLD_W } from '../levels/stage1.js';
import { checkWorldTriggers, nudge, player, resetPlayer, updatePlayer } from '../player/player.js';
import { drawHero, drawViewer, renderFrame, view } from '../render/render.js';
import { HUD } from '../ui/hud.js';

/* =====================================================================
   Game loop + glue. Fixed-order update:
     input → player → world triggers → enemies → projectiles → fx → camera
   Hit-stop freezes everything except screen shake / HUD, then resumes.
   ===================================================================== */
export const Game = {
  running: false, paused: false, freeze: false, time: 0, runTime: 0, frames: 0, fps: 60,
  kills: 0, combo: 0, comboT: 0, bestCombo: 0, showBoxes: false, lead: 0, viewer: null, simError: null,

  focus() { try { S.gameEl.focus({ preventScroll: true }); } catch { S.gameEl.focus(); } },
  selectChip(id) { if (id && this.running && !this.paused) switchChip(id); },
  cycleChip(d) { if (this.running && !this.paused) cycleChipDir(d); },
  swapWeapon() { if (this.running && !this.paused) swapWeapon(); },
  moveNudge(d, amt) { nudge(d, amt); },
  addCombo() { this.combo++; this.comboT = 2.2; if (this.combo > this.bestCombo) this.bestCombo = this.combo; },
  resetCombo() { this.combo = 0; this.comboT = 0; },

  restart() {
    SFX.init();
    pressed.jump = pressed.dash = pressed.attack = false;     // drop presses made on the title screen
    resetPlayer(); spawnEnemies();
    bullets.length = 0; enemyBullets.length = 0; FX.reset();
    this.kills = 0; this.combo = 0; this.comboT = 0; this.bestCombo = 0; this.runTime = 0; this.lead = 0; Feel.slowT = 0;
    resetArenas(); HUD.setBoss(null);
    HUD.setActive('blade', false); HUD.setUnlocked(player.unlocked); HUD.setHealth(player.hp, player.maxhp, false);
    HUD.setKills(0, enemies.length);
    HUD.hideOverlay();
    this.running = true; this.paused = false;
    this.snapCamera();
    HUD.toast('MISSION START // FIND THE CHIPS', '#2fe6ff');
    HUD.hint('[J] SLASH ×3 COMBO  ·  [W] JUMP ×2  ·  [SHIFT] DASH — attack out of a dash to cancel it', '#d6fdff', 8);
    SFX.startMusic();
    this.focus();
  },
  togglePause() {
    if (!this.running) return;
    this.paused = !this.paused;
    if (this.paused) { HUD.toast('PAUSED', '#8ea3c4', 9999); SFX.stopMusic(); } else { HUD.toast('', '#8ea3c4', 0.01); SFX.startMusic(); }
  },
  complete() {
    this.running = false;
    SFX.play('win'); SFX.stopMusic();
    const t = Math.floor(this.runTime), time = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    HUD.showOverlay('complete', { message: 'EXTRACTION COMPLETE — YOU REWROTE THE SYSTEM', kills: this.kills, total: enemies.length, chips: player.unlocked.size, time, bestCombo: this.bestCombo });
  },
  snapCamera() { updateCamera(1, true); },
  arena: null,
  get slowT() { return Feel.slowT; }, set slowT(v) { Feel.slowT = v; },   // timer lives in combat/feel.js
  slowmo(t) { Feel.slowmo(t); },
};

export function updateCamera(dt, snap) {
  const viewW = view.W / PPU, p = player;
  Game.lead += (p.facing * viewW * 0.1 - Game.lead) * Math.min(1, dt * 4);
  let tx = p.x + Game.lead + (p.dash > 0 ? p.facing * 1.2 : 0);
  tx = clamp(tx, viewW / 2 - 3, WORLD_W - viewW / 2 + 2);
  const ty = Math.max(0, (p.y - 2.5) * 0.55);
  if (!Number.isFinite(tx)) tx = p.x;
  const k = snap ? 1 : Math.min(1, dt * 11), ky = snap ? 1 : Math.min(1, dt * 5);
  view.camX += (tx - view.camX) * k; view.camY += (ty - view.camY) * ky;
}

export function update(dt) {
  Game.time += dt;
  HUD.update(dt);
  pollGamepad();

  if (!Game.running) {                                                 // title / results: slow cinematic pan
    view.camX = 14 + Math.sin(Game.time * 0.12) * 10; view.camY = 0;
    Feel.updateScreen(dt);
    return;
  }
  if (Game.paused) return;

  Feel.updateScreen(dt);
  if (Feel.hitstop > 0) { Feel.hitstop -= dt; return; }                    // HIT-STOP: sim frozen, loop keeps running
  if (Feel.slowT > 0) { Feel.slowT -= dt; dt *= 0.3; }                  // perfect-parry slow motion

  Game.runTime += dt;
  updatePlayer(dt);
  if (!player.dead) {
    checkWorldTriggers();
    if (player.x >= EXIT_X) { Game.complete(); return; }
  }
  updateEnemies(dt);
  updateArenas(dt);
  updateBullets(dt);
  FX.update(dt);
  updateDebugBoxes(dt);

  if (Game.combo > 0) { Game.comboT -= dt; if (Game.comboT <= 0) Game.resetCombo(); }
  HUD.setCombo(Game.combo, Game.comboT / 2.2);
  for (const id of CHIP_ORDER) HUD.setCooldown(id, player.cdMax[id] > 0 ? clamp(player.cd[id] / player.cdMax[id], 0, 1) : 0);
  HUD.setLive('shield', player.shielding); HUD.setLive('blink', player.warpU > 0);
  const boss = Game.arena && Game.arena.boss ? enemies.find(e => e.kind === 'warden' && e.alive) : null;
  HUD.setBoss(boss);
  HUD.setProgress(clamp(Math.round(player.x / 139 * 100), 0, 100));

  for (const d of DECOR) {                                              // street steam
    if (d.type === 'vent' && Math.abs(d.x - view.camX) < 18 && Math.random() < dt * 3)
      FX.puff(d.x + rnd(-0.3, 0.3), 0.5, rnd(-0.3, 0.3), rnd(1.2, 2.2), rnd(0.5, 0.9), '#7f93bd', rnd(2, 3.5));
  }
  updateCamera(dt, false);
}

export let lastT = 0, dbgT = 0;
export function frame(t) {
  requestAnimationFrame(frame);
  Game.frames++;
  if (!lastT) lastT = t;
  const raw = Math.max(0.0001, (t - lastT) / 1000); lastT = t;
  const dt = Math.min(0.033, raw);
  Game.fps += (1 / raw - Game.fps) * 0.05;
  if (!Game.freeze) { try { update(dt); } catch (err) { console.error('NEON//SHIFT simulation error:', err); Game.simError = err; } }
  try {
    if (Game.viewer) drawViewer(); else renderFrame();
    if ($('overlay').style.display !== 'none') drawHero();
  } catch (err) { console.error('NEON//SHIFT render error:', err); Game.simError = err; }
  dbgT -= raw;
  if (dbgT <= 0) { dbgT = 0.25; HUD.debug({ fps: Math.round(Game.fps), pos: player.x.toFixed(1), vel: player.vx.toFixed(1), frames: Game.frames, hs: Feel.hitstop.toFixed(2), fx: FX.live }); }
}
