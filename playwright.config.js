// NEON//SHIFT Playwright regression harness (QA / Agent C).
// Uses an installed browser via `channel` — no browser download.
//   npm test                                   → Vite dev server on :5173 (started automatically)
//   NS_URL=http://localhost:8123 npx playwright test   → any already-running build (legacy python server, preview, …)
//   NS_CHANNEL=chrome npx playwright test      → fall back to Chrome if Edge is unavailable
import { defineConfig } from '@playwright/test';

const external = !!process.env.NS_URL;
const baseURL = process.env.NS_URL || 'http://localhost:5173';

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  retries: 0,                       // no retries: flakiness must be visible, not hidden
  reporter: [['list'], ['json', { outputFile: 'test-results/results.json' }]],
  use: {
    baseURL,
    channel: process.env.NS_CHANNEL || 'msedge',
    headless: !process.env.HEADED,
    viewport: { width: 1280, height: 720 },
    // trace/screenshot capture on failure hung the worker for the full timeout on this machine
    // (Edge GPU process crash during capture); opt in with NS_TRACE=1.
    trace: process.env.NS_TRACE ? 'retain-on-failure' : 'off',
    screenshot: process.env.NS_TRACE ? 'only-on-failure' : 'off',
  },
  webServer: external ? undefined : {
    command: 'npx vite --port 5173 --strictPort',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
