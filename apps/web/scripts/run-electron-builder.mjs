import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(scriptDir, "..");

/**
 * electron-builder's node-module-collector writes the resolved pnpm path into
 * a UTF-8 encoded temporary .bat file, but cmd.exe reads .bat files with the
 * system ANSI code page (GBK on zh-CN). When the shim lives under a user
 * profile with non-ASCII characters (e.g. C:\Users\<中文名>\AppData\Local
 * \Temp), the path is mojibake by the time cmd.exe executes it and the build
 * fails with "系统找不到指定的路径" (path not found).
 *
 * So the shim directory must stay ASCII-only on Windows. We create a UNIQUE
 * leaf under an ASCII-safe parent via mkdtempSync (preserving the #1445
 * hardening: per-build uniqueness, 0700 perms, exclusive writes, cleanup on
 * exit/error). Parents are tried in order — repo-local cache, Windows drive
 * root — and are NEVER deleted: only the unique leaf we create is cleaned
 * up. The final fallback is the historical behaviour (mkdtempSync under
 * os.tmpdir()), so a non-ASCII temp dir on Windows degrades to the old
 * failure mode instead of deleting anything shared.
 */
function createShimDir() {
  const parents = [
    path.join(appDir, "node_modules", ".cache"),
    process.platform === "win32" ? path.parse(appDir).root : null,
  ].filter(Boolean);

  for (const parent of parents) {
    if (!/^[\x00-\x7F]*$/.test(parent)) continue;
    try {
      fs.mkdirSync(parent, { recursive: true });
      return fs.mkdtempSync(path.join(parent, "octo-eb-"));
    } catch {
      // Not writable / not creatable — try the next parent.
    }
  }

  // Historical behaviour (also the pre-#1445 location): a unique dir under
  // the OS temp dir. On a non-ASCII Windows temp this still fails, but the
  // failure is the same one this PR set out to fix — no shared data is
  // touched.
  return fs.mkdtempSync(path.join(os.tmpdir(), "octo-eb-"));
}

const shimDir = createShimDir();
// 0700 perms apply on POSIX only; win32 does not support chmod semantics
// and the shim is consumed by cmd.exe which does not need them.
if (process.platform !== "win32") {
  fs.chmodSync(shimDir, 0o700);
}

// Only ever delete the unique leaves WE created (never any shared parent):
// shimDir plus the optional asciiSafeTmp leaf.
const createdTempDirs = [shimDir];

function cleanup() {
  for (const dir of createdTempDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (error) {
      // force:true does not suppress EBUSY/EPERM/EACCES (e.g. a builder
      // child still holding a handle on Windows). A cleanup failure must
      // never turn a successful build into a non-zero exit — the leaves
      // are unique to this run and safe to leave for OS reclaim.
      console.warn(
        `[run-electron-builder] failed to remove temp dir ${dir}: ${error.message}`,
      );
    }
  }
}

const posixShim = path.join(shimDir, "pnpm");
fs.writeFileSync(posixShim, '#!/usr/bin/env sh\nexec corepack pnpm "$@"\n', {
  mode: 0o755,
  flag: "wx",
});

const windowsShim = path.join(shimDir, "pnpm.cmd");
fs.writeFileSync(windowsShim, "@echo off\r\ncorepack pnpm %*\r\n", {
  flag: "wx",
});

// Keep electron-builder's own temp files (including the .bat wrapper that
// invokes the shim above) on an ASCII-safe path too, for the same mojibake
// reason. Only override when the current TMPDIR/TMP/TEMP contains non-ASCII
// characters; otherwise leave the environment untouched.
const childEnv = { ...process.env };
if (process.platform === "win32") {
  const hasNonAsciiTmp = [process.env.TMPDIR, process.env.TMP, process.env.TEMP]
    .some((value) => typeof value === "string" && /[^\x00-\x7F]/.test(value));
  if (hasNonAsciiTmp) {
    // Reuse the shim's ASCII-safe parent (never the shim dir itself — that
    // is removed by cleanup() while the child may still be writing temp
    // files). mkdtempSync keeps it unique; cleanup() removes it on exit.
    const shimParent = path.dirname(shimDir);
    const asciiSafeTmp = fs.mkdtempSync(path.join(shimParent, "octo-eb-tmp-"));
    createdTempDirs.push(asciiSafeTmp);
    childEnv.TMPDIR = asciiSafeTmp;
    childEnv.TMP = asciiSafeTmp;
    childEnv.TEMP = asciiSafeTmp;
  }
}

const electronBuilderBin = require.resolve("electron-builder/out/cli/cli.js");
const builderArgs = process.argv.slice(2);
const hasPublishArg = builderArgs.some((arg) => arg === "--publish" || arg.startsWith("--publish=") || arg === "-p");
if (!hasPublishArg) {
  builderArgs.push("--publish", "never");
}

function hasPlatformFlag(longName, shortName) {
  return builderArgs.some((arg) => {
    if (arg === longName) return true;
    if (!arg.startsWith("-") || arg.startsWith("--")) return false;
    return arg.slice(1).includes(shortName);
  });
}

function readBuiltElectronConfig() {
  const configPath = path.join(appDir, "build", "electron-config.json");
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch {
    return undefined;
  }
}

function requireUpdaterVerifierConfig() {
  if (process.env.VITE_ELECTRON_ALLOW_UNSIGNED_UPDATER_TEST_BUILD === "true") {
    console.warn(
      "[run-electron-builder] Skipping desktop updater verifier identity checks for a local unsigned test build.",
    );
    return;
  }

  const builtConfig = readBuiltElectronConfig();
  const missing = [];
  if (hasPlatformFlag("--mac", "m") && !builtConfig?.electronUpdateSigningTeamId?.trim()) {
    missing.push("build/electron-config.json: electronUpdateSigningTeamId");
  }
  if (hasPlatformFlag("--win", "w") && !builtConfig?.electronUpdateWindowsPublisherName?.trim()) {
    missing.push("build/electron-config.json: electronUpdateWindowsPublisherName");
  }
  if (missing.length === 0) return;

  console.error(
    "[run-electron-builder] Refusing to package an Electron updater build without verifier identity configuration.\n" +
      `Missing: ${missing.join(", ")}\n` +
      "Run build:electron with the public verifier identity values for release packaging, or set " +
      "VITE_ELECTRON_ALLOW_UNSIGNED_UPDATER_TEST_BUILD=true only for local unsigned updater smoke tests.",
  );
  process.exit(1);
}

requireUpdaterVerifierConfig();

const child = childProcess.spawn(process.execPath, [electronBuilderBin, ...builderArgs], {
  cwd: appDir,
  env: {
    ...childEnv,
    PATH: `${shimDir}${path.delimiter}${process.env.PATH || ""}`,
  },
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  cleanup();
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});

child.on("error", error => {
  cleanup();
  console.error(`[run-electron-builder] failed to start electron-builder: ${error.message}`);
  process.exit(1);
});

// Clean up the unique leaves on interrupt too: without this, a Ctrl+C during
// the build leaks octo-eb-* dirs under the repo tree / drive root (where the
// OS never reclaims them, unlike os.tmpdir()).
const handleInterrupt = (signal) => {
  cleanup();
  process.exit(128 + (signal === "SIGINT" ? 2 : 15));
};
process.on("SIGINT", () => handleInterrupt("SIGINT"));
process.on("SIGTERM", () => handleInterrupt("SIGTERM"));
