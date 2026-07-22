#!/usr/bin/env node
/* eslint-disable no-undef */
/**
 * _lib/new-case.mjs — case scaffolder (kit-provided).
 *
 * 生成 spec / test.spec.ts / handler 三件套, 目的是把从 skill 里翻规则
 * (tag 命名 / spec 引用 / register 函数命名 / 相对路径深度) 的手工活压缩到零.
 *
 * **接入方需改的占位** (脚本顶部 config 常量):
 *   - CASE_SPECS_DIR / TESTS_DIR / HANDLERS_DIR  — 项目路径 (默认对齐 kit v0.4 扁平布局)
 *   - FIXTURES_IMPORT_PATH / MOCK_IM_IMPORT_PATH / SANITY_IMPORT_PATH / HANDLERS_IMPORT_ROOT
 *                       — import 路径 (相对 e2e/ 根)
 *   - USE_MOCK_IM      — 是否装 mock-im-runtime (默认 **false**; 项目装了 mock-im-wksdk optional 后改成 true)
 *   - USE_SANITY       — 是否装 sanity helper (默认 true, 无 sanity 关掉)
 *   - FMT_CMD          — 生成后自动 fmt 命令 (默认 null, 项目要用 prettier 之类改这里)
 *
 * **不追加 index.ts**: case-specific handler 由 test.spec.ts 显式
 * `registerXxx(page)` 调 (骨架已经 import + register), 避免污染 baseline
 * (曾在 octo-web-2 上把 case-specific static handler 全局注册, 覆盖了
 *  baseline C2 的动态 handler → 撤销).
 *
 * 用法:
 *
 *   pnpm e2e:new <CaseId> <slug> \
 *     [--module <name>] [--submodule <name>] \
 *     [--tags "@p0 @matter @matter-create"] \
 *     [--covers "GITLAB#215,NANCY-BUG-2026-07-15"] \
 *     [--http-mock] [--no-http-mock] \
 *     [--im-seed] [--no-im-seed] \
 *     [--dry-run]
 *
 * 示例:
 *
 *   pnpm e2e:new M5 matter-list-filter --module matter --submodule list \
 *     --tags "@p1 @matter @matter-list" --http-mock --im-seed
 *
 * 产出 (以默认路径 + 上例参数为例):
 *   e2e/case-specs/matter/list/M5-matter-list-filter.md
 *   e2e/tests/matter/list/M5-matter-list-filter.spec.ts
 *   e2e/msw-handlers/m5-matter-list-filter.ts   (**默认生成**, 传 --no-http-mock 关掉)
 *
 * --no-http-mock → 不出 handler, test 骨架也不 register handler.
 * --no-im-seed → test 骨架不装 mock IM runtime.
 * --dry-run → 只 print 会写哪些文件, 不动盘.
 */

import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve, relative } from "node:path";
import { spawnSync } from "node:child_process";

// ---------- config (接入方按需改) ----------
//
// **默认值对齐 kit v0.4 sync 产物的扁平布局**:
//   e2e/fixtures-authed.ts        (template 落根)
//   e2e/_kit/mock-im-runtime/     (overwrite 落 _kit/)
//   e2e/_lib/sanity.ts            (overwrite 落 _lib/)
//   e2e/msw-handlers/             (hands_off 目录, kit 首次落 README 占位)
//
// 若接入方项目采用其他布局 (例如 e2e-research 的 shared/), 改下面常量即可.

const REPO_ROOT = process.cwd();
const CASE_SPECS_DIR = resolve(REPO_ROOT, "e2e/case-specs");
const TESTS_DIR = resolve(REPO_ROOT, "e2e/tests");
const HANDLERS_DIR = resolve(REPO_ROOT, "e2e/msw-handlers");

// import path segments (相对 e2e/ 根). test 到根的相对前缀由 upToE2eRoot() 算.
const FIXTURES_IMPORT_PATH = "fixtures-authed";
const MOCK_IM_IMPORT_PATH = "_kit/mock-im-runtime";
const SANITY_IMPORT_PATH = "_lib/sanity";
const HANDLERS_IMPORT_ROOT = "msw-handlers";

