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
 * So the shim directory must stay ASCII-only on Windows. Prefer a directory
 * inside the repo (next to the workspace, which we do not control, but the
 * repo path itself is overwhelmingly ASCII in practice); fall back to the
 * drive root, and only use os.tmpdir() when it is already ASCII-safe.
 */
function createShimDir() {
  const candidates = [
    path.join(appDir, "node_modules", ".cache", "octo-electron-builder-shim"),
    process.platform === "win32" ? path.join(path.parse(appDir).root, "octo-eb-shim") : null,
    os.tmpdir(),
  ].filter(Boolean);

  for (const [index, candidate] of candidates.entries()) {
    const isAscii = /^[\x00-\x7F]*$/.test(candidate);
    const usable = index === candidates.length - 1 ? true : isAscii;
    if (!usable) continue;
    try {
      fs.mkdirSync(candidate, { recursive: true });
      fs.rmSync(candidate, { recursive: true, force: true });
      fs.mkdirSync(candidate, { recursive: true });
      return candidate;
    } catch {
      // Not writable / not creatable — try the next candidate.
    }
  }
  throw new Error("[run-electron-builder] unable to create an ASCII-safe shim directory");
}

const shimDir = createShimDir();
if (process.platform !== "win32") {
  fs.chmodSync(shimDir, 0o700);
}

function cleanup() {
  fs.rmSync(shimDir, { recursive: true, force: true });
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
const asciiSafeTmp = process.platform === "win32" ? path.join(path.parse(shimDir).root, "octo-eb-tmp") : null;
if (asciiSafeTmp) {
  const hasNonAsciiTmp = [process.env.TMPDIR, process.env.TMP, process.env.TEMP]
    .some((value) => typeof value === "string" && /[^\x00-\x7F]/.test(value));
  if (hasNonAsciiTmp) {
    fs.mkdirSync(asciiSafeTmp, { recursive: true });
    childEnv.TMPDIR = asciiSafeTmp;
    childEnv.TMP = asciiSafeTmp;
    childEnv.TEMP = asciiSafeTmp;
  }
}

const electronBuilderBin = require.resolve("electron-builder/out/cli/cli.js");

const child = childProcess.spawn(process.execPath, [electronBuilderBin, ...process.argv.slice(2)], {
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
