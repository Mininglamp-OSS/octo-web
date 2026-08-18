import fs from "node:fs";
import path from "node:path";

const requiredRuntimeDeps = [
  "electron-log",
  "electron-screenshots",
  "electron-updater",
  "ms",
  "tmp",
  "wukongimjssdk",
];

const distDir = path.resolve("dist-ele");

function readAsarHeader(asarPath) {
  const buffer = fs.readFileSync(asarPath);
  const headerSize = buffer.readUInt32LE(12);
  return JSON.parse(buffer.subarray(16, 16 + headerSize).toString("utf8"));
}

function collectAsarFiles(dir, result = []) {
  if (!fs.existsSync(dir)) {
    return result;
  }

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectAsarFiles(entryPath, result);
    } else if (entry.isFile() && entry.name === "app.asar") {
      result.push(entryPath);
    }
  }

  return result;
}

const asarFiles = collectAsarFiles(distDir);

if (asarFiles.length === 0) {
  console.error(`[verify-electron-runtime-deps] No app.asar found under ${distDir}`);
  process.exit(1);
}

let hasFailure = false;

for (const asarPath of asarFiles) {
  const header = readAsarHeader(asarPath);
  const nodeModules = header.files?.node_modules?.files || {};
  const missing = requiredRuntimeDeps.filter((dep) => !nodeModules[dep]);

  if (missing.length > 0) {
    hasFailure = true;
    console.error(
      `[verify-electron-runtime-deps] ${path.relative(process.cwd(), asarPath)} is missing runtime deps: ${missing.join(", ")}`,
    );
  } else {
    console.log(
      `[verify-electron-runtime-deps] ${path.relative(process.cwd(), asarPath)} contains required runtime deps.`,
    );
  }
}

if (hasFailure) {
  process.exit(1);
}
