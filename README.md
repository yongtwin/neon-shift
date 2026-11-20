# NEON//SHIFT — v1.0

A fast 2D cyberpunk ninja action platformer for the browser. Collect **chips** that permanently rewrite your
body. Your arm becomes an energy blade or a plasma cannon, your off-arm projects a hard-light shield, and your
legs fire blink thrusters. Switch between them at any moment, even mid-combo, across three stages and a
boss fight.

## Run it

Requires Node 18+ (developed on Node 26) and a desktop Chromium browser (Edge/Chrome) or Firefox.

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:5173.

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server with hot reload |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve the production build at http://localhost:4173 |
| `npm test` | Playwright regression suite (uses your installed Edge — no browser download) |

URL options: `?renderer=canvas` forces the 2D fallback renderer, and `?mem` keeps the save in memory only.
`#sprites` / `#enemies` open the pose sheets. F3 shows debug info, F4 shows hitboxes.

## Controls

| Action | Keyboard | Gamepad |
|---|---|---|
| Move | `A` `D` / `←` `→` | left stick |
| Jump, double jump | `W` / `↑` / `Space` | A |
| Dash | `Shift` | B |
| **R-ARM** attack | `J`. Blade: 3-hit combo. Cannon: tap to shoot, hold to charge a piercing lance | X / RT |
| Swap Blade ⇄ Cannon | `Q` (or `1` / `2`) | RB |
| Cannon aim | auto-lock, or hold `I` (up) / `S` (down) | right stick |
| **L-ARM** Shield | hold `L` to block. Tap on impact to **parry**; a parry makes the next slash a critical | LT / LB |
| **LEGS** Blink | `K` / `E`: warp forward, slashing through enemies | Y |
| Chip collection | `Tab` / `C` | — |
| Pause | `Esc` / `P` | — |
| Music / mute | `N` / `M` | — |
| Restart stage | hold `R` | — |

## The game

- **Three stages.** *Neon District* teaches movement, blade and cannon. *Security Complex* adds turrets to
  parry, timed laser grids, spike floors, drones and the Blink chip. *Cyber Core* mixes every enemy and ends
  in the boss arena.
- **Boss: WARDEN // CORE SENTINEL.** Telegraphed bolt fans (block or parry), ground slams with shockwaves
  (jump them), and a charge along a red danger lane (blink through it to hit its exposed back). Overdrive
  starts at 50 % HP.
- **Permanent chips.** Chips are never drawn at random and never consumed. Unlocks and the highest stage
  reached are saved in `localStorage` (versioned schema) and survive refreshes; the title offers CONTINUE.
- **Combat feel.** Each swing has anticipation, an active window and recovery. Hits add hit-stop
  (50/60/90 ms, longer on kills), camera shake, impact stars, an enemy flash, knockback and music ducking.

## Project layout

See [ARCHITECTURE.md](ARCHITECTURE.md). Short version: `src/core` (loop, input, save, audio), `src/player`,
`src/combat`, `src/chips`, `src/enemies`, `src/levels`, `src/art` (procedural pixel-art rasterisers),
`src/render` (Canvas 2D pixel buffer, then a three.js post-processing compositor), `src/effects`, `src/ui`,
and `tests/` (Playwright).

Other documents: [GAME_DESIGN.md](GAME_DESIGN.md), [TASKS.md](TASKS.md), [TEST_RESULTS.md](TEST_RESULTS.md),
[PROGRESS.md](PROGRESS.md), [docs/REVIEW.md](docs/REVIEW.md), [docs/ART_BIBLE.md](docs/ART_BIBLE.md).

All art and audio are original and generated in code. There are no external asset files.
