/* eslint-disable no-undef -- e2e code runs in Node */
// @caseId C4-loop-create-issue
// @spec apps/web/e2e-kit/case-specs/C4-loop-create-issue.md

import { test, expect } from "../fixtures-authed";
import { installMswScenario } from "../_lib/mswScenario";

test("@C4 loop 创建 issue — 打开新建弹窗 → 填 title → 回车提交 → 新 issue 出现在列表", async ({
  authedPage,
}) => {
  await installMswScenario(authedPage, "one-ws");
  await authedPage.goto("/loop?sid=e2etest");

  // 前置: sidebar 已显示 workspace, 主区域是 issue 空态
  await expect(authedPage.locator(".loop-sidebar__ws-name")).toHaveText(
    "Workspace A"
  );

  // 打开 "新建任务" (i18n loop.action.newIssue), sidebar 里的自定义按钮
  await authedPage.locator(".loop-sidebar__new-btn").click();

  // Modal 出现: 有 title 输入框 (placeholder="输入标题…")
  const titleInput = authedPage.getByPlaceholder("输入标题…");
  await expect(titleInput).toBeVisible();

  // 填 title, 按 Enter 提交 (CreateIssueModal 支持 Enter 触发 submit)
  const NEW_TITLE = "e2e 新任务 C4";
  await titleInput.fill(NEW_TITLE);
  await titleInput.press("Enter");

  // 成功: 创建 toast "已创建" (i18n loop.toast.created)
  await expect(authedPage.getByText("已创建").first()).toBeVisible();
});
