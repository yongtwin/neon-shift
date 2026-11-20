import { makeChipIcon } from '../art/art.js';
import { CHIPS, CHIP_ORDER, SLOTS, SLOT_ORDER } from '../chips/chips.js';
import { SFX } from '../core/audio.js';
import { Save } from '../core/save.js';
import { player } from '../player/player.js';

/* =====================================================================
   Game-flow screens (plain DOM, own <style>, appended to #game):
     stage intro / stage clear card · pause menu · chip collection ·
     victory · CONTINUE button injected into the title overlay.
   Menus are keyboard-first (↑/↓ or W/S, Enter/J/Space, Esc) and clickable.
   The chip screen PAUSES the game (Tab / C): reading descriptions mid-fight
   should never cost HP; chips themselves are switched with Q / 1 / 2.
   ===================================================================== */
const CSS = `
.ns-scr{position:absolute;inset:0;z-index:30;display:none;align-items:center;justify-content:center;background:#02040ccc;backdrop-filter:blur(2px);font-family:inherit;color:#d6e4ff}
.ns-scr.on{display:flex}
.ns-panel{min-width:min(420px,90vw);max-width:min(860px,94vw);max-height:88vh;overflow:auto;padding:22px 26px;background:#070c1ef0;border:1px solid #2fe6ff66;box-shadow:0 0 30px #2fe6ff22,inset 0 0 40px #0008}
.ns-h{font-weight:900;letter-spacing:6px;font-size:22px;color:#2fe6ff;text-shadow:0 0 14px #2fe6ff88;margin:0 0 14px}
.ns-sub{font-size:12px;letter-spacing:2px;color:#8ea3c4;margin:-8px 0 14px}
.ns-btn{display:block;width:100%;margin:6px 0;padding:10px 14px;background:#0b1430;border:1px solid #2a3f63;color:#d6e4ff;font:inherit;font-weight:800;letter-spacing:3px;font-size:14px;text-align:left;cursor:pointer}
.ns-btn.sel,.ns-btn:hover{border-color:#2fe6ff;color:#fff;background:#0f2148;box-shadow:0 0 12px #2fe6ff44}
.ns-btn.sel::before{content:'▶ ';color:#2fe6ff}
.ns-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px}
.ns-chip{border:1px solid #2a3f63;background:#0a1228;padding:10px;min-height:150px}
.ns-chip.got{border-color:var(--c);box-shadow:inset 0 0 18px #0006,0 0 10px color-mix(in srgb,var(--c) 35%,transparent)}
.ns-chip .top{display:flex;gap:10px;align-items:center}
.ns-chip img{width:40px;height:40px;image-rendering:pixelated}
.ns-chip.lock img{filter:grayscale(1) brightness(.25)}
.ns-chip .nm{font-weight:900;letter-spacing:3px;color:var(--c)}
.ns-chip.lock .nm{color:#5b6a8a}
.ns-chip .sl{font-size:11px;letter-spacing:2px;color:#8ea3c4}
.ns-chip .ds{font-size:12px;line-height:1.45;margin-top:8px;color:#c0cde6}
.ns-chip .ky{font-size:11px;margin-top:6px;color:#ffe06b;letter-spacing:1px}
.ns-card{position:absolute;z-index:25;left:50%;top:34%;transform:translate(-50%,0);text-align:center;pointer-events:none;opacity:0;transition:opacity .35s}
.ns-card.on{opacity:1}
.ns-card .k{font-size:13px;letter-spacing:6px;color:#8ea3c4}
.ns-card .t{font-size:34px;font-weight:900;letter-spacing:8px;color:#fff;text-shadow:0 0 18px var(--c,#2fe6ff),3px 3px 0 #000}
.ns-card .s{margin-top:6px;font-size:13px;letter-spacing:3px;color:var(--c,#2fe6ff);text-shadow:0 0 8px #000,1px 1px 0 #000}
.ns-stats{display:grid;grid-template-columns:auto auto;gap:6px 22px;font-size:15px;letter-spacing:2px;margin:6px 0 16px}
.ns-stats b{color:#ffe06b;text-align:right}
.ns-hintline{font-size:11px;color:#6f80a6;letter-spacing:2px;margin-top:10px}
`;
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
const fmtTime = t => { t = Math.max(0, Math.floor(t)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };

export const Screens = {
  root: null, menu: null, chips: null, victory: null, card: null, cardLeft: 0, open: null, items: [], sel: 0, game: null,

  init(game, Game) {
    this.root = game; this.game = Game;
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    this.menu = el('div', 'ns-scr'); this.menu.id = 'ns-pause';
    this.chips = el('div', 'ns-scr'); this.chips.id = 'ns-chips';
    this.victory = el('div', 'ns-scr'); this.victory.id = 'ns-victory';
    this.card = el('div', 'ns-card'); this.card.id = 'ns-card';
    for (const e of [this.menu, this.chips, this.victory, this.card]) game.appendChild(e);
    for (const s of [this.menu, this.chips, this.victory]) s.addEventListener('pointerdown', e => e.stopPropagation());
  },

  /* ---------------------------------------------------------------- cards (non-blocking) */
  showCard(kicker, title, sub, color = '#2fe6ff', dur = 2.6) {
    const c = this.card; c.style.setProperty('--c', color);
    c.innerHTML = `<div class="k">${kicker}</div><div class="t">${title}</div>${sub ? `<div class="s">${sub}</div>` : ''}`;
    c.classList.add('on'); this.cardLeft = dur;
  },
  /** called every rendered frame with real dt (the card follows game time, so NS.step drives it too) */
  hideCard() { this.cardLeft = 0; this.card.classList.remove('on'); },
  tick(dt) { if (this.cardLeft > 0) { this.cardLeft -= dt; if (this.cardLeft <= 0) this.card.classList.remove('on'); } },
  stageIntro(st, i) { this.showCard(`STAGE ${i + 1} / 3`, st.name, st.intro || '', st.theme === 'complex' ? '#a58bff' : st.theme === 'core' ? '#ff4fc0' : '#2fe6ff'); },
  stageClear(st, i, s) { this.showCard('STAGE CLEAR', st.name, `TIME ${fmtTime(s.stageTime)} · KILLS ${s.kills} · DEATHS ${s.deaths}`, '#ffe06b', 1.6); },

  /* ---------------------------------------------------------------- generic menu plumbing */
  setItems(panel, items) {
    this.items = items; this.sel = 0;
    const box = panel.querySelector('.ns-items'); box.innerHTML = '';
    items.forEach((it, k) => {
      const b = el('button', 'ns-btn'); b.textContent = typeof it.label === 'function' ? it.label() : it.label; b.dataset.id = it.id;
      b.addEventListener('click', () => { this.sel = k; this.activate(); });
      b.addEventListener('pointerenter', () => { this.sel = k; this.paintSel(); });
      box.appendChild(b); it.btn = b;
    });
    this.paintSel();
  },
  paintSel() { this.items.forEach((it, k) => { it.btn.classList.toggle('sel', k === this.sel); if (typeof it.label === 'function') it.btn.textContent = it.label(); }); },
  activate() { const it = this.items[this.sel]; if (it) { SFX.play('swap'); it.run(); if (this.open) this.paintSel(); } },
  hideAll() { for (const s of [this.menu, this.chips, this.victory]) s.classList.remove('on'); this.open = null; this.items = []; },
  isOpen() { return !!this.open; },

  /** keyboard routing while a screen is open; returns true if the key was consumed */
  onKey(k) {
    if (!this.open) return false;
    if (this.open === 'chips') { if (k === 'Tab' || k === 'KeyC' || k === 'Escape' || k === 'KeyP' || k === 'Enter') { this.game.toggleChips(); } return true; }
    if (k === 'ArrowUp' || k === 'KeyW') { this.sel = (this.sel + this.items.length - 1) % this.items.length; this.paintSel(); return true; }
    if (k === 'ArrowDown' || k === 'KeyS') { this.sel = (this.sel + 1) % this.items.length; this.paintSel(); return true; }
    if (k === 'Enter' || k === 'Space' || k === 'KeyJ') { this.activate(); return true; }
    if ((k === 'Escape' || k === 'KeyP') && this.open === 'pause') { this.game.togglePause(); return true; }
    return true;                                                       // menus swallow everything else
  },

  /* ---------------------------------------------------------------- pause menu */
  showPause(on) {
    if (!on) { this.menu.classList.remove('on'); if (this.open === 'pause') { this.open = null; this.items = []; } return; }
    const G = this.game;
    this.menu.innerHTML = `<div class="ns-panel"><div class="ns-h">PAUSED</div><div class="ns-sub">${G.stageName()} · DEATHS ${G.deaths}</div><div class="ns-items"></div><div class="ns-hintline">↑ ↓ SELECT · ENTER CONFIRM · ESC RESUME · TAB CHIPS</div></div>`;
    this.menu.classList.add('on'); this.open = 'pause';
    this.setItems(this.menu, [
      { id: 'resume', label: 'RESUME', run: () => G.togglePause() },
      { id: 'restart', label: 'RESTART STAGE', run: () => G.restartStage() },
      { id: 'chips', label: 'CHIP COLLECTION', run: () => G.toggleChips() },
      { id: 'music', label: () => `MUSIC: ${SFX.musicOn ? 'ON' : 'OFF'}`, run: () => SFX.toggleMusic() },
      { id: 'sfx', label: () => `SOUND: ${SFX.muted ? 'OFF' : 'ON'}`, run: () => SFX.toggleMute() },
      { id: 'quit', label: 'QUIT TO TITLE', run: () => G.quitToTitle() },
    ]);
  },

  /* ---------------------------------------------------------------- chip collection (any number of chips: responsive grid) */
  showChips(on) {
    if (!on) { this.chips.classList.remove('on'); if (this.open === 'chips') this.open = null; return; }
    const got = player.unlocked, slots = SLOT_ORDER.map(s => SLOTS[s]);
    const cards = CHIP_ORDER.map(id => {
      const c = CHIPS[id], has = got.has(id), S = SLOTS[c.slot];
      const icon = makeChipIcon(id).toDataURL();
      const keys = c.slot === 'rarm' ? `[${S.key}] ${c.sub} · [Q] / [${CHIP_ORDER.indexOf(id) + 1}] EQUIP` : `[${S.key}] ${c.sub}`;
      return `<div class="ns-chip ${has ? 'got' : 'lock'}" style="--c:${c.color.m}"><div class="top"><img alt="" src="${icon}"><div><div class="nm">${has ? c.name : '???'}</div><div class="sl">${S.label}${has && player.chip === id ? ' · EQUIPPED' : ''}</div></div></div>
        <div class="ds">${has ? c.desc : 'Locked. Find this chip in the city to rewrite your ' + S.label + '.'}</div>${has ? `<div class="ky">${keys}</div>` : ''}</div>`;
    }).join('');
    const coreCard = `<div class="ns-chip lock" style="--c:#5b6a8a"><div class="top"><div><div class="nm">CORE</div><div class="sl">SLOT RESERVED</div></div></div><div class="ds">Passive core chips plug in here in a future update.</div></div>`;
    this.chips.innerHTML = `<div class="ns-panel"><div class="ns-h">CHIP COLLECTION</div><div class="ns-sub">${got.size} / ${CHIP_ORDER.length} COLLECTED · SLOTS ${slots.map(s => s.label).join(' · ')} · GAME PAUSED</div><div class="ns-grid">${cards}${coreCard}</div><div class="ns-hintline">TAB / C / ESC CLOSE · CHIPS ARE PERMANENT — SWITCH ANY TIME WITH Q / 1 / 2</div></div>`;
    this.chips.classList.add('on'); this.open = 'chips';
  },

  /* ---------------------------------------------------------------- victory */
  showVictory(s) {
    const G = this.game;
    this.victory.innerHTML = `<div class="ns-panel"><div class="ns-h" style="color:#ffe06b;text-shadow:0 0 16px #ffe06b88">SYSTEM REWRITTEN</div>
      <div class="ns-sub">WARDEN // CORE SENTINEL DESTROYED · ALL 3 STAGES CLEAR</div>
      <div class="ns-stats"><span>TIME</span><b>${fmtTime(s.time)}</b><span>HOSTILES DOWN</span><b>${s.kills}</b><span>BEST HIT CHAIN</span><b>${s.bestCombo}</b>
      <span>CHIPS</span><b>${s.chips} / ${CHIP_ORDER.length}</b><span>DEATHS</span><b>${s.deaths}</b>${s.bestTime !== undefined ? `<span>BEST TIME</span><b>${fmtTime(s.bestTime)}</b>` : ''}</div>
      <div class="ns-items"></div></div>`;
    this.victory.classList.add('on'); this.open = 'victory';
    this.setItems(this.victory, [
      { id: 'again', label: 'PLAY AGAIN', run: () => { this.hideAll(); G.newRun(0); } },
      { id: 'title', label: 'TITLE SCREEN', run: () => G.quitToTitle() },
    ]);
  },

  /* ---------------------------------------------------------------- title: CONTINUE from the highest stage reached */
  refreshTitle() {
    const start = document.getElementById('start');
    if (!start) return;
    let b = document.getElementById('continue');
    if (!b) {
      b = el('button', 'btn'); b.id = 'continue'; b.style.marginLeft = '10px';
      b.addEventListener('click', () => this.game.newRun(Save.data.stage));
      start.insertAdjacentElement('afterend', b);
    }
    const s = Save.data.stage || 0;
    b.textContent = `▶ CONTINUE · STAGE ${s + 1}`;
    b.style.display = s > 0 ? '' : 'none';
  },
};
