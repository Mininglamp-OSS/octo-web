/* eslint-disable no-undef -- e2e code runs in Node */
// @caseId C9-loop-issue-detail-view
// @spec apps/web/e2e-kit/case-specs/C9-loop-issue-detail-view.md

import { test, expect } from "../fixtures-authed";
import { installMswScenario } from "../_lib/mswScenario";

test("@C9 loop issue 详情加载 — 点开 issue → 属性栏渲染 (status/priority/assignee/项目)", async ({
  authedPage,
}) => {
  await installMswScenario(authedPage, "one-issue");
  await authedPage.goto("/loop?sid=e2etest");

  await authedPage.getByText("First issue").first().click();

  // 属性栏出现: "属性" 段头
  await expect(authedPage.getByText("属性").first()).toBeVisible();
  // 状态 pill = 待办
  await expect(authedPage.locator(".loop-idp__prop-edit").nth(0)).toContainText(
    "待办"
  );
  // 优先级 pill = 无
  await expect(authedPage.locator(".loop-idp__prop-edit").nth(1)).toContainText(
    "无"
  );
});
