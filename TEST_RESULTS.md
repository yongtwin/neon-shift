# NEON//SHIFT — Test Results (QA, Agent C)

**Date:** 2026-11-20 · **Gate:** final regression on the final gameplay commit

## Build under test

| | |
|---|---|
| **Commit** | **`2e587dc`**: Fix round 3 (gameplay): boss accessibility tuning + phase-2 checkpoint, camera speed cap on lockdowns, no restart/death during boss death sequence |
| How served | `git archive 2e587dc` into a clean scratch folder. No working-tree edits could leak in. The same export was used for both builds below. |
| Dev build | Vite 6.0.7 dev server (`vite --port 5178`) |
| Production build | `npm run build` → `dist/` (index.html 4.5 kB, CSS 15 kB, JS 635 kB / 184 kB gzip). Served with `vite preview --port 4173` |
| Environment | Windows 11 Pro · Node v26.12.0 · @playwright/test 1.49.1 · Microsoft Edge (`channel: 'msedge'`), headless, 1280×720. Default renderer in headless Edge: **webgl** |
| Command | `NS_URL=<url> timeout 600 node tests/run.mjs` (run.mjs works around the PW 1.49 / Node 26 ESM-loader hang) |

## Summary

| Run | Build | Pass | Fail | Skip/fixme | Flaky | Duration |
|---|---|---|---|---|---|---|
| Gate run 1 | dev `2e587dc` | **78** | 0 | 0 | 0 | 65 s |
| Gate run 2 | dev `2e587dc` | **78** | 0 | 0 | 0 | 66 s |
| Production smoke (the whole suite) | `vite preview` of `dist/` | **78** | 0 | 0 | 0 | 62 s |

The production run boots, plays all three stages and the boss, and reaches the victory screen. It had **no console errors,
no uncaught exceptions, and no failed or 4xx/5xx requests**. Every test asserts this through the auto-fixture, and one test
checks requests explicitly. `/favicon.ico` is no longer requested (`<link rel="icon" href="data:,">`).

Earlier in this gate, the same suite ran on `940d6d7`/`6f3bba1`: 74/74 (dev), 73/74 (dev), 74/74 (prod). The single failure
was a harness problem, not a game bug: Windows briefly locked a screenshot PNG while it was being written
(`UNKNOWN: unknown error, open …03-combo-slash-finisher.png`). `shot()` now retries the write.

## Measured evidence (production run)

- **Frame time:** rAF median 6.9 ms, p95 7.1 ms. Sim cost 0.14 ms per 60 Hz frame (`NS.step`, fixed 120 Hz ticks).
- **Combat flow, real keys:** run +11.5 u → jump 2.05 u high → blade 2 dmg → `Q` cannon 1 dmg → `K` blink 5.3 u → cannon
  fires straight out of the blink → `Q` back to blade, swing starts.
- **5-minute spam fight:** live particles 2–14, slashes ≤ 1, ghosts ≤ 3, bullets ≤ 2. The enemy list stayed at 21 the whole
  time (no growth).
- **Live smoke per stage (10 s of real keyboard bot each, all chips):** no errors. The bot reached x 91 (stage 1, held by
  the yard lockdown), x 145 (stage 2) and x 45 (stage 3, held by the ring lockdown). Being held by a lockdown is the
  intended design, not a stall.
- **Boss:** `maxhp` 80. The HUD reads `WARDEN // CORE SENTINEL` and switches to `WARDEN // OVERDRIVE` at ≤ 40 HP.
  - Dying in phase 1 → the boss comes back at 80/80, phase 1.
  - Dying in phase 2 → the boss comes back at **40/80, overdrive**. A fresh stage load resets it to 80.
- **Outcome lock:**
  - During the boss death sequence, a lethal bolt plus holding R for 0.75 s → player alive, stage unchanged.
  - During the STAGE CLEAR card, holding R → stage 2 still loads and 0 deaths are counted.
- **Camera cap:** across lockdown start and lockdown end, the largest camera move was ≤ 0.5 u per 1/60 s frame (30 u/s).

## Results by test (identical in all three runs: dev ×2, prod ×1)

