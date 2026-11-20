import { CHIP_ORDER, cycleChipDir, swapWeapon, switchChip } from '../chips/chips.js';
import { updateBullets, updateDebugBoxes } from '../combat/combat.js';
import { Feel } from '../combat/feel.js';
import { SFX } from './audio.js';
import { clearPressed, pollGamepad } from './input.js';
import { Save } from './save.js';
import { S, bullets, enemies, enemyBullets } from './state.js';
import { $, PPU, clamp, rnd } from './util.js';
import { FX } from '../effects/fx.js';
import { bossEnemy, resetArenas, spawnEnemies, totalEnemies, updateArenas, updateEnemies } from '../enemies/enemies.js';
import { DECOR, EXIT_X, WORLD_W, applyStage } from '../levels/stage1.js';
import { STAGES } from '../levels/stages.js';
import { updateHazards } from '../levels/world.js';
import { checkWorldTriggers, player, resetPlayer, updatePlayer } from '../player/player.js';
import { drawHero, drawViewer, onStageLoad, renderFrame, view } from '../render/render.js';
import { HUD } from '../ui/hud.js';
import { Screens } from '../ui/screens.js';

/* =====================================================================
   Game loop + flow. Fixed-order tick:
     player → world triggers → hazards → enemies → arenas → projectiles → fx → camera
   Hit-stop freezes everything except screen shake / HUD, then resumes.

   Flow: title → newRun(i) → loadStage(i) [intro card] → reach the exit portal →
   stageClear (1.6 s card) → next stage … → stage 3 boss death sequence →
   victory screen. Death → respawn at the last checkpoint, full HP (deaths are
   counted, no game over). Pause (Esc / P) and the chip screen (Tab / C) both
   pause the simulation. The highest stage reached persists (title CONTINUE).
   ===================================================================== */
