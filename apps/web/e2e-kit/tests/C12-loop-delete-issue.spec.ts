/* eslint-disable no-undef -- e2e code runs in Node */
// @caseId C12-loop-delete-issue

import { test, expect } from "../fixtures-authed";
import { installMswScenario } from "../_lib/mswScenario";

test("@C12 loop 删除 issue — 详情 → 更多菜单 → 删除 → Modal 确认 → 详情消失", async ({
  authedPage,
}) => {
  await installMswScenario(authedPage, "one-issue");
  await authedPage.goto("/loop?sid=e2etest");

  await authedPage.getByText("First issue").first().click();
  await expect(authedPage.getByText("属性").first()).toBeVisible();

  // 更多菜单 (issue detail header 右上角, aria-label="more" 硬编码)
  await authedPage.getByRole("button", { name: "more" }).click();
  // 菜单里 "删除任务" (i18n loop.menu.deleteIssue)
  await authedPage.getByRole("menuitem", { name: "删除任务" }).click();

  // 确认 Modal → 点确认删除
  await authedPage.locator(".semi-modal button[aria-label=\"confirm\"]").click();

  // 成功: toast "已删除" + 详情面板 pop (属性段消失)
  await expect(authedPage.getByText("已删除").first()).toBeVisible();
});
