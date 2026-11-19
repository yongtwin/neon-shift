# NEON//SHIFT — project instructions

2D cyberpunk ninja action platformer. Browser game, Vite + ES modules, `three` for the WebGL presentation layer.

## Run
- `npm install` · `npm run dev` (Vite, http://localhost:5173) · `npm run build` → `dist/` · `npm run preview`
- `npm test` — Playwright regression suite (uses installed Edge/Chrome via `channel`, no browser download).

## Rendering invariant
Gameplay art is drawn with Canvas 2D into a low-res pixel buffer (~270 px tall, nearest-neighbour). Three.js
uploads that buffer as a texture and composites it (bloom/CRT post). If WebGL fails, the 2D buffer is blitted
directly — the game must stay fully playable without WebGL.

## Gameplay invariants
- Chips are **permanent unlocks**, never random, never consumed. Any unlocked chip can be selected at any time,
  including mid-combat; switching never pauses the game. Locked chips cannot be used.
- Body slots: R-ARM (Blade/Cannon, swapped with Q), L-ARM (Shield, L), LEGS (Blink, K), CORE (future).
- Save: `localStorage`, versioned schema, invalid/corrupt data falls back to defaults without throwing.
- Hit-stop freezes only the simulation; input is buffered; it must always end.
- Keyboard events must never silently stop controlling the player (clear keys on blur/visibility change).
- Physics: world units, y up, y=0 street. Physics constants live at the top of `src/player/player.js`.

## Test hooks
`window.NS` exposes state and deterministic stepping (`NS.step(n)`, `NS.hold(key)`, `NS.press(action)`,
`NS.tp(x,y)`, `NS.unlockAll()`, `NS.loadStage(i)`). Keep it working; Playwright tests depend on it.

## Process
- Do not commit `node_modules/` or `dist/`. Commit stable milestones only.
- Never claim a feature works unless a test or in-browser check passed. Record evidence in `TEST_RESULTS.md`.
- No copyrighted sprites; all art is original/programmatic.
