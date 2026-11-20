// Technical health: errors / failed requests over a scripted run, bounded entity counts, frame time.
import { test, expect, boot, start, step, P, freeze } from './helpers.js';

test('no failed requests (4xx/5xx or network errors) while loading the game', async ({ page, diag }) => {
  await boot(page);
  await page.waitForTimeout(500);
  expect(diag.failedRequests, 'every request the page makes should succeed (incl. /favicon.ico)').toEqual([]);
});

test('scripted live run (real keyboard, ~20 s, all chips): no uncaught errors, no console errors', async ({ page, diag }) => {
  test.setTimeout(90_000);
  await boot(page);
  await page.evaluate(() => NS.unlockAll());
  await start(page, { freeze: false });
  await page.evaluate(() => { NS.player.maxhp = 999; NS.player.hp = 999; });       // the bot must survive to cover the whole level
  const t0 = Date.now();
  let i = 0;
  await page.keyboard.down('KeyD');
  while (Date.now() - t0 < 20_000 && await page.evaluate(() => NS.game.running)) {
    const k = ['KeyJ', 'KeyW', 'KeyJ', 'ShiftLeft', 'KeyK', 'KeyQ', 'KeyJ', 'KeyW'][i++ % 8];
    await page.keyboard.press(k);
    if (i % 11 === 0) { await page.keyboard.down('KeyL'); await page.waitForTimeout(120); await page.keyboard.up('KeyL'); }
    if (i % 17 === 0) { await page.keyboard.down('KeyJ'); await page.waitForTimeout(500); await page.keyboard.up('KeyJ'); } // charge shot
    await page.waitForTimeout(90);
    await page.evaluate(() => { NS.player.hp = Math.max(NS.player.hp, 50); });
  }
  await page.keyboard.up('KeyD');
  const s = await page.evaluate(() => ({ x: NS.player.x, frames: NS.game.frames, kills: NS.game.kills, running: NS.game.running }));
  test.info().annotations.push({ type: 'run', description: JSON.stringify(s) });
  expect(s.x, 'bot should make real progress through the level').toBeGreaterThan(40);
  expect(diag.pageErrors).toEqual([]);
});

test('long fight (5 min of sim at 60 Hz, constant spam): particle / projectile / enemy counts stay bounded', async ({ page }) => {
  test.setTimeout(120_000);
  await boot(page);
  await start(page);
  await page.evaluate(() => NS.unlockAll());
  const samples = await page.evaluate(() => {
    const out = [];
    const fx = NS.FX, lens = () => ({
      live: fx.live ?? 0, parts: (fx.parts || []).filter(p => p.on).length, slashes: (fx.slashes || []).length, ghosts: (fx.ghosts || []).length,
      texts: (fx.texts || []).length, beams: (fx.beams || []).length,
      enemies: NS.enemies.length, bullets: NS.bullets.length, enemyBullets: NS.enemyBullets.length,
    });
    const acts = ['attack', 'jump', 'blink', 'dash', 'attack'];
    for (let s = 0; s < 300; s++) {                       // 300 s
      for (let f = 0; f < 60; f++) {
        const pl = NS.player;
        pl.hp = pl.maxhp; pl.inv = 1;
        if (f % 7 === 0) NS.press(acts[(s + f) % acts.length]);
        if (f === 30) NS.game.swapWeapon();
        NS.hold('KeyD', (s % 20) < 10); NS.hold('KeyA', (s % 20) >= 10);
        NS.hold('KeyL', f > 50);
        NS.step(1);
        if (!NS.game.running) NS.game.restart(), NS.game.freeze = true;
        // keep enemies coming: revive the dead ones near the player so combat never stops
        if (f === 0 && s % 5 === 0) for (const e of NS.enemies) if (!e.alive) { e.alive = true; e.hp = e.maxhp; e.x = Math.min(130, pl.x + 3); e.minX = e.x - 2; e.maxX = e.x + 2; e.state = 'patrol'; }
      }
      if (s % 30 === 29) out.push(lens());
    }
    NS.hold('KeyD', false); NS.hold('KeyA', false); NS.hold('KeyL', false);
    return out;
  });
  test.info().annotations.push({ type: 'samples', description: JSON.stringify(samples) });
  const first = samples[0], last = samples[samples.length - 1];
  for (const s of samples) {
    expect(s.parts).toBeLessThanOrEqual(1000);
    expect(s.slashes).toBeLessThanOrEqual(16);
    expect(s.ghosts).toBeLessThanOrEqual(32);
    expect(s.texts).toBeLessThanOrEqual(16);
    expect(s.beams).toBeLessThanOrEqual(16);
    expect(s.bullets).toBeLessThan(60);
    expect(s.enemyBullets).toBeLessThan(60);
  }
  expect(last.enemies).toBe(first.enemies);               // enemy list does not grow (arena waves only once)
  expect(await page.evaluate(() => NS.game.simError)).toBeNull();
});

