/* eslint-disable no-undef -- e2e code runs in Node */
// @caseId C2-loop-create-workspace
// @spec apps/web/e2e-kit/case-specs/C2-loop-create-workspace.md

import { test, expect } from "../fixtures-authed";
import { installMswScenario } from "../_lib/mswScenario";

test("@C2 loop 创建 workspace — 空态点创建 → 弹窗填名 → 提交 → workspace 出现在 sidebar", async ({
  authedPage,
}) => {
  await installMswScenario(authedPage, "create-ws");
  await authedPage.goto("/loop?sid=e2etest");

  // 空态入口: 空态文案 + 创建按钮
  await expect(authedPage.getByText("还没有工作区")).toBeVisible();
  await authedPage
    .getByRole("button", { name: "创建工作区" })
    .first()
    .click();

  // Modal 出现, 填 workspace name
  await authedPage.getByPlaceholder("工作区名称").fill("E2E Workspace C2");

  // Modal 提交按钮: Semi Modal 用 aria-label="confirm" (i18n loop.action.create)
  await authedPage.locator(".loop-modal button[aria-label=\"confirm\"]").click();

  // 提交成功: sidebar workspace 名显示新 workspace 名
  await expect(authedPage.locator(".loop-sidebar__ws-name")).toHaveText(
    "E2E Workspace C2"
  );
  await expect(authedPage.getByText("还没有工作区")).not.toBeVisible();
});
