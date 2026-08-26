// @caseId EX5-experts-market-load-error
// @spec apps/web/e2e-kit/case-specs/experts/EX5-experts-market-load-error.md

import { test, expect } from "../../fixtures-authed";

test("@EX5 @p1 @experts @market @error Experts 市场加载失败", async ({ authedPage }) => {
  await authedPage.addInitScript(() => {
    sessionStorage.setItem("__e2e_scenario", "expert-market-error");
  });
  await authedPage.goto("/mcp-market/experts?sid=e2etest");

  await expect(authedPage.getByText("服务暂时不可用，请稍后重试")).toBeVisible();
  await expect(authedPage.getByRole("button", { name: "重试" })).toBeVisible();
  expect(await authedPage.getByRole("button", { name: "发布负责人" }).count()).toBe(0);
  expect(await authedPage.getByText(/共 .* 个/).count()).toBe(0);
  await expect(authedPage.getByText("没有找到匹配内容")).not.toBeVisible();
});
