import { expect, test, type Page } from "@playwright/test";
import { openSummaryFixture, summaryFixture as fixture } from "./summary-fixture";

async function expectReadableWorkbench(page: Page) {
  await expect(page.locator(".chat-summary-template-card-select").first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>(".wk-summary-panel")!;
    const back = panel.querySelector(".wk-summary-panel-detail-back")!.getBoundingClientRect();
    const header = panel.querySelector(".wk-summary-workbench__header")!.getBoundingClientRect();
    const title = panel.querySelector(".wk-summary-workbench__header h1")!.getBoundingClientRect();
    const composer = panel.querySelector(".wk-summary-workbench__composer")!.getBoundingClientRect();
    const copy = panel.querySelector(".chat-summary-template-card-copy")!.getBoundingClientRect();
    return header.top >= back.bottom - 1 &&
      title.top >= header.top && title.bottom <= header.bottom &&
      title.height <= 28 && copy.width > 100 &&
      composer.height > 100 && composer.bottom <= panel.getBoundingClientRect().bottom + 1 &&
      panel.scrollWidth <= panel.clientWidth + 1;
  })).toBe(true);
}

for (const platform of ["darwin", "win32", "web"]) {
  for (const width of [320, 360, 480, 600, 720]) {
    test(`${platform}: real summary sidebar fits ${width}px in a wide viewport`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1440, height: 800 });
      await openSummaryFixture(page, `${fixture}?platform=${platform}&width=${width}`);
      await expectReadableWorkbench(page);
      const back = page.locator(".wk-summary-panel-detail-back");
      if (platform !== "web") {
        await expect(back).toHaveAttribute("data-desktop-header");
        await expect(page.locator(".wk-summary-workbench__header")).not.toHaveAttribute("data-desktop-header");
      } else {
        await expect(back).not.toHaveAttribute("data-desktop-header");
      }
      const columns = await page.locator(".wk-template-selector__grid").first().evaluate(element =>
        getComputedStyle(element).gridTemplateColumns.split(" ").length);
      expect(columns).toBe(width < 600 ? 1 : 2);
      if (width === 360) await page.screenshot({ path: testInfo.outputPath("summary-sidebar.png"), animations: "disabled" });
      await page.locator(".chat-summary-template-card-select").first().click();
      await expect(page.locator(".wk-summary-workbench textarea")).not.toHaveValue("");
      await page.getByTestId("summary-chat-panel-back-btn").click();
      await expect(page.getByTestId("summary-card-91")).toBeVisible();
    });
  }
}

