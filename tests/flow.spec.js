// Game flow: title → 3 stages (checkpoints, death/respawn, pits, stage clear) → boss → victory;
// pause menu, chip screen, hold-R restart, CONTINUE. Stage geometry is read from NS.stageData(i),
// never hard-coded, so layout changes do not break the flow tests.
import { test, expect, boot, start, step, P, clearEnemies, shootAtPlayer, freeze, loadStage, stageData, stepUntil, god, shot } from './helpers.js';

const screen = page => page.evaluate(() => NS.game.screen);

test('title screen shows, START begins stage 1 and hides the overlay; keys work right after the click', async ({ page }) => {
  await boot(page);
  await expect(page.locator('#overlay')).toBeVisible();
  expect(await screen(page)).toBe('title');
  await start(page, { freeze: false });
  await expect(page.locator('#overlay')).toBeHidden();
  expect(await screen(page)).toBe('play');
  expect(await page.evaluate(() => NS.game.stage)).toBe(0);
  const x0 = (await P(page)).x;
  await page.keyboard.down('KeyD'); await page.waitForTimeout(400); await page.keyboard.up('KeyD');
  expect((await P(page)).x).toBeGreaterThan(x0 + 1);
});

test('Enter on the focused START button starts once; the next Space is a jump', async ({ page }) => {
  await boot(page);
  await page.locator('#start').focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => NS.game.running);
  await freeze(page);
  await clearEnemies(page);
  await page.keyboard.press('Space');
  await step(page, 10);
  expect((await P(page)).y).toBeGreaterThan(0.3);
  await expect(page.locator('#overlay')).toBeHidden();
});

for (const i of [0, 1, 2]) {
  test(`stage ${i + 1}: loads, is reachable (validateStage), checkpoint → death → respawn there, input works`, async ({ page }) => {
    await boot(page);
    expect(await loadStage(page, i)).toBe(true);
    const sd = await stageData(page, i);
    const st = await page.evaluate(() => ({ index: NS.stage.index, name: NS.stage.name, cur: NS.game.stage }));
    expect(st.index).toBe(i); expect(st.cur).toBe(i); expect(st.name).toBe(sd.name);
    const v = await page.evaluate(i => NS.validateStage(i), i);
    expect(v.ok, `exit reachable: ${JSON.stringify(v.unreachable)}`).toBe(true);
    expect(Object.entries(v.reach).filter(([, r]) => !r).map(([k]) => k), 'unreachable pickups/checkpoints').toEqual([]);

    await clearEnemies(page);
    const cp = sd.checkpoints[1];
    await page.evaluate(x => NS.tp(x, 0), cp - 0.5);
    await page.keyboard.down('KeyD'); await step(page, 15); await page.keyboard.up('KeyD');
    expect((await P(page)).checkpoint).toBe(cp);

    // die a few units past the checkpoint (on the street segment that holds it)
    const seg = sd.plats.find(([a, b, y]) => y === 0 && cp + 3 >= a && cp + 3 <= b);
    const dieX = seg ? Math.min(cp + 3, seg[1] - 1) : cp + 1.5;
    await page.evaluate(x => { NS.tp(x, 0); NS.player.inv = 0; NS.player.facing = 1; NS.player.shielding = false; }, dieX);
    await shootAtPlayer(page, 1.5, 99);
    await stepUntil(page, 'NS.player.dead', 30);
    expect((await P(page)).dead).toBe(true);
    expect(await stepUntil(page, '!NS.player.dead', 400)).toBeLessThan(400);
    const p = await P(page);
    expect(p.hp).toBe(p.maxhp);
    expect(Math.abs(p.x - (cp + 2))).toBeLessThan(1.5);
    expect(await page.evaluate(() => NS.game.deaths)).toBe(1);
    await step(page, 150);                                    // respawn i-frames / landing
    const x0 = (await P(page)).x;
    await page.keyboard.down('KeyD'); await step(page, 20); await page.keyboard.up('KeyD');
    expect((await P(page)).x).toBeGreaterThan(x0 + 1.5);
  });
}

