# NEON//SHIFT — Test Results (QA, Agent C)

**Date:** 2026-11-19 · **Phase:** 1 (harness + baseline)

## Builds under test

`HEAD` moved three times during this pass, and the working tree was mid-edit (A and B). To get repeatable results,
each committed build was exported with `git archive <sha>` into a clean scratch folder and served there with its own
Vite instance. That way, uncommitted edits could not leak into a run.

| Build | Commit | Result | Notes |
|---|---|---|---|
| Latest committed (**primary**) | `2f2a449` Art phase 3 | **60 pass · 1 fail · 10 fixme** | Ran twice. Results matched on both runs. The screenshots in `docs/screenshots/qa/` come from this build |
| Combat feel pass | `3b1687f` | 60 pass · 1 fail · 10 fixme | Ran 3 more times with `--repeat-each=3`: 180 pass / 3 fail, every fail the same test. **No flaky tests** |
| v0.6 converted to Vite | `606374a` | 57 pass · 4 fail · 10 fixme | Ran 3 times. The 3 failing tests failed every time. The 4th fail is the versioned-save test, and v2 saves don't exist in this build |
| Working tree (uncommitted) | `2f2a449` + local edits | 49 pass · 12 fail | Not filed as defects. Stage layout, pickups and checkpoints are being reworked (new `stages.js`), and one load hit a transient `NS is not defined` while modules were being edited |

`legacy js/` (`baseline-v0.6`, served by python) was the original target. A ran once against it, then dropped it when the
conversion landed. The test API is identical there.

## Environment

- Windows 11 Pro, Node **v26.12.0**, @playwright/test 1.49.1, Microsoft Edge (`channel: 'msedge'`), headless, 1280×720.
- Vite 6.0.7 dev server. `playwright.config.js` starts `npx vite --port 5173 --strictPort` (reuseExistingServer). Set
  `NS_URL=<url>` to target an already-running build instead; the webServer step is then skipped.
- **Run with `node tests/run.mjs [args]`**, not bare `npx playwright test`. Playwright 1.49's ESM loader hook hangs forever
  on Node 26 with `"type":"module"` (even `--list` hangs). `tests/run.mjs` sets `PW_DISABLE_TS_ESM=1`, which avoids the hang.
  The other fix is to upgrade Playwright.
- Trace and screenshot capture on failure are **off** by default (`NS_TRACE=1` turns them on). With capture on, a failing test
  stalled the worker for the full 60 s timeout on this machine (Edge GPU process crash during capture).

## How the suite drives the game

- **Input tests use real keyboard events** (`page.keyboard.down/up/press`). These go through the game's own `keydown`
  listeners, not `NS.hold`. The live rAF loop is frozen with `NS.game.freeze = true` and the game is advanced
  deterministically with `NS.step(n)`. Several tests also run the **live** loop unfrozen, with real time.
- An auto-fixture fails **any** test that raises an uncaught page error, prints a `console.error`, or sets `NS.game.simError`.
- Combat tests isolate a single enemy (`isolateEnemy`) and read HP / damage from the game. Nothing is hard-coded, so
  the tests survive tuning.

## Results: `2f2a449` (primary)

