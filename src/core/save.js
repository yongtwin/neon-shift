import { CHIPS } from '../chips/chips.js';

/* =====================================================================
   Versioned save.  localStorage key `neonshift_save`:
     { v: 2, chips: ['blade', ...], stage: 0, best: { time?, kills?, combo? } }
   - v1 data (`neonshift_chips_v1`, a bare array of chip ids) is migrated once;
     the old key is left untouched so an older build still works.
   - Anything invalid / corrupt / blocked falls back to defaults and never throws.
   - Memory mode (URL `?mem`, or Save.useMemory(true)) keeps everything in RAM so
     test runs cannot touch the player's real save.
   ===================================================================== */
export const SAVE_KEY = 'neonshift_save';
export const LEGACY_KEY = 'neonshift_chips_v1';
export const SAVE_VERSION = 2;
export const MAX_STAGE = 2;                                   // stages 0..2

const defaults = () => ({ v: SAVE_VERSION, chips: ['blade'], stage: 0, best: {} });
const memStore = new Map();
const store = {
  get(k) { if (Save.memory) return memStore.has(k) ? memStore.get(k) : null; try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { if (Save.memory) { memStore.set(k, v); return true; } try { localStorage.setItem(k, v); return true; } catch { return false; } },
  del(k) { if (Save.memory) { memStore.delete(k); return; } try { localStorage.removeItem(k); } catch { /* noop */ } },
};

function cleanChips(arr) {
  const out = ['blade'];
  if (Array.isArray(arr)) for (const v of arr) if (typeof v === 'string' && CHIPS[v] && !out.includes(v)) out.push(v);
  return out;
}
function cleanBest(b) {
  const out = {};
  if (b && typeof b === 'object' && !Array.isArray(b)) {
    for (const k of ['time', 'kills', 'combo']) if (typeof b[k] === 'number' && Number.isFinite(b[k]) && b[k] >= 0) out[k] = b[k];
  }
  return out;
}
/** Validate any parsed value into a v2 save object, or null if it is not a usable save. */
export function sanitize(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o) || o.v !== SAVE_VERSION) return null;
  const stage = Number.isInteger(o.stage) ? Math.max(0, Math.min(MAX_STAGE, o.stage)) : 0;
  return { v: SAVE_VERSION, chips: cleanChips(o.chips), stage, best: cleanBest(o.best) };
}
/** v1 → v2: the v1 save was only the array of unlocked chip ids. */
export function migrateV1(arr) {
  if (!Array.isArray(arr)) return null;
  return { v: SAVE_VERSION, chips: cleanChips(arr), stage: 0, best: {} };
}

export const Save = {
  data: defaults(),
  memory: false,
  source: 'default',            // 'v2' | 'migrated-v1' | 'default' | 'corrupt'
  lastError: null,

  useMemory(on = true) { this.memory = !!on; if (on) memStore.clear(); return this.load(); },

  load() {
    this.lastError = null;
    let data = null;
    const raw = store.get(SAVE_KEY);
    if (raw != null) {
      try { data = sanitize(JSON.parse(raw)); } catch (err) { this.lastError = String(err); }
      this.source = data ? 'v2' : 'corrupt';
    }
    if (!data && raw == null) {
      const old = store.get(LEGACY_KEY);
      if (old != null) {
        try { data = migrateV1(JSON.parse(old)); } catch (err) { this.lastError = String(err); }
        if (data) { this.source = 'migrated-v1'; this.data = data; this.commit(); return this.data; }
      }
      this.source = 'default';
    }
    this.data = data || defaults();
    return this.data;
  },
  commit() { return store.set(SAVE_KEY, JSON.stringify(this.data)); },
  reset() { this.data = defaults(); this.commit(); return this.data; },
  wipe() { store.del(SAVE_KEY); store.del(LEGACY_KEY); this.data = defaults(); this.source = 'default'; },

  setChips(set) { this.data.chips = cleanChips([...set]); this.commit(); },
  reachStage(i) { if (Number.isInteger(i) && i > this.data.stage) { this.data.stage = Math.min(MAX_STAGE, i); this.commit(); } },
  /** record a finished run; keeps the best (lowest) time and the highest kills / hit chain */
  recordRun({ time, kills, combo }) {
    const b = this.data.best;
    if (Number.isFinite(time) && (b.time === undefined || time < b.time)) b.time = Math.round(time * 100) / 100;
    if (Number.isFinite(kills) && (b.kills === undefined || kills > b.kills)) b.kills = kills;
    if (Number.isFinite(combo) && (b.combo === undefined || combo > b.combo)) b.combo = combo;
    this.commit();
  },
};

if (typeof location !== 'undefined' && /[?&]mem\b/.test(location.search)) Save.memory = true;

/* legacy helpers (kept for callers that think in Sets) */
export function loadUnlocked() { return new Set(Save.load().chips); }
export function saveUnlocked(set) { Save.setChips(set); }
