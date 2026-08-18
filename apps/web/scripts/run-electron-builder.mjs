import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(scriptDir, "..");
const shimDir = path.join(os.tmpdir(), "octo-electron-builder-corepack-pnpm");

fs.mkdirSync(shimDir, { recursive: true });

const posixShim = path.join(shimDir, "pnpm");
fs.writeFileSync(posixShim, '#!/usr/bin/env sh\nexec corepack pnpm "$@"\n', {
  mode: 0o755,
});

const windowsShim = path.join(shimDir, "pnpm.cmd");
fs.writeFileSync(windowsShim, "@echo off\r\ncorepack pnpm %*\r\n");

const electronBuilderBin = path.join(
  appDir,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "electron-builder.cmd" : "electron-builder",
);

const child = childProcess.spawn(electronBuilderBin, process.argv.slice(2), {
  cwd: appDir,
  env: {
    ...process.env,
    PATH: `${shimDir}${path.delimiter}${process.env.PATH || ""}`,
  },
  shell: process.platform === "win32",
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});

child.on("error", error => {
  console.error(`[run-electron-builder] failed to start electron-builder: ${error.message}`);
  process.exit(1);
});