export const Game = {
  running: false, paused: false, freeze: false, time: 0, runTime: 0, frames: 0, fps: 60,
  kills: 0, combo: 0, comboT: 0, bestCombo: 0, showBoxes: false, lead: 0, viewer: null, simError: null,
  arena: null, stage: 0, alpha: 0, ticks: 0, stageT: 0, deaths: 0, stageDeaths: 0, stageKills0: 0, stageTime0: 0,
  transitionT: 0, bossT: 0, victoryShown: false, menu: null,

  focus() { try { S.gameEl.focus({ preventScroll: true }); } catch { S.gameEl.focus(); } },
  selectChip(id) { if (id && this.running && !this.paused) switchChip(id); },
  cycleChip(d) { if (this.running && !this.paused) cycleChipDir(d); },
  swapWeapon() { if (this.running && !this.paused) swapWeapon(); },
  addCombo() { this.combo++; this.comboT = 2.2; if (this.combo > this.bestCombo) this.bestCombo = this.combo; },
  resetCombo() { this.combo = 0; this.comboT = 0; },
  get totalEnemies() { return this.stageKills0 + totalEnemies(); },   // run kills needed for "all down" in this stage (renderer compares Game.kills to it)
  get stageKills() { return this.kills - this.stageKills0; },
  get boss() { return bossEnemy(); },
  /** 'title' | 'play' | 'pause' | 'chips' | 'stageclear' | 'victory' */
  get screen() {
    if (this.victoryShown && !this.running) return 'victory';
    if (!this.running) return 'title';
    if (this.menu === 'chips') return 'chips';
    if (this.paused) return 'pause';
    if (this.transitionT > 0) return 'stageclear';
    return 'play';
  },
  stageName() { const st = STAGES[this.stage]; return st ? `STAGE ${this.stage + 1} · ${st.name}` : ''; },

  /** start a fresh run (title START, PLAY AGAIN, CONTINUE) */
  newRun(i = 0) {
    this.kills = 0; this.bestCombo = 0; this.runTime = 0; this.deaths = 0; this.victoryShown = false;
    return this.loadStage(i);
  },
  restart() { return this.newRun(0); },                       // legacy name (title START button, R key, tests)

  /** load stage i keeping run totals (kills, time, chips) */
  loadStage(i) {
    if (!STAGES[i]) return false;
    SFX.init();
    applyStage(i); this.stage = i;
    try { onStageLoad(S.stage); } catch (err) { console.error('NEON//SHIFT stage art error:', err); }
    Save.reachStage(i);
    clearPressed(); resetClock(); Screens.hideAll();
    resetPlayer(); spawnEnemies();
    bullets.length = 0; enemyBullets.length = 0; FX.reset();
    this.combo = 0; this.comboT = 0; this.lead = 0; Feel.slowT = 0; this.stageT = 0; this.transitionT = 0; this.bossT = 0;
    this.stageDeaths = 0; this.stageKills0 = this.kills; this.stageTime0 = this.runTime;
    resetArenas(); updateHazards(0); HUD.setBoss(null);
    HUD.setActive(player.chip, false); HUD.setUnlocked(player.unlocked); HUD.setHealth(player.hp, player.maxhp, false);
    HUD.setKills(0, totalEnemies());
    HUD.hideOverlay();
    this.running = true; this.paused = false; this.menu = null;
    this.snapCamera();
    Screens.stageIntro(STAGES[i], i);
    const hints = [
      '[J] SLASH ×3 COMBO  ·  [W] JUMP ×2  ·  [SHIFT] DASH — attack out of a dash to cancel it',
      'hold [L] to guard (3 blocks) · tap [L] as a bolt lands to PARRY it back · lasers: wait for the gap',
      'turrets shrug off the blade — [Q] cannon or parry their bolts · BLINK [K] through laser gates',
    ];
    HUD.hint(hints[i] || hints[0], '#d6fdff', 8);
    SFX.startMusic();
    this.focus();
    return true;
  },
  restartStage() { this.kills = this.stageKills0; this.runTime = this.stageTime0; return this.loadStage(this.stage); },

  /** the exit portal was reached (or NS.stageClear()) */
  stageClear(immediate = false) {
    if (!this.running || this.transitionT > 0) return false;
    const st = STAGES[this.stage], last = this.stage >= STAGES.length - 1;
    Save.reachStage(Math.min(this.stage + 1, STAGES.length - 1));
    SFX.play('win');
    if (last) { this.victory(); return true; }
    if (immediate) return this.loadStage(this.stage + 1);
    Screens.stageClear(st, this.stage, { stageTime: this.runTime - this.stageTime0, kills: this.kills - this.stageKills0, deaths: this.stageDeaths });
    this.transitionT = 1.6;
    return true;
  },
  /** called by the boss death sequence */
  bossDefeated() { HUD.setBoss(null); this.bossT = 2.2; HUD.toast('WARDEN DESTROYED', '#ffe06b', 2); },
  victory() {
    if (this.victoryShown) return;
    this.victoryShown = true; this.running = false; this.paused = false;
    SFX.stopMusic();
    Save.recordRun({ time: this.runTime, kills: this.kills, combo: this.bestCombo });
    HUD.setBoss(null);
    Screens.showVictory({ time: this.runTime, kills: this.kills, bestCombo: this.bestCombo, chips: player.unlocked.size, deaths: this.deaths, bestTime: Save.data.best.time });
  },
  complete() { return this.stageClear(); },                     // legacy name
  onPlayerDeath() { this.deaths++; this.stageDeaths++; },

  togglePause() {
    if (!this.running) return;
    if (this.menu === 'chips') { this.toggleChips(); return; }
    this.paused = !this.paused; this.menu = this.paused ? 'pause' : null;
    clearPressed();                                                   // nothing pressed during pause fires on resume (R-013)
    Screens.showPause(this.paused);
    if (this.paused) SFX.stopMusic(); else { SFX.startMusic(); this.focus(); }
  },
  toggleChips() {
    if (!this.running) return;
    clearPressed();
    if (this.menu === 'chips') { Screens.showChips(false); this.menu = null; this.paused = false; SFX.startMusic(); this.focus(); return; }
    Screens.showPause(false); Screens.showChips(true); this.menu = 'chips'; this.paused = true; SFX.stopMusic();
  },
  quitToTitle() {
    this.running = false; this.paused = false; this.victoryShown = false; this.menu = null; this.transitionT = 0; this.bossT = 0;
    Screens.hideAll(); SFX.stopMusic(); HUD.setBoss(null);
    HUD.showOverlay('title'); Screens.refreshTitle();
  },
  snapCamera() { updateCamera(1, true); },
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
  Game.runTime += dt; Game.stageT += dt;
  updatePlayer(dt);
  if (!player.dead) {
    checkWorldTriggers();
    if (player.x >= EXIT_X && !Game.arena && Game.transitionT <= 0) { Game.stageClear(); return; }
  }
  updateHazards(Game.stageT);
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
  HUD.update(realDt); Screens.tick(realDt);
  pollGamepad();

  if (!Game.running) {                                                 // title / results: slow cinematic pan
    view.camX = 14 + Math.sin(Game.time * 0.12) * 10; view.camY = 0;
    Feel.updateScreen(realDt);
    return;
  }
  if (Game.paused) return;

  if (Game.transitionT > 0) {                                          // stage-clear card, then the next stage
    Game.transitionT -= realDt; Feel.updateScreen(realDt);
    if (Game.transitionT <= 0) Game.loadStage(Game.stage + 1);
    return;
  }
  if (Game.bossT > 0) { Game.bossT -= realDt; if (Game.bossT <= 0) { Game.stageClear(); return; } }
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
  HUD.setProgress(clamp(Math.round(player.x / EXIT_X * 100), 0, 100));
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
