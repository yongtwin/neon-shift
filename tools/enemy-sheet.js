/* Standalone pose sheet for src/art/enemy-art.js (+ the ninja for scale). */
import { drawEnemyArt } from '../src/art/enemy-art.js';
import { drawNinja } from '../src/art/ninja.js';

const CW = 120, CH = 140, FEET = 128;
const E = (kind, anim, o = {}) => Object.assign({ kind, anim, facing: -1, t: 0, walk: 0, tele: 0, muzzle: 0, recoil: 0, flash: 0 }, o);
const ROWS = [
  ['gunner', [E('gunner', 'idle'), E('gunner', 'walk', { walk: 0 }), E('gunner', 'walk', { walk: 1.6 }), E('gunner', 'alert'), E('gunner', 'windup', { tele: 0.4 }), E('gunner', 'windup', { tele: 1 }), E('gunner', 'fire', { muzzle: 0.1, recoil: 1 }), E('gunner', 'hit', { flash: 0.1 }), E('gunner', 'dead', { deadU: 0.2 }), E('gunner', 'dead', { deadU: 1 })]],
  ['enforcer', [E('enforcer', 'idle'), E('enforcer', 'walk', { walk: 0 }), E('enforcer', 'chase', { walk: 1.6 }), E('enforcer', 'windup', { tele: 0.5 }), E('enforcer', 'windup', { tele: 1, t: 0.08 }), E('enforcer', 'lunge'), E('enforcer', 'recover'), E('enforcer', 'hit', { flash: 0.1 }), E('enforcer', 'stagger'), E('enforcer', 'dead', { deadU: 1 })]],
  ['warden', [E('warden', 'idle'), E('warden', 'windup', { tele: 0.8, attack: 'bolt' }), E('warden', 'fire', { muzzle: 0.1, recoil: 1 }), E('warden', 'slam', { tele: 0.9 }), E('warden', 'alert', { attack: 'slam', state: 'alert', st: 0.1 }), E('warden', 'charge', { tele: 0.8 }), E('warden', 'stun'), E('warden', 'idle', { exposed: true, phase2: true })]],
  ['warden dying', [0.05, 0.2, 0.35, 0.5, 0.65, 0.8, 0.95].map(u => E('warden', 'dying', { deadU: u }))],
  ['drone / turret', [E('drone', 'idle'), E('drone', 'walk'), E('drone', 'windup', { tele: 1 }), E('drone', 'swoop'), E('drone', 'fire', { muzzle: 0.1, recoil: 1 }), E('drone', 'dead', { deadU: 1 }),
    E('turret', 'idle', { aim: 0.3 }), E('turret', 'windup', { tele: 1, aim: 0 }), E('turret', 'fire', { muzzle: 0.1, recoil: 1, aim: -0.3 }), E('turret', 'idle', { mount: 'ceiling', aim: -0.4 })]],
];
const cols = Math.max(...ROWS.map(r => r[1].length)) + 1;
const W = cols * CW, H = ROWS.length * CH;
const c1 = document.getElementById('sheet1x'); c1.width = W; c1.height = H;
const x1 = c1.getContext('2d'); x1.imageSmoothingEnabled = false;
x1.fillStyle = '#171d38'; x1.fillRect(0, 0, W, H);
ROWS.forEach(([, list], r) => {
  x1.fillStyle = '#262f58'; x1.fillRect(0, r * CH + FEET + 1, W, 1);
  drawNinja(x1, { facing: 1, anim: 'idle', chip: 'blade', t: 0 }, CW / 2, r * CH + FEET);
  list.forEach((e, i) => {
    const flying = e.kind === 'drone', ceil = e.mount === 'ceiling';
    drawEnemyArt(x1, e, (i + 1) * CW + CW / 2, r * CH + (ceil ? 6 : flying ? FEET - 22 : FEET));
  });
});
const c4 = document.getElementById('sheet4x'); c4.width = W * 4; c4.height = H * 4;
const x4 = c4.getContext('2d'); x4.imageSmoothingEnabled = false; x4.drawImage(c1, 0, 0, W * 4, H * 4);
x4.font = '12px Consolas, monospace'; x4.fillStyle = '#9fb0e0';
ROWS.forEach(([n], r) => x4.fillText(n, 6, r * CH * 4 + 14));
window.__sheetReady = true;
