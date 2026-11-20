// Movement: real keyboard events (page.keyboard) feeding the game's own listeners,
// advanced with deterministic NS.step while the live rAF loop is frozen.
import { test, expect, boot, start, step, stepTrack, P, clearEnemies, freeze } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await boot(page);
  await start(page);
  await clearEnemies(page);
});

for (const [label, right, left] of [['A/D', 'KeyD', 'KeyA'], ['arrow keys', 'ArrowRight', 'ArrowLeft']]) {
  test(`${label}: hold right then left moves the player both ways at run speed`, async ({ page }) => {
    const p0 = await P(page);
    await page.keyboard.down(right);
    await step(page, 60);
    const p1 = await P(page);
    expect(p1.facing).toBe(1);
    expect(p1.x - p0.x).toBeGreaterThan(8);                 // ~12.2 u/s minus acceleration ramp
    expect(p1.vx).toBeGreaterThan(11.5);
    await page.keyboard.up(right);
    await step(page, 30);
    expect(Math.abs((await P(page)).vx)).toBeLessThan(0.5); // stops when released

    await page.keyboard.down(left);
    await step(page, 45);
    const p2 = await P(page);
    await page.keyboard.up(left);
    expect(p2.facing).toBe(-1);
    expect(p2.vx).toBeLessThan(-11.5);
    expect(p2.x).toBeLessThan(p1.x - 5);
  });
}

test('holding a key is not faster than tapping-then-holding (no key-repeat speed-up)', async ({ page }) => {
  await page.evaluate(() => NS.tp(10, 0));
  await page.keyboard.down('KeyD');
  await step(page, 60);
  const a = (await P(page)).x;
  // OS key-repeat: extra keydown events with repeat=true must not nudge the player
  for (let i = 0; i < 20; i++) await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD', key: 'd', repeat: true })));
  const b = (await P(page)).x;
  await page.keyboard.up('KeyD');
  expect(b - a).toBeLessThan(0.01);
});

for (const key of ['KeyW', 'Space']) {
  test(`jump (${key}) held: reaches the expected apex and lands again`, async ({ page }) => {
    await page.keyboard.down(key);
    const a = await stepTrack(page, 30, 'y');
    await page.keyboard.up(key);
    const b = await stepTrack(page, 50, 'y');
    const t = { max: Math.max(a.max, b.max) };
    expect(t.max).toBeGreaterThan(2.4);
    expect(t.max).toBeLessThan(3.0);                        // README: apex 2.69 u
    const p = await P(page);
    expect(p.onGround).toBe(true);
    expect(p.y).toBe(0);
  });
}

test('variable jump height: a quick tap jumps lower than a held jump', async ({ page }) => {
  await page.keyboard.down('KeyW');
  const held = (await stepTrack(page, 70, 'y')).max;
  await page.keyboard.up('KeyW');
  await step(page, 10);
  await page.keyboard.down('KeyW'); await step(page, 3); await page.keyboard.up('KeyW');
  const tap = (await stepTrack(page, 70, 'y')).max;
  expect(tap).toBeGreaterThan(0.5);
  expect(tap).toBeLessThan(held);
});

test('double jump goes higher than a single jump; a third press does nothing', async ({ page }) => {
  await page.keyboard.down('KeyW'); await step(page, 18); await page.keyboard.up('KeyW');
  await step(page, 2);
  await page.keyboard.down('KeyW');                        // second (air) jump, held
  const t2 = await stepTrack(page, 10, 'y');
  expect((await P(page)).airJumps).toBe(1);
  const t3 = await stepTrack(page, 20, 'y');               // keep holding through the 2nd jump's rise
  await page.keyboard.up('KeyW');
  await page.keyboard.down('KeyW'); await page.keyboard.up('KeyW');   // third jump must be ignored
  const t4 = await stepTrack(page, 90, 'y');
  const t = { max: Math.max(t2.max, t3.max, t4.max) };
  expect(t.max).toBeGreaterThan(4.3);                      // 2nd jump near the apex of the 1st (~2.6 + ~2.7)
  expect(t.max).toBeLessThan(5.6);                         // but never a third impulse (would be > 7)
  expect((await P(page)).onGround).toBe(true);
});

test('fast re-tap: releasing jump and pressing it again within the same frame still gives a full double jump', async ({ page }) => {
  // A human double-tap can land key-up and key-down inside one 16 ms frame. The release must cut the
  // FIRST jump only, never the fresh air jump that the new press starts.
  await page.keyboard.down('KeyW'); await step(page, 18);
  const y0 = (await P(page)).y;
  await page.keyboard.up('KeyW');
  await page.keyboard.down('KeyW');                        // same frame: no step in between
  const t = await stepTrack(page, 40, 'y');
  await page.keyboard.up('KeyW');
  expect(t.max - y0, 'air jump height gained after a same-frame re-tap').toBeGreaterThan(2.0);
});

