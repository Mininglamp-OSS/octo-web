import childProcess from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { resolveCommunicationBuildEnv } from "./client-communication-build-env.mjs";

const require = createRequire(import.meta.url);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(scriptDir, "..");
const outputDir = path.join(appDir, "build-client-communication");
const viteEnv = loadEnv("production", appDir, "VITE_");
const buildEnv = resolveCommunicationBuildEnv(process.env, viteEnv);
const apiURL = buildEnv.apiURL;
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
    ...buildEnv.viteEnv,
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

  if (!buildEnv.e2eMock) {
    fs.rmSync(path.join(outputDir, "mockServiceWorker.js"), { force: true });
  }

  const packageJson = JSON.parse(fs.readFileSync(path.join(appDir, "package.json"), "utf8"));
  const gitResult = childProcess.spawnSync("git", ["rev-parse", "--short", "HEAD"], {
    cwd: appDir,
    encoding: "utf8",
  });
  if (gitResult.error || gitResult.status !== 0 || !gitResult.stdout?.trim()) {
    console.error(
      `[build-client-communication] failed to resolve git commit: ${gitResult.error?.message || gitResult.stderr?.trim() || `exit ${gitResult.status}`}`,
    );
    process.exit(1);
    return;
  }
  const commit = gitResult.stdout.trim();
  fs.writeFileSync(path.join(outputDir, "renderer-manifest.json"), `${JSON.stringify({
    schemaVersion: 1,
    name: "octo-web-client-communication",
    version: packageJson.version,
    commit,
    entry: "index.html",
    hostBridgeMajor: 1,
    e2eMock: buildEnv.e2eMock || buildEnv.e2eMockIm,
    mockFlags: {
      api: buildEnv.viteEnv.VITE_E2E_MOCK,
      im: buildEnv.viteEnv.VITE_E2E_MOCK_IM,
    },
  }, null, 2)}\n`);

  process.exit(0);
});

child.on("error", (error) => {
  console.error(`[build-client-communication] failed: ${error.message}`);
  process.exit(1);
});
