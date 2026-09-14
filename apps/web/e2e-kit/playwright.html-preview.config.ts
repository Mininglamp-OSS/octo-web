import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

// Source-tab fixture uses the actual shared Header + HtmlRenderer. New tabs load
// the normal Web /file-preview entry. All attachment/API responses are local.
export default defineConfig({
  testDir: "./tests/html-attachment",
  workers: 1,
  retries: 0,
  reporter: "list",
  use: { baseURL: "http://localhost:18765", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm exec vite --host 127.0.0.1 --port 18765 --strictPort",
    cwd: path.resolve(__dirname, ".."),
    url: "http://localhost:18765",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      VITE_API_URL: "http://127.0.0.1:9",
      VITE_E2E_MOCK: "0",
      VITE_E2E_MOCK_IM: "0",
    },
  },
});
