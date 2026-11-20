import { SFX } from './audio.js';
import { Game } from './game.js';
import { HUD } from '../ui/hud.js';
import { Screens } from '../ui/screens.js';

/* =====================================================================
   Input: KEYBOARD + GAMEPAD (+ touch buttons). No mouse.

     R-ARM (Blade / Cannon)  J attack            Q swap  (or 1 / 2)
     L-ARM (Shield)          L hold = guard,     every fresh press = parry window
     LEGS  (Blink)           K / E
     Cannon aim              auto-locks the nearest enemy ahead; I up / S down
   Gamepad: A jump · B dash · X/RT attack · Y blink · LT/LB shield (pressing the
            second shield trigger while the first is held re-times the parry) ·
            RB swap · right stick (or left stick up/down) aims.

   State lives in three separate sources so one can never leave another stuck:
     keys  (keyboard, cleared on blur / tab hide)
     touch (on-screen buttons, cleared on pointerup / blur)
     pad   (gamepad, rewritten every poll and CLEARED when the pad disconnects)
   `pressed` holds edge flags; the simulation consumes them on its next tick.
   Action edges are ignored while paused / on the title screen and all edges
   are cleared on pause, resume and restart (no jump-on-resume).
   ===================================================================== */
export const keys = {};
export const touch = {};
export const pad = { left: false, right: false, up: false, down: false, attack: false, shield: false };
export const pressed = { jump: false, jumpCut: false, dash: false, attack: false, blink: false, shield: false, tap: 0 };
export const Aim = { padX: 0, padY: 0, pad: false };
let gpPrev = { jump: false, dash: false, atk: false, blink: false, swap: false, lt: false, lb: false };
export let lastInputLabel = '-';

export function keyName(e) {
  const code = e.code;
  if (code && code !== 'Unidentified') return code;
  const raw = e.key || '', k = raw.toLowerCase();
  if (/^[a-z]$/.test(k)) return 'Key' + k.toUpperCase();
  if (/^[1-4]$/.test(k)) return 'Digit' + k;
  if (k === ' ' || k === 'spacebar') return 'Space';
  if (k === 'shift') return 'ShiftLeft';
  if (k.startsWith('arrow')) return 'Arrow' + k.slice(5, 6).toUpperCase() + k.slice(6);
  return code || raw;
}

export function clearPressed() { for (const k in pressed) pressed[k] = k === 'tap' ? 0 : false; }
function clearPad() { for (const k in pad) pad[k] = false; Aim.pad = false; Aim.padX = 0; Aim.padY = 0; gpPrev = { jump: false, dash: false, atk: false, blink: false, swap: false, lt: false, lb: false }; }
export function clearInput() { for (const k in keys) keys[k] = false; for (const k in touch) touch[k] = false; clearPad(); clearPressed(); }

export const isLeftKey = k => k === 'KeyA' || k === 'ArrowLeft';
export const isRightKey = k => k === 'KeyD' || k === 'ArrowRight';
const JUMP_KEYS = ['Space', 'KeyW'];

export function inputLeft() { return !!(keys.KeyA || keys.ArrowLeft || touch.left || pad.left); }
export function inputRight() { return !!(keys.KeyD || keys.ArrowRight || touch.right || pad.right); }
export function inputAttackHeld() { return !!(keys.KeyJ || touch.attack || pad.attack); }
export function inputShieldHeld() { return !!(keys.KeyL || touch.shield || pad.shield); }
export function inputAimUp() { return !!(keys.KeyI || keys.ArrowUp || pad.up); }
export function inputAimDown() { return !!(keys.KeyS || keys.ArrowDown || pad.down); }

const live = () => Game.running && !Game.paused;

