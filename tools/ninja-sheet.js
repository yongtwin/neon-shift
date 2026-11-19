/* Standalone pose sheet for src/art/ninja.js (imports only the ninja modules). */
import { drawNinja, ninjaAnchors, ninjaCacheSize } from '../src/art/ninja.js';

const CW = 64, CH = 78, FEET = 66;
const SCARF_N = 10;

function scarfFor(p, t = 0) {
  const a = ninjaAnchors(p), sc = new Float32Array(SCARF_N * 2);
  const fast = p.anim === 'run' || p.anim === 'dash' || p.warpU > 0, fall = p.anim === 'fall', jump = p.anim === 'jump';
  sc[0] = a.scarf.x; sc[1] = -a.scarf.y;
  for (let i = 1; i < SCARF_N; i++) {
    const wob = Math.sin(t * 9 + i * 0.9) * 0.8 * (i / SCARF_N);
    const dx = fast ? -3.1 : -2.4, dy = fast ? 0.35 : fall ? -1.6 : jump ? 1.8 : 1.3;
    sc[i * 2] = sc[i * 2 - 2] + dx; sc[i * 2 + 1] = sc[i * 2 - 1] + dy + wob;
  }
  for (let i = 0; i < SCARF_N; i++) sc[i * 2] *= p.facing;
  return sc;
}
const base = o => Object.assign({ facing: 1, anim: 'idle', t: 0, run: 0, chip: 'blade', atkStep: 0, atkU: 0, aim: 0, recoil: 0, muzzle: 0,
  charge: 0, shieldAmt: 0, parryT: 0, blockFlash: 0, hasShield: true, hasBlink: true, warpU: 0, rot: 0, landT: 0, flash: 0, xf: 1 }, o);

const ROWS = [
  ['idle x4 (breathing)', [0, 0.4, 0.8, 1.2].map(t => base({ t, hasBlink: false }))],
  ['run x8', [0, 1, 2, 3, 4, 5, 6, 7].map(i => base({ anim: 'run', run: (i + 0.5) / 8 * Math.PI * 2 }))],
  ['jump / fall / dash / flip / land / hurt / hit-flash / death', [base({ anim: 'jump' }), base({ anim: 'fall' }), base({ anim: 'dash' }), base({ anim: 'jump', rot: -Math.PI / 2 }),
    base({ anim: 'idle', landT: 0.1 }), base({ anim: 'hurt' }), base({ anim: 'hurt', flash: 1 }), base({ anim: 'dead', deadU: 0.2 }), base({ anim: 'dead', deadU: 0.9 })]],
  ['blade 1 - horizontal slash', [0.05, 0.14, 0.24, 0.32, 0.42, 0.55, 0.8].map(u => base({ atkStep: 1, atkU: u }))],
  ['blade 2 - rising backhand', [0.05, 0.14, 0.24, 0.32, 0.42, 0.55, 0.8].map(u => base({ atkStep: 2, atkU: u }))],
  ['blade 3 - overhead finisher', [0.05, 0.16, 0.26, 0.34, 0.44, 0.58, 0.8].map(u => base({ atkStep: 3, atkU: u }))],
  ['cannon - aim / fire / charge / run / air', [base({ chip: 'cannon' }), base({ chip: 'cannon', aim: 0.6 }), base({ chip: 'cannon', aim: -0.6 }), base({ chip: 'cannon', aim: 1.2 }),
    base({ chip: 'cannon', muzzle: 0.1, recoil: 1 }), base({ chip: 'cannon', muzzle: 0.03, recoil: 0.5 }), base({ chip: 'cannon', charge: 0.5 }), base({ chip: 'cannon', charge: 1, t: 0.06 }),
    base({ chip: 'cannon', anim: 'run', run: 1 }), base({ chip: 'cannon', anim: 'jump', aim: -0.8 })]],
  ['shield - raise / block / parry', [base({ shieldAmt: 0.25 }), base({ shieldAmt: 0.6 }), base({ shieldAmt: 1 }), base({ shieldAmt: 1, blockFlash: 0.1 }), base({ shieldAmt: 1, parryT: 0.1 }),
    base({ chip: 'cannon', shieldAmt: 1 }), base({ anim: 'run', run: 2, shieldAmt: 1 })]],
  ['blink - leg thrusters (run / jump / fall / warp)', [base({ anim: 'run', run: 2, t: 0 }), base({ anim: 'jump', t: 0.06 }), base({ anim: 'fall', t: 0.11 }),
    base({ warpU: 0.33, anim: 'dash' }), base({ warpU: 0.66, anim: 'dash', t: 0.06 }), base({ warpU: 1, anim: 'dash', t: 0.11 })]],
  ['transform flash / no chips / facing left', [base({ xf: 0.15 }), base({ xf: 0.5 }), base({ chip: 'cannon', xf: 0.2 }), base({ chip: 'cannon', xf: 0.6 }),
    base({ hasShield: false, hasBlink: false }), base({ facing: -1 }), base({ facing: -1, chip: 'cannon', aim: 0.4 })]],
];

function bg(x, w, h) {
  const g = x.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#141a33'); g.addColorStop(1, '#1d2444');
  x.fillStyle = g; x.fillRect(0, 0, w, h);
}