| Spec | Test | Result |
|---|---|---|
| movement | A/D: hold right then left moves both ways at run speed | PASS |
| movement | arrow keys: same | PASS |
| movement | holding a key is not faster than tap+hold (no key-repeat speed-up) | PASS |
| movement | jump (W) held: apex, lands | PASS |
| movement | jump (Space) held: apex, lands | PASS |
| movement | variable jump height: tap < hold | PASS |
| movement | double jump higher than single; third press ignored | PASS |
| movement | fast re-tap: release + re-press in the same frame still gives a full air jump (**D-1 regression**) | PASS (fixed) |
| movement | dash distance + cooldown | PASS |
| movement | movement responsive during/after the 3-hit combo (back to full run speed after the swing) | PASS |
| movement | window blur clears held keys; next press works | PASS |
| movement | visibilitychange clears held keys | PASS |
| movement | keyboard works after clicking HUD / canvas / body | PASS |
| movement | LIVE rAF: hold D ~1 s moves right | PASS |
| movement | LIVE rAF: control kept after many direction changes | PASS |
| combat | blade damages in reach | PASS |
| combat | blade misses out of reach / behind | PASS |
| combat | 3-hit combo 1→2→3, finisher kills, kill counter | PASS |
| combat | enemy reacts (flash, knockback, stun), dies at 0 HP | PASS |
| combat | cannon bolt hits a distant enemy | PASS |
| combat | charged lance (hold J): piercing, ≥ 3 dmg | PASS |
| combat | unshielded bolt costs 1 HP | PASS |
| combat | shield BLOCK: no damage, no reflect, no crit | PASS |
| combat | shield PARRY: reflect, crit armed, no damage | PASS |
| combat | shield covers the front only | PASS |
| combat | hit-stop starts and always ends (stepped) | PASS |
| combat | attack pressed during hit-stop is buffered (**D-2 regression**) | PASS |
| combat | LIVE rAF: hit-stop ends after a burst of hits | PASS |
| combat | 30 rapid chip swaps never break either weapon | PASS |
| combat | blink warps 5.3 u and damages along its path | PASS |
| combat | **combat flow (real keys): run → jump → blade → Q → fire → K blink → attack** | PASS |
| chips | fresh save: BLADE only, HUD 1 / 4 | PASS |
| chips | CANNON pickup (stage 1, x 61 from `stageData`) unlocks + equips + saves | PASS |
| chips | unlocks persist across reload (all 4, via the stage-3 catch-up pickups) | PASS |
| chips | locked chips unusable (Q / 2 / K / L) | PASS |
| chips | weapon swap mid-combo never pauses; new weapon fires at once | PASS |
| chips | shield + blink usable with either weapon | PASS |
| chips | corrupt legacy save → defaults | PASS |
| chips | unknown chip ids ignored | PASS |
| chips | RESET CHIPS clears the collection | PASS |
| chips | versioned save: v1 array migrates to `{v:2, chips}` | PASS |
| chips | versioned save: newer build (v:99) read forward-compatibly, unknown fields preserved on commit | PASS |
| chips | versioned save: corrupt v2 falls back to intact v1, bad data backed up | PASS |
| chips | versioned save: corrupt JSON / wrong types / array → safe defaults (3 tests) | PASS ×3 |
| flow | title → START → stage 1, keys work right after the click | PASS |
| flow | Enter on focused START starts once; next Space is a jump | PASS |
| flow | **stage 1 / 2 / 3**: loads, `validateStage` ok (exit, pickups, checkpoints reachable), checkpoint → death → respawn there with full HP, input works (3 tests) | PASS ×3 |
| flow | stage exit → STAGE CLEAR card → next stage (1→2→3); save remembers stage 3 | PASS |
| flow | pit = death → respawn at checkpoint, controllable | PASS |
| flow | lockdown walls hold the player; dying inside resets the arena wave | PASS |
| flow | **boss**: arena locks, bar shows, can't leave while it lives; defeat → death sequence (outcome-locked) → **VICTORY** screen; Enter = PLAY AGAIN | PASS |
| flow | victory → TITLE SCREEN → CONTINUE · STAGE 3 offered | PASS |
| flow | CONTINUE resumes from the furthest saved stage | PASS |
| flow | **pause menu** (Esc): no sim ticks while open, keyboard navigable, RESUME restores control | PASS |
| flow | pause menu: P toggles; RESTART STAGE; QUIT TO TITLE | PASS |
| flow | **chip collection screen** (Tab / C / Esc): pauses, 1/4 → 4/4, locked chips unnamed, CORE slot shown | PASS |
| flow | R tap = hint only; hold R 0.6 s restarts the current stage | PASS |
| flow | **renderers**: WebGL by default; `?renderer=canvas` forces canvas (no `#gl`) | PASS |
| flow | canvas renderer fully playable (move, attack, stage clear, non-blank frame) | PASS |
| flow | boss checkpoint: death in phase 1 → full 80 HP | PASS |
| flow | boss checkpoint: death in phase 2 → 40/80, overdrive; fresh load → 80 | PASS |
| flow | stage-clear beat outcome-locked (hold R / lethal hit ignored) | PASS |
| flow | camera ≤ 30 u/s on lockdown start and end | PASS |
| technical | no failed requests while loading | PASS |
| technical | scripted live run ~20 s, real keys, all chips: no errors | PASS |
| technical | 5-min spam fight: FX / projectile / enemy counts bounded | PASS |
| technical | hit-stop never sticks across 2000 hits | PASS |
| technical | frame time (median < 20 ms, sim < 8 ms) | PASS |
| technical | NS API contract | PASS |
| technical | `NS.loadStage(0..2)` loads, `loadStage(3)` refused, `NS.levels` has 3 stages | PASS |
| technical | 10 s live play per stage with real keys, no errors | PASS |
| screenshots | title; gameplay / combo / cannon / shield / blink; each stage | PASS ×3 |

