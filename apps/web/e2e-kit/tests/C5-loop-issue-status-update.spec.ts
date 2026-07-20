/* eslint-disable no-undef -- e2e code runs in Node */
// @caseId C5-loop-issue-status-inline-update
// @spec apps/web/e2e-kit/case-specs/C5-loop-issue-status-inline-update.md

import { test, expect } from "../fixtures-authed";
import { installMswScenario } from "../_lib/mswScenario";

test("@C5 loop issue status 内联切换 — 打开详情 → 点状态 pill → 选新状态 → UI 反映", async ({
  authedPage,
}) => {
  await installMswScenario(authedPage, "one-issue");
  await authedPage.goto("/loop?sid=e2etest");

  // 前置: sidebar 有 workspace, 列表有一个 issue
  await expect(authedPage.locator(".loop-sidebar__ws-name")).toHaveText(
    "Workspace A"
  );

  // 点击 issue 卡片打开详情 (issue title = "First issue" from handler)
  await authedPage.getByText("First issue").first().click();

  // 详情面板出现: 属性栏里 "状态" (i18n loop.field.status), pill 显示当前 "待办" (todo)
  const statusPill = authedPage.locator(".loop-idp__prop-edit").first();
  await expect(statusPill).toContainText("待办");

  // 点 pill → 弹出 Dropdown → 点 "进行中" (in_progress)
  await statusPill.click();
  await authedPage.getByRole("menuitem", { name: "进行中" }).click();

  // UI 反映: pill 变成 "进行中"
  await expect(statusPill).toContainText("进行中");
});
