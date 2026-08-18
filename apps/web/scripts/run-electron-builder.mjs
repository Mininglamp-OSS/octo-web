import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(scriptDir, "..");
const shimDir = fs.mkdtempSync(path.join(os.tmpdir(), "octo-eb-"));
fs.chmodSync(shimDir, 0o700);

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

const electronBuilderBin = require.resolve("electron-builder/out/cli/cli.js");

const child = childProcess.spawn(process.execPath, [electronBuilderBin, ...process.argv.slice(2)], {
  cwd: appDir,
  env: {
    ...process.env,
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
