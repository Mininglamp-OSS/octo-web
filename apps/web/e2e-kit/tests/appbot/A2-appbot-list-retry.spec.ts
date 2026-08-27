import { test, expect } from "../../fixtures-authed";
import { registerA2AppbotListRetry } from "../../msw-handlers/a2-appbot-list-retry";

test("@A2 @p1 @appbot @appbot-retry 应用列表加载失败后可重试", async ({ authedPage }) => {
  await registerA2AppbotListRetry(authedPage);
  await authedPage.getByRole("button", { name: "应用", exact: true }).click();
  await expect(authedPage.getByTestId("appbot-page-title")).toHaveText("应用");
  await expect(authedPage.getByText("加载失败", { exact: true })).toBeVisible();
  await authedPage.evaluate(() => { (globalThis as { __a2RetryRequested?: boolean }).__a2RetryRequested = true; });
  await authedPage.getByRole("button", { name: "重试", exact: true }).click();
  await expect(authedPage.getByText("文档助手", { exact: true })).toBeVisible();
  await expect(authedPage.getByText("加载失败", { exact: true })).toHaveCount(0);
});
