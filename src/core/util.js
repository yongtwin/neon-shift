/* NEON//SHIFT — math / rng / DOM helpers. */
export const PPU = 20;                         // art pixels per world unit
export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;
export const $ = id => document.getElementById(id);
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = t => t * t * (3 - 2 * t);
export const easeOut = t => 1 - (1 - t) * (1 - t);
export const easeOutBack = t => { const c = 1.70158; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
export const rnd = (a, b) => a + Math.random() * (b - a);

export function seeded(seed) {                  // deterministic RNG for level / background art
  let a = seed | 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function filterInPlace(arr, keep) {        // arr = arr.filter(keep), without replacing the array
  let j = 0;
  for (let i = 0; i < arr.length; i++) if (keep(arr[i])) arr[j++] = arr[i];
  arr.length = j;
  return arr;
}