test('dash covers distance quickly and respects its cooldown', async ({ page }) => {
  await page.evaluate(() => NS.tp(10, 0));
  await page.keyboard.press('Shift');
  await step(page, 1);
  expect((await P(page)).dash).toBeGreaterThan(0);
  await step(page, 13);
  const p1 = await P(page);
  expect(p1.x - 10).toBeGreaterThan(5);                    // README: dash ~6.6 u
  expect(p1.dashCd).toBeGreaterThan(0);
  await page.keyboard.press('Shift');                      // still on cooldown
  await step(page, 1);
  expect((await P(page)).dash).toBeLessThanOrEqual(0);
  await step(page, 50);
  await page.keyboard.press('Shift');                      // cooldown over
  await step(page, 1);
  expect((await P(page)).dash).toBeGreaterThan(0);
});

test('movement stays responsive during and after a 3-hit blade combo', async ({ page }) => {
  await page.evaluate(() => NS.tp(20, 0));
  for (let i = 0; i < 3; i++) { await page.keyboard.press('KeyJ'); await step(page, 16); }
  await page.keyboard.down('KeyA');                        // turn around right after the finisher
  await step(page, 40);
  const p = await P(page);
  await page.keyboard.up('KeyA');
  expect(p.facing).toBe(-1);
  expect(p.vx).toBeLessThan(-11);
  // attacking while holding a direction never locks movement: the swing slows the run (design: wind/act/rec
  // ground multiplier), but the player keeps advancing and is back to full run speed right after the swing
  await page.keyboard.down('KeyD');
  await step(page, 20);
  const x0 = (await P(page)).x;
  await page.keyboard.press('KeyJ');
  await step(page, 15);
  const x1 = (await P(page)).x;
  await page.evaluate(() => { let n = 0; while (NS.player.atkStep && n++ < 120) NS.step(1); });
  await step(page, 15);
  const v = (await P(page)).vx;
  await page.keyboard.up('KeyD');
  expect(x1 - x0).toBeGreaterThan(0.8);
  expect(v).toBeGreaterThan(11);
});

test('window blur clears held keys, and the next key press controls the player again', async ({ page }) => {
  await page.evaluate(() => NS.tp(10, 0));
  await page.keyboard.down('KeyD');
  await step(page, 20);
  expect((await P(page)).vx).toBeGreaterThan(8);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));   // alt-tab while holding D (keyup never arrives)
  await step(page, 30);
  expect(Math.abs((await P(page)).vx), 'player must not keep running after focus loss').toBeLessThan(0.5);
  await page.keyboard.up('KeyD');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.keyboard.down('KeyA');
  await step(page, 30);
  const p = await P(page);
  await page.keyboard.up('KeyA');
  expect(p.vx).toBeLessThan(-11);
});

test('tab hidden (visibilitychange) clears held keys', async ({ page }) => {
  await page.keyboard.down('ArrowRight');
  await step(page, 10);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
  });
  await step(page, 30);
  expect(Math.abs((await P(page)).vx)).toBeLessThan(0.5);
  await page.keyboard.up('ArrowRight');
  await page.keyboard.down('ArrowRight');
  await step(page, 30);
  expect((await P(page)).vx).toBeGreaterThan(11);
  await page.keyboard.up('ArrowRight');
});

test('keyboard keeps working after clicking around the page (HUD, canvas, body)', async ({ page }) => {
  for (const sel of ['#hud', '#screen', 'body']) {
    await page.locator(sel).click({ position: { x: 5, y: 5 }, force: true });
    const x0 = (await P(page)).x;
    await page.keyboard.down('KeyD'); await step(page, 15); await page.keyboard.up('KeyD'); await step(page, 15);
    expect((await P(page)).x - x0, `after clicking ${sel}`).toBeGreaterThan(1.5);
    await page.evaluate(() => NS.tp(5, 0));
  }
});

test('LIVE loop (rAF, not stepped): holding D for ~1 s moves the player right', async ({ page }) => {
  await freeze(page, false);
  const x0 = (await P(page)).x;
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(1000);
  await page.keyboard.up('KeyD');
  const p = await P(page);
  expect(p.x - x0).toBeGreaterThan(6);
  const frames = await page.evaluate(() => NS.game.frames);
  expect(frames).toBeGreaterThan(30);
});

test('LIVE loop: input still controls the player after a long hold + many direction changes', async ({ page }) => {
  await freeze(page, false);
  for (let i = 0; i < 8; i++) {
    const k = i % 2 ? 'KeyA' : 'KeyD';
    await page.keyboard.down(k); await page.waitForTimeout(150); await page.keyboard.up(k);
  }
  await page.waitForTimeout(150);
  const x0 = (await P(page)).x;
  await page.keyboard.down('KeyD'); await page.waitForTimeout(600); await page.keyboard.up('KeyD');
  expect((await P(page)).x - x0).toBeGreaterThan(3);
});
