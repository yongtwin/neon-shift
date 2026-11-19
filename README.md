# NEON//SHIFT — v0.4 "Combat Feel"

Cyberpunk chip-runner prototype. This build keeps the v0.3 level and movement and adds
impactful combat, a redrawn pixel-art ninja with visible chip transformations, readable enemy AI,
a parallax neon city and a restyled HUD.

## Run it

| How | Steps |
|---|---|
| **Easiest** | Double-click `NEON_SHIFT_v04.html` (one self-contained file, no internet, no server). |
| **Multi-file source** | Double-click `index.html`. It uses plain `<script>` tags (not ES modules), so it also works from `file://`. |
| **Local server** (optional) | `python -m http.server 8123` in this folder → open <http://localhost:8123>. |

After editing anything in `js/` or `css/`, run `node build.mjs` to regenerate `NEON_SHIFT_v04.html`.

Desktop Chrome / Edge. Touch buttons appear automatically on touch devices (or add `?touch` to the URL).

## Controls

| Action | Keys |
|---|---|
| Move | `A` `D` / arrows |
| Jump (×2) | `W` / `Space` / `↑` |
| Dash (i-frames) | `Shift` |
| Attack / fire / warp | `J` / `K` / mouse click (hold to repeat) |
| Shield | hold `J` — **tap it just before a hit to parry** |
| Swap chip | `1`–`4`, `Q` / `E`, or click the chip cards |
| Restart / pause / mute | `R` / `P` or `Esc` / `M` |
| Debug / hitboxes | `F3` / `F4` |

## What changed from v0.3

**Combat feel**
- **Hit-stop** (50 / 55 / 85 ms for the 3 blade hits, 100–140 ms on kills). It freezes the simulation only; the loop, camera shake and HUD keep running, and key presses made during the freeze are buffered.
- **Camera shake** (directional, scales with hit power), **screen flash** on kills / parries / damage.
- **Directional slash arcs** sized to the real hitbox, hit sparks, impact flash, enemy white-flash, knockback, flinch, debris explosion on kill.
- **Blade 3-hit combo**: slash → reverse slash → heavy finisher (2 / 2 / 3 damage, rising knockback and hit-stop). Presses are buffered, combo window 0.4 s after cooldown, attacks never lock movement (small forward step-in only), usable in the air.
- **Cannon**: recoil, muzzle-flash star, plasma bolt with trail, impact burst.
- **Shield**: hold to block (front only, 60 % move speed). A press timed within 0.2 s of the hit is a **PARRY**: bolts are reflected at 1.7× speed for 3 damage, melee lunges leave the enforcer **staggered** (+1 damage on everything while it is open). 0.55 s parry cooldown.
- **Blink**: warps 5.3 u, slashes everything in the path for 3, pink afterimage at the start, echo trail, flash at the end, short i-frames.
- **Per-chip cooldowns** (v0.3 shared one timer) with cooldown fill on the HUD cards; combo chain counter.

**Character** — programmatic pixel-art ninja (no external images): hooded cyber-ninja with glowing visor, plated armour, trailing scarf with cloth physics, run/jump/fall/dash/hit/death poses, somersault double-jump, dash afterimages, death disintegration. **Each chip changes the body**: arm becomes an energy blade / plasma cannon / hard-light shield / kunai, the visor + chest core + knees recolour to the chip, Blink adds leg thrusters, and a flash + data-bits + ring plays on every swap (0.28 s, movement is never interrupted).

**Enemies** — three kinds with a readable loop *patrol → alert (“!”) → windup (glowing telegraph) → attack → recover* and hit / stagger / death states:
Gunner (aimed bolt), Enforcer (chase + lunge), Warden (armoured, 3-bolt burst). Getting hit cancels a windup (except Warden), so aggression suppresses fire.

**World / UI** — 4-layer parallax city with neon signs, flying traffic, rain, street props, checkpoint pylons, animated portal, foreground silhouettes, HUD with chip icons, cooldowns, chain counter, damage pips; debug panel moved behind `F3`.

