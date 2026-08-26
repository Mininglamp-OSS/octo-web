import { test, expect } from "../../fixtures-authed";
import { registerGS1GlobalSearchResults } from "../../msw-handlers/gs1-global-search-results";

test("@GS1 @p1 @search @global-search 全局搜索消息与联系人", async ({ authedPage }) => {
  await registerGS1GlobalSearchResults(authedPage);
  await authedPage.getByTestId("chat-global-search-entry").click();
  const search = authedPage.getByPlaceholder("搜索联系人、群组、聊天或文件");
  await expect(search).toBeVisible();
  await search.fill("E2E 全局搜索");

  await authedPage.getByRole("button", { name: "聊天" }).click();
  await authedPage.getByText("GS1 群聊", { exact: true }).click();
  await expect(authedPage.getByText("E2E 全局搜索消息", { exact: true })).toBeVisible({ timeout: 10_000 });
  await authedPage.getByRole("button", { name: "联系人" }).click();
  await expect(authedPage.getByText("E2E 全局搜索消息", { exact: true })).toBeHidden();
  await expect(authedPage.getByText("GS1 联系人", { exact: true })).toBeVisible();
  await authedPage.getByRole("button", { name: "文件" }).click();
  await expect(authedPage.getByText("GS1 联系人", { exact: true })).toBeHidden();
  await expect(authedPage.getByText("GS1 文件.pdf", { exact: true })).toBeVisible();
  await expect(search).toHaveValue("E2E 全局搜索");
});