## Defects

**No open defects** against `2e587dc`. Earlier defects:

| ID | Severity | Status | Repro / note |
|---|---|---|---|
| D-1 | Major | **Fixed** (`940d6d7`), regression test passes | Hold W ~0.3 s, release and re-press inside one frame. The air jump used to gain only 0.67 u. |
| D-2 | Major | Fixed (`3b1687f`), regression test passes | A J press during hit-stop was dropped. |
| D-3 | Minor | Fixed (`3b1687f`) | A/D nudged the player while paused. The pause test now also checks that no sim ticks run while paused. |
| D-4 | Minor (visual) | **Still visible** | On the slash-3 finisher, the impact flash and white hit-flash cover both the ninja and the enemy during hit-stop (`03-combo-slash-finisher.png`). Readability only. Assign to B if wanted. |
| D-5 | Minor | Fixed | `/favicon.ico` 404. |
| H-1 | Harness | Mitigated | A transient Windows file lock while writing a screenshot (1 occurrence in 7 full runs). `shot()` now retries the write. |

## Not verified / limits

- **The full 80-HP boss fight was not completed by real play.** The automated test drops the boss to 4 HP, then finishes it
  with real blade presses (god mode), and checks the death sequence, the outcome lock and the victory screen. Boss
  difficulty and pattern fairness still need a human playtest.
- **No full stage was played start to finish by a bot.** Flow tests teleport between checkpoints and exits.
  `validateStage` proves reachability against the jump physics, and 10 s live bot runs per stage stop at the first lockdown.
- **Headless only.** Timings come from headless Edge (rAF ≈ 144 Hz). The game was not tested on real displays or GPUs, or
  with a gamepad or touch input.
- **Screenshot timing:** CSS fades run on real time while the stepped sim is frozen. Screenshots wait 120–450 ms so
  cards have finished fading before capture.
- **Bundle size:** the production build warns that one chunk is larger than 500 kB (635 kB, mostly three.js). This is
  informational only.

## Screenshots (`docs/screenshots/qa/`, from `2e587dc` production + dev runs)

`01-title` · `02-gameplay` · `03-combo-slash-finisher` · `04-cannon-fire` · `05-shield` · `06-blink` ·
`10-stage1-neon-district` · `11-stage2-security-complex` · `12-stage3-cyber-core` · `20-boss-fight` · `21-victory` ·
`22-chip-collection`
