import { expect, test } from "@playwright/test";

for (const platform of ["win32", "darwin"]) {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1120, height: 760 }, { width: 900, height: 700 }, { width: 760, height: 800 }]) {
    for (const panelWidth of [360, 432]) {
      test(`${platform} header fits ${panelWidth}px panel in ${viewport.width}px viewport`, async ({ page }, testInfo) => {
        const errors: string[] = [];
        page.on("pageerror", error => errors.push(error.message));
        await page.setViewportSize(viewport);
        await page.goto(`/e2e-kit/fixtures/desktop-header.html?platform=${platform}&width=${panelWidth}`);
        const header = page.locator(".wk-file-preview-header");
        await expect(header).toHaveAttribute("data-desktop-header");
        await expect.poll(() => header.evaluate(element => {
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          const left = rect.left + parseFloat(style.paddingLeft);
          const right = rect.right - parseFloat(style.paddingRight);
          const buttons = [...element.querySelectorAll("button")].map(button => ({
            rect: button.getBoundingClientRect(), button,
          }));
          return buttons.length === 9 && buttons.every(({ rect: box, button }) =>
            box.width > 0 && box.height > 0 &&
            box.left >= left - 1 && box.right <= right + 1 &&
            box.top >= rect.top && box.bottom <= rect.bottom &&
            button.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2))
          ) && document.documentElement.scrollWidth <= innerWidth;
        })).toBe(true);
        await expect(header).toHaveCSS("padding-right", platform === "win32" ? "150px" : "12px");
        await expect(page.locator(".wk-file-preview-header__view-toggle")).toBeVisible();
        const actions = header.locator(".wk-file-preview-header__actions button");
        for (const [index, action] of ["preview", "source", "toc", "external", "reply", "download", "close"].entries()) {
          await actions.nth(index).click();
          await expect(page.getByTestId("action")).toHaveText(action);
        }
        await header.locator(".wk-file-preview-header__btn--back").click();
        await expect(page.getByTestId("action")).toHaveText("back");
        await header.locator(".wk-file-preview-header__dropdown-btn").click();
        await expect(page.getByTestId("action")).toHaveText("files");
        expect(errors).toEqual([]);
        await page.screenshot({ path: testInfo.outputPath("header.png") });
      });
    }
  }
}

test("zoomed Windows header grows for its controls without clipping the second row", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 700 });
  await page.goto("/e2e-kit/fixtures/desktop-header.html?platform=win32&width=360&zoom=1.5");
  const header = page.locator(".wk-file-preview-header");
  await expect(header).toHaveAttribute("data-desktop-header");
  await expect(header).toHaveCSS("padding-right", "104px");
  await expect.poll(() => header.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return [...element.querySelectorAll("button")].every(button => {
      const box = button.getBoundingClientRect();
      return box.height > 0 && box.top >= rect.top && box.bottom <= rect.bottom &&
        box.right <= rect.right - 104;
    });
  })).toBe(true);
  await header.locator(".wk-file-preview-header__btn--close").click();
  await expect(page.getByTestId("action")).toHaveText("close");
});

test("browser entry keeps its original header styles and actions", async ({ page }) => {
  await page.setViewportSize({ width: 1120, height: 760 });
  await page.goto("/e2e-kit/fixtures/desktop-header.html?platform=web&width=600");
  const header = page.locator(".wk-file-preview-header");
  await expect(header).toBeVisible();
  await expect(header).not.toHaveAttribute("data-desktop-header");
  await expect(page.locator("#root")).not.toHaveAttribute("data-desktop-platform");
  await expect(header).toHaveCSS("height", "48px");
  await expect(header).toHaveCSS("padding-right", "16px");
  await expect(header.locator(".wk-file-preview-header__actions")).toHaveCSS("gap", "16px");
  await header.locator(".wk-file-preview-header__btn--close").click();
  await expect(page.getByTestId("action")).toHaveText("close");
});
