// Combat: deterministic NS.step with the live loop frozen; attacks issued with real key presses.
import { test, expect, boot, start, step, P, isolateEnemy, shootAtPlayer, freeze } from './helpers.js';

const enemy = (page, i) => page.evaluate(i => {
  const e = NS.enemies[i];
  return { x: e.x, hp: e.hp, alive: e.alive, flash: e.flash, stun: e.stun, kvx: e.kvx, state: e.state };
}, i);
const stepUntilNoHitstop = page => page.evaluate(() => { let n = 0; while ((NS.feel || NS.FX).hitstop > 0 && n < 600) { NS.step(1); n++; } return n; });

test.beforeEach(async ({ page }) => {
  await boot(page);
  await start(page);
  await page.evaluate(() => { NS.tp(10, 0); NS.player.facing = 1; NS.player.inv = 999; });   // invulnerable: isolate the mechanic under test
});

test('blade damages an enemy inside its reach', async ({ page }) => {
  const { hp } = await isolateEnemy(page, 0, 11.8);          // gunner, 1.8 u ahead
  await page.keyboard.press('KeyJ');
  await step(page, 20);
  const e = await enemy(page, 0);
  expect(e.hp).toBe(hp - 2);                                 // swing 1 = 2 dmg
  expect(e.flash + Math.abs(e.kvx)).toBeGreaterThan(0);      // reacted (flash / knockback)
});

test('blade does NOT damage an enemy outside its reach or behind the player', async ({ page }) => {
  const { hp } = await isolateEnemy(page, 0, 16.5);          // 6.5 u ahead (reach ≈ 2.7 + lunge)
  await page.keyboard.press('KeyJ');
  await step(page, 25);
  expect((await enemy(page, 0)).hp).toBe(hp);
  await page.evaluate(() => { NS.enemies[0].x = 8.4; NS.enemies[0].minX = 8.39; NS.enemies[0].maxX = 8.41; NS.tp(10, 0); NS.player.facing = 1; });  // behind
  await page.keyboard.press('KeyJ');
  await step(page, 25);
  expect((await enemy(page, 0)).hp).toBe(hp);
});

test('3-hit blade combo advances 1→2→3 and the finisher kills; kill counter updates', async ({ page }) => {
  await isolateEnemy(page, 1, 12);                           // enforcer
  await page.evaluate(() => { NS.enemies[1].hp = 7; });      // 2 + 2 + 3: only the finisher kills
  const steps = [];
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('KeyJ');
    // record the swing that this press started (allowing for hit-stop / remaining cooldown)
    steps.push(await page.evaluate(() => { let s = 0; for (let n = 0; n < 40; n++) { NS.step(1); s = Math.max(s, NS.player.atkStep); if (s && NS.player.atkStep === 0) break; } return s; }));
    await page.evaluate(() => { let n = 0; while ((NS.player.atkStep || NS.player.cd.blade > 0) && n++ < 120) NS.step(1); });
    await page.evaluate(() => { const e = NS.enemies[1]; if (e.alive) { e.x = NS.player.x + 1.6; } });
  }
  expect(steps).toEqual([1, 2, 3]);
  const e = await enemy(page, 1);
  expect(e.alive).toBe(false);
  expect(await page.evaluate(() => NS.game.kills)).toBe(1);
  await expect(page.locator('#killcount')).toHaveText(/^1 \//);
});

test('enemy reacts to a hit (flash, knockback, stun) and dies at 0 HP', async ({ page }) => {
  await isolateEnemy(page, 0, 11.8);
  await page.keyboard.press('KeyJ');
  await step(page, 6);
  const hit = await page.evaluate(() => { const e = NS.enemies[0]; return { flash: e.flash, kvx: e.kvx, stun: e.stun }; });
  expect(hit.flash).toBeGreaterThan(0);
  expect(hit.kvx).toBeGreaterThan(0);                        // pushed away from the player
  expect(hit.stun).toBeGreaterThan(0);
  // keep slashing (re-positioning the target in reach) until it dies; must die within 6 swings
  for (let i = 0; i < 6 && (await enemy(page, 0)).alive; i++) {
    await page.evaluate(() => { let n = 0; while ((NS.player.atkStep || NS.player.cd.blade > 0 || (NS.feel || NS.FX).hitstop > 0) && n++ < 200) NS.step(1); });
    await page.evaluate(() => { const e = NS.enemies[0]; e.x = NS.player.x + 1.6; e.minX = e.x - 3; e.maxX = e.x + 3; });
    await page.keyboard.press('KeyJ');
    await step(page, 30);
  }
  expect((await enemy(page, 0)).alive).toBe(false);
  expect(await page.evaluate(() => NS.game.kills)).toBe(1);
});