const USE_MOCK_IM = false; // 项目装了 mock-im-wksdk optional 后, 改成 true
const USE_SANITY = true;
const FMT_CMD = null; // 例: ["pnpm", "exec", "prettier", "--write"]

// test 到 e2e/ 根的相对前缀. tests/[module/[sub/]]<file>.spec.ts → depth 决定 ../ 个数.
function upToE2eRoot(moduleName, subModule) {
  const depth = 1 + (moduleName ? 1 : 0) + (subModule ? 1 : 0);
  return "../".repeat(depth);
}

// ---------- arg parse ----------

function parseArgs(argv) {
  const args = { flags: {}, positional: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      if (key.startsWith("no-")) {
        args.flags[key.slice(3)] = false;
      } else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
        args.flags[key] = argv[++i];
      } else {
        args.flags[key] = true;
      }
    } else {
      args.positional.push(a);
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const [caseId, slug] = args.positional;

if (!caseId || !slug) {
  console.error(
    "usage: e2e:new <CaseId> <slug> [--module m] [--submodule sm] [--tags '@p0 @m'] [--http-mock] [--no-im-seed] [--dry-run]",
  );
  process.exit(1);
}

if (!/^[A-Z][A-Z0-9]{0,4}\d+[A-Za-z]?$/.test(caseId)) {
  console.error(`CaseId 建议格式: 字母前缀 + 数字, 可选尾字母, e.g. C1 / M5 / CS3 / LOC2 / CT5v. 收到: ${caseId}`);
  process.exit(1);
}
if (!/^[a-z][a-z0-9-]*$/.test(slug)) {
  console.error(`slug 只能小写字母 + 数字 + 连字符, e.g. matter-list-filter. 收到: ${slug}`);
  process.exit(1);
}

const moduleName = args.flags.module || null;
const subModule = args.flags.submodule || null;
const tags = (args.flags.tags || "@p1").trim();
// tag 匹配用完整词判定, 不用 /@p0\b/ —— JS \b 在 "0" 和 "-" 之间就是词边界,
// 会让 @p0-follow-up 误匹配 @p0 (MR-14 review round 1 抓到).
const tagSet = new Set(tags.split(/\s+/).filter(Boolean));
const covers = args.flags.covers ? String(args.flags.covers).trim() : null;
const withHttpMock = args.flags["http-mock"] !== false;
// --im-seed 语义: 显式传 --im-seed → 强开; --no-im-seed → 强关;
// 都不传 → 跟 USE_MOCK_IM 默认. 允许"USE_MOCK_IM=false 时 CLI 覆盖 opt-in",
// 避免"没手改常量就静默 no-op"的坑 (MR-12 Codex-0 review round 2).
const withImSeed =
  args.flags["im-seed"] === true
    ? true
    : args.flags["im-seed"] === false
      ? false
      : USE_MOCK_IM;
const dryRun = args.flags["dry-run"] === true;

// ---------- path resolution ----------

const specDir = moduleName
  ? subModule
    ? resolve(CASE_SPECS_DIR, moduleName, subModule)
    : resolve(CASE_SPECS_DIR, moduleName)
  : CASE_SPECS_DIR;
const testDir = moduleName
  ? subModule
    ? resolve(TESTS_DIR, moduleName, subModule)
    : resolve(TESTS_DIR, moduleName)
  : TESTS_DIR;

const specFileName = `${caseId}-${slug}.md`;
const testFileName = `${caseId}-${slug}.spec.ts`;
const handlerFileName = `${caseId.toLowerCase()}-${slug}.ts`;

const specPath = resolve(specDir, specFileName);
const testPath = resolve(testDir, testFileName);
const handlerPath = resolve(HANDLERS_DIR, handlerFileName);

const specRelForHeader = [
  relative(REPO_ROOT, CASE_SPECS_DIR),
  ...(moduleName ? [moduleName] : []),
  ...(subModule ? [subModule] : []),
  specFileName,
].join("/");

const sharedRoot = upToE2eRoot(moduleName, subModule);

// register 函数名: register + CaseId + PascalCase(slug)
const registerFnName =
  "register" +
  caseId +
  slug
    .split("-")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join("");

const stateKey = `__${caseId.toLowerCase()}State__`;

// ---------- templates ----------

const specTemplate = `# ${caseId} ${slug.replace(/-/g, " ").replace(/(^|\s)\w/g, (c) => c.toUpperCase())}

## Metadata

- Case 类型: feature flow / 契约 / 回归守护 (**选一个**)
- 目标模式: real-page seed / harness route (**选一个**;默认 real-page)
- 登录状态: authed fixture${withImSeed ? ", mock IM runtime" : ""}
- 优先级: ${tagSet.has("@p0") ? "P0" : tagSet.has("@p2") ? "P2" : "P1"}
${tags ? "- Tags: " + tags + "\n" : ""}${covers ? "- covers: " + covers + "\n" : ""}

## 目标

**一句话说清用户想完成什么, 以及守护的边界.**

## 前置条件

- fixture: \`${FIXTURES_IMPORT_PATH}\`
${withHttpMock ? `- MSW handler: \`${handlerFileName}\`\n  - **待补** GET/POST endpoint + resp shape 说明\n` : "- 无 HTTP mock (纯 IM seed / 静态 UI)\n"}${withImSeed ? "- mock-im-runtime seed:\n  - **待补** currentUid / spaceId / users / groups / conversations / subscribers\n" : ""}

