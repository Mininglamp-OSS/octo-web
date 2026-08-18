import childProcess from "node:child_process";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";

const require = createRequire(import.meta.url);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(scriptDir, "..");
const viteEnv = loadEnv("production", appDir, "VITE_");
const apiURL = process.env.VITE_API_URL || viteEnv.VITE_API_URL;
const viteBin = path.join(path.dirname(require.resolve("vite/package.json")), "bin", "vite.js");

if (!apiURL) {
  console.error(
    "[build-electron-renderer] VITE_API_URL is required for Electron builds. " +
      "Set it to the deployment API origin, for example: VITE_API_URL=https://api.example.com",
  );
  process.exit(1);
}

const child = childProcess.spawn(process.execPath, [viteBin, "build"], {
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

  process.exit(code ?? 1);
});

child.on("error", error => {
  console.error(`[build-electron-renderer] failed to start vite: ${error.message}`);
  process.exit(1);
});