test('cannon projectile travels and hits a distant enemy', async ({ page }) => {
  await page.evaluate(() => NS.unlockAll());
  await page.keyboard.press('Digit2');
  expect((await P(page)).chip).toBe('cannon');
  const { hp: hp0 } = await isolateEnemy(page, 0, 18);       // 8 u away: unreachable by the blade
  await page.keyboard.press('KeyJ');
  await step(page, 1);
  expect(await page.evaluate(() => NS.bullets.length)).toBe(1);
  let hp = hp0;
  for (let i = 0; i < 40 && hp === hp0; i++) { await step(page, 1); hp = (await enemy(page, 0)).hp; }
  expect(hp).toBeLessThan(hp0);
  expect(await page.evaluate(() => NS.bullets.length)).toBe(0);  // bolt consumed on impact
});

test('cannon: holding J charges a piercing lance (more damage than a tap)', async ({ page }) => {
  await page.evaluate(() => NS.unlockAll());
  await page.keyboard.press('Digit2');
  await isolateEnemy(page, 3, 22);                           // gunner 3 HP far away
  await page.keyboard.down('KeyJ');
  await step(page, 1);
  await page.evaluate(() => { NS.bullets.length = 0; });     // drop the tap shot, keep charging
  await step(page, 60);                                      // 1 s > CHARGE_FULL
  await page.keyboard.up('KeyJ');
  await step(page, 1);
  const b = await page.evaluate(() => NS.bullets.map(b => ({ dmg: b.dmg, pierce: !!b.pierce })));
  expect(b.length).toBe(1);
  expect(b[0].pierce).toBe(true);
  expect(b[0].dmg).toBeGreaterThanOrEqual(3);
});

test('unshielded: an enemy bolt costs 1 HP', async ({ page }) => {
  await page.evaluate(() => { NS.player.inv = 0; });
  await isolateEnemy(page, 0, 40);
  await shootAtPlayer(page, 2);
  await step(page, 15);
  const p = await P(page);
  expect(p.hp).toBe(p.maxhp - 1);
});

test('shield BLOCK (held > parry window): bolt absorbed, no damage, no reflect, no crit', async ({ page }) => {
  await page.evaluate(() => { NS.unlockAll(); NS.player.inv = 0; });
  await isolateEnemy(page, 0, 40);
  await page.keyboard.down('KeyL');
  await step(page, 30);                                      // parry window (0.2 s) has expired
  const before = await P(page);
  expect(before.shielding).toBe(true);
  expect(before.parryT).toBe(0);
  await shootAtPlayer(page, 2);
  await step(page, 15);
  const p = await P(page);
  await page.keyboard.up('KeyL');
  expect(p.hp).toBe(p.maxhp);
  expect(p.critT).toBe(0);
  expect(await page.evaluate(() => NS.bullets.filter(b => b.reflected).length)).toBe(0);
  expect(await page.evaluate(() => NS.enemyBullets.length)).toBe(0);
});

test('shield PARRY (pressed just before impact): bolt reflected, crit armed, no damage', async ({ page }) => {
  await page.evaluate(() => { NS.unlockAll(); NS.player.inv = 0; });
  await isolateEnemy(page, 0, 40);
  await shootAtPlayer(page, 1.6);                            // arrives in ~4 frames
  await page.keyboard.down('KeyL');
  await step(page, 8);
  await page.keyboard.up('KeyL');
  const p = await P(page);
  expect(p.hp).toBe(p.maxhp);
  expect(p.critT).toBeGreaterThan(0);
  const refl = await page.evaluate(() => NS.bullets.filter(b => b.reflected).length);
  expect(refl).toBe(1);
});

test('shield only covers the front: a bolt from behind still hurts', async ({ page }) => {
  await page.evaluate(() => { NS.unlockAll(); NS.player.inv = 0; });
  await isolateEnemy(page, 0, 40);
  await page.keyboard.down('KeyL');
  await step(page, 20);
  await shootAtPlayer(page, -2);                             // from behind
  await page.evaluate(() => { const b = NS.enemyBullets[0]; b.vx = -b.vx; });
  await step(page, 15);
  await page.keyboard.up('KeyL');
  expect((await P(page)).hp).toBe(5);
});

