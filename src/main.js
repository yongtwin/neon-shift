import { setGfx } from './art/pixel.js';
import { CHIPS, CHIP_ORDER, SLOTS, syncSlots } from './chips/chips.js';
import { Feel } from './combat/feel.js';
import { FLINCH_MAX, HYPER_ARMOR } from './combat/combat.js';
import { SFX } from './core/audio.js';
import { Game, TICK, advance, frame } from './core/game.js';
import { bindPointer, bindTouchButtons, keys, pad, pressed } from './core/input.js';
import { Save, loadUnlocked } from './core/save.js';
import { S, bullets, enemies, enemyBullets } from './core/state.js';
import { $ } from './core/util.js';
import { FX } from './effects/fx.js';
import { ENEMY_DEF, spawnEnemies, totalEnemies } from './enemies/enemies.js';
import { ANCHOR, BLINK, CANNON, CHARGE_FULL, CHARGE_MIN, GUARD, MOVE, PARRY_WINDOW, PERFECT_WINDOW, SWING, player, resetPlayer } from './player/player.js';
import { Compositor, buildArt, resizeView } from './render/render.js';
import { HUD } from './ui/hud.js';
import { Screens } from './ui/screens.js';
import { STAGES } from './levels/stages.js';
import { HAZARDS } from './levels/stage1.js';
import { validateStage } from './levels/validate.js';
import { laserTimeToOn } from './levels/world.js';
import { BOSS } from './enemies/enemies.js';

/* =====================================================================
   NEON//SHIFT entry point (Vite ES module). Wires DOM + canvases, builds the
   procedural art, exposes the window.NS test hooks and starts the loop.
   ===================================================================== */

/* ------------------------------------------------------------------ boot */
function boot() {
  S.gameEl = $('game'); S.screenEl = $('screen');
  S.screenCtx = S.screenEl.getContext('2d', { alpha: false });
  S.heroCtx = $('hero').getContext('2d'); S.heroCtx.imageSmoothingEnabled = false;
  setGfx(S.screenCtx);
  player.unlocked = loadUnlocked(); syncSlots();
  HUD.init(); FX.init();
  HUD.setUnlocked(player.unlocked); HUD.setActive('blade', false); HUD.setHealth(player.hp, player.maxhp, false);
  buildArt();
  resizeView();
  resetPlayer(); spawnEnemies(); HUD.setKills(0, totalEnemies());
  bindPointer(S.gameEl); bindTouchButtons();
  window.addEventListener('resize', resizeView);
  Screens.init(S.gameEl, Game); Screens.refreshTitle();
  $('start').addEventListener('click', () => Game.newRun(0));
  $('clear').addEventListener('click', () => {
    player.unlocked = new Set(['blade']); Save.setChips(player.unlocked); syncSlots();
    HUD.setUnlocked(player.unlocked); HUD.setActive('blade', false);
    $('save-note').textContent = 'Saved collection reset. Only BLADE is unlocked.';
  });
  S.gameEl.addEventListener('pointerdown', e => { if (!e.target.closest('button')) Game.focus(); });
  if (location.hash === '#sprites') Game.viewer = 'sprites'; else if (location.hash === '#enemies') Game.viewer = 'enemies';
  if (Game.viewer) { $('overlay').style.display = 'none'; $('hud').style.display = 'none'; $('hint').style.display = 'none'; }
  else { HUD.showOverlay('title'); Game.focus(); }
  requestAnimationFrame(frame);
}

/* debug / test hooks (used by the browser test pass; harmless in play) */
window.NS = {
  get game() { return Game; }, player, FX, get enemies() { return enemies; }, get bullets() { return bullets; }, get enemyBullets() { return enemyBullets; },
  /* step(n, dt): n rendered frames of dt seconds each (default 60 Hz); the sim inside runs fixed 1/120 s ticks */
  step(n = 1, dt = 1 / 60) { for (let i = 0; i < n; i++) advance(dt); },
  TICK,
  hold(k, v = true) { keys[k] = v; }, press(k, v = 1) { if (k in pressed) pressed[k] = k === 'tap' ? v : true; },   // 'tap' takes a direction ±1
  pad,                                                    // gamepad-owned input state (cleared on disconnect)
  unlockAll() { for (const c of CHIP_ORDER) player.unlocked.add(c); Save.setChips(player.unlocked); syncSlots(); HUD.setUnlocked(player.unlocked); },
  tp(x, y = 0) { player.x = x; player.y = y; player.vx = 0; player.vy = 0; player.prevX = x; player.prevY = y; player.px = x; player.py = y; Game.snapCamera(); },
  loadStage(i = 0, fresh = false) { return fresh ? Game.newRun(i) : Game.loadStage(i); },   // 0..2; false for an unknown stage
  stageClear(immediate = true) { return Game.stageClear(immediate); },                     // finish the current stage now (tests)
  get boss() { return Game.boss; },
  get stage() { return { index: Game.stage, ...STAGES[Game.stage], hazards: HAZARDS, t: Game.stageT }; },
  STAGES,
  /** per-stage level data (copies of the authored stage, independent of the stage being played) */
  stageData(i) { const s = STAGES[i]; return s ? JSON.parse(JSON.stringify({ id: s.id, name: s.name, worldW: s.worldW, exitX: s.exitX, checkpoints: s.checkpoints, pickups: s.pickups, arenas: s.arenas, spawns: s.spawns, hazards: s.hazards, plats: s.plats })) : null; },
  get levels() { return STAGES.map((_, i) => this.stageData(i)); },
  get renderer() { return Compositor.mode === 'webgl' ? 'webgl' : 'canvas'; },
  validateStage,                                                                           // reachability vs jump physics
  laserTimeToOn: h => laserTimeToOn(h, Game.stageT),
  get screens() { return Screens.open; },
  get feel() { return Feel; },                            // hitstop / shake / shakeX / slowT / log
  get save() { return Save; },                            // data, load(), reset(), wipe(), useMemory(), source
  consts: { BOSS, MOVE, SWING, GUARD, PARRY_WINDOW, PERFECT_WINDOW, CHARGE_MIN, CHARGE_FULL, CANNON, BLINK, ANCHOR, ENEMY_DEF, FLINCH_MAX, HYPER_ARMOR, CHIPS, SLOTS },
  totalEnemies,
};

boot();
window.NS.ready = true;                                                 // Playwright waits on this
