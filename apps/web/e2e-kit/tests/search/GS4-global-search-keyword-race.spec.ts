/* eslint-disable no-undef -- e2e code runs in Node */
/** spec: e2e-kit/case-specs/search/GS4-global-search-keyword-race.md */
import { test, expect } from "../../fixtures-authed";
import { registerGS4GlobalSearchKeywordRace } from "../../msw-handlers/gs4-global-search-keyword-race";

test("@GS4 @p1 @search @global-search @race 全局搜索新关键词覆盖旧请求", async ({ authedPage }) => {
  await registerGS4GlobalSearchKeywordRace(authedPage);
  await authedPage.getByTestId("chat-global-search-entry").click();
  const search = authedPage.getByPlaceholder("搜索联系人、群组、聊天或文件");
  await expect(search).toBeVisible();

  await search.fill("E2E 旧关键词");
  await authedPage.waitForTimeout(450);
  await search.fill("E2E 新关键词");

  await expect(search).toHaveValue("E2E 新关键词");
  await expect(authedPage.getByText("GS4 新结果", { exact: true })).toBeVisible({ timeout: 10_000 });
  // The old response is intentionally delayed by 900 ms. Let it arrive before
  // asserting that the requestId guard keeps it from replacing the new result.
  await authedPage.waitForTimeout(1_000);
  await expect(authedPage.getByText("GS4 旧结果", { exact: true })).toHaveCount(0);
  await expect(authedPage.getByText("GS4 新结果", { exact: true })).toBeVisible();
});
