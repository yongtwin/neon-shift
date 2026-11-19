import { setGfx } from './art/pixel.js';
import { CHIP_ORDER, syncSlots } from './chips/chips.js';
import { SFX } from './core/audio.js';
import { Game, frame, update } from './core/game.js';
import { bindPointer, bindTouchButtons, keyName, keys, pressed } from './core/input.js';
import { loadUnlocked, saveUnlocked } from './core/save.js';
import { S, bullets, enemies, enemyBullets } from './core/state.js';
import { $ } from './core/util.js';
import { FX } from './effects/fx.js';
import { spawnEnemies } from './enemies/enemies.js';
import { player, resetPlayer } from './player/player.js';
import { buildArt, resizeView } from './render/render.js';
import { HUD } from './ui/hud.js';

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
  resetPlayer(); spawnEnemies(); HUD.setKills(0, enemies.length);
  bindPointer(S.gameEl); bindTouchButtons();
  window.addEventListener('resize', resizeView);
  $('start').addEventListener('click', () => Game.restart());
  $('clear').addEventListener('click', () => {
    player.unlocked = new Set(['blade']); saveUnlocked(player.unlocked); syncSlots();
    HUD.setUnlocked(player.unlocked); HUD.setActive('blade', false);
    $('save-note').textContent = 'Saved collection reset. Only BLADE is unlocked.';
  });
  S.gameEl.addEventListener('pointerdown', e => { if (!e.target.closest('button')) Game.focus(); });
  window.addEventListener('keydown', e => { if (keyName(e) === 'KeyN') HUD.toast(SFX.toggleMusic() ? 'MUSIC ON' : 'MUSIC OFF', '#8ea3c4', 1); });
  if (location.hash === '#sprites') Game.viewer = 'sprites'; else if (location.hash === '#enemies') Game.viewer = 'enemies';
  if (Game.viewer) { $('overlay').style.display = 'none'; $('hud').style.display = 'none'; $('hint').style.display = 'none'; }
  else { HUD.showOverlay('title'); Game.focus(); }
  requestAnimationFrame(frame);
}

/* debug / test hooks (used by the browser test pass; harmless in play) */
window.NS = {
  get game() { return Game; }, player, FX, get enemies() { return enemies; }, get bullets() { return bullets; }, get enemyBullets() { return enemyBullets; },
  step(n = 1, dt = 1 / 60) { for (let i = 0; i < n; i++) update(dt); },
  hold(k, v = true) { keys[k] = v; }, press(k) { if (k in pressed) pressed[k] = true; },
  unlockAll() { for (const c of CHIP_ORDER) player.unlocked.add(c); saveUnlocked(player.unlocked); syncSlots(); HUD.setUnlocked(player.unlocked); },
  tp(x, y = 0) { player.x = x; player.y = y; player.vx = 0; player.vy = 0; Game.snapCamera(); },
};

boot();
window.NS.ready = true;                                                 // Playwright waits on this
