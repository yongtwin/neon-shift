import { seeded } from '../core/util.js';

/* Stage 1 level data. World units: x → right, y → up, y = 0 is street level.
   Layout, pickups and checkpoints are unchanged from v0.3. */
export const WORLD_W = 145;
export const EXIT_X = 139;
// [x1, x2, y] — y 0 is solid street, the rest are floating catwalks (land from above only)
export const PLAT = [[0, 21, 0], [23, 40, 0], [42, 62, 0], [64, 81, 0], [83, 103, 0], [105, 122, 0], [124, 145, 0],
  [9, 17, 3.8], [30, 38, 4.4], [48, 57, 3.9], [70, 78, 4.4], [89, 99, 3.8], [111, 120, 4]];
export const PICKUPS = [{ x: 19, y: 1.3, id: 'cannon' }, { x: 46, y: 1.3, id: 'shield' }, { x: 86, y: 1.3, id: 'blink' }];
export const CHECKPOINTS = [0, 42, 83, 124];

// kind per spawn; positions are v0.3's enemy x list
export const SPAWNS = [
  { x: 13, kind: 'gunner' }, { x: 27, kind: 'enforcer' }, { x: 34, kind: 'gunner' }, { x: 45, kind: 'gunner' },
  { x: 54, kind: 'enforcer' }, { x: 69, kind: 'gunner' }, { x: 86, kind: 'enforcer' }, { x: 94, kind: 'gunner' },
  { x: 111, kind: 'enforcer' }, { x: 131, kind: 'warden' },
];

/* lockdown arenas: walls rise when you pass `trigger`, drop when every enemy inside is down */
export const ARENAS = [
  { id: 'yard', x0: 64.4, x1: 80.6, trigger: 66.5, title: 'AMBUSH — LOCKDOWN', wave: [{ x: 77, kind: 'enforcer' }, { x: 74.5, kind: 'gunner' }] },
  { id: 'boss', x0: 124.4, x1: 137.6, trigger: 126.5, title: 'WARDEN — LOCKDOWN', wave: [], boss: true },
];

/* ------------------------------------------------------------ static decor (seeded => identical every run) */
export const DECOR = [];         // props that stand on the street
export const FG = [];            // dark foreground silhouettes (parallax > 1)
(function buildDecor() {
  const r = seeded(7731);
  const keep = [...SPAWNS.map(s => s.x), ...PICKUPS.map(p => p.x), ...CHECKPOINTS, EXIT_X];
  const free = x => keep.every(k => Math.abs(k - x) > 2.4);
  for (const [x1, x2, y] of PLAT) {
    if (y !== 0) continue;
    let x = x1 + 2.5 + r() * 3;
    while (x < x2 - 2) {
      if (free(x)) {
        const roll = r();
        const type = roll < 0.28 ? 'lamp' : roll < 0.5 ? 'crates' : roll < 0.64 ? 'barrel' : roll < 0.8 ? 'terminal' : roll < 0.9 ? 'vent' : 'sign';
        DECOR.push({ type, x, seed: (r() * 1e6) | 0, hue: r() < 0.5 ? 0 : 1 });
      }
      x += 3.2 + r() * 5.5;
    }
  }
  for (let x = 8; x < WORLD_W; x += 18 + r() * 14) FG.push({ x, kind: r() < 0.6 ? 'pole' : 'cable', seed: (r() * 1e6) | 0 });
})();