test('stage exit: reaching the portal on stage 1 shows STAGE CLEAR, then stage 2 loads; stage 2 → stage 3', async ({ page }) => {
  await boot(page);
  await loadStage(page, 0);
  for (const i of [0, 1]) {
    const sd = await stageData(page, i);
    await clearEnemies(page);
    await page.evaluate(x => { NS.tp(x, 0); }, sd.exitX - 2);
    await page.keyboard.down('KeyD');
    expect(await stepUntil(page, "NS.game.screen === 'stageclear'", 120, { god: true })).toBeLessThan(120);
    await page.keyboard.up('KeyD');
    await expect(page.locator('#ns-card')).toContainText('STAGE CLEAR');
    expect(await stepUntil(page, `NS.game.stage === ${i + 1} && NS.game.screen === 'play'`, 300)).toBeLessThan(300);
    const p = await P(page);
    expect(p.x).toBeLessThan(6);
    await expect(page.locator('#ns-card')).toContainText((await stageData(page, i + 1)).name);
  }
  // the save remembers the furthest stage → CONTINUE offered on the title
  expect(await page.evaluate(() => NS.save.data.stage)).toBe(2);
});

test('falling into a pit kills/punishes and respawns at the checkpoint, alive and controllable', async ({ page }) => {
  await boot(page);
  await loadStage(page, 0);
  await clearEnemies(page);
  const sd = await stageData(page, 0);
  const ground = sd.plats.filter(p => p[2] === 0).sort((a, b) => a[0] - b[0]);
  const gapX = (ground[0][1] + ground[1][0]) / 2;               // first pit
  await page.evaluate(x => { NS.tp(x, 3); NS.player.inv = 0; }, gapX);
  let punished = false;
  for (let n = 0; n < 60 && !punished; n++) { await step(page, 5); const p = await P(page); punished = p.dead || p.hp < p.maxhp; }
  expect(punished).toBe(true);
  expect(await stepUntil(page, '!NS.player.dead && NS.player.y >= 0 && NS.player.onGround', 400)).toBeLessThan(400);
  const p = await P(page);
  expect(p.x).toBeLessThan(gapX);
  await step(page, 120);
  const x0 = (await P(page)).x;
  await page.keyboard.down('KeyD'); await step(page, 15); await page.keyboard.up('KeyD');
  expect((await P(page)).x).toBeGreaterThan(x0 + 1.5);
});

test('lockdown arena: walls hold the player in; dying inside resets the arena wave', async ({ page }) => {
  await boot(page);
  await loadStage(page, 0);
  await clearEnemies(page);
  const a = (await stageData(page, 0)).arenas[0];
  await page.evaluate(x => { NS.tp(x, 0); NS.player.inv = 999; }, a.trigger - 1.5);
  await page.keyboard.down('KeyD');
  expect(await stepUntil(page, 'NS.game.arena !== null', 120, { god: true })).toBeLessThan(120);
  await step(page, 240);                                     // keep pushing right for 4 s
  await page.keyboard.up('KeyD');
  const p = await P(page);
  expect(p.x).toBeLessThanOrEqual(a.x1);
  const wave = await page.evaluate(id => NS.enemies.filter(e => e.arenaId === id && e.alive).length, a.id);
  expect(wave).toBe(a.wave.length);
  // kill one wave enemy, then die → the wave is restored at full strength
  await page.evaluate(id => { const e = NS.enemies.find(e => e.arenaId === id && e.alive); e.hp = 0; e.alive = false; }, a.id);
  await page.evaluate(() => { NS.enemyBullets.length = 0; NS.player.hp = 1; NS.player.inv = 0; NS.player.shielding = false; NS.player.facing = -1; });   // bolt from inside the arena
  await shootAtPlayer(page, 1.5, 99);
  await stepUntil(page, 'NS.player.dead', 30);
  expect((await P(page)).dead).toBe(true);
  await stepUntil(page, '!NS.player.dead', 400);
  expect(await page.evaluate(() => NS.game.arena)).toBeNull();
  await page.evaluate(x => { NS.tp(x, 0); }, a.trigger - 1.5);
  await page.keyboard.down('KeyD');
  await stepUntil(page, 'NS.game.arena !== null', 120, { god: true });
  await page.keyboard.up('KeyD');
  await step(page, 5);
  expect(await page.evaluate(id => NS.enemies.filter(e => e.arenaId === id && e.alive).length, a.id)).toBe(a.wave.length);
});

