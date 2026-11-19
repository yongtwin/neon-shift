import { PLAT } from './stage1.js';

/* World / collision queries (pure functions over the current level data). */
export function groundSegments() { return PLAT.filter(p => p[2] === 0); }
export function segmentAt(x) {
  for (const p of PLAT) if (p[2] === 0 && x >= p[0] && x <= p[1]) return p;
  return PLAT[0];
}
/** true when a platform whose top is at or below `y` lies under x (with a small edge margin) */
export function hasFloorBelow(x, y, margin = 0.3) {
  for (const [x1, x2, py] of PLAT) if (x >= x1 + margin && x <= x2 - margin && py <= y + 0.05) return true;
  return false;
}
/** street top at x, or -Infinity over a pit */
export function streetTop(x) {
  for (const [x1, x2, py] of PLAT) if (py === 0 && x >= x1 && x <= x2) return 0;
  return -Infinity;
}
/**
 * Where a horizontal warp from `from` toward `want` can safely end at height y:
 * the wanted point if there is floor under it, else up to 1 u further, else the
 * farthest safe point back toward the start (never over a pit).
 */
export function safeLandingX(from, want, y, lo, hi) {
  if (hasFloorBelow(want, y)) return want;
  const dir = Math.sign(want - from) || 1;
  for (let d = 0.25; d <= 1.0001; d += 0.25) { const x = want + dir * d; if (x >= lo && x <= hi && hasFloorBelow(x, y)) return x; }
  for (let x = want - dir * 0.25; dir * (x - from) > 0; x -= dir * 0.25) if (hasFloorBelow(x, y)) return x;
  return from;
}
