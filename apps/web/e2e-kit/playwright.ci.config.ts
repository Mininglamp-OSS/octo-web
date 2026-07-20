/* eslint-disable no-undef -- e2e code runs in Node */
import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * kit-provided CI-only config. 差异 vs playwright.config.ts:
 *  - webServer.command 改成 preview / static-serve (build 产物, 冷启快)
 *  - reuseExistingServer: false (CI 每次都新)
 *  - PW_PREVIEW_PORT env: CI 各 job 用不同 port 隔离
 *  - 硬约束 TARGET=local: CI 只跑 mock 模式, 真后端走另一条 pipeline
 *
 * TODO(接入方) 填占位:
 *  - `<PROJECT_PREVIEW_COMMAND>` — 例 "pnpm preview:e2e" 或 "node ci/static-serve.mjs"
 *  - `<PROJECT_ROOT_REL>` — 相对 e2e/ 到项目根 (通常 "..")
 *
 * 前提: 先 `pnpm build:e2e` 产 dist-e2e/, tree-shake 掉 harness route gate.
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
    command: "<PROJECT_PREVIEW_COMMAND>",       // TODO
    cwd: path.resolve(__dirname, "<PROJECT_ROOT_REL>"),  // TODO
    url: `http://localhost:${PREVIEW_PORT}`,
    reuseExistingServer: false,
    // 静态 http 服务 (推荐): 冷启 ~200ms. `vite preview` / `vp preview` 在
    // 复杂 vite config (tailwind v4 / 多 plugin) 下冷启可能 > 60s 屡屡 timeout;
    // 若必须走 vite preview, 请把 timeout 加到 180_000 且监控 CI runner 内存.
    timeout: 30_000,
    stdout: "pipe",
    stderr: "pipe",
    env: { PW_PREVIEW_PORT: PREVIEW_PORT },
  },
});
