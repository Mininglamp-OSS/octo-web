/* eslint-disable no-undef -- e2e code runs in Node */
import { test, expect } from "../../fixtures-authed";
import type { Page } from "@playwright/test";
import { installMockImRuntime } from "../../_kit/mock-im-runtime";

async function openEmojiPicker(page: Page) {
  await installMockImRuntime(page, {
    currentUid: "e2e-user-1",
    spaceId: "e2e-space-001",
    users: [{ uid: "e2e-user-1", name: "E2E Tester", robot: 0 }],
    groups: [{ group_no: "emoji-test-group", name: "Emoji 测试群" }],
    conversations: [
      { channelId: "emoji-test-group", channelType: 2, unread: 0 },
    ],
    messages: [],
    subscribers: [
      {
        uid: "e2e-user-1",
        name: "E2E Tester",
        channelId: "emoji-test-group",
        channelType: 2,
        role: 1,
        robot: 0,
      },
    ],
  });

  await page.getByRole("button", { name: "会话" }).click();
  await page.getByRole("button", { name: "最近" }).click();
  await expect(page.getByText("Emoji 测试群", { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await page.getByText("Emoji 测试群", { exact: true }).click();

  const editor = page.locator(".wk-messageinput-editor .ProseMirror");
  await expect(editor).toBeVisible({ timeout: 15_000 });
  await page.locator(".wk-emojitoolbar .wk-iconclick").click();
  await expect(page.locator(".wk-emojitoolbar-emojipanel-show")).toBeVisible();
}

async function expectImmediateCloseAt(
  page: Page,
  point: { x: number; y: number }
) {
  const panel = page.locator(".wk-emojitoolbar-emojipanel");
  const hitTarget = await page.evaluate(({ x, y }) => {
    return document.elementFromPoint(x, y)?.className;
  }, point);
  expect(hitTarget).toContain("wk-emojitoolbar-mask");

  await page.evaluate(() => {
    const panel = document.querySelector(
      ".wk-emojitoolbar-emojipanel"
    ) as HTMLElement;
    const classes = [panel.className];
    const observer = new MutationObserver(() => classes.push(panel.className));
    observer.observe(panel, { attributes: true, attributeFilter: ["class"] });
    (window as any).__emojiPickerCloseProbe__ = { classes, observer };
  });

  await page.mouse.click(point.x, point.y);

  const state = await panel.evaluate((element) => ({
    className: element.className,
    visibility: getComputedStyle(element).visibility,
  }));
  const classes = await page.evaluate(() => {
    const probe = (window as any).__emojiPickerCloseProbe__ as {
      classes: string[];
      observer: MutationObserver;
    };
    probe.observer.disconnect();
    return probe.classes;
  });

  expect(state.className).toBe("wk-emojitoolbar-emojipanel");
  expect(state.visibility).toBe("hidden");
  expect(classes.some((name) => name.includes("emojipanel-hide"))).toBe(false);
  await expect(page.locator(".wk-emojitoolbar-mask")).toHaveCount(0);
}

test.describe("@chat @emoji emoji picker dismissal", () => {
  test.beforeEach(async ({ authedPage }) => {
    await openEmojiPicker(authedPage);
  });

  test("clicking the editor closes the picker without a visible exit frame", async ({
    authedPage,
  }) => {
    const bounds = await authedPage
      .locator(".wk-messageinput-editor .ProseMirror")
      .boundingBox();
    expect(bounds).not.toBeNull();

    await expectImmediateCloseAt(authedPage, {
      x: bounds!.x + bounds!.width / 2,
      y: bounds!.y + bounds!.height / 2,
    });
  });

  test("clicking the composer row gap closes the picker without a visible exit frame", async ({
    authedPage,
  }) => {
    const row = authedPage.locator(".wk-messageinput-row");
    const inputBox = authedPage.locator(".wk-messageinput-inputbox");
    const [rowBounds, inputBounds] = await Promise.all([
      row.boundingBox(),
      inputBox.boundingBox(),
    ]);
    expect(rowBounds).not.toBeNull();
    expect(inputBounds).not.toBeNull();

    await expectImmediateCloseAt(authedPage, {
      x: inputBounds!.x + inputBounds!.width + 8,
      y: rowBounds!.y + rowBounds!.height / 2,
    });
  });
});
