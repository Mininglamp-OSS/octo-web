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
  | "two-ws";

export async function installMswScenario(
  page: Page,
  scenario: LoopScenario
): Promise<void> {
  // 塞在 addInitScript, 让下一次 goto 时就已生效 (nav 前设置)
  await page.addInitScript(
    ({ name }) => {
      try {
        sessionStorage.setItem("__e2e_scenario", name);
        // 清历史场景残留标记
        sessionStorage.removeItem("__e2e_c2_created");
      } catch {
        /* noop */
      }
    },
    { name: scenario }
  );
  // 若当前页已加载 (fixture 已 goto '/'), 同步设置一份, 让后续 fetch 也走新 scenario
  await page.evaluate((name) => {
    try {
      sessionStorage.setItem("__e2e_scenario", name);
      sessionStorage.removeItem("__e2e_c2_created");
    } catch {
      /* noop */
    }
  }, scenario);
}
