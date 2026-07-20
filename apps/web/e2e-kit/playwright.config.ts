/* eslint-disable no-undef -- e2e code runs in Node */
import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

// 注: 用 __dirname (CJS) 而不是 import.meta.url. 本 repo root 无 "type": "module",
// playwright pirates transform 走 CJS 加载 config, import.meta 挂不上会报
// "exports is not defined in ES module scope".
const HERE = __dirname;

/**
 * octo-web e2e-kit playwright config (本地 dev 用).
 * CI 用另一份 playwright.ci.config.ts (preview 模式, 冷启快).
 *
 * 两种模式 (E2E_TARGET):
 *  - `local` (默认): Lite mock 模式, spec 内 `page.route()` 拦 API
 *  - `test`: 真后端 storageState 模式, 由 global-setup 预登录
 *
 * 注: octo-web 目前没有 app 侧 mock harness (无 MSW, 无 VITE_E2E_MOCK 消费).
 * 所以 kit 的 Full 模式 (MSW) 暂不启用. 后续接入方需要时再加.
 */
const TARGET = process.env.E2E_TARGET ?? "local";
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

if (TARGET !== "local" && TARGET !== "test") {
  throw new Error(`E2E_TARGET 必须 local 或 test, 当前=${TARGET}`);
}

// HTML 报告每次跑一档不覆盖. 需要清理时手动 rm.
const REPORT_STAMP = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
const REPORT_DIR = path.resolve(HERE, "playwright-report", REPORT_STAMP);

// TARGET=test 用的 storageState (由接入方 global-setup.ts 生成)
const STORAGE_STATE = path.resolve(HERE, ".auth", "user.json");

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,                // handler state 隔离 (kit 硬约束)
  retries: 0,                // 稳定性铁律: 失败就失败, 不掩盖 flake (kit 硬约束)
  ...(TARGET === "test"
    ? { globalSetup: path.resolve(HERE, "global-setup.ts") }
    : {}),
  reporter: [
    ["list"],
    ["html", { outputFolder: REPORT_DIR, open: "never" }],
    ["json", { outputFile: path.resolve(HERE, "reports", ".raw-results.json") }],
  ],

  snapshotPathTemplate: "{testDir}/../screenshots/{projectName}/{testFilePath}/{arg}{ext}",

  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.01,
      threshold: 0.2,
    },
    timeout: 10_000,
  },

  use: {
    baseURL: BASE_URL,
    // retries=0 时 'on-first-retry' 永不生效; 用 'retain-on-failure' 让 fail 时留 trace.zip
    // 用 `npx playwright show-trace trace.zip` 打开可拖时间轴
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    contextOptions: { reducedMotion: "reduce" },
    ...(TARGET === "test" ? { storageState: STORAGE_STATE } : {}),
  },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  webServer: {
    // pnpm dev 会走 turbo 起 apps/web + 所有 packages 的 watch, vite 默认 :3000.
    command: "pnpm dev",
    cwd: path.resolve(HERE, "../../.."),
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 180_000,
    env: {
      // local 模式启动 MSW; test 模式走真后端不启动
      VITE_E2E_MOCK: TARGET === "local" ? "1" : "0",
    },
  },
});
