import { expect, test } from "@playwright/test";
import { openSummaryFixture, summaryFixture as fixture } from "./summary-fixture";

for (const platform of ["darwin", "win32", "web"]) {
  test(`${platform}: reference stays below the header without a resolvable CSS anchor`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1200, height: 800 });
    await openSummaryFixture(page, `${fixture}?platform=${platform}&width=700&standalone&locale=en-US`);
    await page.addStyleTag({ content: "#root .wk-summary-workbench__header { anchor-name: none; }" });
    await expect(page.locator(".wk-summary-workbench__header")).toHaveCSS("anchor-name", "none");
    const input = page.locator(".wk-summary-workbench textarea");
    await input.fill("Keep this draft without CSS anchors");
    await page.getByRole("button", { name: "Reference summary", exact: true }).click();
    await page.locator(".summary-reference-picker-item").click();
    const reference = page.getByTestId("summary-agent-ref-side-panel");
    await expect(reference).toBeVisible();
    for (const width of [1200, 390, 800]) {
      await page.setViewportSize({ width, height: 600 });
      await expect.poll(() => reference.evaluate(element => {
        const rect = element.getBoundingClientRect();
        const header = document.querySelector(".wk-summary-workbench__header")!.getBoundingClientRect();
        return rect.top >= header.bottom - 1 && rect.bottom <= innerHeight + 1;
      })).toBe(true);
    }
    await page.screenshot({ path: testInfo.outputPath("reference-without-anchors.png"), animations: "disabled" });
    await page.getByTestId("summary-agent-ref-side-close-btn").click();
    await expect(input).toHaveValue("Keep this draft without CSS anchors");
  });
}
