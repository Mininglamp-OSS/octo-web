// @caseId MY1-my-publications-scroll
// @spec apps/web/e2e-kit/case-specs/market/MY1-my-publications-scroll.md
// Regression for octo-marketplace#85: shared personal-asset tables must not
// shrink/clip their rows inside the skill list's column flexbox.
import { test, expect } from "../../fixtures-authed";
import { registerMyPublicationsScroll } from "../../msw-handlers/my-publications-scroll";

for (const viewport of [{ width: 1280, height: 720 }, { width: 900, height: 520 }]) {
  for (const type of ["skills", "mcp", "experts", "squads"]) {
    test(`@MY1 @market My publications wheel scrolling: ${type} ${viewport.width}`, async ({ authedPage: page }, testInfo) => {
      await page.setViewportSize(viewport);
      await registerMyPublicationsScroll(page);
      await page.goto(`/mcp-market/mine?type=${type}&sid=e2etest`);
      const content = page.locator(type === "skills" ? ".skill-market-content" : type === "mcp" ? ".wk-mcp__body" : ".wk-mcp-expert-content");
      const table = page.getByRole("table");
      await expect(page.locator(".wk-mine-table__row")).toHaveCount(16);

      // A wheel over actual rows must move the page scroller. Programmatic
      // scrollIntoView would incorrectly pass even when overflow:hidden clips it.
      const box = (await content.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.wheel(0, 450);
      await expect.poll(() => content.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
      await page.mouse.wheel(0, 20000);
      await expect.poll(() => content.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThanOrEqual(1);

      // Horizontal wheel input must expose action columns in a narrow pane.
      const overflows = await table.evaluate((el) => el.scrollWidth > el.clientWidth);
      if (overflows) {
        await page.mouse.wheel(20000, 0);
        await expect.poll(() => table.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
      }
      const lastRow = page.getByRole("row", { name: "Scroll asset 16", exact: true });
      const lastDelete = lastRow.getByRole("button", { name: "删除「Scroll asset 16」", exact: true });
      const tableWidth = await table.evaluate((el) => el.scrollWidth);
      expect(await lastRow.evaluate((el) => el.clientWidth)).toBeGreaterThanOrEqual(tableWidth - 1);
      await expect(lastDelete).toBeInViewport();
      await page.screenshot({ path: testInfo.outputPath(`mine-${type}-${viewport.width}.png`) });

      // Cancel a real dialog without mutating data; scrolling must still work.
      await lastDelete.click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: "取消", exact: true }).click();
      await expect(dialog).not.toBeVisible();
      const before = await content.evaluate((el) => el.scrollTop);
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      // Small deltas also exercise the smooth input pattern of a trackpad.
      for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -35);
      await expect.poll(() => content.evaluate((el) => el.scrollTop)).toBeLessThan(before);
      await page.mouse.wheel(0, -20000);
      await expect.poll(() => content.evaluate((el) => el.scrollTop)).toBe(0);
    });
  }
}
