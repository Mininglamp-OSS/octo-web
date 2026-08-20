# _lib helper

本目录放 kit 通用 helper (overwrite 策略, kit 独占, 接入方别改).

## 现有文件

- `sanity.ts` — sanityCheck: URL 检查 / MSW 无 fallthrough / 无 retry
- `spec-history.sh` — 封装 `git log -- apps/web/e2e-kit/case-specs/<caseId>-*.md`
- `collect-evidence.sh` — 从 Playwright json reporter 生成两级 report + trace/keyframes tar.gz
- `preflight.mjs` — 只读检查 lockfile、env、包管理器、服务端口，并选择附近可用端口
- `verify-case.sh` — 统一执行单 case 的 3x 稳定性 gate
- `e2eReady.ts` — 统一等待 app/MSW/mock seed readiness marker，并保留明确错误原因
- `target-layout.mjs` — 自动识别 `e2e` / `e2e-kit` / `apps/web/e2e-kit`，避免接入方手改脚本路径
- `tokens.ts` — (midscene optional) LLM token 消耗采集
- `new-case.mjs` — case scaffolder (v0.4): 一条命令生成 spec + test + handler 三件套
- `lint-spec-format.mjs` — case-spec md 格式 lint (v0.4): 必需段 + Metadata 字段 + 反例非空, 支持 --diff-mode 存量豁免

## `new-case.mjs` 用法

```bash
# octo-web 可直接运行: `node apps/web/e2e-kit/_lib/new-case.mjs`
pnpm e2e:new M5 matter-list-filter --module matter --submodule list

# 完整参数
pnpm e2e:new <CaseId> <slug> \
  (--module <name> | --tags "@p1 @module") \
  [--submodule <name>] \
  [--tags "@p0 @matter"] \
  [--covers "GITLAB#215,NANCY-BUG-2026-07-15"] \
  [--http-mock] [--no-http-mock] \
  [--im-seed] [--no-im-seed] \
  [--dry-run]
```

Tags 会自动归一化:
- 补 `@<CaseId>`
- 缺 `@p0|@p1|@p2` 时默认补 `@p1`
- 传了 `--module` / `--submodule` 时自动补 `@<module>` / `@<submodule>`

CaseId 前缀只是项目自定义 ID, 不参与模块语义; 筛选靠 `@module` tag.

**默认生成 spec + test + handler 三件套** (对齐 kit v0.4 sync 产物的扁平布局).
`--no-http-mock` 关掉 handler (只出 spec + test 骨架, test 不 register handler).

**接入方按需改脚本顶部 config 常量** (搜 `---- config ----`):
- `CASE_SPECS_DIR` / `TESTS_DIR` / `HANDLERS_DIR` — 项目路径 (默认对齐 kit v0.4)
- `FIXTURES_IMPORT_PATH` / `MOCK_IM_IMPORT_PATH` / `SANITY_IMPORT_PATH` / `HANDLERS_IMPORT_ROOT` — import 路径 (相对 e2e 根)
- `USE_MOCK_IM` — **默认 false**. 项目装了 `mock-im-wksdk` optional 后改成 true
- `USE_SANITY` — 默认 true, 无 sanity helper 项目关掉
- `FMT_CMD` — 生成后自动 fmt (`null` 关闭)

**产出布局** (默认):
```
apps/web/e2e-kit/case-specs/[module/[sub/]]<CaseId>-<slug>.md    (spec)
apps/web/e2e-kit/tests/[module/[sub/]]<CaseId>-<slug>.spec.ts    (test)
apps/web/e2e-kit/msw-handlers/<caseidLower>-<slug>.ts             (handler, --no-http-mock 关掉)
```

Handler 不追加 index.ts (case-specific 由 test 显式 register, 避免污染 baseline).

sync 策略: **overwrite**.
