/* eslint-disable no-undef -- e2e code runs in Node */
// @caseId C14-loop-create-project

import { test, expect } from "../fixtures-authed";
import { installMswScenario } from "../_lib/mswScenario";

test("@C14 loop 创建 project — 项目 tab → 新建 → 填 name → 提交 → 出现在列表", async ({
  authedPage,
}) => {
  await installMswScenario(authedPage, "one-ws");
  await authedPage.goto("/loop?sid=e2etest");

  // 切到 "项目" tab (i18n loop.nav.project)
  await authedPage.locator(".loop-sidebar__menu button", { hasText: "项目" }).click();

  // 点 "新建项目" (i18n loop.action.newProject)
  await authedPage.getByRole("button", { name: "新建项目" }).first().click();

  // Modal (i18n loop.action.newProject 复用 modal title): 填 name
  await authedPage.getByPlaceholder("项目名称，例如 增长实验").fill("C14 Project");

  // 提交 (Semi Modal aria-label="confirm", i18n loop.action.create)
  await authedPage.locator(".loop-modal button[aria-label=\"confirm\"]").click();

  // 成功 toast "已创建" + 列表出现新项目
  await expect(authedPage.getByText("已创建").first()).toBeVisible();
});
