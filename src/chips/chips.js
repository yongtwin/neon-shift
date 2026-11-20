import { ACCENT } from '../art/art.js';
import { Feel } from '../combat/feel.js';
import { SFX } from '../core/audio.js';
import { Save } from '../core/save.js';
import { FX } from '../effects/fx.js';
import { player } from '../player/player.js';
import { HUD } from '../ui/hud.js';

/* =====================================================================
   Chip registry + body slots.
   A chip is a permanent unlock that rewrites one body slot. Chips are never
   random and never consumed. Every unlocked chip is usable at any time,
   mid-combo included; switching never pauses. Locked chips cannot be used.

     rarm  R-ARM  weapon. Blade / Cannon, swapped instantly with Q (or 1 / 2)
     larm  L-ARM  Shield, on its own button (L)
     legs  LEGS   Blink, on its own button (K)
     core  CORE   reserved for passive chips
   ===================================================================== */
export const SLOTS = {
  rarm: { id: 'rarm', label: 'R-ARM', key: 'J', swap: 'Q' },
  larm: { id: 'larm', label: 'L-ARM', key: 'L' },
  legs: { id: 'legs', label: 'LEGS',  key: 'K' },
  core: { id: 'core', label: 'CORE',  key: null },
};
export const SLOT_ORDER = ['rarm', 'larm', 'legs', 'core'];

/* cool = base cooldown in seconds (the blade's real cadence comes from SWING in player.js) */
export const CHIPS = {
  blade:  { id: 'blade',  name: 'BLADE',  slot: 'rarm', slotLabel: 'R-ARM', key: 'J', sub: '3-HIT COMBO',         cool: 0.26, starter: true,
            color: { d: '#0e7f9c', m: '#2fe6ff', l: '#d6fdff' }, desc: 'Energy blade. Slash, reverse slash, heavy finisher.' },
  cannon: { id: 'cannon', name: 'CANNON', slot: 'rarm', slotLabel: 'R-ARM', key: 'J', sub: 'TAP · HOLD = CHARGE', cool: 0.30,
            color: { d: '#b8700c', m: '#ffc43d', l: '#fff3b8' }, desc: 'Plasma arm. Tap to shoot, hold 0.6 s for a piercing lance.' },
  shield: { id: 'shield', name: 'SHIELD', slot: 'larm', slotLabel: 'L-ARM', key: 'L', sub: 'HOLD · TAP = PARRY',  cool: 0.40,
            color: { d: '#5a3fc0', m: '#a58bff', l: '#ece4ff' }, desc: 'Hard-light guard (3 blocks). Tap on impact to parry.' },
  blink:  { id: 'blink',  name: 'BLINK',  slot: 'legs', slotLabel: 'LEGS',  key: 'K', sub: 'WARP · SLASH',        cool: 1.60,
            color: { d: '#a3146f', m: '#ff4fc0', l: '#ffd0f0' }, desc: 'Short warp that slashes everything in its path.' },
};
export const CHIP_INFO = CHIPS;                      // legacy name used by HUD / renderer
export const CHIP_ORDER = ['blade', 'cannon', 'shield', 'blink'];
export const WEAPONS = CHIP_ORDER.filter(id => CHIPS[id].slot === 'rarm');
export const chipsInSlot = slot => CHIP_ORDER.filter(id => CHIPS[id].slot === slot);
export const isUnlocked = id => !!CHIPS[id] && player.unlocked.has(id);

/* equipped chip per slot (rarm = the active weapon; larm/legs are on as soon as they are unlocked) */
export function syncSlots() {
  const p = player;
  p.hasShield = p.unlocked.has('shield'); p.hasBlink = p.unlocked.has('blink');
  if (!p.unlocked.has(p.chip)) p.chip = 'blade';
  p.equip.rarm = p.chip;
  p.equip.larm = p.hasShield ? 'shield' : null;
  p.equip.legs = p.hasBlink ? 'blink' : null;
  p.equip.core = null;
}

export function switchChip(id, silent) {                                // R-ARM weapon swap (instant, never pauses)
  const p = player;
  if (!WEAPONS.includes(id) || !p.unlocked.has(id) || p.chip === id || p.dead) return false;
  const cancelled = p.atkStep > 0 || p.charging;
  p.chip = id; p.equip.rarm = id; p.xf = 0; p.cd.blade = 0; p.heldGap = 0;          // a cancelled swing leaves no dead input (R2-011a)
  p.atkStep = 0; p.atkU = 0; p.atkPhase = ''; p.atkQueued = false; p.lungeT = 0;
  p.muzzle = 0; p.recoil = 0; p.charging = false; p.chargeT = 0; p.charge = 0;
  HUD.setActive(id, true);
  if (silent) return true;
  const A = ACCENT[id], hx = p.x + p.facing * 0.4, hy = p.y + 1.2;
  FX.bits(hx, hy, A.m, 12);
  FX.ring(hx, hy, 3, 20, 0.22, A.m);
  FX.disc(hx, hy, cancelled ? 9 : 6, 0.1, '#ffffff');               // a cancelled swing / charge "snaps" brighter
  FX.text(CHIPS[id].name, p.x, p.y + 2.9, A.m, 0.7);
  Feel.kick(1.2);
  SFX.play('xform');
  return true;
}
export function swapWeapon() {
  const p = player;
  if (!p.unlocked.has('cannon')) { HUD.toast('NO SECOND WEAPON YET', '#8ea3c4', 1.2); return; }
  switchChip(p.chip === 'blade' ? 'cannon' : 'blade');
}
export function cycleChipDir() { swapWeapon(); }

export const UNLOCK_HINT = {
  cannon: '[Q] swaps BLADE / CANNON  ·  cannon auto-aims, hold [I] up / [S] down to steer',
  shield: 'hold [L] to guard (3 blocks, then GUARD BREAK)  ·  tap it right before a hit to PARRY',
  blink:  '[K] warps through enemies with any weapon',
};
export function unlockChip(id) {
  const p = player;
  if (!CHIPS[id] || p.unlocked.has(id)) return;
  p.unlocked.add(id); Save.setChips(p.unlocked); syncSlots();
  HUD.setUnlocked(p.unlocked);
  if (WEAPONS.includes(id)) switchChip(id);                              // a new weapon is equipped straight away
  const A = ACCENT[id];
  HUD.toast(`◈ ${CHIPS[id].slotLabel} UPGRADE: ${CHIPS[id].name}`, A.m, 2.2);
  HUD.hint(UNLOCK_HINT[id], A.m);
  const oy = id === 'blink' ? 0.3 : 1.1;                                 // burst on the body part that changed
  FX.ring(p.x, p.y + oy, 4, 40, 0.4, A.m); FX.ring(p.x, p.y + oy, 2, 28, 0.3, '#ffffff');
  FX.burst(p.x, p.y + oy, 26, A.m, 11); FX.bits(p.x, p.y + oy, A.l, 14);
  Feel.screenFlash(0.25, A.l);
  SFX.play('pickup');
}
