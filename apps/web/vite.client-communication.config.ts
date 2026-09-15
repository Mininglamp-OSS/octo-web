import { resolve } from "node:path";
import { defineConfig, mergeConfig } from "vite";
import baseConfig from "./vite.config";

export default defineConfig(async (environment) => {
  const shared = typeof baseConfig === "function"
    ? await baseConfig(environment)
    : await baseConfig;

  return mergeConfig(shared, {
    base: "./",
    build: {
      outDir: "build-client-communication",
      emptyOutDir: true,
      rollupOptions: {
        input: {
          communication: resolve(__dirname, "client-communication.html"),
          forwardSurface: resolve(__dirname, "client-forward-surface.html"),
        },
      },
    },
  });
});
