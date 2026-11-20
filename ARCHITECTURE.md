# NEON//SHIFT — Architecture

Vite + plain ES modules, no framework. ~5.8k lines. `npm run dev` serves `index.html` → `src/main.js`.

## Frame pipeline

```
requestAnimationFrame
  └─ Game.frame (src/core/game.js)
       ├─ input: keyboard / gamepad poll → keys{} (held) + pressed{} (edge, buffered)
       ├─ fixed-step accumulator @ 120 Hz (NS.TICK) ── skipped while paused / menu open
       │    hit-stop (Feel) consumes ticks first; slow-mo scales dt
       │    player → world triggers / pickups → hazards → enemies → arenas → projectiles → FX → camera
       ├─ HUD.update (DOM, only writes on change)
       └─ renderFrame (src/render/render.js)
            Canvas 2D low-res pixel buffer (~270 px tall), interpolated with Game.alpha
            └─ compositor (src/render/compositor.js): three.js full-screen quad,
               integer upscale, bloom (half-res), scanlines, vignette, chromatic flash
               └─ fallback: CSS-scaled 2D canvas (WebGL missing / context lost / ?renderer=canvas)
```

**Why Canvas 2D + Three.js rather than 3-D sprites:** pixel art needs a pixel-exact pipeline. Characters are
skeleton/pose-driven pixel rasterisers that produce cached frames; Three.js is used where it adds real value —
the GPU post-processing pass. The game remains fully playable on the canvas fallback.

## Modules

| Area | Files | Notes |
|---|---|---|
| core | `game.js` (loop, flow, camera), `input.js`, `audio.js` (WebAudio synth SFX + procedural EDM), `save.js`, `state.js`, `util.js` | `S` in `state.js` holds shared mutable handles; arrays (`bullets`, `enemies`, …) are mutated in place so imports stay valid |
| player | `player.js` | movement (coyote, buffer, variable jump, double jump, dash), blade/cannon/shield/blink state, anchors |
| combat | `combat.js` (hit resolution, block/parry, projectiles), `feel.js` (hit-stop, shake, flash, slow-mo) | gameplay hitboxes never read from art |
| chips | `chips.js` | registry `{id, name, slot: rarm/larm/legs/core, colour, desc}`, swap/select, lock checks |
| enemies | `enemies.js` | gunner, enforcer, drone, turret, Warden boss; patrol → alert → windup → attack → recover; poise/armour; lockdown arenas |
| levels | `stages.js` (3 stage definitions), `stage1.js` (live view of the *current* stage — arrays mutated on load), `world.js` (collision, hazards), `validate.js` (jump reachability using the real physics) | |
| art | `ninja.js` + `ninja-pixel.js` (protagonist), `enemy-art.js`, `pixel.js` (primitives, font), `art.js` (routing) | frame cache keyed by quantised pose |
| render | `render.js`, `themes.js` (district / complex / core), `compositor.js` | `onStageLoad(stage)` rebuilds theme art |
| effects | `fx.js` | pooled particles, slash arcs, after-images, impact stars |
| ui | `hud.js` (DOM HUD), `screens.js` (pause, chip collection, stage cards, victory) | |

## Save schema

`localStorage['neonshift_save'] = { v: 2, chips: string[], stage: number, best: {...} }`. Legacy
`neonshift_chips_v1` arrays are migrated. Corrupt JSON → defaults (never throws). Blocked storage → in-memory.

## Test hooks

`window.NS` (see `src/main.js`): state accessors, `step(n)` deterministic fixed ticks, `hold(code)`,
`press(action)`, `tp`, `unlockAll`, `loadStage(i)`, `stageClear()`, `boss`, `validateStage(i)`, `feel`, `save`,
`renderer`. Playwright suite in `tests/` (run via `tests/run.mjs` — works around a Playwright 1.49 ESM-loader
hang on Node 26).

## Team integration decisions

- Agents worked in one checkout with strict per-directory ownership; the lead committed each approved slice.
- Cross-area contracts (pose fields, stage interface, hazard fields) were relayed by the lead and are
  documented in `docs/ART_BIBLE.md` and in the module headers.
