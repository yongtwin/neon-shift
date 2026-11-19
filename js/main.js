'use strict';
/* =====================================================================
   Game loop + glue. Fixed-order update:
     input → player → world triggers → enemies → projectiles → fx → camera
   Hit-stop freezes everything except screen shake / HUD, then resumes.
   ===================================================================== */
const Game = {
  running: false, paused: false, freeze: false, time: 0, runTime: 0, frames: 0, fps: 60,
  kills: 0, combo: 0, comboT: 0, bestCombo: 0, showBoxes: false, lead: 0, viewer: null, simError: null,

  focus() { try { gameEl.focus({ preventScroll: true }); } catch { gameEl.focus(); } },
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
    bullets = []; enemyBullets = []; FX.reset();
    this.kills = 0; this.combo = 0; this.comboT = 0; this.bestCombo = 0; this.runTime = 0; this.lead = 0;
    HUD.setActive('blade', false); HUD.setUnlocked(player.unlocked); HUD.setHealth(player.hp, player.maxhp, false);
    HUD.setKills(0, enemies.length);
    HUD.hideOverlay();
    this.running = true; this.paused = false;
    this.snapCamera();
    HUD.toast('MISSION START // FIND THE CHIPS', '#2fe6ff');
    HUD.hint('[J] SLASH — swing into enemy bolts to DEFLECT them  ·  [W] JUMP ×2  ·  [SHIFT] DASH', '#d6fdff', 8);
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
};

function updateCamera(dt, snap) {
  const viewW = view.W / PPU, p = player;
  Game.lead += (p.facing * viewW * 0.1 - Game.lead) * Math.min(1, dt * 4);
  let tx = p.x + Game.lead + (p.dash > 0 ? p.facing * 1.2 : 0);
  tx = clamp(tx, viewW / 2 - 3, WORLD_W - viewW / 2 + 2);
  const ty = Math.max(0, (p.y - 2.5) * 0.55);
  if (!Number.isFinite(tx)) tx = p.x;
  const k = snap ? 1 : Math.min(1, dt * 11), ky = snap ? 1 : Math.min(1, dt * 5);
  view.camX += (tx - view.camX) * k; view.camY += (ty - view.camY) * ky;
}

function update(dt) {
  Game.time += dt;
  HUD.update(dt);
  pollGamepad();

  if (!Game.running) {                                                 // title / results: slow cinematic pan
    view.camX = 14 + Math.sin(Game.time * 0.12) * 10; view.camY = 0;
    FX.updateScreen(dt);
    return;
  }
  if (Game.paused) return;

  FX.updateScreen(dt);
  if (FX.hitstop > 0) { FX.hitstop -= dt; return; }                    // HIT-STOP: sim frozen, loop keeps running

  Game.runTime += dt;
  updatePlayer(dt);
  if (!player.dead) {
    checkWorldTriggers();
    if (player.x >= EXIT_X) { Game.complete(); return; }
  }
  updateEnemies(dt);
  updateBullets(dt);
  FX.update(dt);
  updateDebugBoxes(dt);

  if (Game.combo > 0) { Game.comboT -= dt; if (Game.comboT <= 0) Game.resetCombo(); }
  HUD.setCombo(Game.combo, Game.comboT / 2.2);
  for (const id of CHIP_ORDER) HUD.setCooldown(id, player.cdMax[id] > 0 ? clamp(player.cd[id] / player.cdMax[id], 0, 1) : 0);
  HUD.setLive('shield', player.shielding); HUD.setLive('blink', player.warpU > 0);
  HUD.setProgress(clamp(Math.round(player.x / 139 * 100), 0, 100));

  for (const d of DECOR) {                                              // street steam
    if (d.type === 'vent' && Math.abs(d.x - view.camX) < 18 && Math.random() < dt * 3)
      FX.puff(d.x + rnd(-0.3, 0.3), 0.5, rnd(-0.3, 0.3), rnd(1.2, 2.2), rnd(0.5, 0.9), '#7f93bd', rnd(2, 3.5));
  }
  updateCamera(dt, false);
}

let lastT = 0, dbgT = 0;
function frame(t) {
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
  if (dbgT <= 0) { dbgT = 0.25; HUD.debug({ fps: Math.round(Game.fps), pos: player.x.toFixed(1), vel: player.vx.toFixed(1), frames: Game.frames, hs: FX.hitstop.toFixed(2), fx: FX.live }); }
}