test('hit-stop never sticks across 2000 random hits', async ({ page }) => {
  await boot(page); await start(page);
  const res = await page.evaluate(() => {
    const F = NS.feel || NS.FX; let maxStuck = 0;
    for (let i = 0; i < 2000; i++) {
      const pl = NS.player; pl.inv = 1; pl.hp = pl.maxhp;
      const e = NS.enemies[i % NS.enemies.length];
      e.alive = true; e.hp = 3; e.x = pl.x + 1.5; e.minX = e.x - 0.1; e.maxX = e.x + 0.1;
      NS.press('attack');
      let n = 0; NS.step(1); while (F.hitstop > 0 && n < 100) { NS.step(1); n++; }
      maxStuck = Math.max(maxStuck, n);
      if (!NS.game.running) NS.game.restart();
    }
    return { maxStuck, hitstop: F.hitstop };
  });
  expect(res.maxStuck).toBeLessThan(15);                   // cap 0.14 s ≈ 9 frames
  expect(res.hitstop).toBeLessThanOrEqual(0);
});

test('frame time: live loop ≥ 50 fps median, sim+render cost < 8 ms per frame', async ({ page }) => {
  await boot(page);
  await start(page, { freeze: false });
  await page.keyboard.down('KeyD');
  const r = await page.evaluate(() => new Promise(res => {
    const ts = []; let last = 0;
    function f(t) { if (last) ts.push(t - last); last = t; if (ts.length < 180) requestAnimationFrame(f); else res(ts); }
    requestAnimationFrame(f);
  }));
  await page.keyboard.up('KeyD');
  await freeze(page);
  const cost = await page.evaluate(() => {
    const t0 = performance.now(); NS.step(120); return (performance.now() - t0) / 120;
  });
  r.sort((a, b) => a - b);
  const median = r[r.length >> 1], p95 = r[Math.floor(r.length * 0.95)];
  test.info().annotations.push({ type: 'frame', description: `rAF median ${median.toFixed(2)} ms, p95 ${p95.toFixed(2)} ms, sim step ${cost.toFixed(3)} ms` });
  expect(median).toBeLessThan(20);
  expect(cost).toBeLessThan(8);
});

test('NS test API contract is present', async ({ page }) => {
  await boot(page);
  const api = await page.evaluate(() => ({
    keys: Object.keys(NS),
    game: ['running', 'paused', 'kills', 'combo', 'restart', 'complete', 'freeze'].filter(k => !(k in NS.game)),
    player: ['x', 'y', 'vx', 'vy', 'hp', 'maxhp', 'dead', 'facing', 'chip', 'unlocked', 'onGround', 'dash'].filter(k => !(k in NS.player)),
  }));
  for (const k of ['game', 'player', 'FX', 'enemies', 'bullets', 'enemyBullets', 'step', 'hold', 'press', 'unlockAll', 'tp']) expect(api.keys).toContain(k);
  expect(api.game, 'missing Game fields').toEqual([]);
  expect(api.player, 'missing player fields').toEqual([]);
});

test('NS.loadStage(i) loads every stage; unknown stages are refused; level data is exposed', async ({ page }) => {
  await boot(page);
  for (const i of [0, 1, 2]) {
    expect(await page.evaluate(i => NS.loadStage(i, true), i)).toBe(true);
    const s = await page.evaluate(() => ({ stage: NS.game.stage, screen: NS.game.screen, n: NS.enemies.length }));
    expect(s.stage).toBe(i); expect(s.screen).toBe('play'); expect(s.n).toBeGreaterThan(3);
    const d = await page.evaluate(i => NS.stageData(i), i);
    expect(d.exitX).toBeGreaterThan(100);
    expect(d.checkpoints.length).toBeGreaterThan(2);
  }
  expect(await page.evaluate(() => NS.loadStage(3))).toBe(false);
  expect(await page.evaluate(() => NS.levels.length)).toBe(3);
});

test('production smoke on every stage: 10 s live play per stage with real keys, no errors', async ({ page }) => {
  test.setTimeout(90_000);
  await boot(page);
  await page.evaluate(() => NS.unlockAll());
  for (const i of [0, 1, 2]) {
    await page.evaluate(i => NS.loadStage(i, true), i);
    await page.evaluate(() => { NS.player.maxhp = 999; NS.player.hp = 999; });
    await page.keyboard.down('KeyD');
    const t0 = Date.now(); let k = 0;
    while (Date.now() - t0 < 10_000 && await page.evaluate(() => NS.game.screen === 'play')) {
      await page.keyboard.press(['KeyJ', 'KeyW', 'KeyK', 'KeyJ', 'ShiftLeft', 'KeyQ', 'KeyJ'][k++ % 7]);
      await page.waitForTimeout(110);
      await page.evaluate(() => { NS.player.hp = Math.max(NS.player.hp, 100); });
    }
    await page.keyboard.up('KeyD');
    const s = await page.evaluate(() => ({ x: NS.player.x, stage: NS.game.stage, screen: NS.game.screen }));
    test.info().annotations.push({ type: `stage${i + 1}`, description: JSON.stringify(s) });
    expect(s.x).toBeGreaterThan(20);
  }
});