| Spec | Test | Result | Evidence for failures |
|---|---|---|---|
| movement | A/D: hold right then left moves the player both ways at run speed | PASS | |
| movement | arrow keys: hold right then left moves both ways at run speed | PASS | |
| movement | holding a key is not faster than tapping-then-holding (no key-repeat speed-up) | PASS | |
| movement | jump (KeyW) held: expected apex, lands again | PASS | |
| movement | jump (Space) held: expected apex, lands again | PASS | |
| movement | variable jump height: tap jumps lower than hold | PASS | |
| movement | double jump goes higher than a single jump; a third press does nothing | PASS | |
| movement | **fast re-tap: release + re-press of jump in the same frame still gives a full double jump** | **FAIL** | Air jump gained only **0.67 u** (> 2.0 expected; a normal air jump is ~2.7 u). See D-1 |
| movement | dash covers distance quickly and respects its cooldown | PASS | |
| movement | movement stays responsive during and after a 3-hit blade combo | PASS | |
| movement | window blur clears held keys; next press controls the player again | PASS | |
| movement | tab hidden (visibilitychange) clears held keys | PASS | |
| movement | keyboard keeps working after clicking HUD / canvas / body | PASS | |
| movement | LIVE loop: holding D ~1 s moves the player right | PASS | |
| movement | LIVE loop: input still controls the player after many direction changes | PASS | |
| combat | blade damages an enemy inside its reach | PASS | |
| combat | blade does NOT damage an enemy outside reach or behind the player | PASS | |
| combat | 3-hit combo advances 1→2→3, finisher kills, kill counter updates | PASS | |
| combat | enemy reacts to a hit (flash, knockback, stun) and dies at 0 HP | PASS | |
| combat | cannon projectile travels and hits a distant enemy | PASS | |
| combat | cannon: hold J charges a piercing lance | PASS | |
| combat | unshielded: enemy bolt costs 1 HP | PASS | |
| combat | shield BLOCK: absorbed, no damage, no reflect, no crit | PASS | |
| combat | shield PARRY: bolt reflected, crit armed, no damage | PASS | |
| combat | shield covers the front only (bolt from behind hurts) | PASS | |
| combat | hit-stop starts on a hit and always ends (stepped) | PASS | |
| combat | hit-stop: attack pressed during the freeze is buffered and fires afterwards | PASS | (FAILS on `606374a`, see D-2) |
| combat | LIVE loop: hit-stop always ends under real rAF after a burst of hits | PASS | |
| combat | rapid chip switching (30 swaps) never breaks either weapon | PASS | |
| combat | blink warps forward and damages enemies in its path | PASS | |
| chips | fresh save: only BLADE unlocked, HUD 1 / 4 | PASS | |
| chips | walking over the CANNON pickup unlocks + equips + saves it | PASS | |
| chips | unlocks persist across a page reload | PASS | |
| chips | locked chips cannot be used (Q / 2 / K / L) | PASS | |
| chips | switching weapon mid-combo never pauses; new weapon fires at once | PASS | |
| chips | shield and blink usable together with either weapon | PASS | |
| chips | corrupt legacy save falls back to defaults | PASS | |
| chips | unknown chip ids in the save are ignored | PASS | |
| chips | RESET CHIPS on the title screen clears the collection | PASS | |
| chips | versioned save: v1 array migrates to `{v:2, chips}` | PASS | |
| chips | versioned save: corrupt JSON / future version / wrong types / array → safe defaults (4 tests) | PASS ×4 | |
| chips | chip collection screen | FIXME | Phase 3 |
| flow | title shows; START begins a run; keys work right after the click | PASS | |
| flow | Enter on focused START, then Space = jump (no double start) | PASS | |
| flow | checkpoint is recorded when passed | PASS | |
| flow | death → respawn at last checkpoint, full HP, input works | PASS | |
| flow | pit fall punished → back at checkpoint, alive, controllable | PASS | |
| flow | reaching the exit completes the level, results screen | PASS | |
| flow | PLAY AGAIN starts a fresh run | PASS | |
| flow | P pauses the live sim, keys do nothing while paused, P resumes | PASS | (FAILS on `606374a`, see D-3) |
| flow | R restarts mid-level | PASS | |
| flow | 3 stages via `NS.loadStage(0..2)` | FIXME | `loadStage` is a stub (stage 0 only) |
| flow | stage exit advances to the next stage | FIXME | |
| flow | final boss → victory screen | FIXME | |
| flow | boss arena cannot be skipped | FIXME | |
| flow | pause **menu** (resume / restart / quit) | FIXME | Today P only shows a toast |
| flow | game-over flow | FIXME | |
| flow | title → continue / stage select from the versioned save | FIXME | |
| technical | no failed requests while loading | PASS | (legacy python build: `/favicon.ico` 404 on every load, see D-5) |
| technical | scripted live run, ~20 s real keyboard, all chips: no errors | PASS | Bot reached x≈80 of 139, 2890 frames, 0 errors |
| technical | 5 min sim of constant spam: FX / projectile / enemy counts bounded | PASS | Peak live particles ≈ 21; slashes ≤ 1; bullets ≤ 2; enemy list stable |
| technical | hit-stop never sticks across 2000 random hits | PASS | |
| technical | frame time | PASS | rAF median 6.9–7.0 ms (p95 7–14 ms); sim `NS.step` 0.08–0.26 ms/frame |
| technical | NS test API contract present | PASS | |
| technical | `NS.loadStage(i)` loads every stage | FIXME | |
| technical | WebGL compositor + canvas fallback with WebGL disabled | FIXME | Needs `NS.renderer` (see requests) |
| screenshots | title; gameplay / combo / cannon / shield / blink | PASS | `docs/screenshots/qa/01..06-*.png` |

