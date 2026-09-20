import { expect, test, type Page } from "@playwright/test";

const topHeader = (page: Page) => page.locator("#wk-viewqueue-view-last .wk-viewqueueheader");

async function expectBackGeometry(page: Page, platform: string, fullScreen = false) {
  const header = topHeader(page);
  if (platform === "web") {
    await expect(header).not.toHaveAttribute("data-desktop-header");
  } else {
    await expect(header).toHaveAttribute("data-desktop-header");
  }
  // Browser clicks alone do not exercise Electron's native drag hit testing.
  // Keep the no-drag control INSIDE the drag layout that used to cover it.
  await expect(header.locator('[data-desktop-chrome="layout"] > .wk-viewqueueheader-back')).toHaveCount(1);
  await expect.poll(() => header.evaluate((element, { platform, fullScreen }) => {
    const back = element.querySelector<HTMLElement>(".wk-viewqueueheader-back")!;
    const title = element.querySelector<HTMLElement>(".wk-viewqueueheader-content-title")!;
    const bounds = element.getBoundingClientRect();
    const button = back.getBoundingClientRect();
    const titleBounds = title.getBoundingClientRect();
    const inset = platform === "darwin" && !fullScreen ? Math.max(0, 96 - bounds.left) : 0;
    const hit = document.elementFromPoint(button.left + button.width / 2, button.top + button.height / 2);
    const image = back.querySelector("img")!;
    return {
      anchored: Math.abs(button.left - bounds.left - inset) < 1 && Math.abs(button.top - bounds.top) < 1,
      fits: button.right <= titleBounds.left && button.bottom <= bounds.bottom + 1,
      hit: back.contains(hit),
      image: image.complete && image.naturalWidth > 0,
      noOverflow: document.documentElement.scrollWidth <= innerWidth,
    };
  }, { platform, fullScreen })).toEqual({
    anchored: true, fits: true, hit: true, image: true, noOverflow: true,
  });
}

async function openQrCode(page: Page, platform: string, fullScreen = false) {
  await page.getByRole("button", { name: "Add friend", exact: true }).click();
  await expect(page.getByTestId("route-depth")).toHaveText("1");
  await expect(page.locator(".wk-viewqueue-view-in")).toHaveCount(0);
  await expectBackGeometry(page, platform, fullScreen);
  await page.locator(".wk-friendadd-content-qrcode img").click();
  await expect(page.getByTestId("route-depth")).toHaveText("2");
  await expect(page.locator(".wk-viewqueue-view-in")).toHaveCount(0);
  await expect(page.locator(".wk-qrcodemy-content-qrcode svg")).toBeVisible();
  await expectBackGeometry(page, platform, fullScreen);
}

async function returnToMessages(page: Page, platform: string, fullScreen = false) {
  await topHeader(page).locator(".wk-viewqueueheader-back").click();
  await expect(page.locator(".wk-qrcodemy")).toHaveCount(0);
  await expect(page.getByTestId("route-depth")).toHaveText("1");
  await expectBackGeometry(page, platform, fullScreen);
  await topHeader(page).locator(".wk-viewqueueheader-back").click();
  await expect(page.locator(".wk-friendadd")).toHaveCount(0);
  await expect(page.getByTestId("route-depth")).toHaveText("0");
  await expect(page.locator(".wk-viewqueue-view")).toHaveCount(1);
}

for (const platform of ["darwin", "win32", "web"]) {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1120, height: 760 }, { width: 900, height: 700 }, { width: 760, height: 800 }]) {
    test(`${platform}: friend and QR pages return at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.setViewportSize(viewport);
      await page.goto(`/e2e-kit/fixtures/desktop-viewqueue.html?platform=${platform}`);
      await openQrCode(page, platform);
      await page.screenshot({ path: testInfo.outputPath("qr-header.png") });
      await returnToMessages(page, platform);
      expect(errors).toEqual([]);
    });
  }
}

for (const platform of ["darwin", "win32"]) {
  test(`${platform}: fullscreen dark headers return with no native control inset`, async ({ page }) => {
    await page.setViewportSize({ width: 1120, height: 760 });
    await page.goto(`/e2e-kit/fixtures/desktop-viewqueue.html?platform=${platform}&theme=dark&fullscreen`);
    await openQrCode(page, platform, true);
    await expect(topHeader(page).locator(".wk-viewqueueheader-back img")).toHaveAttribute("src", /nav_back_dark/);
    await returnToMessages(page, platform, true);
  });
}