const cols = Math.max(...ROWS.map(r => r[1].length));
const W = cols * CW, H = ROWS.length * CH;
const c1 = document.getElementById('sheet1x'); c1.width = W; c1.height = H;
const x1 = c1.getContext('2d'); x1.imageSmoothingEnabled = false;
bg(x1, W, H);
ROWS.forEach(([, poses], r) => {
  x1.fillStyle = '#262f58'; x1.fillRect(0, r * CH + FEET + 1, W, 1);
  poses.forEach((p, i) => {
    p.scarf = scarfFor(p, p.t);
    drawNinja(x1, p, i * CW + CW / 2 + 2, r * CH + FEET);
  });
});

const c4 = document.getElementById('sheet4x'); c4.width = W * 4; c4.height = H * 4;
const x4 = c4.getContext('2d'); x4.imageSmoothingEnabled = false;
x4.drawImage(c1, 0, 0, W * 4, H * 4);
x4.font = '12px Consolas, monospace'; x4.fillStyle = '#9fb0e0';
ROWS.forEach(([name], r) => x4.fillText(name, 6, r * CH * 4 + 14));
x4.fillStyle = 'rgba(255,255,255,0.05)';
for (let i = 1; i < cols; i++) x4.fillRect(i * CW * 4, 0, 1, H * 4);

/* live loops at 4x */
const LOOPS = ['idle', 'run', 'combo', 'cannon', 'shield', 'blink'];
const ca = document.getElementById('anim'), AW = 72, AH = 78; ca.width = AW * LOOPS.length; ca.height = AH;
ca.style.width = ca.width * 4 + 'px'; ca.style.height = ca.height * 4 + 'px';
const xa = ca.getContext('2d'); xa.imageSmoothingEnabled = false;
const t0 = performance.now();
function loopPose(kind, t) {
  if (kind === 'idle') return base({ t, hasBlink: false });
  if (kind === 'run') return base({ anim: 'run', run: t * 14, t });
  if (kind === 'combo') {
    const c = t % 1.6, step = Math.min(3, 1 + Math.floor(c / 0.42)), u = (c - (step - 1) * 0.42) / (step === 3 ? 0.7 : 0.42);
    return base({ atkStep: step, atkU: Math.min(1, u), t });
  }
  if (kind === 'cannon') { const c = t % 0.6; return base({ chip: 'cannon', t, aim: Math.sin(t * 0.7) * 0.5, muzzle: c < 0.08 ? 0.1 - c : 0, recoil: Math.max(0, 1 - c / 0.2) }); }
  if (kind === 'shield') { const c = t % 2; return base({ t, shieldAmt: Math.min(1, c * 4), parryT: c > 1 && c < 1.2 ? 0.1 : 0, blockFlash: c > 0.6 && c < 0.7 ? 0.1 : 0 }); }
  const c = t % 1.2; return base({ anim: c < 0.4 ? 'dash' : c < 0.8 ? 'jump' : 'fall', t, warpU: c < 0.4 ? 1 - c / 0.4 : 0 });
}
function tick() {
  const t = (performance.now() - t0) / 1000;
  bg(xa, ca.width, ca.height);
  xa.fillStyle = '#262f58'; xa.fillRect(0, FEET + 1, ca.width, 1);
  LOOPS.forEach((k, i) => { const p = loopPose(k, t); p.scarf = scarfFor(p, t); drawNinja(xa, p, i * AW + AW / 2 + 4, FEET); });
  document.getElementById('stats').textContent = `cached frames: ${ninjaCacheSize()}`;
  requestAnimationFrame(tick);
}
tick();

/* ?compare: the legacy #sprites layout (first two rows) for before/after shots */
if (/[?&]compare/.test(location.search)) {
  const OLD = [['idle', {}], ['run', { run: 0 }], ['run', { run: 1.2 }], ['run', { run: 2.4 }], ['run', { run: 3.6 }], ['jump', {}], ['fall', {}], ['dash', {}], ['hurt', {}],
    ['idle', { atkStep: 1, atkU: 0.45 }], ['idle', { atkStep: 2, atkU: 0.45 }], ['idle', { atkStep: 3, atkU: 0.55 }]];
  const cc = document.createElement('canvas'); cc.id = 'compare'; cc.width = 12 * 58; cc.height = 2 * 64 + 8;
  cc.style.width = cc.width * 4 + 'px'; cc.style.height = cc.height * 4 + 'px';
  document.body.prepend(cc);
  const xc = cc.getContext('2d'); xc.fillStyle = '#1a2038'; xc.fillRect(0, 0, cc.width, cc.height);
  [0, 1].forEach(r => OLD.forEach(([anim, o], i) => {
    const chip = r ? 'cannon' : 'blade';
    const p = base({ anim, chip, hasShield: false, hasBlink: r >= 1, aim: chip === 'cannon' ? (i - 6) * 0.25 : 0, muzzle: chip === 'cannon' && i === 9 ? 0.1 : 0, ...o });
    if (chip !== 'blade') p.atkStep = 0;
    p.scarf = scarfFor(p, 0);
    drawNinja(xc, p, 34 + i * 58, 62 + r * 64);
  }));
}
window.__sheetReady = true;