test('boss: arena locks, boss bar shows, exit unreachable while it lives; defeat → death sequence → VICTORY screen', async ({ page }) => {
  test.setTimeout(90_000);
  await boot(page);
  await loadStage(page, 2);
  await page.evaluate(() => NS.unlockAll());
  await clearEnemies(page);
  const sd = await stageData(page, 2);
  const a = sd.arenas.find(x => x.boss);
  await page.evaluate(x => { NS.tp(x, 0); }, a.trigger - 2);
  await page.keyboard.down('KeyD');
  expect(await stepUntil(page, 'NS.game.arena && NS.game.arena.boss && NS.boss', 200, { god: true })).toBeLessThan(200);
  await stepUntil(page, 'false', 300, { god: true });         // keep running right into the boss for 5 s
  await page.keyboard.up('KeyD');
  const b0 = await page.evaluate(() => ({ hp: NS.boss.hp, maxhp: NS.boss.maxhp, alive: NS.boss.alive }));
  expect(b0.alive).toBe(true);
  expect(b0.maxhp).toBe(80);                                  // 2e587dc tuning
  expect(b0.hp).toBe(80);
  await expect(page.locator('#boss-name')).toHaveText('WARDEN // CORE SENTINEL');
  expect((await P(page)).x).toBeLessThanOrEqual(a.x1);
  expect(await page.evaluate(() => NS.game.screen)).toBe('play');
  await expect(page.locator('#boss')).toBeVisible();
  await page.waitForTimeout(450);                             // let CSS fades (real time) catch up with the stepped sim
  await shot(page, '20-boss-fight');

  // finish it: drop the boss to 4 HP, then real blade presses until the death sequence starts
  await page.evaluate(() => { NS.boss.hp = 4; });
  await page.keyboard.press('Digit1');                       // blade
  for (let n = 0; n < 40 && await page.evaluate(() => NS.boss && NS.boss.alive && !NS.boss.dying); n++) {
    await page.evaluate(() => { const b = NS.boss, p = NS.player; p.facing = b.x > p.x ? 1 : -1; if (Math.abs(b.x - p.x) > 2.2) NS.tp(b.x - p.facing * 2, 0); p.inv = 9; p.hp = p.maxhp; });
    await page.keyboard.press('KeyJ');
    await step(page, 4);
    await stepUntil(page, '!NS.player.atkStep && !(NS.feel.hitstop > 0)', 80, { god: true });
  }
  expect(await page.evaluate(() => !NS.boss || NS.boss.dying || !NS.boss.alive)).toBe(true);
  // outcome lock: while the boss dies, holding R does not restart and a lethal bolt does not kill
  expect(await page.evaluate(() => !!(NS.boss && NS.boss.dying)), 'boss death sequence in progress').toBe(true);
  {
    await page.evaluate(() => { NS.player.inv = 0; NS.player.hp = 1; NS.player.shielding = false; });
    await shootAtPlayer(page, 1.2, 99);
    await page.keyboard.down('KeyR'); await step(page, 45); await page.keyboard.up('KeyR');
    const s = await page.evaluate(() => ({ dead: NS.player.dead, stage: NS.game.stage, bossDying: !!(NS.boss && (NS.boss.dying || !NS.boss.alive)) }));
    expect(s).toEqual({ dead: false, stage: 2, bossDying: true });
  }
  expect(await stepUntil(page, "NS.game.screen === 'victory'", 600, { god: true })).toBeLessThan(600);
  await expect(page.locator('#ns-victory')).toBeVisible();
  await expect(page.locator('#ns-victory')).toContainText('SYSTEM REWRITTEN');
  await expect(page.locator('#ns-victory')).toContainText('PLAY AGAIN');
  await page.waitForTimeout(150);
  await shot(page, '21-victory');
  // keyboard on the victory menu: Enter = PLAY AGAIN → fresh stage-1 run
  await page.keyboard.press('Enter');
  expect(await screen(page)).toBe('play');
  expect(await page.evaluate(() => ({ s: NS.game.stage, k: NS.game.kills }))).toEqual({ s: 0, k: 0 });
});

test('victory menu: TITLE SCREEN returns to the title with CONTINUE offered', async ({ page }) => {
  await boot(page);
  await loadStage(page, 2);
  await page.evaluate(() => NS.stageClear());
  expect(await screen(page)).toBe('victory');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  expect(await screen(page)).toBe('title');
  await expect(page.locator('#overlay')).toBeVisible();
  await expect(page.locator('#continue')).toBeVisible();
  await expect(page.locator('#continue')).toContainText('STAGE 3');
});

