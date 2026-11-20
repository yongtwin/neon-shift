// Chips: permanent unlocks, persistence, locked chips unusable, switching mid-combat.
import { test, expect, boot, start, step, P, isolateEnemy, clearEnemies, loadStage, stageData } from './helpers.js';

const STORAGE = 'neonshift_chips_v1';   // legacy v1 key (migrated into `neonshift_save` {v:2,…})

test('fresh save: only BLADE unlocked, HUD shows 1 / 4', async ({ page }) => {
  await boot(page);
  await start(page);
  expect((await P(page)).unlocked).toEqual(['blade']);
  await expect(page.locator('#unlocks')).toHaveText('1 / 4');
});

test('walking over the CANNON pickup unlocks and equips it, and saves it', async ({ page }) => {
  await boot(page);
  await start(page);
  await clearEnemies(page);
  const pk = (await stageData(page, 0)).pickups.find(p => p.id === 'cannon');
  await page.evaluate(x => NS.tp(x, 0), pk.x - 3);
  await page.keyboard.down('KeyD');
  await step(page, 25);
  await page.keyboard.up('KeyD');
  const p = await P(page);
  expect(p.unlocked).toContain('cannon');
  expect(p.chip).toBe('cannon');                               // new weapon is equipped straight away
  await expect(page.locator('#unlocks')).toHaveText('2 / 4');
  // v2 save (`neonshift_save` {v, chips}) when present, else the legacy v1 array key
  const saved = await page.evaluate(k => JSON.stringify([localStorage.getItem('neonshift_save'), localStorage.getItem(k)]), STORAGE);
  expect(saved).toContain('cannon');
});

test('unlocks persist across a page reload', async ({ page }) => {
  await boot(page);
  await start(page);
  await loadStage(page, 2);                                    // stage 3 has catch-up pickups for every chip
  await clearEnemies(page);
  const xs = (await stageData(page, 2)).pickups.map(p => p.x);
  await page.evaluate(x => NS.tp(x, 0), Math.min(...xs) - 2);
  await page.keyboard.down('KeyD'); await step(page, 50); await page.keyboard.up('KeyD');
  expect((await P(page)).unlocked).toEqual(['blade', 'blink', 'cannon', 'shield']);
  await page.reload();
  await page.waitForFunction(() => window.NS && NS.player);
  expect((await P(page)).unlocked).toEqual(['blade', 'blink', 'cannon', 'shield']);
  await start(page);
  expect((await P(page)).unlocked).toEqual(['blade', 'blink', 'cannon', 'shield']);
  await expect(page.locator('#unlocks')).toHaveText('4 / 4');
});

test('locked chips cannot be used (Q / 2 / K / L do nothing with a fresh save)', async ({ page }) => {
  await boot(page);
  await start(page);
  await clearEnemies(page);
  await page.evaluate(() => NS.tp(10, 0));
  for (const k of ['KeyQ', 'Digit2']) { await page.keyboard.press(k); await step(page, 2); }
  expect((await P(page)).chip).toBe('blade');
  await page.keyboard.press('KeyK');
  await step(page, 3);
  let p = await P(page);
  expect(p.x).toBeLessThan(10.5);                              // no blink warp
  expect(p.warpU).toBe(0);
  await page.keyboard.down('KeyL');
  await step(page, 5);
  p = await P(page);
  await page.keyboard.up('KeyL');
  expect(p.shielding).toBe(false);
  expect(p.parryT).toBe(0);
});

test('switching weapon mid-combo never pauses the game and the new weapon fires at once', async ({ page }) => {
  await boot(page);
  await start(page);
  await page.evaluate(() => { NS.unlockAll(); NS.tp(10, 0); NS.player.facing = 1; NS.player.inv = 999; });
  await isolateEnemy(page, 1, 11.8);
  await page.evaluate(() => { NS.enemies[1].hp = 99; });
  await page.keyboard.press('KeyJ');
  await step(page, 4);                                         // mid-swing
  const t0 = await page.evaluate(() => NS.game.runTime);
  await page.keyboard.press('KeyQ');
  const s = await P(page);
  expect(s.chip).toBe('cannon');
  expect(await page.evaluate(() => NS.game.paused)).toBe(false);
  await step(page, 20);
  expect(await page.evaluate(() => NS.game.runTime)).toBeGreaterThan(t0);
  const hp0 = await page.evaluate(() => NS.enemies[1].hp);
  await page.keyboard.press('KeyJ');
  await step(page, 1);
  // point-blank: the bolt may hit on its first frame, so accept either a live bolt or the damage it did
  const fired = await page.evaluate(hp0 => NS.bullets.length > 0 || NS.enemies[1].hp < hp0, hp0);
  expect(fired).toBe(true);
  await page.keyboard.press('KeyQ');
  expect((await P(page)).chip).toBe('blade');
});

