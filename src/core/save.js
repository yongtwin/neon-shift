import { CHIP_INFO } from '../chips/chips.js';

/* Persistence: permanent chip unlocks (localStorage). */
export const STORAGE = 'neonshift_chips_v1';       // same key as v0.3 so existing unlocks carry over

/* ------------------------------------------------------------ persistence (permanent chip unlocks) */
export function loadUnlocked() {
  const set = new Set(['blade']);
  try {
    const arr = JSON.parse(localStorage.getItem(STORAGE) || '[]');
    if (Array.isArray(arr)) arr.forEach(v => { if (CHIP_INFO[v]) set.add(v); });
  } catch { /* storage blocked: run without persistence */ }
  return set;
}
export function saveUnlocked(set) {
  try { localStorage.setItem(STORAGE, JSON.stringify([...set])); } catch { /* noop */ }
}