test('CONTINUE on the title resumes from the furthest stage in the save', async ({ page }) => {
  await boot(page, { seed: ['neonshift_save', JSON.stringify({ v: 2, chips: ['blade', 'cannon'], stage: 1, best: {} })] });
  await expect(page.locator('#continue')).toBeVisible();
  await page.locator('#continue').click();
  await page.waitForFunction(() => NS.game.running);
  expect(await page.evaluate(() => NS.game.stage)).toBe(1);
  expect((await P(page)).unlocked).toContain('cannon');
});

test('pause menu (Esc): freezes the live sim, keyboard navigable, RESUME restores control', async ({ page }) => {
  await boot(page); await start(page, { freeze: false });
  await page.keyboard.press('Escape');
  expect(await screen(page)).toBe('pause');
  await expect(page.locator('#ns-pause')).toBeVisible();
  for (const t of ['RESUME', 'RESTART STAGE', 'CHIP COLLECTION', 'QUIT TO TITLE']) await expect(page.locator('#ns-pause')).toContainText(t);
  const s0 = await page.evaluate(() => ({ x: NS.player.x, ticks: NS.game.ticks }));
  await page.keyboard.down('KeyD'); await page.waitForTimeout(400); await page.keyboard.up('KeyD');
  await page.keyboard.press('Shift');
  await page.waitForTimeout(150);
  const s1 = await page.evaluate(() => ({ x: NS.player.x, ticks: NS.game.ticks }));
  expect(s1).toEqual(s0);                                    // no sim ticks, no movement while paused
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');                        // RESUME
  expect(await screen(page)).toBe('play');
  await expect(page.locator('#ns-pause')).toBeHidden();
  await page.keyboard.down('KeyD'); await page.waitForTimeout(400); await page.keyboard.up('KeyD');
  expect((await P(page)).x).toBeGreaterThan(s0.x + 1);
});

test('pause menu: P toggles; RESTART STAGE and QUIT TO TITLE work', async ({ page }) => {
  await boot(page); await start(page);
  await clearEnemies(page);
  await page.evaluate(() => NS.tp(20, 0));
  await page.keyboard.press('KeyP');
  expect(await screen(page)).toBe('pause');
  await page.keyboard.press('KeyP');
  expect(await screen(page)).toBe('play');
  await page.keyboard.press('KeyP');
  await page.keyboard.press('ArrowDown');                    // RESTART STAGE
  await page.keyboard.press('Enter');
  expect(await screen(page)).toBe('play');
  expect((await P(page)).x).toBeLessThan(6);
  await page.keyboard.press('Escape');
  for (let k = 0; k < 5; k++) await page.keyboard.press('ArrowDown');   // QUIT TO TITLE (last item)
  await page.keyboard.press('Enter');
  expect(await screen(page)).toBe('title');
  await expect(page.locator('#overlay')).toBeVisible();
});

test('chip collection screen (Tab / C): pauses, lists every chip, locked ones hidden; closes again', async ({ page }) => {
  await boot(page); await start(page);
  await page.keyboard.press('Tab');
  expect(await screen(page)).toBe('chips');
  const scr = page.locator('#ns-chips');
  await expect(scr).toBeVisible();
  await expect(scr).toContainText('1 / 4 COLLECTED');
  await expect(scr.locator('.ns-chip.got')).toHaveCount(1);
  await expect(scr.locator('.ns-chip.lock')).toHaveCount(4);   // 3 locked chips + reserved CORE slot
  await expect(scr).toContainText('BLADE');
  await expect(scr).not.toContainText('CANNON');               // locked chips are not named
  expect(await page.evaluate(() => NS.game.paused)).toBe(true);
  await page.keyboard.press('Tab');
  expect(await screen(page)).toBe('play');
  await page.evaluate(() => NS.unlockAll());
  await page.keyboard.press('KeyC');
  await expect(scr).toContainText('4 / 4 COLLECTED');
  await expect(scr.locator('.ns-chip.got')).toHaveCount(4);
  await shot(page, '22-chip-collection');
  await page.keyboard.press('Escape');
  expect(await screen(page)).toBe('play');
});

