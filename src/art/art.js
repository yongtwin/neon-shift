import { R, g, line, makeCanvas, px, withCtx } from './pixel.js';
import { drawNinja, ninjaAnchors, NINJA_PAL } from './ninja.js';
import { drawEnemyArt, ENEMY_PAL, ENEMY_HEIGHT } from './enemy-art.js';

/* =====================================================================
   Character art facade.

   The protagonist is drawn by src/art/ninja.js (cached, shaded pixel-art
   rasteriser) and the robots by src/art/enemy-art.js. This module keeps the
   historical API (drawPlayer / drawEnemy / poseOf / Q / palettes / chip
   icons) so gameplay + FX code can stay untouched. Both draw into the
   active pixel.js context `g`.
   ===================================================================== */
export const PAL = {
  ol: NINJA_PAL.ol,
  s0: NINJA_PAL.suit[0], s1: NINJA_PAL.suit[1], s2: NINJA_PAL.suit[2], s3: NINJA_PAL.armour[1],
  p0: NINJA_PAL.armour[0], p1: NINJA_PAL.armour[2], p2: NINJA_PAL.armour[3],
  mg0: NINJA_PAL.mg[0], mg1: NINJA_PAL.mg[1], mg2: NINJA_PAL.mg[2],
  wh: '#ffffff',
};
export const ACCENT = {           // one accent colour per chip: visor, core, arm glow
  blade:  { d: '#0e7f9c', m: '#2fe6ff', l: '#d6fdff', name: 'CYAN' },
  cannon: { d: '#b8700c', m: '#ffc43d', l: '#fff3b8', name: 'AMBER' },
  shield: { d: '#5a3fc0', m: '#a58bff', l: '#ece4ff', name: 'VIOLET' },
  blink:  { d: '#a3146f', m: '#ff4fc0', l: '#ffd0f0', name: 'PINK' },
};
export const EN = {               // enemy palette (FX debris / sparks use these keys)
  o: ENEMY_PAL.ol, g0: ENEMY_PAL.metal[0], g1: ENEMY_PAL.metal[1], g2: ENEMY_PAL.metal[2], g3: ENEMY_PAL.metal[3],
  r0: ENEMY_PAL.red[0], r1: ENEMY_PAL.red[1], r2: ENEMY_PAL.orange[1], am: ENEMY_PAL.hazard[1], am0: ENEMY_PAL.hazard[0], wh: '#ffffff',
};
export { ENEMY_HEIGHT };

/* legacy pose probe: shoulder / scarf-root in art px (x forward, y up from the feet) */
export const Q = { sx: 0, sy: 0, hx: 0, hy: 0 };
export function poseOf(p) {
  const a = ninjaAnchors(p);
  Q.sx = a.shoulder.x; Q.sy = a.shoulder.y; Q.hx = a.scarf.x + 4; Q.hy = a.scarf.y - 1;
  return Q;
}

/** the ninja; `ov` = {fill, alpha} draws a flat silhouette (after-images) */
export function drawPlayer(p, ox, oy, ov) { drawNinja(g, p, ox, oy, ov); }
/** robots: gunner | enforcer | warden | drone | turret */
export function drawEnemy(e, ox, oy, ov) { drawEnemyArt(g, e, ox, oy, ov); }

/* ------------------------------------------------------------------ chip icons (16x16, used by HUD + world pickups) */
export function makeChipIcon(id) {
  const [c, x] = makeCanvas(16, 16);
  const A = ACCENT[id];
  withCtx(x, () => {
    if (id === 'blade') {
      line(2, 14, 13, 3, 5, PAL.ol); line(2, 14, 13, 3, 3, A.m); line(3, 13, 13, 3, 1, A.l);
      line(2, 9, 7, 14, 3, PAL.ol); line(3, 9, 7, 13, 1, PAL.p2); line(1, 15, 3, 13, 3, PAL.p1);
    } else if (id === 'cannon') {
      R(1, 5, 9, 6, PAL.ol); R(2, 6, 7, 4, PAL.p1); R(2, 6, 7, 1, PAL.p2);
      R(10, 6, 5, 4, PAL.ol); R(10, 7, 5, 2, A.m); R(14, 7, 1, 2, A.l);
      R(4, 5, 1, 6, A.m); R(7, 5, 1, 6, A.m);
      R(2, 10, 4, 5, PAL.ol); R(3, 10, 2, 4, PAL.p0);
    } else if (id === 'shield') {
      const pts = [[8, 0], [14, 3], [14, 10], [8, 15], [2, 10], [2, 3]];
      for (let i = 0; i < 6; i++) { const a = pts[i], b = pts[(i + 1) % 6]; line(a[0], a[1], b[0], b[1], 3, PAL.ol); }
      for (let i = 0; i < 6; i++) { const a = pts[i], b = pts[(i + 1) % 6]; line(a[0], a[1], b[0], b[1], 1, A.m); }
      x.globalAlpha = 0.35; for (let yy = 3; yy < 12; yy++) R(4, yy, 8, 1, A.m); x.globalAlpha = 1;
      line(8, 4, 8, 11, 1, A.l); line(5, 6, 11, 6, 1, A.l);
    } else {
      const bolt = [[10, 0], [4, 9], [8, 9], [5, 15], [12, 6], [8, 6], [11, 0]];
      for (let i = 0; i < bolt.length - 1; i++) line(bolt[i][0], bolt[i][1], bolt[i + 1][0], bolt[i + 1][1], 3, PAL.ol);
      for (let i = 0; i < bolt.length - 1; i++) line(bolt[i][0], bolt[i][1], bolt[i + 1][0], bolt[i + 1][1], 1, A.m);
      px(10, 1, A.l); px(5, 14, A.l);
    }
  });
  return c;
}
