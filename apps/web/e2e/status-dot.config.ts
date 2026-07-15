import { defineConfig, devices } from '@playwright/test'

// Agent status-dot visual e2e — octo-web #808.
// The fix is CSS-driven (`.loop-status-dot[data-status]` in dmloop/loop.css). This suite injects
// the REAL loop.css into a blank page and asserts computed styles per status in a real browser —
// no dev server / backend / auth needed, and it can't drift from the source because it reads the
// actual CSS file. It guards the exact bug: an online-idle dot must not render like an offline one.
export default defineConfig({
  testDir: '.',
  testMatch: /status-dot\.spec\.ts$/,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  reporter: process.env.CI ? 'github' : 'list',
  use: { headless: true, serviceWorkers: 'block' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