## 用户操作步骤

1. **待补** 用户视角步骤 (含 i18n 实际文本, 不含 selector 实现细节)
2. ...

## 预期结果

- **待补** 纯 UI 观察, 不写 "发出 POST XX"
- ...

## 反例

- **待补** 应失败的场景 + 具体断言点
- ...

## 视觉基准

不建 pixel baseline.

## 摸清依据

- **待补** file:line 引用 (endpoint 定义 / mapper / 主组件位置 / i18n key → 实际文案)
`;

const testTemplate = `/* eslint-disable no-undef -- e2e code runs in Node */
/**
 * spec: ${specRelForHeader}
 *
 * ${caseId}: **待补** 一句话主线 + 反例守护点.
 */
import { test, expect } from "${sharedRoot}${FIXTURES_IMPORT_PATH}";
${withHttpMock ? `import { ${registerFnName} } from "${sharedRoot}${HANDLERS_IMPORT_ROOT}/${caseId.toLowerCase()}-${slug}";\n` : ""}${withImSeed ? `import { installMockImRuntime } from "${sharedRoot}${MOCK_IM_IMPORT_PATH}";\n` : ""}${USE_SANITY ? `import { startRequestMonitor, sanityCheck } from "${sharedRoot}${SANITY_IMPORT_PATH}";\n` : ""}

test.describe("@${caseId} ${tags} ${caseId} — **待补** case 描述", () => {
  test("**待补** 一句话操作 + 预期", async ({ authedPage }) => {
    // scaffolder 骨架 fixme 保护: 作者填完真实操作 + 断言后删掉这行.
    // 若忘删, batch 跑 (--grep @p0 等) 会 skip 而不是假绿.
    test.fixme(true, "scaffolder 骨架, 待作者补真实操作步骤 + UI 断言");

${USE_SANITY ? `    const ctx = startRequestMonitor(authedPage);\n` : ""}${withHttpMock ? `\n    await ${registerFnName}(authedPage);\n` : ""}${withImSeed ? `
    await installMockImRuntime(authedPage, {
      currentUid: "e2e-user-1",
      spaceId: "e2e-space-001",
      users: [{ uid: "e2e-user-1", name: "E2E Tester" }],
      groups: [],
      conversations: [],
      subscribers: [],
    });
` : ""}
    // ---- 用户操作 ----
    // await authedPage.getByRole("link", { name: "**待补**" }).first().click();

    // ---- UI 断言 ----
    // await expect(authedPage.getByRole("heading", { name: "**待补**" })).toBeVisible();
    void expect;
${USE_SANITY ? `
    await sanityCheck(authedPage, ctx);` : ""}
  });
});
`;

const handlerTemplate = `/* eslint-disable no-undef -- e2e code runs in Node */
/* eslint-disable @typescript-eslint/no-explicit-any -- msw resolver types */
import type { Page } from "@playwright/test";