## Defects

| ID | Sev | Build(s) | Summary |
|---|---|---|---|
| D-1 | **Major** | `3b1687f`, `2f2a449` (open) | A fast double-tap of jump loses most of the air jump |
| D-2 | Major | `606374a` (fixed in `3b1687f`) | An attack pressed during hit-stop is silently dropped |
| D-3 | Minor | `606374a` (fixed in `3b1687f`) | Movement keys nudge the player while paused |
| D-4 | Minor (visual) | `2f2a449` | Finisher flash whites out both fighters |
| D-5 | Minor | legacy python build | `/favicon.ico` 404 → console error on every load |

**D-1 (Major, open): fast double-tap of jump loses most of the air jump.**
Repro: hold W ~0.3 s, then release W and press it again inside the same frame (a quick double-tap). The air jump gains
only 0.67 u instead of ~2.7 u. Cause: key-up sets `pressed.jumpCut` and key-down sets `pressed.jump`. The same tick then
starts the new air jump and **then** applies the cut to it (`player.js`: `doJump(...)` runs before
`if (pressed.jumpCut && p.vy > 0) p.vy *= jumpCut`). Fix: apply or clear `jumpCut` before handling a new jump, or ignore a
cut that arrives with a jump press in the same tick. Test: `movement.spec.js` › "fast re-tap…".

**D-2 (Major, fixed in `3b1687f`): attack pressed during hit-stop was dropped.**
Repro (606374a): hit an enemy with slash 1, then press J during the hit-stop freeze. Slash 2 never comes out. The 0.16 s
attack buffer starts counting when the freeze ends, but 0.17 s of blade cooldown is still left, so the buffer expires one
frame early. This broke the "input is buffered during hit-stop" invariant. The test stays in the suite as a regression guard.

**D-3 (Minor, fixed in `3b1687f`): A/D/arrow presses nudged the player while paused.**
Repro (606374a): press P, then tap D. x jumps +0.35 u and vx is set to 8 while the game is paused. The regression test stays.

**D-4 (Minor, visual, `2f2a449`): finisher flash hides both fighters.** On the slash-3 finisher, the impact flash and white
hit-flash cover both the ninja and the enemy for the whole hit-stop (see `03-combo-slash-finisher.png`). Combat becomes
hard to read at the most important moment. Worth a look from B.

**D-5 (Minor, legacy python build only):** `/favicon.ico` returned 404, which logs a console error on every load. The Vite
builds pass this check.

### Other observations (not filed as defects)

- `606374a` hit-stop counter overshoots below zero (-1 frame) because of float rounding. It is harmless and gone with the
  120 Hz accumulator in `3b1687f`.
- The working tree failed 12 tests. All of them are explained by the in-progress stage rework or a module half-written
  while loading. **Retest after the stage work is committed.**

## Requests to developers (test hooks)

1. **Level data on NS** (`NS.level = { checkpoints, pickups, exitX, pits, arenas }`) per stage. The flow and chips tests
   currently hard-code stage-1 coordinates (pickups 19/46/86, checkpoint 42, exit 139). These broke on the working-tree
   stage rework.
2. `NS.loadStage(i)` for 0..2 returning `true`, plus `NS.game.stage`. This unlocks 4 FIXMEs.
3. `NS.renderer` = `'webgl' | 'canvas'` and a URL flag (e.g. `?nogl`) to force the canvas fallback for the fallback test.
4. Screen-state hook (`NS.game.screen = 'title' | 'play' | 'pause' | 'victory' | 'gameover'`) for the menu and flow FIXMEs.
5. Lead: change the npm script to `"test": "node tests/run.mjs"` (Node 26 / PW 1.49 hang), or upgrade @playwright/test.

## Files

`playwright.config.js`, `tests/run.mjs` (launcher), `tests/helpers.js`, `tests/{movement,combat,chips,flow,technical,screenshots}.spec.js`,
`docs/screenshots/qa/01-title.png … 06-blink.png`.
