/* eslint-disable no-undef -- e2e code runs in Node */
// @caseId C19-loop-view-squad-detail

import { test, expect } from "../fixtures-authed";
import { installMswScenario } from "../_lib/mswScenario";

test("@C19 loop 打开 squad 详情 — 专家团 tab → 点开 → 名字 + leader 段渲染", async ({
  authedPage,
}) => {
  await installMswScenario(authedPage, "one-squad");
  await authedPage.goto("/loop?sid=e2etest");

  await authedPage.locator(".loop-sidebar__menu button", { hasText: "专家团" }).first().click();

  await authedPage.locator(".loop-squad-row", { hasText: "Existing Squad" }).click();

  // 详情页 name + leader name 可见
  await expect(authedPage.getByText("Existing Squad").first()).toBeVisible();
  await expect(authedPage.getByText("Agent Alpha").first()).toBeVisible();
});
