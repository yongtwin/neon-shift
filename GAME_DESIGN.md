# NEON//SHIFT — Game Design

## Pitch
A fast 2D cyberpunk ninja action platformer. You collect **chips** that permanently rewrite parts of your
body. Chips are never drawn at random and never consumed: once found, a chip is yours forever and can be
switched to at any moment, even mid-combo. Mastery = chaining transformations:
run → jump → blade combo → swap to cannon → fire → blink through the enemy → keep attacking.

## Controls (keyboard; gamepad mirrors)
| Action | Keys |
|---|---|
| Move | `A`/`D` or `←`/`→` |
| Jump / double jump | `W`, `↑` or `Space` |
| Dash (ground/air, i-frames none) | `Shift` |
| R-ARM attack | `J` — Blade: 3-hit combo · Cannon: tap shot, hold to charge piercing lance |
| Swap R-ARM weapon | `Q` (or `1` Blade / `2` Cannon) |
| L-ARM Shield | hold `L` to block, tap on impact to **parry** |
| LEGS Blink | `K` — short teleport-dash that slashes through enemies |
| Chip collection | `Tab` / `C` (view collected and locked chips) |
| Pause | `P` / `Esc` · Mute `M` · Music `N` |

## Chip system
- Registry of chips, each with `id`, `name`, `slot` (`rarm` / `larm` / `legs` / `core`), colour, description.
- Initial chips: **BLADE** (rarm, starter), **CANNON** (rarm), **SHIELD** (larm), **BLINK** (legs).
- Each slot holds one equipped chip. R-ARM is the only slot with two weapon chips at launch, swapped by `Q`.
  Shield/Blink are always available on their own buttons once unlocked → combos like Cannon + Shield + Blink.
- CORE slot reserved for future passive chips. The collection screen lists any number of chips (grid scrolls).
- Unlocks persist in `localStorage` key `neonshift_save` with schema `{ v: 2, chips: [...], stage: n, best: {...} }`.
  v1 data (`neonshift_chips_v1`, an array) is migrated. Corrupt data → defaults.

## Combat feel targets
| Move | Startup | Active | Recovery | Damage | Hitstop | Shake |
|---|---|---|---|---|---|---|
| Blade 1 | ~50 ms | ~70 ms | short, cancellable into move/jump/dash/swap | 2 | ~50 ms | 2 px |
| Blade 2 | ~50 ms | ~70 ms | short | 2 | ~55 ms | 3 px |
| Blade 3 (finisher) | ~90 ms anticipation | ~90 ms | longer | 3 | ~85 ms | 5 px |
| Cannon tap | instant | projectile | ~0.3 s cooldown | 1 | small | 1–2 px |
| Cannon charged | hold ≥0.6 s | piercing | | 2–4 | medium | 4 px |
| Parry | 200 ms window (80 ms perfect) | | | reflect 3/6 | | flash + slow-mo |
| Blink | instant | path slash | 1.6 s cooldown | 3 | | |
Every hit: hit spark, enemy white flash, knockback, impact SFX; finishers and kills escalate everything.

## Stages
1. **Neon District** — streets and catwalks. Teaches run/jump/dash, Blade combo. Enemies: Gunner, Enforcer.
   CANNON chip mid-stage, a short lockdown arena that is easier with Cannon (gunners on a high catwalk).
   Exit portal → Stage 2.
2. **Security Complex** — indoor facility. SHIELD chip early (turrets fire bolts you must parry/block),
   laser-grid hazards (timed on/off, contact damage), pits, moving/vertical platforming, Drone enemy (flying,
   swoops), heavier Enforcers. BLINK chip near the end, needed to cross a long laser gap.
3. **Cyber Core** — data-core interior. Mixed waves demanding chip switching (shielded enemies weak to cannon
   charge, drones, turrets), blink gaps, then the boss.

### Boss — WARDEN // CORE SENTINEL
Large armoured security mech in a locked arena. Readable, telegraphed attacks:
- **Bolt fan** (windup glow → 3/5-bolt spread): block or parry; perfect parry reflects for big damage.
- **Ground slam** (raises fists, flashes) → shockwaves both directions: jump them.
- **Charge** (crouches, red line telegraph) → rushes across arena: blink through it to punish its back.
- Phase 2 (OVERDRIVE) at 50% HP: faster windups, chained patterns. Dying in phase 2 respawns you with the
  boss at 50% (mid-fight checkpoint). 80 HP; front armour halves blade damage, EXPOSED takes ×1.5.
  Defeat → 2.2 s death sequence (restart/death ignored) → victory screen.
- Tuning target (measured with bots): 0.28 s-reaction player wins reliably; fast players can't cheese it
  under ~30 s; mashing doesn't work.

## Enemies
| Enemy | Behaviour | Counter |
|---|---|---|
| Gunner | patrols, telegraphs, fires aimed bolt | parry, close in with blade |
| Enforcer | chases, telegraphed lunge | parry → stagger, combo |
| Drone | flies, hovers out of reach, swoops | cannon, jump slash |
| Turret | stationary, periodic bolts | parry-reflect, cannon |
| Warden (boss) | see above | everything |

## Game flow
Title → Stage 1 → 2 → 3 (boss) → Victory screen (time, kills, best chain, chips). Death → respawn at last
checkpoint with full HP (enemies in the current arena reset). Pause menu: resume / restart stage / music / quit
to title. Stage select is not required; progress (highest stage reached) persists.
