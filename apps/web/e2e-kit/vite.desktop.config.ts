import { defineConfig } from "vite";
import webConfig from "../vite.config";

export default defineConfig(env => {
  const config = webConfig(env);
  return {
    ...config,
    cacheDir: "node_modules/.vite-desktop",
    optimizeDeps: {
      ...config.optimizeDeps,
      // Discover each fixture's imports before navigation can trigger a reload.
      entries: ["e2e-kit/fixtures/desktop-*.html"],
    },
    server: {
      ...config.server,
      warmup: {
        clientFiles: [
          "./e2e-kit/fixtures/desktop-header.tsx",
          "./e2e-kit/fixtures/desktop-summary-sidebar.tsx",
        ],
      },
    },
  };
});
