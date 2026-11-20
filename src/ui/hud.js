import { ACCENT, makeChipIcon } from '../art/art.js';
import { CHIP_INFO, CHIP_ORDER } from '../chips/chips.js';
import { lastInputLabel } from '../core/input.js';
import { $ } from '../core/util.js';

/* =====================================================================
   DOM HUD. The chip bar and health pips are built ONCE and only touched
   when a value actually changes (v0.3 rebuilt them on every hit).
   ===================================================================== */
export const HUD = {
  chips: {}, pips: [], last: {}, toastT: 0, debugOn: false, hintT: 14,

  init() {
    const hp = $('health');
    for (let i = 0; i < 6; i++) { const v = document.createElement('i'); hp.appendChild(v); this.pips.push(v); }

    /* guard meter (shield stamina): 3 pips beside the health bar, shown once SHIELD is owned */
    const gw = document.createElement('div'); gw.className = 'guard'; gw.id = 'guard';
    gw.innerHTML = '<span class="tiny">GUARD</span>';
    this.gpips = [];
    for (let i = 0; i < 3; i++) { const v = document.createElement('i'); gw.appendChild(v); this.gpips.push(v); }
    hp.parentElement.appendChild(gw);

    /* stage label (top of the right panel) */
    const right = document.querySelector('.hud-right');
    if (right && !document.getElementById('stage-name')) {
      const st = document.createElement('div'); st.className = 'stage-tag'; st.id = 'stage-name';
      st.innerHTML = '<span id="stage-idx">STAGE 1</span><b id="stage-title">NEON DISTRICT</b>';
      right.prepend(st);
    }

    /* three body slots, each labelled with the button that fires it */
    const bar = $('chipbar');
    const groups = [['R-ARM', ['blade', 'cannon'], 'J'], ['L-ARM', ['shield'], 'L'], ['LEGS', ['blink'], 'K']];
    for (const [label, ids, key] of groups) {
      const grp = document.createElement('div'); grp.className = 'slot';
      grp.innerHTML = `<div class="slot-label">${label} <kbd>${key}</kbd>${ids.length > 1 ? '<span class="swap">⇄ <kbd>Q</kbd></span>' : ''}</div>`;
      const row = document.createElement('div'); row.className = 'slot-row';
      for (const id of ids) {
        const info = CHIP_INFO[id], A = ACCENT[id];
        const b = document.createElement('div');
        b.className = 'chip'; b.dataset.chip = id; b.style.setProperty('--c', A.m);
        const img = document.createElement('img');
        img.className = 'ico'; img.alt = ''; img.src = makeChipIcon(id).toDataURL();
        img.style.width = img.style.height = '28px';
        const txt = document.createElement('span');
        txt.innerHTML = `<span class="name">${info.name}</span><span class="sub">${info.sub}</span>`;
        const cd = document.createElement('span'); cd.className = 'cd';
        const barEl = document.createElement('span'); barEl.className = 'bar';
        b.append(img, txt, cd, barEl);
        row.appendChild(b);
        this.chips[id] = { el: b, cd, img, sub: txt.querySelector('.sub'), name: txt.querySelector('.name'), cdv: 0, live: false };
      }
      grp.appendChild(row); bar.appendChild(grp);
    }
  },
  setLive(id, on) {                          // shield raised / blink firing: light the card up
    const c = this.chips[id];
    if (c.live === on) return;
    c.live = on; c.el.classList.toggle('live', on);
  },
  setBoss(e) {                               // top-centre boss integrity bar
    const on = !!e;
    if (this.last.bossOn !== on) { this.last.bossOn = on; $('boss').classList.toggle('on', on); }
    if (!on) return;
    const f = Math.round(Math.max(0, e.hp) / e.maxhp * 100) / 100, ph = !!e.phase2;
    if (this.last.bossF !== f) { this.last.bossF = f; $('boss-fill').style.transform = `scaleX(${f})`; }
    if (this.last.bossPh !== ph) { this.last.bossPh = ph; $('boss-name').textContent = ph ? 'WARDEN // OVERDRIVE' : 'WARDEN // SECURITY CORE'; $('boss').classList.toggle('p2', ph); }
  },
  hint(text, color = '#2fe6ff', dur = 6) {   // contextual tutorial line at the bottom of the screen
    const el = $('hint'); el.textContent = text; el.style.color = color;
    el.classList.remove('off'); this.hintT = dur;
  },

  setUnlocked(set) {
    for (const id of CHIP_ORDER) {
      const c = this.chips[id], has = set.has(id);
      c.el.classList.toggle('locked', !has);
      if (id === 'shield' || id === 'blink') c.el.classList.toggle('armed', has);
      c.sub.textContent = has ? CHIP_INFO[id].sub : 'LOCKED';
      c.img.style.filter = has ? '' : 'grayscale(1) brightness(.4)';
    }
    $('unlocks').textContent = `${set.size} / ${CHIP_ORDER.length}`;
  },
  setActive(id, pop) {
    for (const k of CHIP_ORDER) this.chips[k].el.classList.toggle('active', k === id);
    if (pop) { const el = this.chips[id].el; el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); }
  },
  setCooldown(id, f) {                       // f: 1 = just used, 0 = ready
    const c = this.chips[id], v = Math.round(f * 50) / 50;
    if (c.cdv === v) return;
    if (c.cdv > 0 && v === 0) { c.el.classList.remove('ready'); void c.el.offsetWidth; c.el.classList.add('ready'); }
    c.cdv = v; c.cd.style.transform = `scaleY(${v})`;
  },
  setHealth(hp, max, hurt) {
    for (let i = 0; i < this.pips.length; i++) {
      const p = this.pips[i];
      p.style.display = i < max ? '' : 'none';
      p.classList.toggle('empty', i >= hp);
    }
    if (hurt && hp < max) { const p = this.pips[hp]; if (p) { p.classList.remove('pop'); void p.offsetWidth; p.classList.add('pop'); setTimeout(() => p.classList.remove('pop'), 160); } }
  },
  /** guard: 0..max (fractional), broken = guard-break stun */
  setGuard(guard, max = 3, broken = false) {
    if (!this.gpips) return;
    const g = Math.round((guard || 0) * 4) / 4, key = g + '|' + max + '|' + broken + '|' + (this.chips.shield && !this.chips.shield.el.classList.contains('locked'));
    if (this.last.guard === key) return; this.last.guard = key;
    const el = document.getElementById('guard'); if (el) el.classList.toggle('broken', !!broken);
    const n = Math.max(1, Math.round(max) || 3);
    for (let i = 0; i < this.gpips.length; i++) {
      const p = this.gpips[i], f = Math.max(0, Math.min(1, g - i));
      p.style.display = i < n ? '' : 'none';
      p.style.setProperty('--f', f);
      p.classList.toggle('empty', f <= 0); p.classList.toggle('full', f >= 1);
    }
  },
  setStage(idx, name) {
    const key = idx + '|' + name; if (this.last.stage === key) return; this.last.stage = key;
    const i = document.getElementById('stage-idx'), t = document.getElementById('stage-title');
    if (i) i.textContent = 'STAGE ' + idx; if (t) t.textContent = name;
  },
  setKills(k, total) { $('killcount').textContent = `${k} / ${total}`; },
  setProgress(pct) { if (this.last.pct !== pct) { this.last.pct = pct; $('progress').textContent = pct + '%'; } },

  setCombo(n, frac) {
    const el = $('combo'), num = $('combo-n');
    const on = n >= 2;
    if (this.last.comboOn !== on) { this.last.comboOn = on; el.classList.toggle('on', on); }
    if (on) {
      if (this.last.combo !== n) { this.last.combo = n; num.textContent = n; num.classList.remove('bump'); void num.offsetWidth; num.classList.add('bump'); }
      const f = Math.round(frac * 40) / 40;
      if (this.last.cf !== f) { this.last.cf = f; $('combo-bar').style.transform = `scaleX(${f})`; }
    } else this.last.combo = 0;
  },

  toast(t, color = '#2fe6ff', dur = 1.7) {
    const el = $('toast'); el.textContent = t; el.style.color = color; el.classList.add('show'); this.toastT = dur;
  },
  update(dt) {
    if (this.toastT > 0) { this.toastT -= dt; if (this.toastT <= 0) $('toast').classList.remove('show'); }
    if (this.hintT > 0) { this.hintT -= dt; if (this.hintT <= 0) $('hint').classList.add('off'); }
  },

  toggleDebug() { this.debugOn = !this.debugOn; $('debug').hidden = !this.debugOn; },
  debug(d) {
    if (!this.debugOn) return;
    $('d-fps').textContent = d.fps; $('d-pos').textContent = d.pos; $('d-vel').textContent = d.vel;
    $('d-frames').textContent = d.frames; $('d-hs').textContent = d.hs; $('d-fx').textContent = d.fx; $('d-input').textContent = lastInputLabel;
  },

  showOverlay(mode, info) {
    const ov = $('overlay'); ov.style.display = 'flex';
    ov.dataset.mode = mode;
    const set = (id, html) => { $(id).innerHTML = html; };
    if (mode === 'complete') {
      set('ov-eyebrow', '◉ RUN COMPLETE');
      set('ov-title', 'MISSION<span>//</span>CLEAR');
      set('ov-lead', info.message);
      set('ov-desc', `Hostiles down: <span class="hl">${info.kills}</span> / ${info.total} &nbsp;·&nbsp; Chips owned: <span class="hl">${info.chips}</span> / 4 &nbsp;·&nbsp; Time: <span class="hl">${info.time}</span><br>Best hit chain: <span class="hl">${info.bestCombo}</span> &nbsp;·&nbsp; Unlocked chips persist after restarting.`);
      $('ov-controls').style.display = 'none';
      $('start').textContent = '↻ PLAY AGAIN'; $('clear').style.display = 'none';
    } else {
      set('ov-eyebrow', '◉ NEON//SHIFT · v1.0');
      set('ov-title', 'NEON<span>//</span>SHIFT');
      set('ov-lead', 'RUN FAST. REWRITE YOUR BODY. NEVER DRAW A BAD HAND.');
      $('ov-controls').style.display = '';
      $('start').textContent = '▶ START RUN'; $('clear').style.display = '';
    }
  },
  hideOverlay() { $('overlay').style.display = 'none'; },
};
