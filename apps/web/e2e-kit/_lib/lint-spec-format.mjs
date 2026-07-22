#!/usr/bin/env node
/**
 * _lib/lint-spec-format.mjs — spec 格式 lint (kit-provided).
 *
 * 校验 e2e/case-specs/**​/*.md 合规:
 *   - 必需段: Metadata / 目标 / 前置条件 / 用户操作步骤 / 预期结果 / 反例
 *     (视觉基准 / 摸清依据可选)
 *   - Metadata 段有 "Case 类型" / "目标模式" / "优先级"
 *   - 反例段非空 (>= 20 字符, 避免只写 "无" 应付)
 *   - 无残留 "**待补**" marker (scaffolder 骨架填完应删)
 *
 * **接入方需改的占位** (脚本顶部 config):
 *   - SPECS_DIR    — case-spec md 目录 (默认 "e2e/case-specs")
 *
 * 用法:
 *   node e2e/_lib/lint-spec-format.mjs                 # 全部 spec, 不合规 exit 1
 *   node e2e/_lib/lint-spec-format.mjs --files a.md b.md   # 指定文件 (pre-commit)
 *   node e2e/_lib/lint-spec-format.mjs --diff-mode     # 只校验 git 里新加/改的 spec
 *                                                     # (存量老格式豁免, 只挡漂移)
 *
 * 建议 package.json 加脚本:
 *   "check:spec-format": "node e2e/_lib/lint-spec-format.mjs"
 *   "check:spec-format:diff": "node e2e/_lib/lint-spec-format.mjs --diff-mode"
 *
 * CI: quality stage, MR 里 case-specs/ 有变更时触发 --diff-mode
 * pre-commit: .husky/pre-commit 里 staged 涉及 case-specs/ 时跑一次 --files
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { execSync } from "node:child_process";

// ---------- config (接入方按需改) ----------

const REPO_ROOT = process.cwd();
const SPECS_DIR = join(REPO_ROOT, "e2e/case-specs");
const EXCLUDE_FILENAMES = new Set(["README.md", "COVERAGE.md", "BACKLOG.md", "TEMPLATE.md"]);

// 必需段落. 允许小变体 (中英文冒号 / 前后空格 / heading 级别 2 或 3).
const REQUIRED_SECTIONS = [
  { name: "Metadata", pattern: /^##+\s*Metadata\b/im },
  { name: "目标", pattern: /^##+\s*目标\s*$/im },
  { name: "前置条件", pattern: /^##+\s*前置条件\s*$/im },
  { name: "用户操作步骤", pattern: /^##+\s*用户操作步骤\s*$/im },
  { name: "预期结果", pattern: /^##+\s*预期结果\s*$/im },
  { name: "反例", pattern: /^##+\s*反例\s*$/im },
];

// Metadata 段内必需字段
const REQUIRED_METADATA_FIELDS = [
  { name: "Case 类型", pattern: /^-\s*Case\s*类型\s*[::]/im },
  { name: "目标模式", pattern: /^-\s*目标模式\s*[::]/im },
  { name: "优先级", pattern: /^-\s*优先级\s*[::]/im },
];

// ---------- helpers ----------

function walkSpecs(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walkSpecs(full));
    else if (entry.endsWith(".md") && !EXCLUDE_FILENAMES.has(entry)) out.push(full);
  }
  return out;
}

function extractSection(text, sectionRegex) {
  const lines = text.split("\n");
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (sectionRegex.test(lines[i])) {
      start = i + 1;
      break;
    }
  }
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start; i < lines.length; i++) {
    if (/^##+\s+/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n").trim();
}

// diff-mode: 从 git 拿新加/改的 spec 文件.
// 用 merge-base 找分歧点跟 main / master 比 (CI 里 MR 有 CI_MERGE_REQUEST_TARGET_BRANCH_NAME).
//
// 返回 null = 拿不到 base ref, 让 caller 退回全量校验 (safer than 假绿).
// **不 fallback HEAD~1**: 多 commit MR 会漏检早先 commit 的坏 spec (MR-13 review round 1).
function diffModeFiles() {
  const target =
    process.env.CI_MERGE_REQUEST_TARGET_BRANCH_NAME ||
    process.env.GITHUB_BASE_REF ||
    "main";
  let base = null;
  // 试 origin/<target> → 本地 <target> → 拿不到就 null
  for (const ref of [`origin/${target}`, target]) {
    try {
      base = execSync(`git merge-base HEAD ${ref}`, {
        stdio: ["ignore", "pipe", "ignore"],
      })
        .toString()
        .trim();
      if (base) break;
    } catch {
      // 试下一个
    }
  }
  if (!base) return null;
  // diff-filter=AM: A 新加 / M 修改, 不含 deleted
  const out = execSync(`git diff --name-only --diff-filter=AM ${base}...HEAD`, {
    stdio: ["ignore", "pipe", "ignore"],
  }).toString();
  return out
    .split("\n")
    .filter((f) => f && f.endsWith(".md") && f.includes("case-specs/"))
    .filter((f) => !EXCLUDE_FILENAMES.has(f.split("/").pop() || f))
    .map((f) => join(REPO_ROOT, f));
}

// ---------- CLI ----------

const args = process.argv.slice(2);
let files;

if (args.includes("--diff-mode")) {
  files = diffModeFiles();
  if (files === null) {
    // 拿不到 base ref (通常 shallow clone / 未 fetch target branch).
    // 退回全量, **不** 假装成功 (MR-13 review round 1: fallback HEAD~1 会漏检).
    // CI 场景应在 job 里 git fetch origin <target> --depth=... 确保 base 可达.
    console.error(
      `[lint-spec-format] ⚠ diff-mode: 找不到 base ref (origin/${process.env.CI_MERGE_REQUEST_TARGET_BRANCH_NAME || process.env.GITHUB_BASE_REF || "main"}), 退回全量校验. CI 里建议 fetch base branch 避免此警告.`,
    );
    files = walkSpecs(SPECS_DIR);
  } else if (files.length === 0) {
    console.log("[lint-spec-format] ✔ diff-mode: 本次无新加/改的 spec, skip");
    process.exit(0);
  } else {
    console.log(`[lint-spec-format] diff-mode: 校验 ${files.length} 个新加/改的 spec`);
  }
} else {
  const filesIdx = args.indexOf("--files");
  if (filesIdx >= 0) {
    files = args
      .slice(filesIdx + 1)
      .filter((f) => f.endsWith(".md") && !EXCLUDE_FILENAMES.has(f.split("/").pop() || f))
      .filter((f) => f.includes("case-specs/"));
    if (files.length === 0) {
      console.log("[lint-spec-format] ✔ 无 case-specs/ 下的 spec 文件, skip");
      process.exit(0);
    }
  } else {
    files = walkSpecs(SPECS_DIR);
  }
}

// ---------- lint ----------

const errors = [];
for (const f of files) {
  const relF = relative(REPO_ROOT, f);
  const text = readFileSync(f, "utf8");

  for (const { name, pattern } of REQUIRED_SECTIONS) {
    if (!pattern.test(text)) {
      errors.push(`${relF}: 缺 §${name} 段`);
    }
  }

  const metadata = extractSection(text, /^##+\s*Metadata\b/im);
  if (metadata) {
    for (const { name, pattern } of REQUIRED_METADATA_FIELDS) {
      if (!pattern.test(metadata)) {
        errors.push(`${relF}: Metadata 段缺 "${name}" 字段`);
      }
    }
  }

  const counterexamples = extractSection(text, /^##+\s*反例\s*$/im);
  if (counterexamples !== null && counterexamples.length < 20) {
    errors.push(
      `${relF}: §反例 段内容过短 (${counterexamples.length} 字符 < 20), 别只写 "无" 应付, 至少写清楚 "什么输入 → 应该看到什么错"`,
    );
  }

  // 骨架未填检查: scaffolder 生成的模板里 "**待补**" 是显式 TODO marker,
  // 作者填完 spec 后应该删掉. 若残留 → 骨架没填, 挡在 lint (MR-13 review round 2).
  //
  // 用 lastIndex 定位到具体行号, 帮作者跳转.
  const TODO_RE = /\*\*待补\*\*/g;
  const todoHits = [];
  let m;
  while ((m = TODO_RE.exec(text)) !== null) {
    const lineNum = text.slice(0, m.index).split("\n").length;
    todoHits.push(lineNum);
  }
  if (todoHits.length > 0) {
    errors.push(
      `${relF}: 残留 ${todoHits.length} 处 "**待补**" marker (行: ${todoHits.join(", ")}). scaffolder 骨架, 作者填完请删掉这些标记.`,
    );
  }
}

if (errors.length === 0) {
  console.log(`[lint-spec-format] ✔ ${files.length} spec file(s) OK`);
  process.exit(0);
}

console.error(`[lint-spec-format] ✘ 发现 ${errors.length} 个格式问题:\n`);
for (const e of errors) console.error(`  - ${e}`);
console.error("");
console.error("  必需段: Metadata / 目标 / 前置条件 / 用户操作步骤 / 预期结果 / 反例");
console.error("  Metadata 字段: Case 类型 / 目标模式 / 优先级");
console.error("  格式规约见 e2e/case-specs/TEMPLATE.md");
process.exit(1);
