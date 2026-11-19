import { CHIP_ORDER, cycleChipDir, swapWeapon, switchChip } from '../chips/chips.js';
import { updateBullets, updateDebugBoxes } from '../combat/combat.js';
import { Feel } from '../combat/feel.js';
import { SFX } from './audio.js';
import { clearPressed, pollGamepad } from './input.js';
import { Save } from './save.js';
import { S, bullets, enemies, enemyBullets } from './state.js';
import { $, PPU, clamp, rnd } from './util.js';
import { FX } from '../effects/fx.js';
import { resetArenas, spawnEnemies, totalEnemies, updateArenas, updateEnemies } from '../enemies/enemies.js';
import { DECOR, EXIT_X, WORLD_W } from '../levels/stage1.js';
import { checkWorldTriggers, player, resetPlayer, updatePlayer } from '../player/player.js';
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
  addCombo() { this.combo++; this.comboT = 2.2; if (this.combo > this.bestCombo) this.bestCombo = this.combo; },
  resetCombo() { this.combo = 0; this.comboT = 0; },

  restart() {
    SFX.init();
    clearPressed(); resetClock();                              // drop presses made on the title screen / pause
    resetPlayer(); spawnEnemies();
    bullets.length = 0; enemyBullets.length = 0; FX.reset();
    this.kills = 0; this.combo = 0; this.comboT = 0; this.bestCombo = 0; this.runTime = 0; this.lead = 0; Feel.slowT = 0;
    resetArenas(); HUD.setBoss(null);
    HUD.setActive('blade', false); HUD.setUnlocked(player.unlocked); HUD.setHealth(player.hp, player.maxhp, false);
    HUD.setKills(0, totalEnemies());
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
    clearPressed();                                                   // nothing pressed during pause fires on resume (R-013)
    if (this.paused) { HUD.toast('PAUSED', '#8ea3c4', 9999); SFX.stopMusic(); } else { HUD.toast('', '#8ea3c4', 0.01); SFX.startMusic(); }
  },
  complete() {
    this.running = false;
    SFX.play('win'); SFX.stopMusic();
    const t = Math.floor(this.runTime), time = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    Save.recordRun({ time: this.runTime, kills: this.kills, combo: this.bestCombo }); Save.reachStage(this.stage + 1);
    HUD.showOverlay('complete', { message: 'EXTRACTION COMPLETE — YOU REWROTE THE SYSTEM', kills: this.kills, total: totalEnemies(), chips: player.unlocked.size, time, bestCombo: this.bestCombo });
  },
  snapCamera() { updateCamera(1, true); },
  arena: null, stage: 0, alpha: 0, ticks: 0,
  get totalEnemies() { return totalEnemies(); },
  loadStage(i) { if (i !== 0) return false; this.stage = 0; this.restart(); return true; },   // stub: one stage for now
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

/* =====================================================================
   FIXED-STEP SIMULATION (REVIEW R-014). The sim always advances in TICK
   steps; real frame time feeds an accumulator. Feel timers (hit-stop, shake,
   flash, slow-mo) run on real time:
     - hit-stop eats real time; the leftover of the frame that ends it is
       carried into the accumulator (R-030), so it always ends exactly
     - perfect-parry slow-mo scales the time fed to the accumulator
   `advance(realDt)` is one rendered frame; NS.step(n, dt) calls it n times.
   Game.alpha = accumulator fraction for render interpolation (prevX/prevY).
   ===================================================================== */
export const TICK = 1 / 120;
export const MAX_TICKS_PER_FRAME = 8;                       // below ~15 fps the game slows down instead of exploding
let acc = 0;
export function resetClock() { acc = 0; Game.alpha = 0; }

export function tick(dt) {
  Game.ticks++;
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
  for (const d of DECOR) {                                              // street steam
    if (d.type === 'vent' && Math.abs(d.x - view.camX) < 18 && Math.random() < dt * 3)
      FX.puff(d.x + rnd(-0.3, 0.3), 0.5, rnd(-0.3, 0.3), rnd(1.2, 2.2), rnd(0.5, 0.9), '#7f93bd', rnd(2, 3.5));
  }
  updateCamera(dt, false);
}

export function advance(realDt) {
  Game.time += realDt;
  HUD.update(realDt);
  pollGamepad();

  if (!Game.running) {                                                 // title / results: slow cinematic pan
    view.camX = 14 + Math.sin(Game.time * 0.12) * 10; view.camY = 0;
    Feel.updateScreen(realDt);
    return;
  }
  if (Game.paused) return;

  Feel.updateScreen(realDt);
  let t = realDt;
  if (Feel.hitstop > 0) {                                              // HIT-STOP: sim frozen, loop keeps running
    Feel.hitstop -= t;
    if (Feel.hitstop > 0) { syncHud(); return; }
    t = -Feel.hitstop; Feel.hitstop = 0;                               // carry the leftover
  }
  if (Feel.slowT > 0) { const s = Math.min(Feel.slowT, t); Feel.slowT -= s; t = s * Feel.slowScale + (t - s); }
  acc += t;
  let n = 0;
  while (acc >= TICK - 1e-9 && n < MAX_TICKS_PER_FRAME) {
    acc -= TICK; n++;
    tick(TICK);
    if (!Game.running || Feel.hitstop > 0) break;                      // a hit-stop started: keep the rest of acc for later
  }
  if (n >= MAX_TICKS_PER_FRAME) acc = Math.min(acc, TICK);
  if (acc < 0) acc = 0;
  Game.alpha = acc / TICK;
  syncHud();
}
export const update = advance;                                         // legacy name (NS.step, old callers)

function syncHud() {
  HUD.setCombo(Game.combo, Game.comboT / 2.2);
  for (const id of CHIP_ORDER) HUD.setCooldown(id, player.cdMax[id] > 0 ? clamp(player.cd[id] / player.cdMax[id], 0, 1) : 0);
  HUD.setLive('shield', player.shielding); HUD.setLive('blink', player.warpU > 0);
  const boss = Game.arena && Game.arena.boss ? enemies.find(e => e.kind === 'warden' && e.alive) : null;
  HUD.setBoss(boss);
  HUD.setProgress(clamp(Math.round(player.x / 139 * 100), 0, 100));
}

let lastT = 0, dbgT = 0;
export function frame(t) {
  requestAnimationFrame(frame);
  Game.frames++;
  if (!lastT) lastT = t;
  const raw = Math.max(0.0001, (t - lastT) / 1000); lastT = t;
  const dt = Math.min(0.1, raw);
  Game.fps += (1 / raw - Game.fps) * 0.05;
  if (!Game.freeze) { try { advance(dt); } catch (err) { console.error('NEON//SHIFT simulation error:', err); Game.simError = err; } }
  try {
    if (Game.viewer) drawViewer(); else renderFrame();
    if ($('overlay').style.display !== 'none') drawHero();
  } catch (err) { console.error('NEON//SHIFT render error:', err); Game.simError = err; }
  dbgT -= raw;
  if (dbgT <= 0) { dbgT = 0.25; HUD.debug({ fps: Math.round(Game.fps), pos: player.x.toFixed(1), vel: player.vx.toFixed(1), frames: Game.frames, hs: Feel.hitstop.toFixed(2), fx: FX.live }); }
}
