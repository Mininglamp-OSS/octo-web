import { defineConfig, devices } from '@playwright/test'

// Standalone doc page (`/d/:docId`) clean cold-load e2e — octo-web #512 / XIN-294.
//
// Same shape as bind.config.ts: the root playwright.config.ts targets the shared
// im-test.deepminer.com.cn env, but this suite must exhaust the boundary status codes
// (200/401/403/404/409) and the anonymous / malformed-id branches, so it starts a local Vite
// dev server and mocks the backend with page.route(). That is the whole point of the tester's
// finding — the clean cold-load (a shared link opened in a fresh tab, NO in-app sid route) must
// stand on its own, and only a real browser hitting `/d/:docId` directly proves it.
export default defineConfig({
  testDir: '.',
  testMatch: /standalone-doc\.spec\.ts$/,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  reporter: process.env.CI ? 'github' : 'list',

  use: {
    baseURL: 'http://localhost:3000',
    headless: true,
    // The clean cold-load must never touch real network; page.route intercepts everything.
    serviceWorkers: 'block',
    trace: 'on-first-retry',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: {
    command: 'pnpm dev',
    cwd: '.',
    url: 'http://localhost:3000',
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
    stderr: 'pipe',
  },
})
