import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadConfigFromFile, mergeConfig } from "vite";
import postcssImport from "postcss-import";
import { parityFixture } from "../../tests/personal-summary-parity/server.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export default defineConfig(async (environment) => {
    const base = await loadConfigFromFile(environment, path.join(repo, "apps/web/vite.config.ts"));
    if (!base) throw new Error("Web configuration unavailable");
    return mergeConfig(base.config, {
        root: path.join(repo, "tests/personal-summary-parity"),
        plugins: [parityFixture()],
        resolve: { dedupe: ["react", "react-dom"], alias: {
            "@octo/base": path.join(repo, "packages/dmworkbase"),
            react: path.join(repo, "apps/web/node_modules/react"),
            "react-dom": path.join(repo, "apps/web/node_modules/react-dom"),
            wukongimjssdk: path.join(repo, "apps/web/node_modules/wukongimjssdk"),
        } },
        css: { postcss: { plugins: [postcssImport()] } },
        server: { host: "127.0.0.1", port: 28400, strictPort: true, proxy: {} },
        define: { "process.env.PUBLIC_URL": '""' },
        build: { outDir: path.join(repo, "apps/web/build-personal-parity") },
    });
});
