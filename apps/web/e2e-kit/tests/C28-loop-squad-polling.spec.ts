/* eslint-disable no-undef -- e2e code runs in Node */
// @caseId C28-loop-squad-member-status-polling
// @edge — 同 C26: 只覆盖 baseline 稳定性, 不测 30s polling 真实节奏

import { test, expect } from "../fixtures-authed";
import { installMswScenario } from "../_lib/mswScenario";

test("@C28 @edge loop squad member status polling baseline — 详情稳定渲染, 未因 polling crash", async ({
  authedPage,
}) => {
  await installMswScenario(authedPage, "one-squad");
  await authedPage.goto("/loop?sid=e2etest");
  await authedPage.locator(".loop-sidebar__menu button", { hasText: "专家团" }).first().click();
  await authedPage.locator(".loop-squad-row", { hasText: "Existing Squad" }).click();

  await expect(authedPage.getByText("Existing Squad").first()).toBeVisible();
  await authedPage.waitForTimeout(3000);
  await expect(authedPage.getByText("Existing Squad").first()).toBeVisible();
});
