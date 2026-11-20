// Evidence screenshots → docs/screenshots/qa/. The sim is frozen and stepped so each shot lands on the
// exact moment (the live rAF loop keeps rendering the frozen state).
import { test, expect, boot, start, step, isolateEnemy, shot } from './helpers.js';

test.describe.configure({ mode: 'serial' });

const settle = page => page.waitForTimeout(120);               // let rAF render the stepped state

test('screenshot: title', async ({ page }) => {
  await boot(page);
  await page.waitForTimeout(400);
  await shot(page, '01-title');
});

test('screenshots: gameplay, combo slash, cannon, shield, blink', async ({ page }) => {
  await boot(page);
  await start(page);
  await page.keyboard.down('KeyD'); await step(page, 40); await page.keyboard.up('KeyD');
  await settle(page); await shot(page, '02-gameplay');

  await page.evaluate(() => { NS.unlockAll(); NS.tp(30, 0); NS.player.facing = 1; NS.player.inv = 999; });
  await isolateEnemy(page, 1, 32);
  await page.evaluate(() => { NS.enemies[1].hp = 20; });
  await page.keyboard.press('KeyJ'); await step(page, 18);
  await page.keyboard.press('KeyJ'); await step(page, 18);
  await page.keyboard.press('KeyJ'); await step(page, 9);   // finisher arc on screen
  await settle(page); await shot(page, '03-combo-slash-finisher');

  await step(page, 40);
  await page.keyboard.press('Digit2'); await step(page, 20);
  await page.evaluate(() => { NS.enemies[1].x = NS.player.x + 7; NS.enemies[1].minX = NS.enemies[1].x - 0.01; NS.enemies[1].maxX = NS.enemies[1].x + 0.01; });
  await page.keyboard.press('KeyJ'); await step(page, 4);
  await settle(page); await shot(page, '04-cannon-fire');

  await step(page, 30);
  await page.keyboard.down('KeyL'); await step(page, 8);
  await settle(page); await shot(page, '05-shield');
  await page.keyboard.up('KeyL'); await step(page, 10);

  await page.keyboard.press('Digit1');
  await page.keyboard.press('KeyK'); await step(page, 3);
  await settle(page); await shot(page, '06-blink');
  expect(await page.evaluate(() => NS.player.x)).toBeGreaterThan(30);
});
