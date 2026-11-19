// Bundles index.html + css/ + js/ into ONE self-contained file: NEON_SHIFT_v04.html
// Usage:  node build.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
let html = readFileSync(join(root, 'index.html'), 'utf8');
html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, (_, href) => `<style>\n${readFileSync(join(root, href), 'utf8')}\n</style>`);
html = html.replace(/<script src="([^"]+)"><\/script>/g, (_, src) => `<script>\n/* ---- ${src} ---- */\n${readFileSync(join(root, src), 'utf8')}\n</script>`);
const out = join(root, 'NEON_SHIFT_v04.html');
writeFileSync(out, html);
console.log(`wrote ${out} (${(html.length / 1024).toFixed(0)} KB)`);
