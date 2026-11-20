// Game flow: title → run → checkpoints / death / respawn → completion; pause; restart.
import { test, expect, boot, start, step, P, clearEnemies, shootAtPlayer, freeze } from './helpers.js';

test('title screen shows, START begins a run and hides the overlay', async ({ page }) => {
  await boot(page);
  await expect(page.locator('#overlay')).toBeVisible();
  await expect(page.locator('#start')).toBeVisible();
  expect(await page.evaluate(() => NS.game.running)).toBe(false);
  await start(page, { freeze: false });
  await expect(page.locator('#overlay')).toBeHidden();
  const p = await P(page);
  expect(p.hp).toBe(p.maxhp);
  expect(p.dead).toBe(false);
  // gameplay keys reach the game right after the mouse click on START (focus is not stuck on the button)
  const x0 = p.x;
  await page.keyboard.down('KeyD'); await page.waitForTimeout(400); await page.keyboard.up('KeyD');
  expect((await P(page)).x).toBeGreaterThan(x0 + 1);
});

test('pressing Space / Enter on the focused START button does not double-start or eat input', async ({ page }) => {
  await boot(page);
  await page.locator('#start').focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => NS.game.running);
  await freeze(page);
  await clearEnemies(page);
  await page.keyboard.press('Space');                      // must be a jump, not another click on START
  await step(page, 10);
  const p = await P(page);
  expect(p.y).toBeGreaterThan(0.3);
  await expect(page.locator('#overlay')).toBeHidden();
});

test('checkpoint is recorded when passed', async ({ page }) => {
  await boot(page); await start(page); await clearEnemies(page);
  await page.evaluate(() => NS.tp(41.5, 0));
  await page.keyboard.down('KeyD'); await step(page, 20); await page.keyboard.up('KeyD');
  expect((await P(page)).checkpoint).toBe(42);
});

test('death → respawn at the last checkpoint with full HP, input still works', async ({ page }) => {
  await boot(page); await start(page); await clearEnemies(page);
  await page.evaluate(() => NS.tp(41.5, 0));
  await page.keyboard.down('KeyD'); await step(page, 20); await page.keyboard.up('KeyD');
  await page.evaluate(() => { NS.tp(55, 0); NS.player.inv = 0; NS.player.facing = 1; });   // die well past the checkpoint
  await shootAtPlayer(page, 1.5, 99);
  await step(page, 10);
  expect((await P(page)).dead).toBe(true);
  let p;
  for (let i = 0; i < 20; i++) { await step(page, 10); p = await P(page); if (!p.dead) break; }
  expect(p.dead).toBe(false);
  expect(p.hp).toBe(p.maxhp);
  expect(Math.abs(p.x - 44)).toBeLessThan(1.5);           // checkpoint 42 + 2
  await step(page, 60);
  const x0 = (await P(page)).x;
  await page.keyboard.down('KeyD'); await step(page, 30); await page.keyboard.up('KeyD');
  expect((await P(page)).x).toBeGreaterThan(x0 + 3);
});

test('falling into a pit is punished and returns the player to the checkpoint, alive and controllable', async ({ page }) => {
  // v0.6: pit = -1 HP + teleport; 3b1687f: pit = death + respawn. Either is accepted; ending up stuck is not.
  await boot(page); await start(page); await clearEnemies(page);
  await page.evaluate(() => { NS.tp(22, 3); NS.player.inv = 0; });   // gap between street segments 21 and 23
  let punished = false, p;
  for (let i = 0; i < 30; i++) {
    await step(page, 10); p = await P(page);
    if (p.dead || p.hp < p.maxhp) punished = true;
    if (punished && !p.dead && p.y >= 0 && p.x < 5) break;
  }
  expect(punished).toBe(true);
  expect(p.dead).toBe(false);
  expect(p.x).toBeLessThan(5);                             // checkpoint 0 + 2
  expect(p.y).toBeGreaterThanOrEqual(0);
  await step(page, 120);
  const x0 = (await P(page)).x;
  await page.keyboard.down('KeyD'); await step(page, 20); await page.keyboard.up('KeyD');
  expect((await P(page)).x).toBeGreaterThan(x0 + 2);
});

