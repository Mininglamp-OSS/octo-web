/* eslint-disable no-undef -- e2e code runs in Node */
/** spec: e2e-kit/case-specs/search/GS3-global-search-file-filter.md */
import { test, expect } from "../../fixtures-authed";
import { registerGS3GlobalSearchFileFilter } from "../../msw-handlers/gs3-global-search-file-filter";

test("@GS3 @p1 @search @global-search @filter 全局搜索文件类型筛选与清空", async ({ authedPage }) => {
  await registerGS3GlobalSearchFileFilter(authedPage);
  await authedPage.getByTestId("chat-global-search-entry").click();
  const search = authedPage.getByPlaceholder("搜索联系人、群组、聊天或文件");
  await expect(search).toBeVisible();
  await search.fill("E2E 文件筛选");
  await authedPage.getByRole("button", { name: "文件" }).click();
  await expect(authedPage.getByText("GS3 文件.pdf", { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(authedPage.getByText("GS3 其它.txt", { exact: true })).toBeVisible();

  const filter = authedPage.getByRole("button", { name: "筛选" });
  await filter.click();
  const documentType = authedPage.getByRole("button", { name: "文档", exact: true });
  await expect(documentType).toBeVisible();
  await documentType.click();
  await expect(filter).toContainText("1");
  await expect(documentType).toHaveAttribute("aria-pressed", "true");
  await expect(authedPage.getByText("GS3 其它.txt", { exact: true })).toHaveCount(0);

  await authedPage.getByRole("button", { name: "重置" }).click();
  await expect(filter).not.toContainText("1");
  await expect(documentType).toHaveAttribute("aria-pressed", "false");
  await expect(authedPage.getByText("GS3 文件.pdf", { exact: true })).toBeVisible();
  await expect(authedPage.getByText("GS3 其它.txt", { exact: true })).toBeVisible();
});