for (const query of [
  "platform=darwin&width=700",
  "platform=win32&width=700&zoom=1.5&theme=dark",
  "platform=win32&width=700&fallback",
  "platform=web&width=700",
]) {
  test(`resizing and reference preview preserve the draft: ${query}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 800 });
    await openSummaryFixture(page, `${fixture}?${query}&locale=en-US`);
    await expectReadableWorkbench(page);
    const composer = page.locator(".wk-summary-workbench textarea");
    await composer.fill("Keep this draft while changing panel layout");
    await page.setViewportSize({ width: 800, height: 800 });
    await expect(page.locator(".wk-chat-content-right")).toHaveAttribute("data-chat-panel-layout", "split");
    await expect.poll(() => page.locator(".wk-chat-content-chat").evaluate(e => e.getBoundingClientRect().width)).toBeGreaterThanOrEqual(432);
    await page.setViewportSize({ width: 390, height: 600 });
    await expect(page.locator(".wk-chat-content-right")).toHaveAttribute("data-chat-panel-layout", "overlay");
    await expect(page.locator(".wk-chat-content-chat")).toBeHidden();
    await expect(page.locator(".wk-chat-content-chat")).toHaveCSS("width", "390px");
    await expect(page.locator(".wk-thread-panel-splitter")).toBeHidden();
    await expectReadableWorkbench(page);
    await page.getByRole("button", { name: "Reference summary", exact: true }).click();
    await page.locator(".summary-reference-picker-item").click();
    await expect(page.locator(".summary-reference-picker-modal")).toBeHidden();
    const reference = page.getByTestId("summary-agent-ref-side-panel");
    await expect(reference).toBeVisible();
    await expect(page.getByTestId("summary-agent-ref-side-body")).toContainText("Content remains readable");
    await expect.poll(() => reference.evaluate(element => {
      const rect = element.getBoundingClientRect();
      const main = document.querySelector(".wk-summary-workbench-feature__main")!.getBoundingClientRect();
      const header = document.querySelector(".wk-summary-workbench__header")!.getBoundingClientRect();
      return main.width >= 380 && rect.top >= header.bottom - 1 &&
        rect.width <= main.width && rect.bottom <= innerHeight + 1;
    })).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("narrow-reference.png"), animations: "disabled" });
    await page.getByTestId("summary-agent-ref-side-close-btn").click();
    await expect(composer).toHaveValue("Keep this draft while changing panel layout");
    await page.setViewportSize({ width: 1440, height: 800 });
    await expect.poll(() => page.locator(".wk-summary-panel").evaluate(e => e.getBoundingClientRect().width)).toBe(700);
    expect(await page.evaluate(() => localStorage.getItem("wk-summary-panel-width"))).toBe("700");
    await expect(composer).toHaveValue("Keep this draft while changing panel layout");
  });
}

test("history detail keeps its own return bar outside native caption controls", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 800 });
  await openSummaryFixture(page, `${fixture}?platform=win32&width=320&history`);
  await page.getByTestId("summary-card-91").click();
  await expect(page.getByTestId("summary-detail-page")).toBeVisible();
  const back = page.locator(".wk-summary-panel-detail-back");
  await expect(back).toHaveAttribute("data-desktop-header");
  await expect(page.locator(".summary-detail-title-row")).not.toHaveAttribute("data-desktop-header");
  await expect.poll(() => page.locator(".summary-detail-title-row").evaluate(element => {
    const back = document.querySelector(".wk-summary-panel-detail-back")!.getBoundingClientRect();
    return element.getBoundingClientRect().top >= back.bottom;
  })).toBe(true);
  await page.getByTestId("summary-chat-panel-back-btn").click();
  await expect(page.getByTestId("summary-card-91")).toBeVisible();
});

test("splitter continues from the visible width after resizing", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 800 });
  await openSummaryFixture(page, `${fixture}?platform=web&width=700`);
  await expectReadableWorkbench(page);
  const panel = page.locator(".wk-summary-panel");
  await expect(panel).toHaveCSS("width", "568px");
  const splitter = await page.locator(".wk-thread-panel-splitter").boundingBox();
  expect(splitter).not.toBeNull();
  const x = splitter!.x + splitter!.width / 2;
  const y = splitter!.y + 100;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 10, y);
  await page.mouse.up();
  await expect(panel).toHaveCSS("width", "558px");
  expect(await page.evaluate(() => localStorage.getItem("wk-summary-panel-width"))).toBe("558");
});

test("outward dragging at the container cap keeps the wider saved preference", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 800 });
  await openSummaryFixture(page, `${fixture}?platform=web&width=700`);
  await expectReadableWorkbench(page);
  const panel = page.locator(".wk-summary-panel");
  await expect(panel).toHaveCSS("width", "568px");
  const splitter = await page.locator(".wk-thread-panel-splitter").boundingBox();
  expect(splitter).not.toBeNull();
  const x = splitter!.x + splitter!.width / 2;
  const y = splitter!.y + 100;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 10, y);
  await page.mouse.move(x - 40, y);
  await page.mouse.up();
  await expect(panel).toHaveCSS("width", "568px");
  expect(await page.evaluate(() => localStorage.getItem("wk-summary-panel-width"))).toBe("700");
  await page.setViewportSize({ width: 1440, height: 800 });
  await expect(panel).toHaveCSS("width", "700px");
});

for (const platform of ["darwin", "win32", "web"]) {
  test(`${platform}: legacy templates and reference preview fit a narrow sidebar`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 800 });
    await openSummaryFixture(page, `${fixture}?platform=${platform}&width=320&legacy&locale=en-US`);
    await expect(page.locator(".chat-summary-template-card-select").first()).toBeVisible();
    expect(await page.locator(".summary-workbench-templates").first().evaluate(element =>
      getComputedStyle(element).gridTemplateColumns.split(" ").length)).toBe(1);
    expect(await page.locator(".chat-summary-template-card-copy").first().evaluate(element =>
      element.getBoundingClientRect().width)).toBeGreaterThan(100);
    await page.getByTestId("summary-chat-panel-back-btn").click();
    await page.getByTestId("summary-list-mode-switch").click();
    await page.getByTestId("summary-list-agent-tab").click();
    const input = page.getByTestId("summary-agent-input");
    await input.fill("Legacy draft");
    await page.getByTestId("summary-agent-ref-entry").click();
    await page.locator(".summary-reference-picker-item").click();
    await expect(page.locator(".summary-reference-picker-modal")).toBeHidden();
    await page.getByTestId("summary-agent-ref-card").click();
    await expect(page.getByTestId("summary-agent-ref-side-panel")).toBeVisible();
    await expect.poll(() => page.locator(".summary-workbench-agent-chat-main").evaluate(element =>
      element.getBoundingClientRect().width)).toBeGreaterThan(250);
    expect(await page.getByTestId("summary-agent-ref-side-panel").evaluate(element =>
      element.getBoundingClientRect().width)).toBeLessThanOrEqual(320);
    await page.getByTestId("summary-agent-ref-side-close-btn").click();
    await expect(input).toHaveValue("Legacy draft");
  });
}

for (const platform of ["darwin", "win32", "web"]) {
  test(`${platform}: standalone reference changes between split and overlay without losing draft`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 800 });
    await openSummaryFixture(page, `${fixture}?platform=${platform}&width=1200&standalone&locale=en-US`);
    const input = page.locator(".wk-summary-workbench textarea");
    await input.fill("Standalone draft");
    await page.getByRole("button", { name: "Reference summary", exact: true }).click();
    await page.locator(".summary-reference-picker-item").click();
    await expect(page.locator(".summary-reference-picker-modal")).toBeHidden();
    const reference = page.getByTestId("summary-agent-ref-side-panel");
    await expect(reference).toHaveCSS("position", "static");
    await page.setViewportSize({ width: 600, height: 800 });
    await expect(reference).toHaveCSS("position", "absolute");
    await expect.poll(() => reference.evaluate(element =>
      element.getBoundingClientRect().top >= document.querySelector(".wk-summary-workbench__header")!.getBoundingClientRect().bottom - 1,
    )).toBe(true);
    await page.getByTestId("summary-agent-ref-side-close-btn").click();
    await expect(input).toHaveValue("Standalone draft");
  });
}

for (const [width, columns] of [[320, 2], [360, 3], [480, 4], [720, 4]]) {
  test(`search media fits ${width}px with ${columns} fixed-size columns`, async ({ page }) => {
    await openSummaryFixture(page, `${fixture}?media&platform=web&width=${width}`);
    const grid = page.locator(".wk-channel-search-media-grid");
    await expect(grid).toBeVisible();
    expect(await grid.evaluate(element => getComputedStyle(element).gridTemplateColumns.split(" "))).toEqual(
      Array(columns).fill("104px"),
    );
    expect(await grid.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  });
}

test("fixture gates rendering until ChatSummaryPanel loads", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 800 });
  let resolveIntercepted!: () => void;
  const intercepted = new Promise<void>(resolve => { resolveIntercepted = resolve; });
  let releaseRoute!: () => void;
  const released = new Promise<void>(resolve => { releaseRoute = resolve; });
  await page.route("**/ChatSummaryPanel.tsx*", async route => {
    resolveIntercepted();
    await released;
    await route.continue();
  });
  const opener = openSummaryFixture(page, `${fixture}?platform=web&width=700`);
  try {
    await Promise.race([intercepted, opener]);
    await expect(page.locator("#root")).toHaveAttribute("data-fixture-state", "loading");
    expect(await page.locator(".wk-summary-panel").count()).toBe(0);
  } finally {
    releaseRoute();
    await opener;
  }
  await expectReadableWorkbench(page);
});

for (const legacy of [false, true]) {
  test(`standalone web chat selector covers the viewport: legacy=${legacy}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 800 });
    await openSummaryFixture(page, `${fixture}?platform=web&width=700&standalone&locale=en-US${legacy ? "&legacy" : ""}`);
    await page.getByRole("button", { name: "Select chats", exact: true }).click();
    const overlay = page.locator(".chat-selector-overlay");
    await expect(overlay).toBeVisible();
    expect(await overlay.evaluate(element => element.parentElement === document.body)).toBe(true);
    expect(await overlay.evaluate(element => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    })).toEqual({ x: 0, y: 0, width: 1440, height: 800 });
    await page.locator(".chat-selector-close").click();
    await expect(overlay).toHaveCount(0);
  });
}

for (const height of [480, 360]) {
  test(`narrow web keeps templates and composer reachable at ${height}px height`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height });
    await openSummaryFixture(page, `${fixture}?platform=web&width=390&standalone&locale=en-US`);
    const template = page.locator(".chat-summary-template-card-select").last();
    await template.scrollIntoViewIfNeeded();
    await expect(template).toBeInViewport();
    await template.click();
    const composer = page.locator(".wk-summary-workbench textarea");
    await expect(composer).not.toHaveValue("");
    await composer.scrollIntoViewIfNeeded();
    await expect(composer).toBeInViewport();
    const send = page.locator(".wk-summary-workbench__send");
    await send.scrollIntoViewIfNeeded();
    await expect(send).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: testInfo.outputPath("short-workbench.png"), animations: "disabled" });
  });
}
