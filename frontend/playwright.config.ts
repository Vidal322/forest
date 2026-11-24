import { defineConfig, devices } from '@playwright/test'

// End-to-end tests against a running app (the API serving the built frontend). Run them with
// `.claude/loop/e2e.sh` from a checkout: it starts a fresh preview, sets E2E_URL and stops it afterwards.
// Uses the system Chrome (no browser download) emulating a phone, like someone in the field.
export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.e2e.ts',
  outputDir: 'e2e-results/artifacts',
  fullyParallel: false,
  workers: 1, // one shared database per preview
  reporter: [['line']],
  timeout: 30_000,
  use: {
    ...devices['Pixel 7'],
    baseURL: process.env.E2E_URL ?? 'http://127.0.0.1:8100',
    channel: 'chrome',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
})
