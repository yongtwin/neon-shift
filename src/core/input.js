import { SFX } from './audio.js';
import { Game } from './game.js';
import { HUD } from '../ui/hud.js';

/* =====================================================================
   Input: KEYBOARD + GAMEPAD only (no mouse, so hands never leave the controls).

   v0.5 layout — every body slot has its OWN button, so nothing has to be
   swapped to defend or reposition:
     R-ARM (Blade / Cannon)  J attack            Q swap  (or 1 / 2)
     L-ARM (Shield)          L hold              tap just before a hit = PARRY
     LEGS  (Blink)           K tap
     Cannon aim              auto-locks the nearest enemy ahead;
                             hold I = aim up, S = aim down (↑ / ↓ also work)
   Gamepad: A jump · B dash · X attack · Y blink · LT/LB shield · RB swap ·
            right stick (or left stick up/down) aims.

   Movement handling still mirrors v0.3 (keyName fallback + first-press nudge).
   ===================================================================== */
export const keys = {};                 // held keys by normalised code
export const touch = {};                // held virtual buttons (touch pad + gamepad)
export const pressed = { jump: false, dash: false, attack: false, blink: false };   // edge flags, consumed by the sim
export const Aim = { padX: 0, padY: 0, pad: false };
export let gpPrev = { jump: false, dash: false, atk: false, blink: false, swap: false };
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

export function clearInput() { for (const k in keys) keys[k] = false; for (const k in touch) touch[k] = false; }

export const isLeftKey = k => k === 'KeyA' || k === 'ArrowLeft';
export const isRightKey = k => k === 'KeyD' || k === 'ArrowRight';

export function inputLeft() { return !!(keys.KeyA || keys.ArrowLeft || touch.left); }
export function inputRight() { return !!(keys.KeyD || keys.ArrowRight || touch.right); }
export function inputAttackHeld() { return !!(keys.KeyJ || touch.attack || touch.pAttack); }
export function inputShieldHeld() { return !!(keys.KeyL || touch.shield || touch.pShield); }
export function inputAimUp() { return !!(keys.KeyI || keys.ArrowUp || touch.pUp); }
export function inputAimDown() { return !!(keys.KeyS || keys.ArrowDown || touch.pDown); }

window.addEventListener('keydown', e => {
  const k = keyName(e);
  lastInputLabel = k.replace('Key', '').replace('Arrow', '→');
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight'].includes(k)) e.preventDefault();
  const first = !keys[k] && !e.repeat;
  if (first) {
    if (k === 'Space' || k === 'KeyW') pressed.jump = true;
    else if (k === 'ShiftLeft' || k === 'ShiftRight') pressed.dash = true;
    else if (k === 'KeyJ') pressed.attack = true;
    else if (k === 'KeyK' || k === 'KeyE') pressed.blink = true;
    else if (k === 'KeyQ') Game.swapWeapon();
    else if (k === 'Digit1') Game.selectChip('blade');
    else if (k === 'Digit2') Game.selectChip('cannon');
    else if (k === 'KeyR') { if (Game.running) Game.restart(); }
    else if (k === 'KeyP' || k === 'Escape') Game.togglePause();
    else if (k === 'KeyM') HUD.toast(SFX.toggleMute() ? 'SOUND OFF' : 'SOUND ON', '#8ea3c4');
    else if (k === 'F3') { e.preventDefault(); HUD.toggleDebug(); }
    else if (k === 'F4') { e.preventDefault(); Game.showBoxes = !Game.showBoxes; }
    // v0.3 safeguard kept: an immediate nudge so even a very short tap registers
    if ((isLeftKey(k) || isRightKey(k)) && Game.running) Game.moveNudge(isRightKey(k) ? 1 : -1, 0.35);
  }
  keys[k] = true;
});
window.addEventListener('keyup', e => { keys[keyName(e)] = false; });
window.addEventListener('blur', clearInput);
document.addEventListener('visibilitychange', () => { if (document.hidden) clearInput(); });

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
      if (name === 'left' || name === 'right') { if (Game.running) Game.moveNudge(name === 'right' ? 1 : -1, 0.5); }
      else if (name === 'jump') pressed.jump = true;
      else if (name === 'dash') pressed.dash = true;
      else if (name === 'attack') pressed.attack = true;
      else if (name === 'blink') pressed.blink = true;
      else if (name === 'swap') Game.swapWeapon();
    });
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture'])
      btn.addEventListener(ev, () => { touch[name] = false; btn.classList.remove('pressed'); });
  }
  if (matchMedia('(pointer:coarse)').matches || /[?&]touch\b/.test(location.search)) document.body.classList.add('touch-ui');
}

export function pollGamepad() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  let gp = null;
  for (const p of pads) if (p && p.connected) { gp = p; break; }
  if (!gp) return;
  const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0, b = i => !!(gp.buttons[i] && gp.buttons[i].pressed);
  touch.left = ax < -0.25 || b(14); touch.right = ax > 0.25 || b(15);
  touch.pUp = ay < -0.55 || b(12); touch.pDown = ay > 0.55 || b(13);
  const jump = b(0), dash = b(1), atk = b(2) || b(7), blink = b(3), swap = b(5);
  if (jump && !gpPrev.jump) pressed.jump = true;
  if (dash && !gpPrev.dash) pressed.dash = true;
  if (atk && !gpPrev.atk) pressed.attack = true;
  if (blink && !gpPrev.blink) pressed.blink = true;
  if (swap && !gpPrev.swap) Game.swapWeapon();
  touch.pAttack = atk; touch.pShield = b(6) || b(4);
  const rx = gp.axes[2] || 0, ry = gp.axes[3] || 0;
  Aim.pad = Math.hypot(rx, ry) > 0.35; Aim.padX = rx; Aim.padY = -ry;
  if (atk || jump || dash || blink || Aim.pad) lastInputLabel = 'GAMEPAD';
  gpPrev = { jump, dash, atk, blink, swap };
}
