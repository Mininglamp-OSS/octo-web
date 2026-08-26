// @caseId EX3-experts-market-empty-search
// @spec apps/web/e2e-kit/case-specs/experts/EX3-experts-market-empty-search.md

import { test, expect } from "../../fixtures-authed";

test("@EX3 @p1 @experts @market @empty Experts 市场无匹配空态", async ({ authedPage }) => {
  await authedPage.addInitScript(() => {
    sessionStorage.setItem("__e2e_scenario", "expert-market-empty");
  });
  await authedPage.goto("/mcp-market/experts?sid=e2etest");

  const releaseExpert = authedPage.getByRole("button", { name: "发布负责人" });
  const meetingExpert = authedPage.getByRole("button", { name: "会议协调专家" });
  await expect(releaseExpert).toBeVisible();
  await expect(meetingExpert).toBeVisible();

  await authedPage.getByRole("searchbox", { name: "搜索专家" }).fill("不存在");

  await expect(authedPage.getByText("没有找到匹配内容")).toBeVisible();
  await expect(authedPage.getByText("换一个关键词或清除分类筛选后再试。")).toBeVisible();
  await expect(authedPage.getByRole("button", { name: "清除筛选" })).toBeVisible();
  expect(await releaseExpert.count()).toBe(0);
  expect(await meetingExpert.count()).toBe(0);
  await expect(authedPage.getByText("加载失败，请稍后重试。")).not.toBeVisible();
});
