// Test launcher: `node tests/run.mjs [playwright args]`.
// Playwright 1.49's ESM loader hook (module.register) hangs forever on Node 26 when loading
// ESM test files / config ("type":"module"). PW_DISABLE_TS_ESM=1 makes Playwright import the
// plain-JS ESM files natively instead, which works. Remove once Playwright is upgraded.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const cli = require.resolve('@playwright/test/cli');
const child = spawn(process.execPath, [cli, 'test', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, PW_DISABLE_TS_ESM: '1' },
});
child.on('exit', code => process.exit(code ?? 1));
