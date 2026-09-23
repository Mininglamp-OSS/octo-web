import { test, expect } from "../../fixtures-authed";
import type { Page } from "@playwright/test";
import { registerGS1GlobalSearchResults } from "../../msw-handlers/gs1-global-search-results";

async function expectAvatarAlignedWithSearchChrome(page: Page, itemSelector: string) {
  const item = page.locator(itemSelector).first();
  const avatar = item.locator(".wk-avatar");
  const inputWrap = page.locator(".wk-search-workspace__input-wrap");
  const firstTab = page.locator(".wk-search-workspace__tabs button").first();

  await expect(item).toBeVisible();
  await expect(avatar).toBeVisible();
  await expect(inputWrap).toBeVisible();
  await expect(firstTab).toBeVisible();

  await expect.poll(async () => {
    const [avatarBox, inputBox, tabBox] = await Promise.all([
      avatar.boundingBox(),
      inputWrap.boundingBox(),
      firstTab.boundingBox(),
    ]);
    if (!avatarBox || !inputBox || !tabBox) return false;
    return Math.abs(avatarBox.x - inputBox.x) <= 1 &&
      Math.abs(avatarBox.x - tabBox.x) <= 1;
  }).toBe(true);
}

for (const { theme, width, height } of [
  { theme: "light", width: 1280, height: 800 },
  { theme: "dark", width: 1280, height: 800 },
  { theme: "light", width: 768, height: 800 },
  { theme: "dark", width: 768, height: 800 },
] as const) {
  test(`@GS1 @p1 @search @global-search 全局搜索消息、联系人与群组 ${theme} ${width}x${height}`, async ({ authedPage }, testInfo) => {
    await authedPage.setViewportSize({ width, height });
    if (theme === "dark") {
      await authedPage.evaluate(() => document.body.setAttribute("theme-mode", "dark"));
    }
    await registerGS1GlobalSearchResults(authedPage);
    await authedPage.getByTestId("chat-global-search-entry").click();
    const search = authedPage.getByPlaceholder("搜索联系人、群组、聊天或文件");
    await expect(search).toBeVisible();
    await search.fill("E2E 全局搜索");

    await authedPage.getByRole("button", { name: "聊天" }).click();
    await authedPage.locator(".wk-global-chat-search-layout__conversation")
      .filter({ hasText: "GS1 群聊" }).click();
    await expect(authedPage.getByText("E2E 全局搜索消息", { exact: true })).toBeVisible({ timeout: 10_000 });
    await authedPage.getByRole("button", { name: "联系人" }).click();
    await expect(authedPage.getByText("E2E 全局搜索消息", { exact: true })).toBeHidden();
    await expect(authedPage.getByText("GS1 联系人", { exact: true })).toBeVisible();
    await expectAvatarAlignedWithSearchChrome(authedPage, ".wk-item-contacts");
    await testInfo.attach("global-search-contacts", {
      body: await authedPage.screenshot(),
      contentType: "image/png",
    });
    await authedPage.getByRole("button", { name: "群组" }).click();
    await expect(authedPage.locator(".wk-item-contacts")).toBeHidden();
    await expect(authedPage.locator(".wk-item-group")).toBeVisible();
    await expectAvatarAlignedWithSearchChrome(authedPage, ".wk-item-group");
    await authedPage.getByRole("button", { name: "文件" }).click();
    await expect(authedPage.locator(".wk-item-group")).toBeHidden();
    await expect(authedPage.getByText("GS1 文件.pdf", { exact: true })).toBeVisible();
    await expect(search).toHaveValue("E2E 全局搜索");
  });
}