**Movement** — physics constants are unchanged (gravity 34, jump 13.8, run 12.2, dash 28). Two input fixes: the v0.3 “nudge on key press” safeguard is kept but no longer re-fires on OS key-repeat (that made long holds faster than short ones), and the 4.5 s timed key release was replaced by clearing keys on window blur / tab hide.

## Rendering decision

v0.3 loaded Three.js from a CDN and drew 3-D boxes, with a Canvas-2D fallback. Pixel art wants a flat, pixel-exact pipeline, so v0.4 renders everything with **Canvas 2D into a ~270 px tall low-res buffer scaled with nearest-neighbour** (integer device-pixel scale, so no shimmer). No external dependency, works offline, ~0.5–3 ms/frame. Characters are skeleton-driven pixel rasterisers (`js/art.js`), backgrounds/platforms/props are generated once from seeded RNG. No other engine was introduced.

## Code map

```
index.html          shell + DOM HUD            js/util.js     pixel primitives, 3x5 font, glow
css/style.css       HUD / overlay styling      js/audio.js    WebAudio synth SFX (no files)
build.mjs           single-file bundler        js/input.js    keyboard / mouse / touch / gamepad
js/world.js         level data, chips, save    js/art.js      ninja + enemy rasterisers, chip icons
js/player.js        controller, combos, chips  js/fx.js       particles, slashes, ghosts, shake, hit-stop
js/enemies.js       AI state machine           js/combat.js   hits, damage, parry/block, projectiles
js/render.js        background, props, frame   js/hud.js      DOM HUD    js/main.js  loop + glue
```

Dev helpers: `window.NS` (state + `NS.step(n)` deterministic stepping, used for the test pass),
`#sprites` / `#enemies` pose sheets (`?zoom=10&v=0,0` to magnify), `F4` hitboxes.
Chip unlocks persist in `localStorage` under the same key as v0.3 (`neonshift_chips_v1`).

## Verified in this pass (headless-style, deterministic 60 Hz stepping in the Chrome-based preview)

Run/hold-key speed (no key-repeat speed-up), jump apex 2.69 u, double jump 4.33 u + flip, dash 6.6 u with afterimages, 3-hit combo damage and hit-stop, cannon kill in 3 shots, blink warp + path damage, parry reflect / block / back-hit damage, enforcer lunge → parry → stagger, death → checkpoint respawn, pickup unlock → refresh persistence, one-file bundle boots, whole-level bot run to the portal with no console errors.

## Limitations / not done

- **Not played by a human on real hardware yet** — the preview pane throttles `requestAnimationFrame`, so frame-rate and “feel” (hit-stop length, shake strength, difficulty) are untested live. All timings are constants at the top of `js/player.js` (`SWING`, `PARRY_WINDOW`) and `js/combat.js`.
- Difficulty is untuned: a scripted bot clears the level with no deaths. Enemy HP, windup times and aggro ranges live in `js/world.js` (`ENEMY_DEF`) and `js/enemies.js`.
- Art is procedural, not hand-pixelled frame by frame; a human pixel artist can later replace `drawPlayer` / `drawEnemy` with sprite sheets without touching gameplay.
- One short level, no music, SFX are simple synth sounds. No gamepad remapping / settings screen.
- Enemies only react on their own ground segment (they never leave their platform).

## Suggested next steps

1. Playtest and tune feel constants (hit-stop, shake, swing timing, knockback) with the F4 hitbox overlay.
2. Add a second arena beat: mix gunner + enforcer + a floating-platform enemy to push chip swapping.
3. Charge shot for Cannon (hold) and an air-slam finisher to give every chip a depth move.
4. Equipment slots (arm / legs / core) so chips can be combined, e.g. Blink legs + Blade arm.
5. Hand-drawn sprite pass + simple music loop; screen-space bloom shader if moving back to WebGL.
