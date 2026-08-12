#!/usr/bin/env node
/**
 * run-bash-script.mjs — 跨平台执行仓库内的 bash 脚本
 *
 * 背景：package.json 里 `bash scripts/xxx.sh` 这类命令在 Windows 上不可靠：
 *   1. 启用了 WSL 的机器上，`bash` 会被解析到 C:\Windows\System32\bash.exe
 *      （WSL 启动器）。脚本随之进入 Linux 环境，node/pnpm 解析成 WSL 发行版
 *      里的版本（且与 Windows 侧工具链版本不一致），构建直接失败；
 *   2. 没装 WSL 也没把 Git Bash 加进 PATH 的机器上，`bash` 根本不存在。
 *
 * 本脚本在 Windows 上显式探测 Git for Windows 自带的 bash（避开 WSL），
 * 在 Linux/macOS 上直接使用系统 bash。用法（参数原样透传给 bash）：
 *
 *   node scripts/run-bash-script.mjs <script.sh> [args...]
 *
 * Windows 探测顺序：
 *   1. 环境变量 OCTO_BASH 显式指定的 bash 路径（兜底开关）
 *   2. PATH 中 git 所在 Git 安装目录下的 bin/bash.exe、usr/bin/bash.exe
 *   3. 常见安装位置（Program Files / LocalAppData 下的 Git）
 *   4. PATH 中的其他 bash.exe（排除 System32/SysWOW64/WindowsApps 下的 WSL 启动器）
 */

import { spawnSync, execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);

function fail(messages) {
  for (const line of messages) console.error(line);
  process.exit(1);
}

if (args.length === 0) {
  fail(["用法: node scripts/run-bash-script.mjs <script.sh> [args...]"]);
}

/** 判断某个 bash.exe 是否是 WSL/系统自带的启动器（不能用于跑本仓库脚本） */
function isWslOrSystemBash(bashPath) {
  const systemRoot = (process.env.SystemRoot || "C:\\Windows").toLowerCase();
  let real;
  try {
    real = realpathSync(bashPath).toLowerCase();
  } catch {
    real = path.resolve(bashPath).toLowerCase();
  }
  return real.startsWith(systemRoot) || real.includes("windowsapps");
}

/** 收集候选 bash 路径（按优先级排序） */
function collectWindowsBashCandidates() {
  const candidates = [];

  if (process.env.OCTO_BASH) {
    candidates.push(process.env.OCTO_BASH);
  }

  // 从 PATH 中的 git.exe 推导 Git 安装根目录（<root>/cmd/git.exe → <root>/bin/bash.exe）
  try {
    const whereOutput = execFileSync("where", ["git"], { encoding: "utf8" });
    const gitPath = whereOutput.split(/\r?\n/)[0]?.trim();
    if (gitPath && existsSync(gitPath)) {
      const gitRoot = path.resolve(path.dirname(gitPath), "..");
      candidates.push(
        path.join(gitRoot, "bin", "bash.exe"),
        path.join(gitRoot, "usr", "bin", "bash.exe")
      );
    }
  } catch {
    // PATH 里没有 git，继续看常见安装位置
  }

  const programFilesDirs = [
    process.env.ProgramFiles,
    process.env["ProgramFiles(x86)"],
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Programs"),
  ].filter(Boolean);
  for (const dir of programFilesDirs) {
    candidates.push(path.join(dir, "Git", "bin", "bash.exe"));
  }

  // PATH 里的其他 bash.exe（排除 WSL 启动器）
  for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, "bash.exe");
    if (existsSync(candidate) && !isWslOrSystemBash(candidate)) {
      candidates.push(candidate);
    }
  }

  return candidates;
}

function resolveWindowsBash() {
  for (const candidate of collectWindowsBashCandidates()) {
    if (existsSync(candidate) && !isWslOrSystemBash(candidate)) {
      return candidate;
    }
  }
  return null;
}

let bashCommand;
if (process.platform === "win32") {
  const bashPath = resolveWindowsBash();
  if (!bashPath) {
    fail([
      "[run-bash-script] 未找到可用于构建的 bash（已排除 WSL 的 System32\\bash.exe）。",
      "  请安装 Git for Windows（https://git-scm.com/download/win），",
      "  或通过环境变量 OCTO_BASH 显式指定 bash.exe 路径，例如：",
      "    set OCTO_BASH=C:\\Program Files\\Git\\bin\\bash.exe",
    ]);
  }
  bashCommand = bashPath;
  console.log(`[run-bash-script] using bash: ${bashCommand}`);
} else {
  bashCommand = "bash";
}

const result = spawnSync(bashCommand, args, {
  stdio: "inherit",
  cwd: process.cwd(),
  env: process.env,
});

if (result.error) {
  fail([`[run-bash-script] 启动 bash 失败: ${result.error.message}`]);
}
process.exit(result.status ?? 1);