test('hit-stop starts on a hit and always ends (stepped)', async ({ page }) => {
  await isolateEnemy(page, 0, 11.8);
  await page.keyboard.press('KeyJ');
  let max = 0;
  for (let i = 0; i < 12; i++) { await step(page, 1); max = Math.max(max, await page.evaluate(() => (NS.feel || NS.FX).hitstop)); }
  expect(max).toBeGreaterThan(0.03);
  const n = await stepUntilNoHitstop(page);
  expect(n).toBeLessThan(15);                                // ≤ 0.14 s cap
});

test('hit-stop: an attack pressed during the freeze is buffered and fires afterwards (CLAUDE.md invariant)', async ({ page }) => {
  await isolateEnemy(page, 1, 11.8);                         // enforcer 4 HP
  await page.keyboard.press('KeyJ');
  let hs = 0;
  for (let i = 0; i < 12 && hs <= 0; i++) { await step(page, 1); hs = await page.evaluate(() => (NS.feel || NS.FX).hitstop); }
  expect(hs).toBeGreaterThan(0);
  await page.keyboard.press('KeyJ');                         // pressed while frozen
  await stepUntilNoHitstop(page);
  await step(page, 16);
  expect((await P(page)).comboStep).toBe(2);
});

test('LIVE loop: hit-stop always ends under real rAF timing, even after a burst of hits', async ({ page }) => {
  await page.evaluate(() => { NS.unlockAll(); const pl = NS.player; NS.enemies.forEach((e, i) => { e.x = pl.x + 1 + (i % 3) * 0.4; e.minX = e.x - 0.01; e.maxX = e.x + 0.01; e.hp = 50; e.cooldown = 99; }); });
  await freeze(page, false);
  for (let i = 0; i < 12; i++) { await page.keyboard.press('KeyJ'); await page.waitForTimeout(60); }
  await page.keyboard.press('KeyK');
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => (NS.feel || NS.FX).hitstop)).toBeLessThanOrEqual(0);
  const x0 = (await P(page)).x;
  await page.keyboard.down('KeyA'); await page.waitForTimeout(400); await page.keyboard.up('KeyA');
  expect((await P(page)).x).toBeLessThan(x0 - 1);           // sim is running again
});

test('rapid chip switching (30 swaps) never breaks either weapon', async ({ page }) => {
  await page.evaluate(() => NS.unlockAll());
  await isolateEnemy(page, 1, 11.8);
  await page.evaluate(() => { NS.enemies[1].hp = 99; });
  for (let i = 0; i < 30; i++) { await page.keyboard.press(i % 3 === 0 ? 'KeyQ' : i % 3 === 1 ? 'Digit1' : 'Digit2'); await step(page, 1); }
  await page.keyboard.press('Digit1');
  await step(page, 30);
  expect((await P(page)).chip).toBe('blade');
  let hp0 = (await enemy(page, 1)).hp;
  await page.keyboard.press('KeyJ');
  await step(page, 20);
  expect((await enemy(page, 1)).hp).toBeLessThan(hp0);
  await page.keyboard.press('KeyQ');
  expect((await P(page)).chip).toBe('cannon');
  await stepUntilNoHitstop(page); await step(page, 30);
  await page.evaluate(() => { NS.tp(8, 0); NS.player.facing = 1; NS.player.inv = 999; });
  await step(page, 1);
  hp0 = (await enemy(page, 1)).hp;
  await page.keyboard.press('KeyJ');
  await step(page, 30);
  expect((await enemy(page, 1)).hp).toBeLessThan(hp0);
  expect(await page.evaluate(() => NS.game.paused)).toBe(false);
});

test('blink warps forward and damages enemies in its path', async ({ page }) => {
  await page.evaluate(() => NS.unlockAll());
  const { hp } = await isolateEnemy(page, 0, 12.5);
  await page.keyboard.press('KeyK');
  await step(page, 2);
  const p = await P(page);
  expect(p.x).toBeGreaterThan(14.5);                         // ~5.3 u warp
  expect((await enemy(page, 0)).hp).toBeLessThanOrEqual(hp - 3);   // blink path damage (3)
});
