/* eslint-disable no-undef -- e2e code runs in Node */
// @caseId C11-loop-issue-assignee-inline-update

import { test, expect } from "../fixtures-authed";
import { installMswScenario } from "../_lib/mswScenario";

test("@C11 loop issue assignee 内联切换 — picker → 选 Admin User → UI 反映", async ({
  authedPage,
}) => {
  await installMswScenario(authedPage, "one-issue");
  await authedPage.goto("/loop?sid=e2etest");

  await authedPage.getByText("First issue").first().click();

  // 属性栏第 3 pill 是 assignee (loop-assignee-trigger)
  const picker = authedPage.locator(".loop-assignee-trigger").first();
  await expect(picker).toBeVisible();
  await picker.click();

  // 选 Admin User (member 组, 从 /workspaces/:id/members 拿到).
  // 故意避 agent, 因为分派 agent 会触发 RunConfirmModal 走不同分支.
  await authedPage.getByRole("menuitem", { name: "Admin User" }).click();

  // UI 反映
  await expect(picker.locator(".loop-assignee-name")).toHaveText("Admin User");
});
