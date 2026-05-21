import { defineConfig, devices } from '@playwright/test'

// bind 流程独立 Playwright 配置:
//  - 根 playwright.config.ts 跑的是 im-test.deepminer.com.cn 联调环境;
//    bind e2e 必须本地起 Vite + 用 page.route() mock 后端, 否则无法穷举
//    410/401/429/409 错误码分支.
//  - 只跑 Chromium 一种 browser; bind 是表单+路由, 跨浏览器差异极低,
//    引入 firefox/webkit 仅增加 CI 时间, 没有收益.
//  - 浏览器二进制由 PLAYWRIGHT_BROWSERS_PATH=0 锁到 node_modules, 不写
//    用户级 ~/Library/Caches/ms-playwright. 见 README / scripts.

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts$/,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  reporter: process.env.CI ? 'github' : 'list',

  use: {
    baseURL: 'http://localhost:3000',
    headless: true,
    // bind 流程靠 page.route 拦截后端, 不应触达真实网络; 兜底关掉外发.
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
