import { expect, test } from "@playwright/test";

for (const platform of ["darwin", "win32"]) {
  test(`${platform}: toast portals pause header dragging until the final close`, async ({ page }) => {
    await page.setViewportSize({ width: 1120, height: 760 });
    await page.goto(`/e2e-kit/fixtures/desktop-toast.html?platform=${platform}`);
    const root = page.locator("#root");
    const header = page.locator("[data-desktop-header]");
    const toasts = page.getByRole("alert").filter({ hasText: "Voice input is disabled" });
    await expect(page.getByTestId("inline-alert")).toBeVisible();
    await expect(header).toHaveCSS("-webkit-app-region", "drag");
    await expect(root).toHaveAttribute("data-desktop-drag-suspended", "false");

    await page.getByRole("button", { name: "Show toast", exact: true }).click();
    await expect(toasts).toHaveCount(1);
    await expect(root).toHaveAttribute("data-desktop-drag-suspended", "true");
    await expect(header).toHaveCSS("-webkit-app-region", "no-drag");
    expect(await toasts.first().evaluate(element => !document.getElementById("root")!.contains(element))).toBe(true);
    // Browser clicks bypass native drag hit testing; assert the close actually overlaps the header.
    const close = toasts.first().getByRole("button", { name: "close" });
    const [closeBox, headerBox] = await Promise.all([close.boundingBox(), header.boundingBox()]);
    expect(closeBox!.y + closeBox!.height / 2).toBeLessThan(headerBox!.height);

    await page.getByRole("button", { name: "Show toast", exact: true }).click();
    await expect(toasts).toHaveCount(2);
    await toasts.first().getByRole("button", { name: "close" }).click();
    await expect(toasts).toHaveCount(1);
    await expect(page.getByTestId("closed-count")).toHaveText("1");
    await expect(header).toHaveCSS("-webkit-app-region", "no-drag");
    await toasts.getByRole("button", { name: "close" }).click();
    await expect(toasts).toHaveCount(0);
    await expect(page.getByTestId("closed-count")).toHaveText("2");
    await expect(root).toHaveAttribute("data-desktop-drag-suspended", "false");
    await expect(header).toHaveCSS("-webkit-app-region", "drag");
    await expect(page.getByTestId("inline-alert")).toBeVisible();
  });

  test(`${platform}: automatic toast dismissal restores dragging`, async ({ page }) => {
    await page.goto(`/e2e-kit/fixtures/desktop-toast.html?platform=${platform}`);
    const root = page.locator("#root");
    await expect(root).toHaveAttribute("data-desktop-drag-suspended", "false");
    await page.getByRole("button", { name: "Auto-dismiss toast" }).click();
    await expect(root).toHaveAttribute("data-desktop-drag-suspended", "true");
    await expect(page.getByTestId("closed-count")).toHaveText("1");
    await expect(root).toHaveAttribute("data-desktop-drag-suspended", "false");
    await expect(page.locator("[data-desktop-header]")).toHaveCSS("-webkit-app-region", "drag");
  });

  test(`${platform}: notifications share the portal alert protection`, async ({ page }) => {
    await page.goto(`/e2e-kit/fixtures/desktop-toast.html?platform=${platform}`);
    const root = page.locator("#root");
    await expect(root).toHaveAttribute("data-desktop-drag-suspended", "false");
    await page.getByRole("button", { name: "Show notification" }).click();
    const notification = page.getByRole("alert").filter({ hasText: "Enable voice input in settings." });
    await expect(notification).toBeVisible();
    await expect(root).toHaveAttribute("data-desktop-drag-suspended", "true");
    await notification.getByRole("button", { name: "close" }).click();
    await expect(notification).toHaveCount(0);
    await expect(page.getByTestId("closed-count")).toHaveText("1");
    await expect(root).toHaveAttribute("data-desktop-drag-suspended", "false");
  });
}

test("browser entry does not install the desktop drag guard", async ({ page }) => {
  await page.goto("/e2e-kit/fixtures/desktop-toast.html?platform=web");
  await page.getByRole("button", { name: "Show toast", exact: true }).click();
  const toast = page.getByRole("alert").filter({ hasText: "Voice input is disabled" });
  await expect(toast).toBeVisible();
  await expect(page.locator("#root")).not.toHaveAttribute("data-desktop-drag-suspended");
  await toast.getByRole("button", { name: "close" }).click();
  await expect(toast).toHaveCount(0);
  await expect(page.getByTestId("closed-count")).toHaveText("1");
});
