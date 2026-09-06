import childProcess from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { resolveClientFeatureBuildEnv } from "./client-feature-build-env.mjs";

const require = createRequire(import.meta.url);

function run(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = childProcess.spawn(command, args, options);
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`build terminated by signal ${signal}`));
        return;
      }
      if (code !== 0) {
        reject(new Error(`build exited with code ${code ?? 1}`));
        return;
      }
      resolve();
    });
  });
}

export async function buildClientFeature({
  scriptUrl,
  featureId,
  artifactName,
  configFile,
  sourceEntry,
  outputDirectory,
  contractRevision = 1,
  includeImMock = false,
}) {
  const scriptDir = path.dirname(fileURLToPath(scriptUrl));
  const appDir = path.resolve(scriptDir, "..");
  const outputDir = path.join(appDir, outputDirectory);
  const viteEnv = loadEnv("production", appDir, "VITE_");
  const buildEnv = resolveClientFeatureBuildEnv(process.env, viteEnv);
  if (!buildEnv.apiURL) {
    throw new Error(`[build-${featureId}] VITE_API_URL is required`);
  }

  const statusResult = childProcess.spawnSync(
    "git",
    ["status", "--porcelain", "--untracked-files=normal"],
    { cwd: appDir, encoding: "utf8" }
  );
  if (statusResult.error || statusResult.status !== 0) {
    throw new Error(
      `[build-${featureId}] failed to inspect git worktree: ${
        statusResult.error?.message ||
        statusResult.stderr?.trim() ||
        `exit ${statusResult.status}`
      }`
    );
  }
  const sourceDirty = Boolean(statusResult.stdout?.trim());
  if (sourceDirty && process.env.OCTO_ALLOW_DIRTY_CLIENT_ARTIFACT !== "1") {
    throw new Error(
      `[build-${featureId}] refusing to build from a dirty worktree; commit the source or set OCTO_ALLOW_DIRTY_CLIENT_ARTIFACT=1 for local E2E only`
    );
  }

  const viteBin = path.join(
    path.dirname(require.resolve("vite/package.json")),
    "bin",
    "vite.js"
  );
  await run(process.execPath, [viteBin, "build", "--config", configFile], {
    cwd: appDir,
    env: {
      ...process.env,
      VITE_ELECTRON_BUILD: "true",
      ...buildEnv.viteEnv,
    },
    stdio: "inherit",
  });

  const generatedEntry = path.join(outputDir, sourceEntry);
  const entry = path.join(outputDir, "index.html");
  if (!fs.existsSync(generatedEntry)) {
    throw new Error(`[build-${featureId}] missing generated HTML entry`);
  }
  fs.renameSync(generatedEntry, entry);

  if (!buildEnv.e2eMock) {
    fs.rmSync(path.join(outputDir, "mockServiceWorker.js"), { force: true });
  }

  const packageJson = JSON.parse(
    fs.readFileSync(path.join(appDir, "package.json"), "utf8")
  );
  const gitResult = childProcess.spawnSync(
    "git",
    ["rev-parse", "--short", "HEAD"],
    { cwd: appDir, encoding: "utf8" }
  );
  if (gitResult.error || gitResult.status !== 0 || !gitResult.stdout?.trim()) {
    throw new Error(
      `[build-${featureId}] failed to resolve git commit: ${
        gitResult.error?.message ||
        gitResult.stderr?.trim() ||
        `exit ${gitResult.status}`
      }`
    );
  }

  const manifest = {
    schemaVersion: 1,
    name: artifactName,
    featureId,
    version: packageJson.version,
    commit: gitResult.stdout.trim(),
    entry: "index.html",
    hostBridgeMajor: 1,
    contractRevision,
    sourceDirty,
    e2eMock: buildEnv.e2eMock || (includeImMock && buildEnv.e2eMockIm),
    mockFlags: {
      api: buildEnv.viteEnv.VITE_E2E_MOCK,
      im: includeImMock ? buildEnv.viteEnv.VITE_E2E_MOCK_IM : "0",
    },
  };
  fs.writeFileSync(
    path.join(outputDir, "renderer-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`
  );
}
