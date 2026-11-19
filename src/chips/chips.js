import { ACCENT } from '../art/art.js';
import { Feel } from '../combat/feel.js';
import { SFX } from '../core/audio.js';
import { saveUnlocked } from '../core/save.js';
import { FX } from '../effects/fx.js';
import { player } from '../player/player.js';
import { HUD } from '../ui/hud.js';

/* Chip registry (body slots) + R-ARM weapon switching / unlock logic. */
export const CHIP_ORDER = ['blade', 'cannon', 'shield', 'blink'];
export const CHIP_INFO = {   // slot = which body part the chip rewrites; key = the button that fires it
  blade:  { id: 'blade',  name: 'BLADE',  slot: 'R-ARM', key: 'J', sub: '3-HIT COMBO',        cool: 0.22 },
  cannon: { id: 'cannon', name: 'CANNON', slot: 'R-ARM', key: 'J', sub: 'TAP · HOLD = CHARGE', cool: 0.30 },
  shield: { id: 'shield', name: 'SHIELD', slot: 'L-ARM', key: 'L', sub: 'HOLD · TAP = PARRY',  cool: 0.55 },
  blink:  { id: 'blink',  name: 'BLINK',  slot: 'LEGS',  key: 'K', sub: 'WARP · SLASH',       cool: 1.60 },
};

/* ------------------------------------------------------------------ chips / body slots */
export const WEAPONS = ['blade', 'cannon'];
export function syncSlots() { player.hasShield = player.unlocked.has('shield'); player.hasBlink = player.unlocked.has('blink'); }

export function switchChip(id, silent) {                                       // R-ARM weapon swap (Blade <-> Cannon)
  const p = player;
  if (!WEAPONS.includes(id) || !p.unlocked.has(id) || p.chip === id || p.dead) return;
  p.chip = id; p.xf = 0;
  p.atkStep = 0; p.atkU = 0; p.muzzle = 0; p.recoil = 0;
  HUD.setActive(id, true);
  if (silent) return;
  const A = ACCENT[id], hx = p.x + p.facing * 0.4, hy = p.y + 1.2;
  FX.bits(hx, hy, A.m, 12);
  FX.ring(hx, hy, 3, 20, 0.22, A.m);
  FX.disc(hx, hy, 6, 0.1, '#ffffff');
  FX.text(CHIP_INFO[id].name, p.x, p.y + 2.9, A.m, 0.7);
  Feel.kick(1.2);
  SFX.play('xform');
}
export function swapWeapon() {
  const p = player;
  if (!p.unlocked.has('cannon')) { HUD.toast('NO SECOND WEAPON YET', '#8ea3c4', 1.2); return; }
  switchChip(p.chip === 'blade' ? 'cannon' : 'blade');
}
export function cycleChipDir() { swapWeapon(); }

export const UNLOCK_HINT = {
  cannon: '[Q] swaps BLADE / CANNON  ·  cannon auto-aims, hold [I] up / [S] down to steer',
  shield: 'hold [L] to guard while you fight  ·  tap it right before a hit to PARRY',
  blink:  '[K] warps through enemies with any weapon',
};
export function unlockChip(id) {
  const p = player;
  if (p.unlocked.has(id)) return;
  p.unlocked.add(id); saveUnlocked(p.unlocked); syncSlots();
  HUD.setUnlocked(p.unlocked);
  if (WEAPONS.includes(id)) switchChip(id);                              // a new weapon is equipped straight away
  const A = ACCENT[id];
  HUD.toast(`◈ ${CHIP_INFO[id].slot} UPGRADE: ${CHIP_INFO[id].name}`, A.m, 2.2);
  HUD.hint(UNLOCK_HINT[id], A.m);
  const oy = id === 'blink' ? 0.3 : 1.1;                                 // burst on the body part that changed
  FX.ring(p.x, p.y + oy, 4, 40, 0.4, A.m); FX.ring(p.x, p.y + oy, 2, 28, 0.3, '#ffffff');
  FX.burst(p.x, p.y + oy, 26, A.m, 11); FX.bits(p.x, p.y + oy, A.l, 14);
  Feel.screenFlash(0.25, A.l);
  SFX.play('pickup');
}
