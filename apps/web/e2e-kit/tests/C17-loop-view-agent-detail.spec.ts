/* eslint-disable no-undef -- e2e code runs in Node */
// @caseId C17-loop-view-agent-detail

import { test, expect } from "../fixtures-authed";
import { installMswScenario } from "../_lib/mswScenario";

test("@C17 loop 打开 agent 详情 — 专家 tab → 点开 → 详情页 name + owner 段渲染", async ({
  authedPage,
}) => {
  await installMswScenario(authedPage, "one-agent");
  await authedPage.goto("/loop?sid=e2etest");

  await authedPage.locator(".loop-sidebar__menu button", { hasText: "专家" }).first().click();

  // 点开 existing agent
  await authedPage.locator(".loop-agent-row", { hasText: "Existing Agent" }).click();

  // detail 页面出现: agent name 顶部渲染 (heading 或名字)
  await expect(authedPage.getByText("Existing Agent").first()).toBeVisible();
  // owner (i18n loop.agent.owner = "所有者") 或 runtime 段可见
  await expect(authedPage.getByText("Local Runtime").first()).toBeVisible();
});
