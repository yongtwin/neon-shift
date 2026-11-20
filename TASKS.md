# NEON//SHIFT — Task Board

Lead Director: main session. Team runs as Claude Code **subagents** (Agent tool, named, background) — the
experimental Agent Teams feature is not available in this session, so this is the documented fallback.
Agents never commit; the lead integrates and commits checkpoints.

## File ownership (no two agents edit the same file concurrently)

| Area | Owner |
|---|---|
| `src/core/` (loop, input, save, audio, game flow), `src/player/`, `src/combat/`, `src/chips/`, `src/enemies/`, `src/levels/` | **A — Combat & Gameplay** |
| `src/art/`, `src/render/`, `src/effects/`, `src/ui/`, `css/`, `assets/` | **B — Pixel Art, Animation & UI visuals** |
| `tests/`, `playwright.config.js`, `TEST_RESULTS.md`, `docs/screenshots/` | **C — QA** |
| `docs/REVIEW.md` (read-only everywhere else) | **D — Reviewer** |
| `package.json`, `vite.config.js`, `index.html`, root docs, git | **Lead** |

Cross-area changes: request through the lead (or a note in the owning agent's section of this file).

## Phases

| # | Task | Owner | Depends | State |
|---|---|---|---|---|
| 0 | Baseline tag `baseline-v0.6`, npm/Vite/Three/Playwright toolchain | Lead | — | done |
| 1 | Convert classic-script globals to ES modules under `src/`, Vite entry, keep `window.NS` test API | A | 0 | done (b2b68f6, pixel-identical) |
| 1 | v0.6 audit → docs/REVIEW.md (2 critical, 18 major, 14 minor) | D | — | done |
| 1 | Art bible + new ninja rasteriser prototype (`src/art/ninja.js`, new file) | B | — | done |
| 1 | Playwright harness + regression suite skeleton on `window.NS` | C | 0 | done |
| 1 | Independent audit of v0.6 (code + screenshots) → `docs/REVIEW.md` | D | — | done |
| 2 | Combat feel pass (blade 3-hit, cannon, shield/parry, blink), versioned save, chip registry with body slots | A | 1 | done |
| 2 | Integrate new ninja + transformations, Three.js compositor w/ Canvas fallback, VFX | B | 1 | done |
| 3 | 3 stages (Neon District, Security Complex, Cyber Core), checkpoints, boss, title/pause/victory/game-over flow | A | 2 | done |
| 3 | Stage themes, boss art, chip collection screen, menus visuals | B | 2 | done |
| 4 | Full regression + review rounds, fixes (max 4 rounds/feature) | all | 3 | done |
| 5 | Docs, production build verification, release notes | Lead | 4 | done |

## Open (post-v1.0)
See PROGRESS.md "Known issues": D-4 finisher flash, R2-004 residual, R2-016 stage taxes, human playtest, gamepad/touch/real-GPU checks.
