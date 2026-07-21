/* eslint-disable no-undef -- e2e code runs in Node */
// @caseId C16-loop-create-agent

import { test, expect } from "../fixtures-authed";
import { installMswScenario } from "../_lib/mswScenario";

test("@C16 loop 创建 agent — 专家 tab → 新建 → 填 name + runtime → 提交", async ({
  authedPage,
}) => {
  await installMswScenario(authedPage, "one-ws");
  await authedPage.goto("/loop?sid=e2etest");

  await authedPage.locator(".loop-sidebar__menu button", { hasText: "专家" }).first().click();

  // 新建专家 (i18n loop.action.newAgent)
  await authedPage.getByRole("button", { name: "新建专家" }).first().click();

  // Modal fill name (placeholder = loop.agent.namePlaceholder)
  await authedPage.getByPlaceholder("专家名称，例如 前端小助手").fill("C16 Agent");

  // 选 runtime dropdown
  await authedPage.locator('.loop-modal .semi-select').click();
  await authedPage.getByRole("option", { name: /Local Runtime/ }).click();

  // 提交 Modal (Semi confirm aria-label)
  await authedPage.locator(".loop-modal button[aria-label=\"confirm\"]").click();

  await expect(authedPage.getByText("已创建").first()).toBeVisible();
});
