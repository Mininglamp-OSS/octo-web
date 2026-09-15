import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

// Source-tab fixture uses the actual shared Header + HtmlRenderer. New tabs load
// the normal Web /file-preview entry. All attachment/API responses are local.
export default defineConfig({
  // The fixture requires Vite's source transform and is not in build-e2e.
  // Keep it outside the production-preview suite's ./tests discovery root.
  testDir: "./standalone/html-attachment",
  forbidOnly: Boolean(process.env.CI),
  outputDir: "./test-results/html-preview",
  workers: 1,
  retries: 0,
  reporter: [
    ["list"],
    ["json", { outputFile: path.resolve(__dirname, "playwright-report", "html-preview.json") }],
  ],
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
