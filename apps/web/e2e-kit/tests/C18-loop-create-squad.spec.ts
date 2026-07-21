/* eslint-disable no-undef -- e2e code runs in Node */
// @caseId C18-loop-create-squad

import { test, expect } from "../fixtures-authed";
import { installMswScenario } from "../_lib/mswScenario";

test("@C18 loop 创建 squad — 专家团 tab → 新建 → 填 name + leader → 提交", async ({
  authedPage,
}) => {
  await installMswScenario(authedPage, "one-ws");
  await authedPage.goto("/loop?sid=e2etest");

  await authedPage.locator(".loop-sidebar__menu button", { hasText: "专家团" }).first().click();

  // 新建专家团 (i18n loop.action.newSquad)
  await authedPage.getByRole("button", { name: "新建专家团" }).first().click();

  await authedPage.getByPlaceholder("专家团名称").fill("C18 Squad");

  // 选 leader (下拉 = Agent Alpha 从 /agents mock) — Modal 里有 leader + members 两个 Select, 用 first (leader)
  await authedPage.locator('.loop-modal .semi-select').first().click();
  await authedPage.getByRole("option", { name: "Agent Alpha" }).click();

  await authedPage.locator(".loop-modal button[aria-label=\"confirm\"]").click();

  await expect(authedPage.getByText("已创建").first()).toBeVisible();
});
