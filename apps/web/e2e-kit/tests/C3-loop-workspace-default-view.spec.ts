/* eslint-disable no-undef -- e2e code runs in Node */
// @caseId C3-loop-workspace-default-view
// @spec apps/web/e2e-kit/case-specs/C3-loop-workspace-default-view.md

import { test, expect } from "../fixtures-authed";
import { installMswScenario } from "../_lib/mswScenario";

test("@C3 loop 有 workspace 默认视图 — sidebar 显示 workspace 名 + 主区域 issue 空态", async ({
  authedPage,
}) => {
  await installMswScenario(authedPage, "one-ws");
  await authedPage.goto("/loop?sid=e2etest");

  // sidebar 显示 workspace name (i18n 落地: Workspace A)
  await expect(authedPage.locator(".loop-sidebar__ws-name")).toHaveText(
    "Workspace A"
  );

  // 主区域: issue 空态 (i18n loop.empty.issueTitle / issueDesc)
  await expect(authedPage.getByText("还没有任务")).toBeVisible();
  await expect(
    authedPage.getByText("创建第一个任务，开始跟踪你的工作。")
  ).toBeVisible();

  // 空态引导消失 (对偶 C1)
  await expect(authedPage.getByText("还没有工作区")).not.toBeVisible();
});
