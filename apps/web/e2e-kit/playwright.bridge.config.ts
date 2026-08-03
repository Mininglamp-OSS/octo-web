/* eslint-disable no-undef -- e2e code runs in Node */
import { defineConfig, devices } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const HERE = __dirname;
const SPLIT_ROOT = path.resolve(HERE, "../../../..");
const MODULE_NAME = process.env.E2E_MODULE_NAME ?? "loop";
const MODULE_ROOT = process.env.E2E_MODULE_ROOT
  ? path.resolve(SPLIT_ROOT, process.env.E2E_MODULE_ROOT)
  : path.resolve(SPLIT_ROOT, `octo-${MODULE_NAME}-module`);
const WEB_ROOT = path.resolve(SPLIT_ROOT, "octo-web");
const PORT = process.env.E2E_PORT ?? "3001";
const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;
const REPORT_STAMP = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
const defaultTsEntry = path.resolve(MODULE_ROOT, `e2e/bridge/${MODULE_NAME}-only-entry.ts`);
const defaultTsxEntry = path.resolve(MODULE_ROOT, `e2e/bridge/${MODULE_NAME}-only-entry.tsx`);
const MODULE_ENTRY = process.env.E2E_MODULE_ENTRY
  ? path.resolve(SPLIT_ROOT, process.env.E2E_MODULE_ENTRY)
  : fs.existsSync(defaultTsEntry)
    ? defaultTsEntry
    : defaultTsxEntry;

export default defineConfig({
  testDir: process.env.E2E_TEST_DIR
    ? path.resolve(SPLIT_ROOT, process.env.E2E_TEST_DIR)
    : path.resolve(MODULE_ROOT, "e2e/tests"),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [
    ["list"],
    ["html", { outputFolder: path.resolve(HERE, `playwright-report-${MODULE_NAME}`, REPORT_STAMP), open: "never" }],
    ["json", { outputFile: path.resolve(HERE, "reports", `.${MODULE_NAME}-raw-results.json`) }],
  ],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    contextOptions: { reducedMotion: "reduce" },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], channel: "chromium" } }],
  webServer: {
    command: "npx -y pnpm@10.32.0 --filter @octo/web dev -- --host 0.0.0.0",
    cwd: SPLIT_ROOT,
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 180_000,
    env: {
      VITE_PORT: PORT,
      VITE_E2E_MOCK: "1",
      VITE_E2E_MOCK_IM: "1",
      VITE_DISABLE_BUILTIN_DOCS: process.env.VITE_DISABLE_BUILTIN_DOCS ?? "",
      VITE_ENTERPRISE_MODULES_ENTRY: MODULE_ENTRY,
      VITE_ENTERPRISE_FS_ALLOW: process.env.E2E_ENTERPRISE_FS_ALLOW ?? [
        MODULE_ROOT,
        WEB_ROOT,
        path.resolve(SPLIT_ROOT, "node_modules"),
      ].join(path.delimiter),
    },
  },
});