test('shield and blink are body slots: usable together with either weapon', async ({ page }) => {
  await boot(page);
  await start(page);
  await clearEnemies(page);
  await page.evaluate(() => { NS.unlockAll(); NS.tp(10, 0); NS.player.facing = 1; });
  await page.keyboard.press('Digit2');
  await page.keyboard.down('KeyL');
  await step(page, 3);
  expect((await P(page)).shielding).toBe(true);
  expect((await P(page)).chip).toBe('cannon');
  await page.keyboard.up('KeyL');
  await step(page, 3);
  await page.keyboard.press('KeyK');
  await step(page, 2);
  expect((await P(page)).x).toBeGreaterThan(14);
  expect((await P(page)).chip).toBe('cannon');
});

test('corrupt save data falls back to defaults without throwing', async ({ page }) => {
  await boot(page, { seed: [STORAGE, '{not json!!'] });
  await start(page);
  expect((await P(page)).unlocked).toEqual(['blade']);
});

test('unknown chip ids in the save are ignored', async ({ page }) => {
  await boot(page, { seed: [STORAGE, JSON.stringify(['blade', 'cannon', 'hax', 42, null])] });
  expect((await P(page)).unlocked).toEqual(['blade', 'cannon']);
});

test('RESET CHIPS on the title screen clears the collection', async ({ page }) => {
  await boot(page, { seed: [STORAGE, JSON.stringify(['blade', 'cannon', 'shield', 'blink'])] });
  expect((await P(page)).unlocked.length).toBe(4);
  await page.locator('#clear').click();
  expect((await P(page)).unlocked).toEqual(['blade']);
  await page.reload();
  await page.waitForFunction(() => window.NS && NS.player);
  expect((await P(page)).unlocked).toEqual(['blade']);
});

test('versioned save: v1 chip array migrates to {v:2, chips}', async ({ page }) => {
  await boot(page, { seed: [STORAGE, JSON.stringify(['blade', 'cannon'])] });
  expect((await P(page)).unlocked).toEqual(['blade', 'cannon']);
  const v2 = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('neonshift_save')); } catch { return 'corrupt'; } });
  expect(v2, 'neonshift_save should hold a versioned object after migration').toMatchObject({ v: 2, chips: ['blade', 'cannon'] });
});

test('versioned save: a save from a NEWER build (v:99) is read forward-compatibly and its unknown fields survive', async ({ page }) => {
  await boot(page, { seed: ['neonshift_save', JSON.stringify({ v: 99, chips: ['blade', 'blink'], stage: 1, best: {}, futureField: 'keep-me' })] });
  await start(page);
  expect((await P(page)).unlocked).toEqual(['blade', 'blink']);
  await page.evaluate(() => NS.unlockAll());                    // forces a save commit
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('neonshift_save')));
  expect(saved.futureField).toBe('keep-me');
  expect(saved.v).toBe(99);
  expect(saved.chips).toEqual(expect.arrayContaining(['blade', 'cannon', 'shield', 'blink']));
});

test('versioned save: corrupt v2 data falls back to an intact v1 save, and the bad data is backed up', async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('__s')) { sessionStorage.setItem('__s', '1'); localStorage.setItem('neonshift_save', '{broken'); localStorage.setItem('neonshift_chips_v1', '["blade","shield"]'); }
  });
  await boot(page);
  expect((await P(page)).unlocked).toEqual(['blade', 'shield']);
  expect(await page.evaluate(() => NS.save.source)).toMatch(/v1/);
  const keys = await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('neonshift')));
  expect(keys.length).toBeGreaterThanOrEqual(3);              // save, legacy key, backup of the unreadable data
});

for (const [label, raw] of [['corrupt JSON', '{oops'],
  ['wrong types', JSON.stringify({ v: 2, chips: 'cannon', stage: 'x', best: [] })], ['array', '[1,2,3]']]) {
  test(`versioned save: ${label} in neonshift_save loads safe defaults without throwing`, async ({ page }) => {
    await boot(page, { seed: ['neonshift_save', raw] });
    await start(page);
    const u = (await P(page)).unlocked;
    expect(u).toContain('blade');
    expect(u).not.toContain('blink');
  });
}

// chip collection screen: see flow.spec.js › "chip collection screen (Tab / C)".