/* ------------------------------------------------------------------ dev tool: pose sheets (#sprites / #enemies) */
function drawViewer() {
  g = screenCtx; g.globalAlpha = 1; R(0, 0, view.W, view.H, '#1a2038');
  const tm = Game.time;
  const qv = /[?&]v=(\d+),(\d+)/.exec(location.search), vx = qv ? +qv[1] : 0, vy = qv ? +qv[2] : 0;
  g.save(); g.translate(-vx * 58, -vy * 64);
  if (Game.viewer === 'sprites') {
    const poses = [
      ['idle', {}], ['run', { run: 0 }], ['run', { run: 1.2 }], ['run', { run: 2.4 }], ['run', { run: 3.6 }], ['jump', {}], ['fall', {}], ['dash', {}], ['hurt', {}],
      ['idle', { atkStep: 1, atkU: 0.45 }], ['idle', { atkStep: 2, atkU: 0.45 }], ['idle', { atkStep: 3, atkU: 0.55 }],
    ];
    CHIP_ORDER.forEach((chip, r) => poses.forEach((ps, i) => {
      const weapon = r % 2 ? 'cannon' : 'blade';
      const p = Object.assign({ facing: 1, anim: ps[0], t: tm, run: 0, chip: weapon, atkStep: 0, atkU: 0, shieldAmt: r >= 2 ? 0.8 : 0, parryT: 0, blockFlash: 0, recoil: 0, muzzle: weapon === 'cannon' && i === 9 ? 0.1 : 0, xf: 1, rot: 0, warpU: 0, scarf: viewerScarf(ps[0]), hasShield: r >= 2, hasBlink: r >= 1, aim: weapon === 'cannon' ? (i - 6) * 0.25 : 0 }, ps[1]);
      if (weapon !== 'blade' && p.atkStep) { p.atkStep = 0; }
      drawPlayer(p, 34 + i * 58, 58 + r * 64);
    }));
  } else {
    const row = (kind, anims, y) => anims.forEach((a, i) => drawEnemy({ kind, facing: 1, anim: a[0], t: tm, walk: a[1] || 0, flash: 0, tele: a[2] || 0, recoil: 0, muzzle: a[3] || 0 }, 40 + i * 70, y));
    row('gunner', [['idle'], ['walk', 0], ['walk', 1.6], ['alert'], ['windup', 0, 0.7], ['fire', 0, 0, 1], ['hit']], 60);
    row('enforcer', [['idle'], ['walk', 0], ['chase', 1.6], ['windup', 0, 0.7], ['lunge'], ['recover'], ['hit']], 130);
    row('warden', [['idle'], ['walk', 0], ['alert'], ['windup', 0, 0.8], ['fire', 0, 0, 1], ['hit']], 205);
  }
  g.restore();
}
function viewerScarf(anim) {
  const sc = new Float32Array(SCARF_N * 2), run = anim === 'run' || anim === 'dash';
  for (let i = 0; i < SCARF_N; i++) { sc[i * 2] = -4 - i * (run ? 3.1 : 2.6); sc[i * 2 + 1] = -34 + i * (run ? 0.5 : 1.3) + Math.sin(i) * 0.8; }
  return sc;
}

/* ------------------------------------------------------------------ boot */
function boot() {
  gameEl = $('game'); screenEl = $('screen');
  screenCtx = screenEl.getContext('2d', { alpha: false });
  heroCtx = $('hero').getContext('2d'); heroCtx.imageSmoothingEnabled = false;
  g = screenCtx;
  player.unlocked = loadUnlocked(); syncSlots();
  HUD.init(); FX.init();
  HUD.setUnlocked(player.unlocked); HUD.setActive('blade', false); HUD.setHealth(player.hp, player.maxhp, false);
  buildArt();
  resizeView();
  resetPlayer(); spawnEnemies(); HUD.setKills(0, enemies.length);
  bindPointer(gameEl); bindTouchButtons();
  window.addEventListener('resize', resizeView);
  $('start').addEventListener('click', () => Game.restart());
  $('clear').addEventListener('click', () => {
    player.unlocked = new Set(['blade']); saveUnlocked(player.unlocked); syncSlots();
    HUD.setUnlocked(player.unlocked); HUD.setActive('blade', false);
    $('save-note').textContent = 'Saved collection reset. Only BLADE is unlocked.';
  });
  gameEl.addEventListener('pointerdown', e => { if (!e.target.closest('button')) Game.focus(); });
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
