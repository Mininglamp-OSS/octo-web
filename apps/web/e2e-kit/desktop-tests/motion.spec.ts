import { expect, test } from "@playwright/test";

for (const target of ["overlay descendant", "header ancestor"]) {
  test(`an infinite ${target} animation does not keep desktop scans running`, async ({ page }) => {
    await page.goto("/e2e-kit/fixtures/desktop-header.html?platform=win32&width=360");
    await expect(page.locator(".wk-file-preview-header")).toHaveAttribute("data-desktop-header");
    const result = await page.evaluate(async target => {
      const root = document.getElementById("root")!;
      const panel = document.querySelector<HTMLElement>(".wk-file-preview-panel")!;
      panel.setAttribute("data-desktop-overlay", "");
      const spinner = document.createElement("span");
      panel.append(spinner);
      const animated = target === "header ancestor" ? panel : spinner;
      const style = document.createElement("style");
      style.textContent = "@keyframes fixture-loading { from { opacity: 1; } to { opacity: .99; } }";
      document.head.append(style);
      const started = new Promise(resolve => animated.addEventListener("animationstart", resolve, { once: true }));
      animated.style.animation = "fixture-loading 50ms linear infinite";
      await started;
      const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));
      await nextFrame();
      await nextFrame();

      let scans = 0;
      const queryDocument = document.querySelectorAll;
      const queryRoot = root.querySelectorAll;
      document.querySelectorAll = function(this: Document, selector: string) {
        scans++;
        return queryDocument.call(this, selector);
      } as typeof document.querySelectorAll;
      root.querySelectorAll = function(this: HTMLElement, selector: string) {
        scans++;
        return queryRoot.call(this, selector);
      } as typeof root.querySelectorAll;
      try {
        for (let frame = 0; frame < 30; frame++) await nextFrame();
        return {
          scans,
          suspended: root.dataset.desktopDragSuspended,
          infinite: animated.getAnimations().some(animation => animation.effect?.getComputedTiming().endTime === Infinity),
        };
      } finally {
        document.querySelectorAll = queryDocument;
        root.querySelectorAll = queryRoot;
      }
    }, target);
    expect(result).toEqual({ scans: 0, suspended: "true", infinite: true });
    await page.locator(".wk-file-preview-header__btn--close").click();
    await expect(page.getByTestId("action")).toHaveText("close");
    await page.locator(".wk-file-preview-panel").evaluate(panel => panel.setAttribute("hidden", ""));
    await expect(page.locator("#root")).toHaveAttribute("data-desktop-drag-suspended", "false");
  });
}

test("finite panel motion keeps Windows controls clear until the animation finishes", async ({ page }) => {
  await page.setViewportSize({ width: 1120, height: 760 });
  await page.goto("/e2e-kit/fixtures/desktop-header.html?platform=win32&width=360");
  const header = page.locator(".wk-file-preview-header");
  await expect(header).toHaveAttribute("data-desktop-header");
  const samples = await page.evaluate(async () => {
    const root = document.getElementById("root")!;
    const panel = document.querySelector<HTMLElement>(".wk-file-preview-panel")!;
    const header = panel.querySelector<HTMLElement>(".wk-file-preview-header")!;
    panel.setAttribute("data-desktop-overlay", "");
    const style = document.createElement("style");
    style.textContent = "@keyframes fixture-enter { from { transform: translateX(80px); } to { transform: translateX(0); } }";
    document.head.append(style);
    // Queue sampling after the adapter's earlier root listener schedules its frame.
    const started = new Promise(resolve => root.addEventListener("animationstart", resolve, { once: true }));
    panel.style.animation = "fixture-enter 400ms linear forwards";
    await started;
    const samples: { expected: number; actual: number; suspended: string | undefined }[] = [];
    const animation = panel.getAnimations().find(animation => "animationName" in animation && animation.animationName === "fixture-enter")!;
    while (animation.playState === "running") {
      await new Promise(resolve => requestAnimationFrame(resolve));
      samples.push({
        expected: header.getBoundingClientRect().right - (innerWidth - 138),
        actual: parseFloat(header.style.getPropertyValue("--desktop-safe-right")),
        suspended: root.dataset.desktopDragSuspended,
      });
    }
    return samples;
  });
  expect(samples.length).toBeGreaterThan(2);
  expect(samples.every(sample => sample.suspended === "true" && Math.abs(sample.expected - sample.actual) < 1)).toBe(true);
  expect(Math.max(...samples.map(sample => sample.actual))).toBeGreaterThan(160);
  await expect(header).toHaveCSS("--desktop-safe-right", "138px");
  await header.locator(".wk-file-preview-header__btn--close").click();
  await expect(page.getByTestId("action")).toHaveText("close");
});