test('R: a tap only shows a hint; holding R 0.6 s restarts the current stage (not the run)', async ({ page }) => {
  await boot(page);
  await loadStage(page, 1);
  await clearEnemies(page);
  await page.evaluate(() => NS.tp(30, 0));
  await page.keyboard.press('KeyR');
  await step(page, 10);
  expect((await P(page)).x).toBeGreaterThan(25);
  await page.keyboard.down('KeyR');
  await step(page, 45);                                       // 0.75 s
  await page.keyboard.up('KeyR');
  expect((await P(page)).x).toBeLessThan(6);
  expect(await page.evaluate(() => NS.game.stage)).toBe(1);
});

test('renderer: WebGL compositor by default (or a clean canvas fallback) and ?renderer=canvas forces canvas', async ({ page, browser }) => {
  await boot(page);
  const r = await page.evaluate(() => NS.renderer);
  test.info().annotations.push({ type: 'renderer', description: `default renderer in headless Edge: ${r}` });
  expect(['webgl', 'canvas']).toContain(r);
  if (r === 'webgl') await expect(page.locator('canvas#gl')).toBeVisible();
  await page.goto('/?renderer=canvas');
  await page.waitForFunction(() => window.NS && NS.ready);
  expect(await page.evaluate(() => NS.renderer)).toBe('canvas');
  await expect(page.locator('canvas#gl')).toHaveCount(0);
  await expect(page.locator('#screen')).toBeVisible();
});

test('canvas renderer is fully playable: start, move, attack, stage clear', async ({ page }) => {
  await page.goto('/?renderer=canvas');
  await page.waitForFunction(() => window.NS && NS.ready);
  expect(await page.evaluate(() => NS.renderer)).toBe('canvas');
  await start(page);
  await clearEnemies(page);
  const x0 = (await P(page)).x;
  await page.keyboard.down('KeyD'); await step(page, 30); await page.keyboard.up('KeyD');
  expect((await P(page)).x).toBeGreaterThan(x0 + 4);
  await page.keyboard.press('KeyJ'); await step(page, 3);
  expect((await P(page)).atkStep).toBeGreaterThan(0);
  const sd = await stageData(page, 0);
  await page.evaluate(x => NS.tp(x, 0), sd.exitX - 2);
  await page.keyboard.down('KeyD');
  expect(await stepUntil(page, "NS.game.screen === 'stageclear'", 120, { god: true })).toBeLessThan(120);
  await page.keyboard.up('KeyD');
  await page.waitForTimeout(150);
  // the 2D canvas really shows the frame (not a blank / black buffer)
  const lit = await page.evaluate(() => {
    const c = document.getElementById('screen'), g = c.getContext('2d'), d = g.getImageData(0, 0, c.width, c.height).data;
    let n = 0; for (let i = 0; i < d.length; i += 4 * 97) if (d[i] + d[i + 1] + d[i + 2] > 60) n++; return n;
  });
  expect(lit).toBeGreaterThan(50);
});

/* enter the stage-3 boss arena on foot (real keys) and return when the boss is live */
async function enterBoss(page) {
  const sd = await stageData(page, 2);
  const a = sd.arenas.find(x => x.boss);
  await clearEnemies(page);
  await page.evaluate(x => { NS.tp(x, 0); }, a.trigger - 2);
  await page.keyboard.down('KeyD');
  const n = await stepUntil(page, 'NS.game.arena && NS.game.arena.boss && NS.boss && NS.boss.alive', 200, { god: true });
  await page.keyboard.up('KeyD');
  return n;
}
async function dieNow(page) {
  await page.evaluate(() => { NS.enemyBullets.length = 0; const p = NS.player; p.inv = 0; p.hp = 1; p.shielding = false; p.facing = NS.boss && NS.boss.x < p.x ? -1 : 1; });
  await shootAtPlayer(page, 1.2, 99);
  await stepUntil(page, 'NS.player.dead', 40);
  expect((await P(page)).dead).toBe(true);
  expect(await stepUntil(page, '!NS.player.dead', 400)).toBeLessThan(400);
}

