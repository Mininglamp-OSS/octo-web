#!/usr/bin/env node

/**
 * Fast, read-only e2e environment check.
 * Usage: node apps/web/e2e-kit/_lib/preflight.mjs [--port=3000] [--check-env-file=apps/web/env.local]
 *        [--require-env=VITE_API_URL] [--check-url=http://localhost:3000]
 */
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.replace(/^--/, "").split("=");
  return [key, rest.join("=") || true];
}));

function findWorkspaceRoot(start) {
  let current = start;
  while (true) {
    if (
      existsSync(join(current, "package.json")) &&
      ["pnpm-lock.yaml", "yarn.lock", "package-lock.json"].some((name) => existsSync(join(current, name)))
    ) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) return start;
    current = parent;
  }
}

const workspaceRoot = findWorkspaceRoot(process.cwd());
const packageJsonPath = join(workspaceRoot, "package.json");
const packageJson = existsSync(packageJsonPath) ? JSON.parse(readFileSync(packageJsonPath, "utf8")) : {};

const requestedPort = Number(args.port || process.env.PORT || 3000);
const envFile = typeof args["check-env-file"] === "string" ? args["check-env-file"] : null;
const requiredEnv = typeof args["require-env"] === "string"
  ? args["require-env"].split(",").map((name) => name.trim()).filter(Boolean)
  : [];
const checkUrl = typeof args["check-url"] === "string" ? args["check-url"] : null;
const failures = [];

function check(condition, message) {
  if (condition) console.log(`✓ ${message}`);
  else { console.error(`✗ ${message}`); failures.push(message); }
}

function portAvailable(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
}

async function choosePort(start) {
  for (let offset = 0; offset <= 20; offset += 1) {
    for (const port of offset === 0 ? [start] : [start + offset, start - offset]) {
      if (port > 0 && port < 65536 && await portAvailable(port)) return port;
    }
  }
  return null;
}

check(existsSync(packageJsonPath), `工作区存在 package.json: ${workspaceRoot}`);
check(
  ["pnpm-lock.yaml", "yarn.lock", "package-lock.json"].some((name) => existsSync(join(workspaceRoot, name))),
  "找到包管理器 lockfile",
);

if (envFile) {
  const content = existsSync(envFile) ? readFileSync(envFile, "utf8") : "";
  check(Boolean(content), `env 文件存在: ${envFile}`);
  for (const name of requiredEnv) {
    const present = new RegExp(`^${name}\\s*=\\s*.+$`, "m").test(content);
    check(present, `${envFile} 包含 ${name}`);
  }
}

const selectedPort = await choosePort(requestedPort);
check(selectedPort !== null, `端口可用: ${selectedPort ?? requestedPort}`);
if (selectedPort !== null) console.log(`E2E_SELECTED_PORT=${selectedPort}`);

const packageManager = typeof packageJson.packageManager === "string"
  ? packageJson.packageManager.split("@")[0]
  : existsSync(join(workspaceRoot, "pnpm-lock.yaml"))
    ? "pnpm"
    : existsSync(join(workspaceRoot, "yarn.lock"))
      ? "yarn"
      : "npm";
const version = spawnSync(packageManager, ["--version"], { encoding: "utf8" });
check(version.status === 0, `${packageManager} 可执行`);

if (checkUrl) {
  try {
    const response = await fetch(checkUrl, { signal: AbortSignal.timeout(3000) });
    check(response.ok, `服务可访问: ${checkUrl} (${response.status})`);
  } catch (error) {
    check(false, `服务可访问: ${checkUrl} (${error.message})`);
  }
}

if (failures.length) {
  console.error(`\npreflight failed: ${failures.length} check(s)`);
  process.exit(1);
}
console.log("\npreflight passed");
