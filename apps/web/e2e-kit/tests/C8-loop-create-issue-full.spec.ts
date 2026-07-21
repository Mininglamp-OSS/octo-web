/* eslint-disable no-undef -- e2e code runs in Node */
// @caseId C8-loop-create-issue-full
// @spec apps/web/e2e-kit/case-specs/C8-loop-create-issue-full.md
// C4 只填 title, C8 补: 改 priority + status pill 后再提交

import { test, expect } from "../fixtures-authed";
import { installMswScenario } from "../_lib/mswScenario";

test("@C8 loop 创建 issue 完整 — 弹窗 → 改 priority + status → 提交", async ({
  authedPage,
}) => {
  await installMswScenario(authedPage, "one-ws");
  await authedPage.goto("/loop?sid=e2etest");

  await authedPage.locator(".loop-sidebar__new-btn").click();

  const titleInput = authedPage.getByPlaceholder("输入标题…");
  await titleInput.fill("C8 完整 issue");

  // 改 priority pill (LoopPropertyPill aria-label=优先级, i18n loop.field.priority)
  await authedPage.locator('.loop-ci__toolbar [aria-label="优先级"]').click();
  await authedPage.getByRole("menuitem", { name: "高" }).click();

  // 改 status pill
  await authedPage.locator('.loop-ci__toolbar [aria-label="状态"]').click();
  await authedPage.getByRole("menuitem", { name: "进行中" }).click();

  await titleInput.press("Enter");

  await expect(authedPage.getByText("已创建").first()).toBeVisible();
});
