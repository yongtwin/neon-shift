import { PLAT } from './stage1.js';

/* World / collision segment queries. */
export function groundSegments() { return PLAT.filter(p => p[2] === 0); }
export function segmentAt(x) {
  for (const p of PLAT) if (p[2] === 0 && x >= p[0] && x <= p[1]) return p;
  return PLAT[0];
}
