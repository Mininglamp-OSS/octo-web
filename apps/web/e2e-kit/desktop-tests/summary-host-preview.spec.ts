import { expect, test } from "@playwright/test";
import { openSummaryFixture, summaryFixture as fixture } from "./summary-fixture";

for (const platform of ["darwin", "win32"]) {
  test(`${platform}: summary-first native takeover hides the panel and restores its draft`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1200, height: 800 });
    await openSummaryFixture(page, `${fixture}?platform=${platform}&width=700&host-preview&locale=en-US`);
    await page.getByTestId("fixture-summary-open").click();
    const root = page.locator(".wk-chat-content-right");
    const panel = page.locator(".wk-summary-panel");
    const input = panel.locator("textarea");
    await expect(root).toHaveAttribute("data-chat-panel-layout", "split");
    await input.fill("Keep this summary draft across native preview");
    const originalInput = await input.elementHandle();

    await page.getByTestId("fixture-attachment").click();
    await expect(root).toHaveAttribute("data-chat-thread-hidden", "true");
    await expect(root).not.toHaveAttribute("data-chat-panel-layout");
    await expect(root).not.toHaveClass(/wk-chat-summary-panel-open/);
    await expect(panel).toHaveCount(1);
    await expect(panel).toBeHidden();
    await expect(panel).toHaveCSS("display", "none");
    await expect(page.getByRole("textbox", { name: "Conversation draft" })).toBeVisible();
    await expect.poll(() => root.evaluate(element =>
      element.querySelector(".wk-chat-content-chat")!.getBoundingClientRect().width === element.getBoundingClientRect().width,
    )).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("summary-hidden-during-preview.png"), animations: "disabled" });

    await page.setViewportSize({ width: 390, height: 600 });
    await expect(panel).toBeHidden();
    await page.getByTestId("fixture-preview-close").click();
    await expect(root).toHaveAttribute("data-chat-panel-layout", "overlay");
    await expect(panel).toBeVisible();
    await expect(input).toHaveValue("Keep this summary draft across native preview");
    expect(await input.evaluate((element, original) => element === original, originalInput)).toBe(true);
    await expect(page.locator(".wk-chat-content-chat")).toBeHidden();
    await page.setViewportSize({ width: 1200, height: 800 });
    await expect(root).toHaveAttribute("data-chat-panel-layout", "split");
    await expect(panel).toHaveCSS("width", "700px");
    await expect(input).toHaveValue("Keep this summary draft across native preview");
    await page.screenshot({ path: testInfo.outputPath("summary-restored-after-preview.png"), animations: "disabled" });
  });
}
