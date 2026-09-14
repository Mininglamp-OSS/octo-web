import { expect, test } from "@playwright/test";

for (const locale of ["en-US", "zh-CN"]) {
  for (const width of [764, 804, 836, 1120]) {
    test(`Windows version header stays readable at ${width}px in ${locale}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 700 });
      await page.goto(`/e2e-kit/fixtures/desktop-summary-version.html?locale=${locale}`);
      const header = page.locator(".version-panel__header");
      await expect(header).toHaveAttribute("data-desktop-header");
      await expect(header).toHaveCSS("--desktop-safe-right", "138px");
      await expect.poll(() => header.evaluate(element => {
        const rect = element.getBoundingClientRect();
        const heading = element.querySelector("h2")!.getBoundingClientRect();
        const hint = element.querySelector(".version-panel__heading span")!.getBoundingClientRect();
        const close = element.querySelector("button")!.getBoundingClientRect();
        return heading.width >= 130 && heading.height <= 25 &&
          heading.top >= 48 && close.top >= 48 && hint.bottom <= rect.bottom &&
          close.right <= innerWidth && rect.height <= 120 &&
          document.documentElement.scrollWidth <= innerWidth;
      })).toBe(true);
      await page.screenshot({ path: testInfo.outputPath("version-header.png") });
      await header.locator("button").click();
      await expect(page.getByTestId("action")).toHaveText("close");
      await expect(page.getByTestId("summary-version-panel")).toHaveCount(0);
      await page.getByRole("button", { name: "Open versions" }).click();
      await expect(header).toHaveCSS("padding-right", "12px");
      await page.getByTestId("summary-version-card-1").click();
      await page.getByTestId("summary-version-restore-btn").click();
      await expect(page.getByTestId("action")).toHaveText("restore");
    });
  }
}

test("Windows clearance follows guest zoom and panel resizing", async ({ page }) => {
  await page.setViewportSize({ width: 836, height: 700 });
  await page.goto("/e2e-kit/fixtures/desktop-summary-version.html?zoom=1.5");
  const header = page.locator(".version-panel__header");
  await expect(header).toHaveCSS("padding-top", "36px");
  await expect(header).toHaveCSS("padding-right", "12px");
  await page.setViewportSize({ width: 1120, height: 700 });
  await expect(header).toHaveCSS("--desktop-safe-right", "92px");
  await expect(header).toHaveCSS("padding-top", "36px");
  await header.locator("button").click();
  await expect(page.getByTestId("action")).toHaveText("close");
});

for (const query of ["platform=darwin", "platform=win32&fullscreen"]) {
  test(`no extra top clearance without right-side controls (${query})`, async ({ page }) => {
    await page.setViewportSize({ width: 836, height: 700 });
    await page.goto(`/e2e-kit/fixtures/desktop-summary-version.html?${query}`);
    const header = page.locator(".version-panel__header");
    await expect(header).toHaveAttribute("data-desktop-header");
    await expect(header).toHaveCSS("--desktop-safe-right", "0px");
    await expect(header).toHaveCSS("padding-top", "4px");
    await header.locator("button").click();
    await expect(page.getByTestId("action")).toHaveText("close");
  });
}

for (const query of ["platform=web", "platform=win32&fallback"]) {
  test(`framed version header preserves its existing padding (${query})`, async ({ page }) => {
    await page.setViewportSize({ width: 1120, height: 700 });
    await page.goto(`/e2e-kit/fixtures/desktop-summary-version.html?${query}`);
    const header = page.locator(".version-panel__header");
    await expect(header).toBeVisible();
    await expect(header).not.toHaveAttribute("data-desktop-header");
    await expect(header).toHaveCSS("padding-top", "16px");
    await expect(header).toHaveCSS("padding-right", "20px");
    await header.locator("button").click();
    await expect(page.getByTestId("action")).toHaveText("close");
  });
}
