/* eslint-disable no-undef -- e2e code runs in Node */
/**
 * spec: e2e-kit/case-specs/search/GS2-global-search-failure-retry.md
 *
 * GS2: 全局搜索失败后重新搜索恢复.
 */
import { test, expect } from "../../fixtures-authed";
import { registerGS2GlobalSearchFailureRetry } from "../../msw-handlers/gs2-global-search-failure-retry";

test("@GS2 @p1 @search @global-search @error-state 全局搜索失败后重新搜索恢复", async ({ authedPage }) => {
  await registerGS2GlobalSearchFailureRetry(authedPage);
  await authedPage.getByTestId("chat-global-search-entry").click();
  const search = authedPage.getByPlaceholder("搜索联系人、群组、聊天或文件");
  await expect(search).toBeVisible();

  await search.fill("E2E 搜索失败");
  await expect(authedPage.getByRole("alert")).toContainText("搜索失败，请稍后重试", { timeout: 10_000 });
  await expect(search).toBeVisible();

  await search.fill("E2E 搜索恢复");
  await expect(authedPage.getByText("GS2 恢复联系人", { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(authedPage.getByRole("alert")).toHaveCount(0);
});
