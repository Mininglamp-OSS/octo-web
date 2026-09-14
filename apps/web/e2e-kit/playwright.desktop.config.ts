import { defineConfig } from "@playwright/test";
import path from "node:path";

const port = Number(process.env.E2E_DESKTOP_PORT ?? 3198);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  // DEV-only fixtures must not be discovered by the production-preview suite.
  testDir: "./desktop-tests",
  forbidOnly: Boolean(process.env.CI),
  outputDir: "./test-results/desktop",
  workers: 1,
  retries: 0,
  reporter: [
    ["list"],
    ["json", { outputFile: path.resolve(__dirname, "playwright-report", "desktop.json") }],
    ["junit", { outputFile: path.resolve(__dirname, "playwright-report", "desktop-junit.xml") }],
  ],
  timeout: 30_000,
  use: { baseURL, trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: {
    command: `pnpm exec vite --config e2e-kit/vite.desktop.config.ts --host 127.0.0.1 --port ${port} --strictPort`,
    cwd: path.resolve(__dirname, ".."),
    url: `${baseURL}/e2e-kit/fixtures/desktop-header.html`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { VITE_E2E_MOCK: "0", VITE_E2E_MOCK_IM: "0", VITE_API_URL: "http://127.0.0.1:9" },
  },
});
