# NEON//SHIFT — Art Bible (v0.7)

All art is original and programmatic. Gameplay art goes into a low-res buffer (~270 px tall) with nearest-neighbour scaling.
One art pixel is one buffer pixel, and 1 world unit is 20 px (`PPU`).

## Palette

| Role | Tones (dark → light) | Notes |
|---|---|---|
| Outline | `#070812` | 1 px, 4-neighbour, around **every body part** (parts are separated from each other too) |
| Undersuit | `#0b0d20` `#171a36` `#262c58`, rim `#4a5aa8` | matte indigo, the "ninja black" |
| Armour plates | `#2b355e` `#4d5d96` `#8c9fd6`, spec `#dfe8ff`, rim `#7488cc` | cool steel, bevelled plates |
| Back limbs | suit `#07081a…#1a1f44`, armour `#1a2140…#43528a` | one step darker, for depth |
| Joints / pistons | `#3b3348` `#6f6681` `#b9b0c8` | warm grey, so the mechanics read apart from the armour |
| Scarf / sash | `#8f1259` `#ff3d9d` `#ffa6d6` | the hero's signature colour, never used by enemies |
| Enemies | gunmetal + hot red / amber (legacy `EN`) | red is reserved for hostiles |

**Chip accents.** These are the same values as the legacy `ACCENT`. Each one tints the visor, the chest core, the back reactor and the knee light of the active weapon.

| Chip | Slot | d / m / l |
|---|---|---|
| Blade | R-ARM | `#0e7f9c` `#2fe6ff` `#d6fdff` (cyan) |
| Cannon | R-ARM | `#b8700c` `#ffc43d` `#fff3b8` (amber) |
| Shield | L-ARM | `#5a3fc0` `#a58bff` `#ece4ff` (violet) |
| Blink | LEGS | `#a3146f` `#ff4fc0` `#ffd0f0` (pink) |

## Protagonist

- **Size.** The ninja is about 46 px from boot to helmet top when idle (it was about 40 px). Head 12 px, torso 14 px, legs 10.8 + 10.6 px with a 3 px ankle/boot. The gameplay hitbox is unchanged (0.7 world units wide). Only the art grew.
- **Silhouette rules.** Keep these shapes in every frame:
  - a helmet with a swept antenna fin pointing backwards
  - a wide pauldron, a V-shaped chest and a narrow waist
  - long mechanical legs with knee discs and calf pistons
  - a two-tail scarf trailing behind
  - the weapon arm on the near side (R-ARM, in front) and the shield arm on the far side (L-ARM, behind)

  The weapon must always break the silhouette, so you can read which chip is active from the outline alone.
- **Shading.** Each material has 3 tones. Light comes from the front and above. Capsules are shaded by their normal, and polygons get a 1 px bevel. A 1 px rim light runs along back-facing edges. Emissive parts (visor, blade, coils, shield, flames) are not shaded and get an additive glow sprite.
- **Transformations (must read at a glance)**

| Chip | What changes |
|---|---|
| Blade | The forearm gets a cyan energy seam. A single-edged energy blade comes out of a wrist emitter with a tsuba-style guard. |
| Cannon | The forearm is replaced by a chunky amber cannon: housing, vent rail, three coils, a plasma cell, barrel and muzzle collar. It aims around the shoulder, kicks back on recoil and shows a charge orb. |
| Shield | The far arm reaches forward. A wrist emitter projects a flat, scan-lined, violet hard-light shield. On a parry the shield goes white and bursts into a 4-point star. |
| Blink | Calf thruster pods with a dark nozzle, which ignite pink. Flames point down in the air and straight back during a warp. |

## Animations

The cache key quantises each pose to the step shown below. Timings come from gameplay state.

| Anim | Frames | Timing |
|---|---|---|
| idle (breathing) | 4 | 0.4 s each |
| run | 8 (contact, down, pass, up × 2) | phase driven by `run` |
| jump / fall | 1 each | plus `rot` somersault in 16 steps |
| land squash | 2 levels | `landT` |
| dash | 1 | plus Blink flames |
| blade 1 / 2 / 3 | 21 steps of `atkU` | anticipation 0–0.15, strike 0.15–0.35, follow-through to 0.55, recovery to 1; tip smear crescent during the strike |
| cannon | aim at 7.5° steps | 4 recoil levels, 2 muzzle-flash sizes, 5 charge levels + pulse |
| shield | raise in 5 levels | block flash, parry pose |
| hurt | 1 | white visor; plus the full-body white hit-flash variant |
| death | 2 | kneel, then collapse (visor off) |

Each frame costs about 1 ms to build the first time. After that it is about 0.014 ms (one `drawImage` plus glows). The scarf is drawn live each frame because it is world-space physics.

## Enemies (src/art/enemy-art.js)

Enemies must never read as "another ninja".

- **Palette.** Warm industrial gunmetal `#2f2c3a…#bdb5d0`, hazard yellow/black stripes and hostile red/orange optics. Their outer rim is warm red, where the player's is cool blue.
- **Shapes.** Digitigrade (backward-knee) legs, boxy masses, mono or twin optics.
- **Telegraphs.** Every attack has a telegraph pose that glows hotter as `tele` rises:

| Enemy | Telegraph |
|---|---|
| Gunner | the muzzle charges |
| Enforcer | the machete rises overhead and flashes white |
| Warden | the shoulder pods open for the bolt fan; fists go up for the slam; a crouch plus a red ground line for the charge |
| Turret | a dotted red laser sight |
| Drone | the eye flares |

- **Warden-only states.** Phase 2 adds overdrive vents. When `exposed`, the chest opens and shows a white-hot core.
- **Shared states.** Every enemy has a hit-flash (white) and death frames (topple, darken, sparks).
