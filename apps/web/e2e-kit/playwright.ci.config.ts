/* eslint-disable no-undef -- e2e code runs in Node */
import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

// 注: 用 __dirname (CJS) 而不是 import.meta.url. 本 repo root 无 "type": "module",
// playwright pirates transform 走 CJS 加载 config, import.meta 挂不上会报
// "exports is not defined in ES module scope". 跟 playwright.config.ts 保持一致.

/**
 * CI-only playwright config (adapted from e2e-kit v0.4). 差异 vs playwright.config.ts:
 *  - webServer.command: pnpm preview:e2e (build 产物, 冷启快)
 *  - reuseExistingServer: false (CI 每次都新)
 *  - PW_PREVIEW_PORT env: 各 job 用不同 port 隔离
 *  - 硬约束 TARGET=local: CI 只跑 mock 模式, 真后端走另一条 pipeline
 *
 * 前提: 先 `pnpm build:e2e` 产 build-e2e/, tree-shake 掉 MSW / mock IM.
 */
const PREVIEW_PORT = process.env.PW_PREVIEW_PORT ?? "5173";
const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${PREVIEW_PORT}`;

const REPORT_STAMP = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
const REPORT_DIR = path.resolve(__dirname, "playwright-report", REPORT_STAMP);

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [
    ["list"],
    ["html", { outputFolder: REPORT_DIR, open: "never" }],
    ["junit", { outputFile: path.resolve(__dirname, "playwright-report", "junit.xml") }],
    ["json", { outputFile: path.resolve(__dirname, "reports", ".raw-results.json") }],
  ],

  snapshotPathTemplate: "{testDir}/../screenshots/{projectName}/{testFilePath}/{arg}{ext}",

  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: 0.01, threshold: 0.2 },
    timeout: 10_000,
  },

  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    contextOptions: { reducedMotion: "reduce" },
  },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  webServer: {
    command: "pnpm preview:e2e",
    cwd: path.resolve(__dirname, ".."),
    url: `http://localhost:${PREVIEW_PORT}`,
    reuseExistingServer: false,
    // vite preview 冷启在此项目大约 3-10s; 若 CI runner 内存受限或 vite plugin 复杂化,
    // 可加 timeout 或改静态 http 服务. 当前 60s 留余量.
    timeout: 60_000,
    stdout: "pipe",
    stderr: "pipe",
    env: { PW_PREVIEW_PORT: PREVIEW_PORT },
  },
});