window.addEventListener('keydown', e => {
  const k = keyName(e);
  lastInputLabel = k.replace('Key', '').replace('Arrow', '→');
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight', 'Tab'].includes(k)) e.preventDefault();
  const first = !keys[k] && !e.repeat;
  keys[k] = true;
  if (!first) return;
  if (Screens.isOpen()) { if (Screens.onKey(k)) { keys[k] = false; return; } }   // menus own the keyboard while open
  if ((k === 'Tab' || k === 'KeyC') && Game.running) { Game.toggleChips(); return; }
  if (k === 'KeyP' || k === 'Escape') { Game.togglePause(); return; }
  if (k === 'KeyM') { HUD.toast(SFX.toggleMute() ? 'SOUND OFF' : 'SOUND ON', '#8ea3c4'); return; }
  if (k === 'KeyN') { HUD.toast(SFX.toggleMusic() ? 'MUSIC ON' : 'MUSIC OFF', '#8ea3c4', 1); return; }
  if (k === 'F3') { e.preventDefault(); HUD.toggleDebug(); return; }
  if (k === 'F4') { e.preventDefault(); Game.showBoxes = !Game.showBoxes; return; }
  if (k === 'KeyR') { if (Game.running && !Game.paused) HUD.toast('HOLD R TO RESTART THE STAGE', '#8ea3c4', 0.9); return; }   // R2-005
  if (!live()) return;                                   // action keys do nothing while paused / on the title
  if (JUMP_KEYS.includes(k)) pressed.jump = true;
  else if (k === 'ShiftLeft' || k === 'ShiftRight') pressed.dash = true;
  else if (k === 'KeyJ') pressed.attack = true;
  else if (k === 'KeyK' || k === 'KeyE') pressed.blink = true;
  else if (k === 'KeyL') pressed.shield = true;
  else if (k === 'KeyQ') Game.swapWeapon();
  else if (k === 'Digit1') Game.selectChip('blade');
  else if (k === 'Digit2') Game.selectChip('cannon');
  else if (isLeftKey(k)) pressed.tap = -1;               // a very short tap still moves (consumed by the sim)
  else if (isRightKey(k)) pressed.tap = 1;
});
window.addEventListener('keyup', e => {
  const k = keyName(e);
  keys[k] = false;
  if (JUMP_KEYS.includes(k) && live()) pressed.jumpCut = true;     // variable jump height
});
window.addEventListener('blur', clearInput);
document.addEventListener('visibilitychange', () => { if (document.hidden) clearInput(); });
window.addEventListener('gamepaddisconnected', clearPad);

/* the playfield ignores the mouse on purpose; it only keeps keyboard focus */
export function bindPointer(game) {
  game.addEventListener('contextmenu', e => e.preventDefault());
}

/* on-screen touch buttons (phones / tablets) */
export function bindTouchButtons() {
  for (const btn of document.querySelectorAll('.touch')) {
    const name = btn.dataset.control;
    btn.addEventListener('pointerdown', e => {
      e.preventDefault();
      try { btn.setPointerCapture(e.pointerId); } catch { /* noop */ }
      touch[name] = true; btn.classList.add('pressed'); lastInputLabel = 'TOUCH';
      if (!live()) return;
      if (name === 'left' || name === 'right') pressed.tap = name === 'right' ? 1 : -1;
      else if (name === 'jump') pressed.jump = true;
      else if (name === 'dash') pressed.dash = true;
      else if (name === 'attack') pressed.attack = true;
      else if (name === 'blink') pressed.blink = true;
      else if (name === 'shield') pressed.shield = true;
      else if (name === 'swap') Game.swapWeapon();
    });
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture'])
      btn.addEventListener(ev, () => { touch[name] = false; btn.classList.remove('pressed'); if (name === 'jump' && live()) pressed.jumpCut = true; });
  }
  if (matchMedia('(pointer:coarse)').matches || /[?&]touch\b/.test(location.search)) document.body.classList.add('touch-ui');
}

export function pollGamepad() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  let gp = null;
  for (const p of pads) if (p && p.connected) { gp = p; break; }
  if (!gp) { if (pad.left || pad.right || pad.up || pad.down || pad.attack || pad.shield || Aim.pad) clearPad(); return; }
  const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0, b = i => !!(gp.buttons[i] && gp.buttons[i].pressed);
  pad.left = ax < -0.25 || b(14); pad.right = ax > 0.25 || b(15);
  pad.up = ay < -0.55 || b(12); pad.down = ay > 0.55 || b(13);
  const jump = b(0), dash = b(1), atk = b(2) || b(7), blink = b(3), swap = b(5), lt = b(6), lb = b(4);
  pad.attack = atk; pad.shield = lt || lb;
  const rx = gp.axes[2] || 0, ry = gp.axes[3] || 0;
  Aim.pad = Math.hypot(rx, ry) > 0.35; Aim.padX = rx; Aim.padY = -ry;
  if (live()) {
    if (jump && !gpPrev.jump) pressed.jump = true;
    if (!jump && gpPrev.jump) pressed.jumpCut = true;
    if (dash && !gpPrev.dash) pressed.dash = true;
    if (atk && !gpPrev.atk) pressed.attack = true;
    if (blink && !gpPrev.blink) pressed.blink = true;
    if ((lt && !gpPrev.lt) || (lb && !gpPrev.lb)) pressed.shield = true;
    if (swap && !gpPrev.swap) Game.swapWeapon();
  }
  if (atk || jump || dash || blink || Aim.pad) lastInputLabel = 'GAMEPAD';
  gpPrev = { jump, dash, atk, blink, swap, lt, lb };
}
