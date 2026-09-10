import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadConfigFromFile, mergeConfig } from "vite";
import postcssImport from "postcss-import";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// Test-only host for the production entry/Service/bridge/feature components.
// Never included in the normal Web build or a production route.
export default defineConfig(async (environment) => {
  const base = await loadConfigFromFile(environment, path.join(repo, "apps/web/vite.config.ts"));
  if (!base) throw new Error("Web build configuration is required for the continue-optimize fixture");
  return mergeConfig(base.config, {
  root: path.join(repo, "tests/unified-summary-mirror"),
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: {
      "@octo/base": path.join(repo, "packages/dmworkbase"),
      // The fixture root sits outside any workspace package, so bare specifiers the
      // real entry gets for free (the IM SDK is a dependency of apps/web and of both
      // summary packages, but is not hoisted to the repo root) have to be pointed at
      // a concrete install here.
      wukongimjssdk: path.join(repo, "apps/web/node_modules/wukongimjssdk"),
      react: path.join(repo, "apps/web/node_modules/react"),
      "react-dom": path.join(repo, "apps/web/node_modules/react-dom"),
    },
  },
  css: { postcss: { plugins: [postcssImport()] } },
  define: { "process.env.NODE_ENV": JSON.stringify("production"), "process.env.PUBLIC_URL": '""' },
  build: { outDir: path.join(repo, "apps/web/build-unified-mirror"), emptyOutDir: true },
  });
});
