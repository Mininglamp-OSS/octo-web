import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadConfigFromFile, mergeConfig } from "vite";
import postcssImport from "postcss-import";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// Test-only host for the production entry/Service/bridge/feature components.
// Never included in the normal Web build or a production route.
export default defineConfig(async (environment) => {
  const base = await loadConfigFromFile(environment, path.join(repo, "apps/web/vite.config.ts"));
  if (!base) throw new Error("Web build configuration is required for the execution fixture");
  return mergeConfig(base.config, {
  root: path.join(repo, "tests/content-execution-mirror"),
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: {
      "@octo/base": path.join(repo, "packages/dmworkbase"),
      react: path.join(repo, "apps/web/node_modules/react"),
      "react-dom": path.join(repo, "apps/web/node_modules/react-dom"),
    },
  },
  css: { postcss: { plugins: [postcssImport()] } },
  define: { "process.env.NODE_ENV": JSON.stringify("production"), "process.env.PUBLIC_URL": '""' },
  build: { outDir: path.join(repo, "apps/web/build-formal-mirror"), emptyOutDir: true },
  });
});
