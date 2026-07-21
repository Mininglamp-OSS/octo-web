/* eslint-disable no-undef -- e2e code runs in Node */
/**
 * mswScenario — 让 spec 通过 sessionStorage 通知 MSW handler 走哪个场景.
 *
 * 为什么用 sessionStorage 而不是 worker.use():
 *  - worker.use() 装的 handler 在 page nav 后会 reset (Playwright authedPage
 *    fixture 先 goto('/'), spec 再 goto('/loop') → 中间会重置)
 *  - sessionStorage 在 nav 后存活, handler 内部读它做 dispatch, 一次装长期有效
 *
 * 用法:
 *   test("...", async ({ authedPage }) => {
 *     await installMswScenario(authedPage, "one-issue");
 *     await authedPage.goto("/loop?sid=e2etest");
 *     ...
 *   });
 *
 * 目前支持的 scenario 名 (见 apps/web/e2e-kit/msw-handlers/loop-empty.ts):
 *   - "empty" (默认): 无 workspace, 空态引导 (C1)
 *   - "create-ws": POST 前空, POST 后有 workspace (C2)
 *   - "one-ws": 一个 workspace, 无 issue (C3)
 *   - "one-issue": 一个 workspace + 一个 issue (C4/C5)
 *   - "two-ws": 两个 workspace (C6 切换)
 */
import type { Page } from "@playwright/test";

export type LoopScenario =
  | "empty"
  | "create-ws"
  | "one-ws"
  | "one-issue"
  | "two-ws"
  | "ws-with-members"
  | "member-remove"
  | "one-project"
  | "one-agent"
  | "one-squad"
  | "one-automation"
  | "no-mock";

export async function installMswScenario(
  page: Page,
  scenario: LoopScenario
): Promise<void> {
  // no-mock: 阻止 SW 加载 (让 page.route 生效, 因为 SW 一旦 register 会抢
  // 所有 fetch, page.route 只能拦不经过 SW 的原生 fetch).
  //   1. context.route 拦 mockServiceWorker.js, 返 404, index.tsx 里
  //      worker.start() 会抛异常, MSW 未 register
  //   2. index.tsx 里 catch 掉异常 (下面 patch), 或者接受错误让 app 继续.
  //      本 kit 目前 __MSW_READY__ 只在成功时 set true, 迁移进来的 spec
  //      不用 wait 它, 所以不会卡死.
  //
  // 塞 addInitScript 让下一次 goto 时就已生效 (nav 前设置)
  if (scenario === "no-mock") {
    await page.context().route("**/mockServiceWorker.js", (route) =>
      route.fulfill({ status: 404, body: "" })
    );
  }

  await page.addInitScript(
    ({ name }) => {
      try {
        sessionStorage.setItem("__e2e_scenario", name);
        // 清历史场景残留标记
        sessionStorage.removeItem("__e2e_c2_created");
        sessionStorage.removeItem("__e2e_removed_members");
        sessionStorage.removeItem("__e2e_added_members");
      } catch {
        /* noop */
      }
    },
    { name: scenario }
  );
  // 若当前页已加载 (fixture 已 goto '/'), 同步设置一份, 让后续 fetch 也走新 scenario.
  // 未加载 (about:blank / bind spec 未 goto) 的情况直接跳过, addInitScript 已足够.
  try {
    await page.evaluate((name) => {
      try {
        sessionStorage.setItem("__e2e_scenario", name);
        sessionStorage.removeItem("__e2e_c2_created");
      } catch {
        /* noop */
      }
    }, scenario);
  } catch {
    /* page 未 loaded, 忽略 */
  }
}
