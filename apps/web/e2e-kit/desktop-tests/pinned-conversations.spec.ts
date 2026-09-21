import { expect, test, type Locator } from "@playwright/test";

async function backgroundToken(row: Locator, token: string) {
  return row.evaluate((element, name) => {
    const probe = document.createElement("span");
    probe.style.backgroundColor = `var(${name})`;
    element.appendChild(probe);
    const color = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return color;
  }, token);
}

for (const platform of ["darwin", "win32", "web"]) {
  for (const theme of ["light", "dark"]) {
    test(`${platform} ${theme}: pinned tint yields to hover and selection`, async ({ page }) => {
      await page.goto(`/e2e-kit/fixtures/desktop-pinned-conversations.html?platform=${platform}&theme=${theme}`);
      const pinned = page.getByTestId("pinned");
      const regular = page.getByTestId("regular");
      const selected = page.getByTestId("selected");
      const pinnedSelected = page.getByTestId("pinned-selected");
      await expect(page.locator("body")).toHaveAttribute("theme-mode", theme);
      await expect(pinned).toBeVisible();
      const tint = await backgroundToken(pinned, "--wk-brand-tint-03");
      const hover = await backgroundToken(pinned, "--wk-bg-item-hover");
      const selection = await backgroundToken(pinned, "--wk-brand-tint-06");

      expect(new Set([tint, hover, selection, "rgba(0, 0, 0, 0)"]).size).toBe(4);
      await expect(pinned).toHaveCSS("background-color", tint);
      await expect(regular).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      await expect(page.getByTestId("follow")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      await expect(pinnedSelected).toHaveCSS("background-color", selection);
      await expect(selected).toHaveCSS("background-color", selection);

      await pinned.hover();
      await expect(pinned).toHaveCSS("background-color", hover);
      await pinnedSelected.hover();
      await expect(pinned).toHaveCSS("background-color", tint);
      await expect(pinnedSelected).toHaveCSS("background-color", selection);
      await regular.hover();
      await expect(regular).toHaveCSS("background-color", hover);
      await selected.hover();
      await expect(selected).toHaveCSS("background-color", selection);

      // Component tests cover pin/unpin wiring; exercise its CSS class transition here.
      await pinned.evaluate(element => element.classList.remove("wk-conversationlist-item-top"));
      await expect(pinned).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      await pinned.evaluate(element => element.classList.add("wk-conversationlist-item-top"));
      await expect(pinned).toHaveCSS("background-color", tint);
    });
  }
}

for (const theme of ["light", "dark"]) {
  for (const [width, height] of [[1440, 900], [1120, 760], [900, 700], [760, 800]]) {
    test(`${theme} ${width}x${height}: pinned row layout`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height });
      await page.goto(`/e2e-kit/fixtures/desktop-pinned-conversations.html?theme=${theme}`);
      const pinned = page.getByTestId("pinned");
      await expect(page.locator("body")).toHaveAttribute("theme-mode", theme);
      await expect(pinned).toHaveCSS("background-color", await backgroundToken(pinned, "--wk-brand-tint-03"));
      const rows = await page.locator(".wk-conversationlist-item").evaluateAll(elements =>
        elements.map(element => {
          const bounds = element.getBoundingClientRect();
          return { x: bounds.x, right: bounds.right, y: bounds.y, bottom: bounds.bottom };
        }),
      );
      rows.forEach((row, index) => {
        expect(row.x).toBeGreaterThanOrEqual(0);
        expect(row.right).toBeLessThanOrEqual(width);
        if (index > 0) expect(row.y).toBeGreaterThanOrEqual(rows[index - 1].bottom);
      });
      await page.screenshot({ path: testInfo.outputPath("pinned-conversations.png") });
    });
  }
}
