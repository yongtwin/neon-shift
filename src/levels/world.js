import { HAZARDS, PLAT } from './stage1.js';

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
  const ok = x => hasFloorBelow(x, y) && !inSolidLaser(x, y);
  if (ok(want)) return want;
  const dir = Math.sign(want - from) || 1;
  for (let d = 0.25; d <= 1.5001; d += 0.25) { const x = want + dir * d; if (x >= lo && x <= hi && ok(x)) return x; }
  for (let x = want - dir * 0.25; dir * (x - from) > 0; x -= dir * 0.25) if (ok(x)) return x;
  return from;
}

/* ------------------------------------------------------------------ hazards */
export const LASER_HALF = 0.45;                                   // contact half-width of a beam (player half-width included)
/** true inside an always-on laser gate (a blink must not end there) */
export function inSolidLaser(x, y) {
  for (const h of HAZARDS) if (h.type === 'laser' && h.solid && Math.abs(x - h.x) < LASER_HALF + 0.15 && y < h.y1 && y + 1.7 > h.y0) return true;
  return false;
}
/** advance laser timers (stage time t, sim seconds). Writes the renderer's runtime fields: on (bool), warn (0..1). */
export function updateHazards(t) {
  for (const h of HAZARDS) {
    if (h.type !== 'laser') continue;
    if (h.solid || !h.period) { h.on = true; h.warn = 0; continue; }
    const P = h.period, ph = (((t + (h.phase || 0)) % P) + P) % P, onAt = P - h.onT, warnAt = onAt - (h.warnT || 0);
    h.on = ph >= onAt;
    h.warn = !h.on && ph >= warnAt && h.warnT ? (ph - warnAt) / h.warnT : 0;
  }
}
/** seconds until laser h next switches on (0 if on) — used by bots / tests */
export function laserTimeToOn(h, t) {
  if (h.solid || !h.period) return 0;
  const P = h.period, ph = (((t + (h.phase || 0)) % P) + P) % P, onAt = P - h.onT;
  return ph >= onAt ? 0 : onAt - ph;
}
