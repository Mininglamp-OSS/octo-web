import childProcess from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";

const require = createRequire(import.meta.url);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(scriptDir, "..");
const outputDir = path.join(appDir, "build-client-communication");
const viteEnv = loadEnv("production", appDir, "VITE_");
const apiURL = process.env.VITE_API_URL || viteEnv.VITE_API_URL;
const viteBin = path.join(path.dirname(require.resolve("vite/package.json")), "bin", "vite.js");

if (!apiURL) {
  console.error("[build-client-communication] VITE_API_URL is required");
  process.exit(1);
}

const child = childProcess.spawn(process.execPath, [
  viteBin,
  "build",
  "--config",
  "vite.client-communication.config.ts",
], {
  cwd: appDir,
  env: {
    ...process.env,
    VITE_ELECTRON_BUILD: "true",
    VITE_API_URL: apiURL,
  },
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  if (code !== 0) {
    process.exit(code ?? 1);
    return;
  }

  const sourceEntry = path.join(outputDir, "client-communication.html");
  const entry = path.join(outputDir, "index.html");
  if (!fs.existsSync(sourceEntry)) {
    console.error("[build-client-communication] missing generated HTML entry");
    process.exit(1);
    return;
  }
  fs.renameSync(sourceEntry, entry);

  if (process.env.VITE_E2E_MOCK !== "1") {
    fs.rmSync(path.join(outputDir, "mockServiceWorker.js"), { force: true });
  }

  const packageJson = JSON.parse(fs.readFileSync(path.join(appDir, "package.json"), "utf8"));
  const commit = childProcess.spawnSync("git", ["rev-parse", "--short", "HEAD"], {
    cwd: appDir,
    encoding: "utf8",
  }).stdout.trim();
  fs.writeFileSync(path.join(outputDir, "renderer-manifest.json"), `${JSON.stringify({
    schemaVersion: 1,
    name: "octo-web-client-communication",
    version: packageJson.version,
    commit,
    entry: "index.html",
    hostBridgeMajor: 1,
    e2eMock: process.env.VITE_E2E_MOCK === "1",
  }, null, 2)}\n`);

  process.exit(0);
});

child.on("error", (error) => {
  console.error(`[build-client-communication] failed: ${error.message}`);
  process.exit(1);
});
