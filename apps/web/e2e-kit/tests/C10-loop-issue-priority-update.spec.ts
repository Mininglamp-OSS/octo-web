/* eslint-disable no-undef -- e2e code runs in Node */
// @caseId C10-loop-issue-priority-inline-update

import { test, expect } from "../fixtures-authed";
import { installMswScenario } from "../_lib/mswScenario";

test("@C10 loop issue priority 内联切换 — 详情 pill → Dropdown → 选高 → UI 反映", async ({
  authedPage,
}) => {
  await installMswScenario(authedPage, "one-issue");
  await authedPage.goto("/loop?sid=e2etest");

  await authedPage.getByText("First issue").first().click();

  const priorityPill = authedPage.locator(".loop-idp__prop-edit").nth(1);
  await expect(priorityPill).toContainText("无");

  await priorityPill.click();
  await authedPage.getByRole("menuitem", { name: "高" }).click();

  await expect(priorityPill).toContainText("高");
});