test('boss checkpoint: dying in phase 1 restarts the fight at full HP', async ({ page }) => {
  await boot(page); await loadStage(page, 2); await page.evaluate(() => NS.unlockAll());
  expect(await enterBoss(page)).toBeLessThan(200);
  await page.evaluate(() => { NS.boss.hp = 50; });           // damaged but still phase 1 (> 40)
  await step(page, 2);
  expect(await page.evaluate(() => NS.boss.phase2)).toBe(false);
  await dieNow(page);
  expect(await enterBoss(page)).toBeLessThan(200);
  expect(await page.evaluate(() => ({ hp: NS.boss.hp, p2: NS.boss.phase2 }))).toEqual({ hp: 80, p2: false });
});

test('boss checkpoint: dying in phase 2 (OVERDRIVE) restarts the fight at 40/80 HP, still in overdrive', async ({ page }) => {
  await boot(page); await loadStage(page, 2); await page.evaluate(() => NS.unlockAll());
  expect(await enterBoss(page)).toBeLessThan(200);
  await page.evaluate(() => { NS.boss.hp = 30; });
  expect(await stepUntil(page, 'NS.boss.phase2', 30, { god: true })).toBeLessThan(30);
  await expect(page.locator('#boss-name')).toHaveText('WARDEN // OVERDRIVE');
  await dieNow(page);
  expect(await enterBoss(page)).toBeLessThan(200);
  expect(await page.evaluate(() => ({ hp: NS.boss.hp, max: NS.boss.maxhp, p2: NS.boss.phase2 }))).toEqual({ hp: 40, max: 80, p2: true });
  // a fresh stage load clears the mid-fight checkpoint
  await page.evaluate(() => NS.loadStage(2, true)); await page.evaluate(() => { NS.game.freeze = true; NS.unlockAll(); });
  expect(await enterBoss(page)).toBeLessThan(200);
  expect(await page.evaluate(() => NS.boss.hp)).toBe(80);
});

test('stage-clear beat is outcome-locked: holding R or a lethal hit during the STAGE CLEAR card changes nothing', async ({ page }) => {
  await boot(page); await loadStage(page, 0); await clearEnemies(page);
  const sd = await stageData(page, 0);
  await page.evaluate(x => NS.tp(x, 0), sd.exitX - 2);
  await page.keyboard.down('KeyD');
  expect(await stepUntil(page, "NS.game.screen === 'stageclear'", 120, { god: true })).toBeLessThan(120);
  await page.keyboard.up('KeyD');
  await page.evaluate(() => { NS.player.inv = 0; NS.player.hp = 1; });
  await page.keyboard.down('KeyR'); await step(page, 45); await page.keyboard.up('KeyR');
  expect(await stepUntil(page, "NS.game.stage === 1 && NS.game.screen === 'play'", 300)).toBeLessThan(300);
  expect(await page.evaluate(() => NS.game.deaths)).toBe(0);
});

test('camera: lockdown start/end framing moves at most 30 u/s (no snap)', async ({ page }) => {
  await boot(page); await loadStage(page, 0); await clearEnemies(page);
  const a = (await stageData(page, 0)).arenas[0];
  await page.evaluate(x => { NS.tp(x, 0); NS.player.inv = 999; }, a.trigger - 1);
  await page.keyboard.down('KeyD');
  const r = await page.evaluate(() => {
    let max = 0, prev = NS.camera.x, locked = false;
    for (let i = 0; i < 120; i++) { NS.player.inv = 9; NS.step(1); const x = NS.camera.x; max = Math.max(max, Math.abs(x - prev)); prev = x; if (NS.game.arena) locked = true; }
    return { max, locked };
  });
  await page.keyboard.up('KeyD');
  expect(r.locked).toBe(true);
  expect(r.max, 'max camera move per 1/60 s frame').toBeLessThanOrEqual(30 / 60 + 1e-6);
  // clear the arena → walls drop → camera eases back
  await page.evaluate(id => { for (const e of NS.enemies) if (e.arenaId === id) { e.alive = false; } }, a.id);
  const r2 = await page.evaluate(() => { let max = 0, prev = NS.camera.x; for (let i = 0; i < 90; i++) { NS.step(1); const x = NS.camera.x; max = Math.max(max, Math.abs(x - prev)); prev = x; } return { max, arena: NS.game.arena }; });
  expect(r2.arena).toBeNull();
  expect(r2.max).toBeLessThanOrEqual(30 / 60 + 1e-6);
});
