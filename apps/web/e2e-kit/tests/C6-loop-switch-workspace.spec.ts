/* eslint-disable no-undef -- e2e code runs in Node */
// @caseId C6-loop-switch-workspace
// @spec apps/web/e2e-kit/case-specs/C6-loop-switch-workspace.md

import { test, expect } from "../fixtures-authed";
import { installMswScenario } from "../_lib/mswScenario";

test("@C6 loop 切换 workspace — 从 A 切到 B, sidebar 名字变化", async ({
  authedPage,
}) => {
  await installMswScenario(authedPage, "two-ws");
  await authedPage.goto("/loop?sid=e2etest");

  // 初始: 默认选中 list[0] = Workspace A
  await expect(authedPage.locator(".loop-sidebar__ws-name")).toHaveText(
    "Workspace A"
  );

  // 点 sidebar workspace 按钮打开下拉
  await authedPage.locator(".loop-sidebar__ws-btn").click();

  // 下拉里应该有 A 和 B, 点 B
  await authedPage.locator(".loop-sidebar__ws-menu-name", { hasText: "Workspace B" }).click();

  // 切换成功: sidebar 名字变成 Workspace B
  await expect(authedPage.locator(".loop-sidebar__ws-name")).toHaveText(
    "Workspace B"
  );
});
