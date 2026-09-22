import { expect, test, type Page } from "@playwright/test";

const fixture = "/e2e-kit/fixtures/desktop-channel-search.html";

async function openFixture(page: Page, query: string) {
  await page.goto(`${fixture}?${query}`);
  await page.waitForFunction(() => {
    const state = document.getElementById("root")?.dataset.fixtureState;
    return state === "ready" || state === "error";
  });
  const root = page.locator("#root");
  expect(await root.getAttribute("data-fixture-error")).toBeNull();
  await expect(root).toHaveAttribute("data-fixture-state", "ready");
}

async function expectToolbarFits(page: Page) {
  const panel = page.locator(".wk-channel-search-panel");
  await expect(panel.locator(".wk-search-workspace__tabs button")).toHaveCount(4);
  await expect.poll(() => panel.evaluate(element => {
    const tabs = element.querySelector<HTMLElement>(".wk-search-workspace__tabs")!;
    const action = element.querySelector<HTMLElement>(".wk-channel-search-filter-trigger")!;
    const frame = element.getBoundingClientRect();
    const actionBox = action.getBoundingClientRect();
    return tabs.scrollWidth <= tabs.clientWidth + 1 &&
      actionBox.right <= frame.right + 1 &&
      [...tabs.querySelectorAll("button")].every(button => {
        const box = button.getBoundingClientRect();
        return box.left >= frame.left && box.right <= actionBox.left &&
          box.bottom <= tabs.getBoundingClientRect().bottom + 1;
      });
  })).toBe(true);
}

for (const client of [false, true]) {
  for (const locale of ["zh-CN", "en-US"]) {
    test(`${client ? "Client" : "Web"} ${locale}: search grows to 420px and shrinks without overflow`, async ({ page }, testInfo) => {
      test.setTimeout(60_000);
      await page.setViewportSize({ width: 1200, height: 800 });
      await openFixture(page, `locale=${locale}&filtered${client ? "&client-shell" : ""}`);
      if (client) await expect(page.locator(".wk-layout-content-left")).toBeHidden();
      const chat = page.locator(".wk-chat-content-right");
      const panel = page.locator(".wk-chat-channel-search-panel");
      const conversation = page.locator(".wk-chat-content-chat");
      const input = panel.locator(".wk-search-workspace__input-wrap input");
      const filter = panel.locator(".wk-channel-search-filter-trigger");
      await expect(panel.locator(".wk-channel-search-filter-count")).toHaveText("3");

      for (const width of [1200, 852, 800, 752, 751, 420, 401, 400, 399, 360, 320, 1200]) {
        await page.setViewportSize({ width, height: 800 });
        const split = width >= 752;
        await expect(chat).toHaveAttribute("data-chat-panel-layout", split ? "split" : "overlay");
        await expect(panel).toHaveCSS("width", `${split ? Math.min(420, width - 432) : width}px`);
        if (split) {
          await expect(conversation).toBeVisible();
          await expect.poll(() => conversation.evaluate(e => e.getBoundingClientRect().width)).toBeGreaterThanOrEqual(432);
        } else {
          await expect(conversation).toBeHidden();
        }
        await expect(input).toHaveValue("design");
        await expectToolbarFits(page);
        await expect(filter).toHaveAccessibleName(locale === "zh-CN" ? /筛选\s*3/ : /Filter\s*3/);
        const contentWidth = await panel.locator(".wk-channel-search-panel").evaluate(e => e.getBoundingClientRect().width);
        await expect(panel.locator(".wk-channel-search-filter-label")).toHaveCSS(
          "position", contentWidth < 400 ? "absolute" : "static",
        );
      }
      await page.screenshot({ path: testInfo.outputPath("search-wide.png"), animations: "disabled" });
      await page.setViewportSize({ width: 320, height: 700 });
      await filter.click();
      const popover = panel.locator(".wk-channel-search-filter-popover");
      await expect(popover).toBeVisible();
      const frame = (await panel.boundingBox())!;
      const popup = (await popover.boundingBox())!;
      expect(popup.x).toBeGreaterThanOrEqual(frame.x);
      expect(popup.x + popup.width).toBeLessThanOrEqual(frame.x + frame.width);
      await page.screenshot({ path: testInfo.outputPath("search-narrow-filter.png"), animations: "disabled" });
      await input.click();
      await expect(popover).toBeHidden();
      for (const tab of await panel.locator(".wk-search-workspace__tabs button").all()) {
        await tab.click();
        await expect(tab).toHaveAttribute("aria-current", "page");
        await expectToolbarFits(page);
      }
      await panel.locator(".wk-search-workspace__trailing").getByRole("button").click();
      await expect(panel).toHaveCount(0);
      await expect(conversation).toBeVisible();
    });
  }
}

test("wide search keeps its full label and compact threads keep their 360px budget", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 800 });
  await openFixture(page, "locale=zh-CN");
  await expect(page.locator(".wk-chat-channel-search-panel")).toHaveCSS("width", "420px");
  const label = page.locator(".wk-channel-search-filter-label");
  await expect(label).toHaveCSS("position", "static");
  await expectToolbarFits(page);
  await openFixture(page, "compact");
  await expect(page.locator(".wk-chat-content-chat")).toHaveCSS("width", "640px");
});

test("dark narrow search keeps all translated categories and the filter trigger reachable", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 700 });
  await openFixture(page, "locale=en-US&theme=dark&client-shell");
  await expectToolbarFits(page);
  const filter = page.getByRole("button", { name: "Filter", exact: true });
  await filter.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".wk-channel-search-filter-popover")).toBeVisible();
});
