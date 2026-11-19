import { seeded } from '../core/util.js';
import { S } from '../core/state.js';
import { STAGES } from './stages.js';

/* =====================================================================
   CURRENT STAGE VIEW. (File name kept for existing importers.)
   Every gameplay module reads level data from here; applyStage(i) swaps the
   contents IN PLACE (arrays mutated, WORLD_W / EXIT_X are live `let`
   bindings), so `import { PLAT } from './stage1.js'` always sees the stage
   being played. S.stage = STAGES[i] (the renderer's contract object).
   ===================================================================== */
export let STAGE_INDEX = 0;
export let WORLD_W = 150;
export let EXIT_X = 145;
export const PLAT = [];
export const PICKUPS = [];
export const CHECKPOINTS = [];
export const SPAWNS = [];
export const ARENAS = [];
export const HAZARDS = [];
export const DECOR = [];         // props that stand on the street (seeded => identical every run)
export const FG = [];            // dark foreground silhouettes (parallax > 1)

const fill = (arr, src, map = v => v) => { arr.length = 0; for (const v of src || []) arr.push(map(v)); };

export function applyStage(i) {
  const st = STAGES[i];
  if (!st) return null;
  STAGE_INDEX = i; WORLD_W = st.worldW; EXIT_X = st.exitX;
  fill(PLAT, st.plats, p => [p[0], p[1], p[2]]);
  fill(PICKUPS, st.pickups, p => ({ ...p }));
  fill(CHECKPOINTS, st.checkpoints);
  fill(SPAWNS, st.spawns, s => ({ ...s }));
  fill(ARENAS, st.arenas, a => ({ ...a, wave: a.wave.map(w => ({ ...w })), spawned: false, cleared: false, wallT: 0 }));
  fill(HAZARDS, st.hazards, h => ({ ...h, on: !!h.solid, warn: 0 }));
  // the contract object the renderer reads: live arrays (hazard runtime fields are visible to it)
  S.stage = Object.assign({}, st, { index: i, plats: PLAT, pickups: PICKUPS, checkpoints: CHECKPOINTS, spawns: SPAWNS, arenas: ARENAS, hazards: HAZARDS });
  buildDecor(st);
  return S.stage;
}

function buildDecor(st) {
  DECOR.length = 0; FG.length = 0;
  const r = seeded(7731 + (st.id === 'district' ? 0 : st.id.length * 101));
  const keep = [...SPAWNS.map(s => s.x), ...PICKUPS.map(p => p.x), ...CHECKPOINTS, EXIT_X, ...HAZARDS.map(h => h.x ?? h.x0)];
  const free = x => keep.every(k => Math.abs(k - x) > 2.4) && !HAZARDS.some(h => h.type === 'spikes' && x > h.x0 - 1 && x < h.x1 + 1);
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
}

applyStage(0);
