// Shared harness for the NEON//SHIFT regression suite.
// Every test gets: console/page-error capture (fails the test on any uncaught error),
// boot + start helpers, deterministic stepping and state snapshots via window.NS.
import { test as base, expect } from '@playwright/test';

export const DT = 1 / 60;

export const test = base.extend({
  // Collected diagnostics for the current page. Auto fixture: asserts a clean run after every test.
  diag: [async ({ page }, use, testInfo) => {
    const d = { pageErrors: [], consoleErrors: [], failedRequests: [], allowConsole: [] };
    page.on('pageerror', e => d.pageErrors.push(String(e && e.stack || e)));
    page.on('console', m => { if (m.type() === 'error') d.consoleErrors.push(m.text()); });
    page.on('requestfailed', r => d.failedRequests.push(`${r.url()} — ${r.failure()?.errorText}`));
    page.on('response', r => { if (r.status() >= 400) d.failedRequests.push(`${r.url()} — HTTP ${r.status()}`); });
    await use(d);
    let simError = null;
    try { simError = await page.evaluate(() => window.NS && NS.game.simError ? String(NS.game.simError.stack || NS.game.simError) : null); } catch { /* page closed */ }
    // The browser's automatic /favicon.ico probe 404s on the legacy build (reported once as a minor defect by
    // technical.spec.js). Ignore that resource error here so it does not fail every unrelated test.
    const onlyFavicon = d.failedRequests.length > 0 && d.failedRequests.every(r => /favicon\.ico/.test(r));
    const consoleErrors = d.consoleErrors.filter(t => !d.allowConsole.some(rx => rx.test(t))
      && !(onlyFavicon && /Failed to load resource/.test(t)));
    if (d.pageErrors.length || consoleErrors.length || simError) {
      await testInfo.attach('diagnostics', { body: JSON.stringify({ ...d, simError }, null, 2), contentType: 'application/json' });
    }
    expect(d.pageErrors, 'uncaught page errors').toEqual([]);
    expect(consoleErrors, 'console.error output').toEqual([]);
    expect(simError, 'NS.game.simError (exception inside the game loop)').toBeNull();
  }, { auto: true }],
});
export { expect };

/** Navigate to the game and wait until the test API is ready. Optional raw localStorage seed. */
export async function boot(page, { seed } = {}) {
  if (seed) {
    // one-shot: only on the first load of this page, so reload-persistence tests are not overwritten
    await page.addInitScript(([k, v]) => {
      if (!sessionStorage.getItem('__ns_seeded')) { sessionStorage.setItem('__ns_seeded', '1'); localStorage.setItem(k, v); }
    }, seed);
  }
  await page.goto('/');
  await page.waitForFunction(() => window.NS && NS.game && NS.player && typeof NS.step === 'function');
}

/** Start a run the way a player does (mouse click on START), then optionally freeze the live loop. */
export async function start(page, { freeze = true } = {}) {
  await page.locator('#start').click();
  await page.waitForFunction(() => NS.game.running === true);
  if (freeze) await page.evaluate(() => { NS.game.freeze = true; });
}

export const freeze = (page, on = true) => page.evaluate(v => { NS.game.freeze = v; }, on);
export const step = (page, n = 1) => page.evaluate(n => NS.step(n), n);

/** Step n frames, returning the max / min of a player field over the window. */
export async function stepTrack(page, n, field = 'y') {
  return page.evaluate(([n, f]) => {
    let max = -Infinity, min = Infinity;
    for (let i = 0; i < n; i++) { NS.step(1); const v = NS.player[f]; if (v > max) max = v; if (v < min) min = v; }
    return { max, min };
  }, [n, field]);
}

export const P = page => page.evaluate(() => {
  const p = NS.player;
  return { x: p.x, y: p.y, vx: p.vx, vy: p.vy, hp: p.hp, maxhp: p.maxhp, dead: p.dead, facing: p.facing, chip: p.chip,
    onGround: p.onGround, airJumps: p.airJumps, dash: p.dash, dashCd: p.dashCd, atkStep: p.atkStep, comboStep: p.comboStep,
    shielding: p.shielding, parryT: p.parryT, critT: p.critT, checkpoint: p.checkpoint, inv: p.inv, warpU: p.warpU,
    unlocked: [...p.unlocked].sort() };
});

/** Remove every enemy and projectile so movement tests are not disturbed. */
export const clearEnemies = page => page.evaluate(() => {
  for (const e of NS.enemies) e.alive = false;
  NS.bullets.length = 0; NS.enemyBullets.length = 0;
});

/** Keep one enemy (by index), park it at x, make it passive; everything else removed. Returns its id. */
export const isolateEnemy = (page, idx, x) => page.evaluate(([idx, x]) => {
  NS.enemies.forEach((e, i) => { if (i !== idx) e.alive = false; });
  const e = NS.enemies[idx];
  // patrol range ±3 u: tight enough to keep it near x, wide enough not to bounce knockback off a fake wall
  e.x = x; e.y = 0; e.minX = x - 3; e.maxX = x + 3; e.cooldown = 99; e.state = 'patrol'; e.st = 0;
  NS.bullets.length = 0; NS.enemyBullets.length = 0;
  return { id: e.id, hp: e.hp, kind: e.kind };
}, [idx, x]);

/** Fire an enemy bolt at the player from `dx` units in front (positive = in the facing direction). */
export const shootAtPlayer = (page, dx = 2, dmg = 1) => page.evaluate(([dx, dmg]) => {
  const p = NS.player, sx = p.x + p.facing * dx;
  NS.enemyBullets.push({ x: sx, y: p.y + 1, vx: -p.facing * 14, vy: 0, life: 2, dmg, reflected: false, owner: null });
}, [dx, dmg]);

export const shot = (page, name) => page.screenshot({ path: `docs/screenshots/qa/${name}.png` });