test('reaching the exit completes the level and shows the results screen', async ({ page }) => {
  await boot(page); await start(page); await clearEnemies(page);
  await page.evaluate(() => NS.tp(137.8, 0));
  await page.keyboard.down('KeyD'); await step(page, 30); await page.keyboard.up('KeyD');
  expect(await page.evaluate(() => NS.game.running)).toBe(false);
  await expect(page.locator('#overlay')).toBeVisible();
  await expect(page.locator('#ov-title')).toContainText('CLEAR');
  await expect(page.locator('#start')).toContainText(/PLAY AGAIN/i);
});

test('PLAY AGAIN after completion starts a fresh run (HP, kills, position reset)', async ({ page }) => {
  await boot(page); await start(page); await clearEnemies(page);
  await page.evaluate(() => NS.game.complete());
  await start(page);
  const p = await P(page);
  expect(p.x).toBeLessThan(5);
  expect(p.hp).toBe(p.maxhp);
  expect(await page.evaluate(() => NS.game.kills)).toBe(0);
  expect(await page.evaluate(() => NS.enemies.filter(e => e.alive).length)).toBeGreaterThan(5);
});

test('P pauses the simulation (live loop), held keys do nothing while paused, P resumes', async ({ page }) => {
  await boot(page); await start(page, { freeze: false });
  await page.keyboard.press('KeyP');
  expect(await page.evaluate(() => NS.game.paused)).toBe(true);
  const x0 = (await P(page)).x;
  await page.keyboard.down('KeyD'); await page.waitForTimeout(400); await page.keyboard.up('KeyD');
  await page.keyboard.press('KeyJ');
  await page.waitForTimeout(200);
  expect((await P(page)).x).toBeCloseTo(x0, 3);
  await page.keyboard.press('KeyP');
  expect(await page.evaluate(() => NS.game.paused)).toBe(false);
  await page.keyboard.down('KeyD'); await page.waitForTimeout(400); await page.keyboard.up('KeyD');
  expect((await P(page)).x).toBeGreaterThan(x0 + 1);
});

test('R restarts the run mid-level', async ({ page }) => {
  await boot(page); await start(page); await clearEnemies(page);
  await page.evaluate(() => NS.tp(60, 0));
  await page.keyboard.press('KeyR');
  const p = await P(page);
  expect(p.x).toBeLessThan(5);
  expect(await page.evaluate(() => NS.game.running)).toBe(true);
});

/* ---------------- acceptance criteria for features not built yet (Phase 3) ---------------- */
test.fixme('3 stages: NS.loadStage(0..2) loads Neon District, Security Complex, Cyber Core', async ({ page }) => {
  await boot(page);
  for (const i of [0, 1, 2]) expect(await page.evaluate(i => NS.loadStage(i), i)).toBe(true);
  // ACCEPTANCE: each stage has its own layout/theme, checkpoints and an exit that leads to the next stage.
});
test.fixme('stage exit advances to the next stage (not straight to the results screen)', async ({ page }) => { await boot(page); });
test.fixme('boss: Cyber Core boss fight → boss victory screen with run stats', async ({ page }) => {
  // ACCEPTANCE: defeating the final boss shows a victory screen; the exit cannot be reached while the boss lives.
  await boot(page);
});
test.fixme('boss arena cannot be skipped: exit is locked until the Warden/boss is down', async ({ page }) => {
  // Currently NS.tp past the arena trigger reaches the exit; with real movement the lockdown walls should hold.
  await boot(page);
});
test.fixme('pause menu: Esc/P opens a menu (resume / restart / quit to title) and fully freezes the sim', async ({ page }) => {
  // Today P only shows a PAUSED toast. ACCEPTANCE: a visible menu, keyboard navigable, resume restores control.
  await boot(page);
});
test.fixme('game over flow: losing all lives shows a game-over screen with retry', async ({ page }) => { await boot(page); });
test.fixme('title → stage select / continue uses the versioned save', async ({ page }) => { await boot(page); });
