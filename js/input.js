'use strict';
/* =====================================================================
   Input: keyboard, mouse, touch buttons and gamepad.
   Movement handling intentionally mirrors v0.3 (confirmed working):
     - keyName() fallback for embedded browsers that report empty `code`
     - an immediate nudge on the FIRST press of a move key (not on OS key
       repeat — v0.3 re-applied it on every repeat event, which made long
       holds faster than short ones)
   Lost key-ups (alt-tab, focus steal) are handled by clearing on blur.
   ===================================================================== */
const keys = {};                 // held keys by normalised code
const touch = {};                // held virtual buttons
const pressed = { jump: false, dash: false, attack: false };   // edge flags, consumed by the sim
let gpPrev = { jump: false, dash: false, atk: false, lb: false, rb: false };
let lastInputLabel = '-';

function keyName(e) {
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

function clearInput() { for (const k in keys) keys[k] = false; for (const k in touch) touch[k] = false; }

const isLeftKey = k => k === 'KeyA' || k === 'ArrowLeft';
const isRightKey = k => k === 'KeyD' || k === 'ArrowRight';

function inputLeft() { return !!(keys.KeyA || keys.ArrowLeft || touch.left); }
function inputRight() { return !!(keys.KeyD || keys.ArrowRight || touch.right); }
function inputAttackHeld() { return !!(keys.KeyJ || keys.KeyK || touch.attack); }

window.addEventListener('keydown', e => {
  const k = keyName(e);
  lastInputLabel = k.replace('Key', '').replace('Arrow', '→');
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight'].includes(k)) e.preventDefault();
  const first = !keys[k] && !e.repeat;
  if (first) {
    if (k === 'Space' || k === 'KeyW' || k === 'ArrowUp') pressed.jump = true;
    else if (k === 'ShiftLeft' || k === 'ShiftRight') pressed.dash = true;
    else if (k === 'KeyJ' || k === 'KeyK') pressed.attack = true;
    else if (k === 'KeyQ') Game.cycleChip(-1);
    else if (k === 'KeyE') Game.cycleChip(1);
    else if (k === 'KeyR') { if (Game.running) Game.restart(); }
    else if (k === 'KeyP' || k === 'Escape') Game.togglePause();
    else if (k === 'KeyM') HUD.toast(SFX.toggleMute() ? 'SOUND OFF' : 'SOUND ON', '#8ea3c4');
    else if (k === 'F3') { e.preventDefault(); HUD.toggleDebug(); }
    else if (k === 'F4') { e.preventDefault(); Game.showBoxes = !Game.showBoxes; }
    else if (k === 'Digit1' || k === 'Digit2' || k === 'Digit3' || k === 'Digit4') Game.selectChip(CHIP_ORDER[Number(k.slice(-1)) - 1]);
    // v0.3 safeguard kept: an immediate nudge so even a very short tap registers
    if ((isLeftKey(k) || isRightKey(k)) && Game.running) Game.moveNudge(isRightKey(k) ? 1 : -1, 0.35);
  }
  keys[k] = true;
});
window.addEventListener('keyup', e => { keys[keyName(e)] = false; });
window.addEventListener('blur', clearInput);
document.addEventListener('visibilitychange', () => { if (document.hidden) clearInput(); });

/* mouse: click anywhere on the playfield to attack */
function bindPointer(game) {
  game.addEventListener('pointerdown', e => {
    if (e.target.closest('button') || !Game.running) return;
    if (e.button === 0) { touch.attack = true; pressed.attack = true; try { game.setPointerCapture(e.pointerId); } catch { /* noop */ } }
  });
  const up = () => { touch.attack = false; };
  game.addEventListener('pointerup', up);
  game.addEventListener('pointercancel', up);
  game.addEventListener('contextmenu', e => e.preventDefault());
}

/* on-screen touch buttons */
function bindTouchButtons() {
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
    });
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture'])
      btn.addEventListener(ev, () => { touch[name] = false; btn.classList.remove('pressed'); });
  }
  if (matchMedia('(pointer:coarse)').matches || /[?&]touch\b/.test(location.search)) document.body.classList.add('touch-ui');
}

function pollGamepad() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  let gp = null;
  for (const p of pads) if (p && p.connected) { gp = p; break; }
  if (!gp) return;
  const ax = gp.axes[0] || 0, b = i => !!(gp.buttons[i] && gp.buttons[i].pressed);
  touch.left = ax < -0.25 || b(14); touch.right = ax > 0.25 || b(15);
  const jump = b(0), dash = b(1), atk = b(2) || b(5);
  if (jump && !gpPrev.jump) pressed.jump = true;
  if (dash && !gpPrev.dash) pressed.dash = true;
  if (atk && !gpPrev.atk) pressed.attack = true;
  touch.attack = atk;
  if (b(4) && !gpPrev.lb) Game.cycleChip(-1);
  if ((b(6) || b(7)) && !gpPrev.rb) Game.cycleChip(1);
  gpPrev = { jump, dash, atk, lb: b(4), rb: b(6) || b(7) };
}
