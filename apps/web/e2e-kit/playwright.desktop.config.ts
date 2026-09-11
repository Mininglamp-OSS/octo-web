import { defineConfig } from "@playwright/test";
import path from "node:path";

const port = Number(process.env.E2E_DESKTOP_PORT ?? 3198);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/desktop",
  outputDir: "./test-results/desktop",
  workers: 1,
  retries: 0,
  reporter: "list",
  timeout: 30_000,
  use: { baseURL, trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: {
    command: `pnpm exec vite --host 127.0.0.1 --port ${port} --strictPort`,
    cwd: path.resolve(__dirname, ".."),
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { VITE_E2E_MOCK: "0", VITE_E2E_MOCK_IM: "0" },
  },
});
