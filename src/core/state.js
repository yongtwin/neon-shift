/* Shared mutable state. ES-module imports are read-only bindings, so anything that used to be a
   reassigned classic-script global lives here and is mutated in place (arrays) or via S.<field>. */
export const S = { gameEl: null, screenEl: null, screenCtx: null, heroCtx: null };   // DOM / canvas handles (set in boot)
export const bullets = [];          // player (and reflected) projectiles
export const enemyBullets = [];
export const enemies = [];
