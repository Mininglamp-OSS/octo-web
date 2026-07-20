/* eslint-disable no-undef -- e2e code runs in Node */
// @caseId C13-loop-subtask-create

import { test, expect } from "../fixtures-authed";
import { installMswScenario } from "../_lib/mswScenario";

test("@C13 loop 新建子任务 — 详情 → 更多菜单 → 新建子任务 → 弹窗填 title → 提交", async ({
  authedPage,
}) => {
  await installMswScenario(authedPage, "one-issue");
  await authedPage.goto("/loop?sid=e2etest");

  await authedPage.getByText("First issue").first().click();
  await authedPage.getByRole("button", { name: "more" }).click();
  // (i18n loop.subIssue.create = "新建子任务")
  await authedPage.getByRole("menuitem", { name: "新建子任务" }).click();

  // 复用 CreateIssueModal, title input placeholder 相同
  const titleInput = authedPage.getByPlaceholder("输入标题…");
  await expect(titleInput).toBeVisible();
  await titleInput.fill("C13 子任务");
  await titleInput.press("Enter");

  await expect(authedPage.getByText("已创建").first()).toBeVisible();
});
