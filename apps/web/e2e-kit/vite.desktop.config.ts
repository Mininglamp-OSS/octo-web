import { defineConfig } from "vite";
import webConfig from "../vite.config";

export default defineConfig(env => {
  const config = webConfig(env);
  return {
    ...config,
    cacheDir: "node_modules/.vite-desktop",
    optimizeDeps: {
      ...config.optimizeDeps,
      entries: ["e2e-kit/fixtures/desktop-header.tsx"],
    },
    server: {
      ...config.server,
      warmup: { clientFiles: ["./e2e-kit/fixtures/desktop-header.tsx"] },
    },
  };
});
