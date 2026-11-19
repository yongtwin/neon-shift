/* =====================================================================
   Stage data. World units: x → right, y → up, y = 0 is street level.

   STAGES[i] = { id, name, theme, worldW, exitX, plats, pickups, checkpoints, spawns, arenas, hazards, ... }
     plats       [x1, x2, y]   y 0 = solid street, y > 0 = one-way catwalk (land from above)
     pickups     { x, y, id }  a chip pickup only appears while that chip is still locked, so every
                               stage carries "catch-up" pickups for the chips it relies on
     checkpoints x list (first = stage start)
     spawns      { x, kind, y?, range?, mount? }   y = platform top (or hover height for drones)
     arenas      { id, x0, x1, trigger, title, wave:[spawn], boss? }  laser walls lock until clear
     hazards     { type:'laser', x, y0, y1, period, onT, warnT, phase?, solid? }
                   timed beam: on for onT s every period s, warns for warnT s first. solid = always on
                   and impassable (a laser gate: only BLINK crosses it). Runtime fields written by the
                   sim for the renderer: on (bool), warn (0..1 telegraph progress)
                 { type:'spikes', x0, x1, y? }   floor spikes: 1 damage + bounce
     requires    chips the stage design expects (informational; catch-up pickups provide them)
     needs       { blinkFrom } x from which progress requires BLINK (used by the reachability check)

   Physics budget (player.js MOVE): single jump apex 2.74 u, run jump ~9.9 u flat, double jump apex ~5,
   dash 6.6 u, blink 5.3 u. Gaps here are ≤ 6 u, catwalk steps ≤ 2.4 u (single jump) or ≤ 4.4 u (double).
   ===================================================================== */