/**
 * ${caseId}: **待补** 覆盖的 endpoints + resp shape 说明.
 *
 * 覆盖 endpoints:
 *   GET/POST *​/v1/... — **待补**
 *
 * state 挂 window.${stateKey} 供调试.
 */

export async function ${registerFnName}(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = (window as unknown as { __mswWorker__?: { use: (...h: unknown[]) => void } })
      .__mswWorker__;
    const http = (
      window as unknown as {
        __mswHttp__?: {
          get: (path: string, resolver: (info: any) => unknown) => unknown;
          post: (path: string, resolver: (info: any) => unknown) => unknown;
        };
      }
    ).__mswHttp__;
    const HttpResponse = (
      window as unknown as {
        __mswHttpResponse__?: { json: (body: unknown, init?: unknown) => unknown };
      }
    ).__mswHttpResponse__;
    if (!w || !http || !HttpResponse) {
      throw new Error("[${caseId}] MSW worker 未就绪 (等 __MSW_READY__).");
    }

    // module-scope state 每 install 重置, 避免 --repeat-each=10 相互泄漏.
    (window as unknown as { ${stateKey}: { calls: number } }).${stateKey} = {
      calls: 0,
    };

    w.use(
      // **待补** 本 case 的 endpoint handler
      // http.post("*​/v1/matter/xxx", async (info: any) => {
      //   const state = (window as unknown as { ${stateKey}: { calls: number } }).${stateKey};
      //   state.calls += 1;
      //   const body = await info.request.json();
      //   return HttpResponse.json({ code: 0, message: "ok", data: {} });
      // }),
    );
  });
}
`;

// ---------- write ----------

function ensureDir(p) {
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
}

function writeIfMissing(path, content, label) {
  if (existsSync(path)) {
    console.log(`  ✗ 已存在, 跳过: ${label} (${path})`);
    return false;
  }
  if (dryRun) {
    console.log(`  [dry-run] would write ${label}: ${path} (${content.length} bytes)`);
    return true;
  }
  ensureDir(dirname(path));
  writeFileSync(path, content, "utf8");
  console.log(`  ✓ 写入 ${label}: ${path}`);
  return true;
}

console.log(`\n生成 case ${caseId} (${slug})`);
console.log(`  module = ${moduleName || "(root)"}, submodule = ${subModule || "-"}`);
console.log(`  tags   = ${tags}`);
console.log(`  http-mock = ${withHttpMock}, im-seed = ${withImSeed}\n`);

writeIfMissing(specPath, specTemplate, "spec");
writeIfMissing(testPath, testTemplate, "test");
const writtenFiles = [specPath, testPath];
if (withHttpMock) {
  const handlerWritten = writeIfMissing(handlerPath, handlerTemplate, "handler");
  if (handlerWritten) {
    writtenFiles.push(handlerPath);
    console.log(`  ℹ  handler 不追加到 index.ts (case-specific, 由 test 显式 register)`);
  }
}

// auto-fmt (可选): 让新生成的文件直接过 pre-commit hook
if (!dryRun && FMT_CMD && writtenFiles.length > 0) {
  console.log(`\n  运行 ${FMT_CMD.join(" ")} ...`);
  const fmt = spawnSync(FMT_CMD[0], [...FMT_CMD.slice(1), ...writtenFiles], {
    cwd: REPO_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  });
  if (fmt.status === 0) {
    console.log(`  ✓ fmt 完成`);
  } else {
    console.error(`  ✗ fmt 失败 (status ${fmt.status})`);
    if (fmt.stderr) console.error(fmt.stderr.split("\n").slice(-8).join("\n"));
  }
}

console.log(`\n下一步:`);
console.log(`  1. 摸清: 按 spec 里 "**待补**" 位置填 endpoint / shape / i18n 文案`);
console.log(`  2. 实装 handler + test.spec.ts`);
console.log(`  3. 跑单次: pnpm exec playwright test --grep @${caseId} --workers=1`);
console.log(`  4. 稳定 10x: 加 --repeat-each=10\n`);
