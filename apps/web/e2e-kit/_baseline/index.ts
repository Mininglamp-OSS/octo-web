/* eslint-disable no-undef -- e2e code runs in Node */
import type { Page } from "@playwright/test";
// 接入方按需 import 自己的 baseline handler, 例:
// import { registerAppConfig } from "./appconfig";
// import { registerSpaceMy } from "./space-my";
// import { registerUserMe } from "./user-me";

/**
 * kit-provided 空 baseline 骨架.
 *
 * ## 什么是 baseline
 *
 * **auth guard 依赖**的少数 HTTP endpoint, 不装就会踢登录页 —— 例如:
 * - `GET /api/config` — 应用配置 (oidc_providers / system_bot_uids 之类)
 * - `GET /api/space/my` — 当前用户所属 space
 * - `GET /api/user/me` — 当前用户信息
 *
 * baseline handler 由 `applyBaselineRoutes(page)` **强制装**, 由接入方在本目录
 * 补齐具体 handler (每个 endpoint 一个文件, 命名 `<endpoint-slug>.ts`, 导出
 * `register<Name>` 函数).
 *
 * ## 关键规范 (kit 硬约束)
 *
 * ### 1. baseline handler 必须全字段 spread
 *
 * 例如 auth guard 读 config.oidc_providers, 若 handler 只返 `{version: 1}` 而不
 * 返 oidc_providers, 会走 undefined 分支 → 沉默 401 → 踢登录页. 所以:
 *
 * ```ts
 * // ✅ 正确
 * http.get('/api/config', () => HttpResponse.json({
 *   version: 1,
 *   oidc_providers: [],
 *   system_bot_uids: [],
 *   // ... 所有 auth guard 可能读的字段全字段 spread
 * }))
 *
 * // ❌ 错
 * http.get('/api/config', () => HttpResponse.json({ version: 1 }))
 * ```
 *
 * ### 2. case handler 不进本目录, 走 `msw-handlers/<caseId>-*.ts` + 显式装
 *
 * Case-specific handler 不 install 到 baseline. 由 test 里显式引入 + 调:
 *
 * ```ts
 * test('@C7 xxx', async ({ authedPage }) => {
 *   await applyBaselineRoutes(authedPage)       // 强制装 baseline
 *   await registerC7CreateCategory(authedPage)  // per-case, 显式
 *   // ...
 * })
 * ```
 *
 * **禁 install-all 糖** —— 别写"把所有 case handler 全装" 的函数, 会导致别的
 * case handler 意外拦本 case 请求, 隐性污染. 详见 msw-handlers/README.md.
 *
 * ### 3. Handler 命名约定 (v0.3 反哺 e2e-research 实践)
 *
 * 每个 per-case handler 文件命名 `<caseId>-<name>.ts`, 里面 export 一个函数:
 * `register<CaseId><PascalCase>(page: Page): Promise<void>`
 *
 * 例:
 * - 文件: `e2e/msw-handlers/C7-create-category.ts`
 * - export: `export async function registerC7CreateCategory(page: Page)`
 *
 * 该函数无副作用 (不修改 module 状态), 幂等可反复调.
 * Test 里显式 import + await 调用, 不要走"注册表"或"入口 apply 全部"糖.
 *
 * ## 起手怎么补
 *
 * 1. `pnpm add -D msw` (Full 模式) 或者用 Playwright `page.route()` (Lite 模式)
 * 2. `npx msw init ./public --save` (Full 模式生成 mockServiceWorker.js)
 * 3. 找到你项目的 auth guard 依赖的 endpoint, 每个建一个 handler 文件
 * 4. 在本文件 uncomment import + append `await register<Name>(page)`
 *
 * 参考 kit repo: https://codex.mlamp.cn/e2e/e2e-kit/-/blob/main/docs/methodology/mock-selection.md
 */
export async function applyBaselineRoutes(page: Page): Promise<void> {
  // TODO(接入方): 按项目补 baseline handler, 例:
  // await registerAppConfig(page);
  // await registerSpaceMy(page);
  // await registerUserMe(page);
  //
  // 未补齐时 case 会踢登录页, sanityCheck 会明确报出 "URL 在 /login".
  void page;
}