export const STAGES = [
  /* ---------------------------------------------------------------- 1. NEON DISTRICT  (~260 u)
     Teaches run / jump / double jump / dash and the blade combo on gunners + enforcers.
     CANNON mid-stage (x 61), then lockdowns with gunners up on catwalks (the cannon makes them easy). */
  {
    id: 'district', name: 'NEON DISTRICT', theme: 'district', worldW: 262, exitX: 256,
    intro: 'RUN · JUMP ×2 · DASH · [J] BLADE COMBO',
    requires: ['blade'],
    plats: [[0, 24, 0], [27, 46, 0], [49, 70, 0], [73, 92, 0], [95, 120, 0], [123, 141, 0], [144, 170, 0], [173, 200, 0], [203, 230, 0], [233, 262, 0],
      [10, 17, 2.4], [32, 40, 4.2], [56, 64, 3.6], [78, 86, 4.0], [104, 114, 3.8], [128, 135, 2.4], [150, 158, 4.0], [180, 188, 3.6], [216, 224, 4.2]],
    pickups: [{ x: 61, y: 1.3, id: 'cannon' }],
    checkpoints: [0, 27, 49, 95, 123, 173, 203, 233],
    spawns: [
      { x: 20, kind: 'gunner' }, { x: 36, kind: 'enforcer' }, { x: 43, kind: 'gunner' },
      { x: 54, kind: 'enforcer' }, { x: 67, kind: 'gunner' },
      { x: 100, kind: 'gunner' }, { x: 112, kind: 'enforcer' }, { x: 116, kind: 'gunner' },
      { x: 131, kind: 'enforcer' }, { x: 138, kind: 'gunner' },
      { x: 154, y: 4.0, kind: 'gunner' }, { x: 160, kind: 'enforcer' }, { x: 166, kind: 'gunner' },
      { x: 178, kind: 'gunner' }, { x: 186, kind: 'enforcer' }, { x: 195, kind: 'enforcer' },
      { x: 245, kind: 'gunner' }, { x: 251, kind: 'enforcer' },
    ],
    arenas: [
      { id: 'yard', x0: 73.4, x1: 91.6, trigger: 75.5, title: 'AMBUSH — LOCKDOWN', wave: [{ x: 82, y: 4.0, kind: 'gunner' }, { x: 88, kind: 'enforcer' }, { x: 80, kind: 'gunner' }] },
      { id: 'plaza', x0: 203.4, x1: 229.6, trigger: 205.5, title: 'PLAZA — LOCKDOWN', wave: [{ x: 214, kind: 'enforcer' }, { x: 220, y: 4.2, kind: 'gunner' }, { x: 222, kind: 'gunner' }, { x: 227, kind: 'enforcer' }] },
    ],
    hazards: [],
  },
  /* ---------------------------------------------------------------- 2. SECURITY COMPLEX  (~250 u)
     SHIELD at the door and a turret to parry, timed laser grids, pits, a spike floor crossed on
     catwalks, drones, a lockdown lab, BLINK + a laser gate only BLINK crosses, then a final
     drone / turret corridor with alternating lasers. */
  {
    id: 'complex', name: 'SECURITY COMPLEX', theme: 'complex', worldW: 250, exitX: 245,
    intro: '[L] GUARD · TAP [L] ON IMPACT = PARRY · MIND THE LASERS',
    requires: ['blade', 'shield', 'blink'],
    needs: { blinkFrom: 152 },
    plats: [[0, 18, 0], [22, 40, 0], [46, 64, 0], [66, 96, 0], [98, 124, 0], [126, 180, 0], [184, 200, 0], [204, 226, 0], [229, 250, 0],
      [69, 74, 2.4], [76, 81, 4.4], [83, 89, 2.6], [108, 116, 3.6], [131, 138, 3.8], [208, 216, 3.6]],
    pickups: [{ x: 4, y: 1.3, id: 'cannon' }, { x: 8, y: 1.3, id: 'shield' }, { x: 148.5, y: 1.3, id: 'blink' }],
    checkpoints: [0, 22, 46, 90, 126, 146, 184, 229],
    spawns: [
      { x: 16.5, kind: 'turret' },
      { x: 35, kind: 'gunner' },
      { x: 52, kind: 'drone', y: 3.6, range: 3 }, { x: 58, kind: 'gunner' }, { x: 61, kind: 'drone', y: 4.0, range: 2.5 },
      { x: 79, y: 4.4, kind: 'turret' }, { x: 93, kind: 'turret' },
      { x: 112, kind: 'drone', y: 5.2, range: 3 }, { x: 117, kind: 'enforcer' }, { x: 121, kind: 'gunner' },
      { x: 166, kind: 'enforcer' }, { x: 172, kind: 'gunner' }, { x: 176, kind: 'drone', y: 3.8, range: 3 },
      { x: 196, kind: 'drone', y: 3.6, range: 2.5 }, { x: 210, kind: 'enforcer' }, { x: 212, y: 3.6, kind: 'turret' }, { x: 214, kind: 'drone', y: 5.4, range: 3 },
      { x: 224, kind: 'turret' }, { x: 238, kind: 'enforcer' },
    ],
    arenas: [
      { id: 'lab', x0: 126.4, x1: 145.6, trigger: 128.5, title: 'LAB — LOCKDOWN', wave: [{ x: 134.5, y: 3.8, kind: 'turret' }, { x: 140, kind: 'enforcer' }, { x: 137, kind: 'drone', y: 3.4, range: 3 }, { x: 143, kind: 'gunner' }] },
    ],
    hazards: [
      { type: 'laser', x: 30, y0: 0, y1: 6, period: 2.4, onT: 1.0, warnT: 0.5 },
      { type: 'spikes', x0: 67.5, x1: 90.5 },
      { type: 'laser', x: 109.5, y0: 0, y1: 3.4, period: 2.6, onT: 1.0, warnT: 0.5 },          // under the catwalk: time it, or go over the top
      { type: 'laser', x: 112.5, y0: 0, y1: 3.4, period: 2.6, onT: 1.0, warnT: 0.5, phase: 1.3 },
      { type: 'laser', x: 152.6, y0: 0, y1: 9, solid: true }, { type: 'laser', x: 153.8, y0: 0, y1: 9, solid: true },
      { type: 'laser', x: 155.0, y0: 0, y1: 9, solid: true }, { type: 'laser', x: 156.2, y0: 0, y1: 9, solid: true },
      { type: 'laser', x: 189, y0: 0, y1: 7, period: 2.0, onT: 0.8, warnT: 0.4 },
      { type: 'laser', x: 193, y0: 0, y1: 7, period: 2.0, onT: 0.8, warnT: 0.4, phase: 1.0 },
      { type: 'spikes', x0: 218, x1: 223 },
    ],
  },
  /* ---------------------------------------------------------------- 3. CYBER CORE  (~245 u)
     Catch-up pickups at the start; mixed waves that want chip switching (turrets: cannon / reflect only,
     drones overhead: cannon or a jump slash), lasers, a laser gate (BLINK), a spike run, a gauntlet
     lockdown, then the WARDEN // CORE SENTINEL arena. */
  {
    id: 'core', name: 'CYBER CORE', theme: 'core', worldW: 246, exitX: 238,
    intro: 'SWITCH CHIPS · TURRETS SHRUG OFF THE BLADE',
    requires: ['blade', 'cannon', 'shield', 'blink'],
    needs: { blinkFrom: 79 },
    bossStage: true,
    plats: [[0, 20, 0], [22, 46, 0], [49, 76, 0], [76, 108, 0], [111, 150, 0], [154, 176, 0], [180, 246, 0],
      [30, 38, 3.6], [64, 72, 3.8], [114, 121, 2.6], [160, 168, 3.8]],
    pickups: [{ x: 4, y: 1.3, id: 'cannon' }, { x: 7, y: 1.3, id: 'shield' }, { x: 10, y: 1.3, id: 'blink' }],
    checkpoints: [0, 22, 49, 86, 111, 154, 182],
    spawns: [
      { x: 58, kind: 'gunner' }, { x: 66, kind: 'drone', y: 5.6, range: 2.5 }, { x: 70, kind: 'enforcer' },
      { x: 68, y: 3.8, kind: 'turret' },
      { x: 130, kind: 'drone', y: 4.0, range: 3 }, { x: 134, kind: 'enforcer' }, { x: 138, kind: 'turret' }, { x: 146, kind: 'gunner' },
      { x: 188, kind: 'gunner' }, { x: 192, kind: 'drone', y: 3.8, range: 2.5 },
    ],
    arenas: [
      { id: 'ring', x0: 22.4, x1: 45.6, trigger: 24.5, title: 'CORE RING — LOCKDOWN', wave: [{ x: 34, y: 3.6, kind: 'turret' }, { x: 30, kind: 'drone', y: 3.0, range: 3 }, { x: 40, kind: 'enforcer' }, { x: 44, kind: 'gunner' }] },
      { id: 'core', x0: 86.4, x1: 107.6, trigger: 88.5, title: 'DATA VAULT — LOCKDOWN', wave: [{ x: 97, kind: 'enforcer' }, { x: 104, kind: 'enforcer' }, { x: 106.5, kind: 'turret' }, { x: 100, kind: 'drone', y: 3.6, range: 3 }, { x: 93, kind: 'gunner' }] },
      { id: 'gauntlet', x0: 154.4, x1: 175.6, trigger: 156.5, title: 'GAUNTLET — LOCKDOWN', wave: [{ x: 166, kind: 'enforcer' }, { x: 170, kind: 'enforcer' }, { x: 162, kind: 'drone', y: 3.5, range: 3 }, { x: 174.5, kind: 'turret' }, { x: 164, y: 3.8, kind: 'gunner' }] },
      { id: 'boss', x0: 198.4, x1: 232.6, trigger: 201, title: 'WARDEN // CORE SENTINEL', wave: [{ x: 224, kind: 'warden' }], boss: true },
    ],
    hazards: [
      { type: 'laser', x: 56, y0: 0, y1: 7, period: 2.2, onT: 0.9, warnT: 0.45 },
      { type: 'laser', x: 61, y0: 0, y1: 7, period: 2.2, onT: 0.9, warnT: 0.45, phase: 1.1 },
      { type: 'laser', x: 79.4, y0: 0, y1: 9, solid: true }, { type: 'laser', x: 80.6, y0: 0, y1: 9, solid: true },
      { type: 'laser', x: 81.8, y0: 0, y1: 9, solid: true }, { type: 'laser', x: 83.0, y0: 0, y1: 9, solid: true },
      { type: 'spikes', x0: 113, x1: 122.5 },
      { type: 'laser', x: 127, y0: 0, y1: 7, period: 2.2, onT: 0.9, warnT: 0.45 },
      { type: 'laser', x: 142, y0: 0, y1: 7, period: 2.2, onT: 0.9, warnT: 0.45, phase: 0.7 },
    ],
  },
];
