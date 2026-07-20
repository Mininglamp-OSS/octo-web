/* eslint-disable no-undef -- e2e code runs in Node */
// @caseId C26-loop-agent-status-polling
// @edge — 非主流程 (agent 详情实时状态轮询, 只覆盖"初始加载 status 轮询未 crash", 不覆盖 30s polling 真实节奏)

import { test, expect } from "../fixtures-authed";
import { installMswScenario } from "../_lib/mswScenario";

test("@C26 @edge loop agent 详情 status 轮询 baseline — 详情稳定渲染, 未因 polling crash", async ({
  authedPage,
}) => {
  await installMswScenario(authedPage, "one-agent");
  await authedPage.goto("/loop?sid=e2etest");
  await authedPage.locator(".loop-sidebar__menu button", { hasText: "专家" }).first().click();
  await authedPage.locator(".loop-agent-row", { hasText: "Existing Agent" }).click();

  // 详情稳定, 等 3s 让潜在 polling 至少走一轮
  await expect(authedPage.getByText("Existing Agent").first()).toBeVisible();
  await authedPage.waitForTimeout(3000);
  // 依然可见 (未 crash / 未 error boundary)
  await expect(authedPage.getByText("Existing Agent").first()).toBeVisible();
});
