# NEON//SHIFT — Progress & Release Notes

## v1.0 (tag `v1.0`), 2026-11-20

### Release summary
NEON//SHIFT has grown from a one-level combat prototype (v0.6) into a complete short game:
- a title screen, then three stages, then a boss, then a victory screen
- a redesigned original cyber-ninja
- reworked combat feel
- permanent chip unlocks with a versioned save
- a Three.js post-processing renderer with a canvas fallback
- a 78-test Playwright suite that passes on both the dev and production builds

### What changed since v0.6
- **Architecture:** Vite + ES modules under `src/`. The conversion was verified pixel-identical to v0.6 before
  any feature work started. The game uses `npm install`, `npm run dev`, `npm run build` and `npm test`.
- **Combat:**
  - Blade swings have anticipation, active and recovery phases, with a lunge. Inputs are buffered and
    facing is locked during the active window.
  - Hit-stop is 50/60/90 ms on the three combo hits, 120 ms on kills and 200 ms on the boss kill. Screen
    shake builds to 2–5 px and is noticeable.
  - Hits show an impact star and knockback with a bounce, and the music ducks on impact.
  - Enemies have poise, so they can't be stun-locked.
  - Shield has a guard meter with guard-break; blocks and parries look and sound different.
  - Blink respects walls and pits.
  - Physics runs on a fixed 120 Hz step, so results are the same at every refresh rate.
- **Character art:** a new original ninja about 46 px tall. It has a helmet with a glowing visor, mechanical
  limbs and a scarf. Each chip transforms it visibly: an energy-sword forearm, a plasma-cannon forearm, a
  hard-light shield, or calf thrusters. All required animations are in, including hit and death.
- **Enemies:** gunner, enforcer, drone and turret, all with readable telegraphs. The boss is
  WARDEN // CORE SENTINEL, drawn at 1.7× scale, with a bolt fan, a ground slam with shockwaves, a charge
  with a danger lane, an EXPOSED punish window, an overdrive phase, a mid-fight checkpoint and a death
  sequence.
- **Stages:**
  - Neon District teaches movement, blade and cannon.
  - Security Complex introduces the shield, turrets, timed lasers, spikes, drones and the blink gate.
  - Cyber Core mixes everything and ends with the boss.
  - Every jump is checked for reachability against the real physics.
- **Flow and UI:**
  - Stage intro and stage-clear cards.
  - Pause menu, chip collection screen (Tab/C) and victory screen with stats.
  - CONTINUE from the highest stage reached; hold R to restart the current stage.
  - The HUD has backing panels, guard pips and a stage label.
- **Rendering:** the Canvas 2D pixel buffer is composited by Three.js with bloom, scanlines, vignette and a
  flash aberration. It falls back to plain canvas automatically or with `?renderer=canvas`.
- **Save:** `neonshift_save` uses schema `{v:2, chips, stage, best}`. The save code:
  - migrates v1 saves;
  - keeps saves from newer versions instead of overwriting them;
  - falls back from a corrupt v2 save to the v1 save, with a backup.

### How it was built
The lead director worked with four Claude Code subagents: Gameplay (A), Art and Rendering (B), QA (C) and
Reviewer (D). Each owned its own files. The experimental Agent Teams feature was not available in this
session, so named background subagents were the fallback. The process ran in loops of plan, implement,
independent review, browser QA, fix and integrate:
- **Three review rounds:**
  - 34 issues in the v0.6 audit.
  - 17 new issues in round 2, including 1 critical boss exploit.
  - Round 3 found no unresolved critical or major issues.
- **Three gameplay fix rounds and two art fix rounds.**

### Verification evidence
- `TEST_RESULTS.md`: 78/78 passing, twice on the dev build and once against the production `dist/`
  preview. It records no console errors and no 404s.
- `docs/REVIEW.md`: the three review rounds with probe measurements.
- Screenshots:
  - `docs/screenshots/qa/` (each stage, the boss, victory, chip screen)
  - `docs/screenshots/art/` (sprite sheets, before/after, phase 2–4)
  - `docs/screenshots/review/`
- Boss fairness was measured with bots that react in 0.28 s. They win 6/6 with about one death each.
  Mashing never wins.

## Known issues / not done
| ID | Severity | Item |
|---|---|---|
| D-4 | minor | The blade finisher's white impact flash briefly washes out both fighters' silhouettes (a few frames). |
| R2-004 (residual) | minor | Enforcers start a counter windup under pressure but usually die before it lands; one combo still kills a lone enemy. |
| R2-016 | minor | The stage 2 spike floor and the stage 3 catch-up chip pickups are "taxes" rather than real skill tests. |
| — | unverified | **No human playtest yet.** Feel, difficulty and stage length (bots take 38–55 s per stage) were measured with bots only. |
| — | unverified | Only headless Edge was tested. There was no real-GPU frame-rate measurement, and gamepad and touch input are untested. |
| — | unverified | The automated suite never plays a full 80-HP boss fight with real keys; the bots did that through `NS` hooks. |
| — | env | Playwright 1.49 hangs when loading ESM tests on Node 26. `npm test` goes through `tests/run.mjs`, which works around it. Never run `npx playwright test` directly. |
| — | scope | Audio is synthesized SFX plus procedural music. There's no settings or key-remapping screen and no stage select. The CORE chip slot is reserved but empty. |
