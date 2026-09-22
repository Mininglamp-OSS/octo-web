import { expect, test } from "@playwright/test";
import { openSummaryFixture, summaryFixture as fixture } from "./summary-fixture";

for (const platform of ["darwin", "win32"]) {
  test(`${platform}: Client conversation shell restores split Summary at wide sizes`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1000, height: 800 });
    await page.addInitScript(() => localStorage.setItem("wk-layout-left-width", "360"));
    await openSummaryFixture(page, `${fixture}?platform=${platform}&width=700&host-preview&client-shell&locale=en-US`);
    await expect(page.locator(".wk-layout-content-left")).toBeHidden();
    await page.getByTestId("fixture-summary-open").click();
    const chat = page.locator(".wk-chat-content-right");
    const panel = page.locator(".wk-summary-panel");
    const conversation = page.locator(".wk-chat-content-chat");
    const input = panel.locator("textarea");
    await input.fill("Keep my draft as the Client grows");
    await expect(chat).toHaveAttribute("data-chat-panel-layout", "split");
    await expect(panel).toHaveCSS("width", "568px");
    await expect(conversation).toBeVisible();

    for (const width of [1600, 900, 752, 751, 600, 390, 1000, 1600]) {
      await page.setViewportSize({ width, height: 800 });
      const split = width >= 752;
      await expect(chat).toHaveAttribute("data-chat-panel-layout", split ? "split" : "overlay");
      await expect(input).toHaveValue("Keep my draft as the Client grows");
      if (split) {
        await expect(conversation).toBeVisible();
        await expect(page.locator(".wk-thread-panel-splitter")).toBeVisible();
        await expect.poll(() => panel.evaluate(element =>
          element.getBoundingClientRect().width,
        )).toBe(Math.min(700, width - 432));
        await expect.poll(() => conversation.evaluate(element =>
          element.getBoundingClientRect().width,
        )).toBeGreaterThanOrEqual(432);
      } else {
        await expect(conversation).toBeHidden();
        await expect(panel).toHaveCSS("width", `${width}px`);
      }
    }
    await page.screenshot({ path: testInfo.outputPath("client-wide-summary-split.png"), animations: "disabled" });
    expect(await page.evaluate(() => localStorage.getItem("wk-layout-left-width"))).toBe("360");
    expect(await page.evaluate(() => localStorage.getItem("wk-summary-panel-width"))).toBe("700");
  });
}

test("Client presentation changes only reserve the Web list when it is displayed", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 800 });
  await openSummaryFixture(page, `${fixture}?platform=web&width=700&host-preview&client-shell&locale=en-US`);
  await page.getByTestId("fixture-summary-open").click();
  const chat = page.locator(".wk-chat-content-right");
  const input = page.locator(".wk-summary-panel textarea");
  await input.fill("Keep the same draft when navigation changes");
  await expect(chat).toHaveAttribute("data-chat-panel-layout", "split");
  await page.getByTestId("fixture-presentation").click();
  await expect(page.locator(".wk-layout-content-left")).toBeVisible();
  await expect(chat).toHaveAttribute("data-chat-panel-layout", "overlay");
  await page.getByTestId("fixture-presentation").click();
  await expect(page.locator(".wk-layout-content-left")).toBeHidden();
  await expect(chat).toHaveAttribute("data-chat-panel-layout", "split");
  await expect(input).toHaveValue("Keep the same draft when navigation changes");
});
