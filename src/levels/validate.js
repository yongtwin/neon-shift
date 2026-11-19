import { MOVE, BLINK } from '../player/player.js';
import { STAGES } from './stages.js';
import { LASER_HALF } from './world.js';

/* =====================================================================
   Reachability check of a stage against the real jump physics.
   Walkable intervals = ground split by spikes and solid laser gates, plus
   catwalks. An edge A→B exists if a trajectory integrated exactly like the
   player (fixed 120 Hz, gravity 34, jump 13.8, run 12.2, optional double
   jump at any time, or just walking off) leaves A and lands on B from above
   without crossing a solid laser or falling into a pit. BLINK edges (5.3 u
   warp at the same height, through laser gates) are allowed only when
   `blink` is true. Used by NS.validateStage(i) and the Edge verification.
   ===================================================================== */
const DT = 1 / 120;

function intervals(st) {
  const out = [];
  for (const [x1, x2, y] of st.plats) {
    let cuts = [[x1, x2]];
    if (y === 0) {
      const blocks = [];
      for (const h of st.hazards || []) {
        if (h.type === 'spikes' && (h.y || 0) === 0) blocks.push([h.x0, h.x1]);
        if (h.type === 'laser' && h.solid) blocks.push([h.x - LASER_HALF, h.x + LASER_HALF]);
      }
      for (const [b0, b1] of blocks) cuts = cuts.flatMap(([a, b]) => (b0 >= b || b1 <= a) ? [[a, b]] : [[a, b0], [b1, b]].filter(([u, v]) => v - u > 0.5));
    }
    for (const [a, b] of cuts) out.push({ x1: a, x2: b, y });
  }
  return out;
}
const solidLasers = st => (st.hazards || []).filter(h => h.type === 'laser' && h.solid);

/* integrate one jump; returns the interval index landed on (or -1) */
function fly(st, ivs, sx, sy, dir, jump, dj, lasers) {
  let x = sx, y = sy, vy = jump ? MOVE.jump : 0, t = 0, used = false;
  const vx = dir * MOVE.run;
  for (let n = 0; n < 400; n++) {
    t += DT;
    if (!used && dj !== null && t >= dj) { vy = MOVE.jump; used = true; }
    const px = x, py = y;
    x += vx * DT; vy = Math.max(-MOVE.maxFall, vy - MOVE.gravity * DT); y += vy * DT;
    for (const L of lasers) if ((px - L.x) * (x - L.x) <= 0 && y < L.y1 && y + 1.7 > L.y0) return -1;   // hit a gate
    if (x < 0.5 || x > st.worldW - 2) return -1;
    if (vy <= 0) {
      let best = -1, by = -Infinity;
      for (let i = 0; i < ivs.length; i++) {
        const I = ivs[i];
        if (x + 0.35 > I.x1 && x - 0.35 < I.x2 && py >= I.y - 0.08 && y <= I.y && I.y > by) { best = i; by = I.y; }
      }
      if (best >= 0) {
        const I = ivs[best];
        return (x >= I.x1 - 0.2 && x <= I.x2 + 0.2) ? best : -1;
      }
    }
    if (y < -8) return -1;
    // landing on a spike strip of the street = treated as failure (it hurts)
    if (y <= 0 && vy < 0 && (st.hazards || []).some(h => h.type === 'spikes' && x > h.x0 && x < h.x1)) return -1;
  }
  return -1;
}

export function validateStage(i, { blink = true } = {}) {
  const st = STAGES[i];
  const ivs = intervals(st), lasers = solidLasers(st), edges = ivs.map(() => new Set());
  for (let a = 0; a < ivs.length; a++) {
    const A = ivs[a];
    for (let sx = A.x1 + 0.2; sx <= A.x2 - 0.2 + 1e-9; sx += 0.25) {
      for (const dir of [-1, 1]) {
        const tried = [fly(st, ivs, sx, A.y, dir, false, null, lasers)];                     // walk off
        for (const dj of [null, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7]) tried.push(fly(st, ivs, sx, A.y, dir, true, dj, lasers));
        for (const b of tried) if (b >= 0 && b !== a) edges[a].add(b);
      }
    }
    if (blink) {
      for (let sx = A.x1; sx <= A.x2 + 1e-9; sx += 0.25) {
        for (const dir of [-1, 1]) {
          const tx = sx + dir * BLINK.dist;
          const b = ivs.findIndex(I => I.y === A.y && tx >= I.x1 + 0.3 && tx <= I.x2 - 0.3);
          if (b >= 0 && b !== a) edges[a].add(b);
        }
      }
    }
  }
  const find = (x, y = 0) => ivs.findIndex(I => I.y === y && x >= I.x1 && x <= I.x2);
  const start = find(2), seen = new Set([start]), prev = new Map(), q = [start];
  while (q.length) { const a = q.shift(); for (const b of edges[a]) if (!seen.has(b)) { seen.add(b); prev.set(b, a); q.push(b); } }
  const exit = find(st.exitX);
  const path = []; for (let k = exit; k !== undefined && k >= 0; k = prev.get(k)) { path.unshift(`[${ivs[k].x1}-${ivs[k].x2}@${ivs[k].y}]`); if (k === start) break; }
  const targets = { exit: st.exitX, ...Object.fromEntries((st.pickups || []).map(p => ['pickup:' + p.id, p.x])), ...Object.fromEntries((st.checkpoints || []).map(c => ['cp:' + c, c + 1.5])) };
  const reach = {};
  for (const [k, x] of Object.entries(targets)) { const j = ivs.findIndex(I => x >= I.x1 && x <= I.x2 && (I.y === 0 || k.startsWith('pickup'))); reach[k] = j >= 0 && seen.has(j); }
  const unreachable = ivs.map((I, k) => seen.has(k) ? null : `[${I.x1}-${I.x2}@${I.y}]`).filter(Boolean);
  return { stage: st.id, blink, ok: !!reach.exit, reach, path, unreachable, intervals: ivs.length };
}
