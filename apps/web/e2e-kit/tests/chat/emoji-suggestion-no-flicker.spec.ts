/* eslint-disable no-undef -- e2e code runs in Node */
import { test, expect } from "../../fixtures-authed";
import type { Page } from "@playwright/test";
import { installMockImRuntime } from "../../_kit/mock-im-runtime";

async function openEmojiSuggestion(page: Page) {
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
  await editor.click();
  await editor.pressSequentially("使命");

  const suggestion = page.locator(".emoji-suggestion-bar");
  await expect(suggestion).toBeVisible();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      })
  );
}

async function startStablePopupProbe(page: Page) {
  await page.evaluate(() => {
    const visibleCount = () =>
      Array.from(document.querySelectorAll(".emoji-suggestion-bar")).filter(
        (bar) => {
          const box = bar.closest(".tippy-box");
          return box?.getAttribute("data-state") === "visible";
        }
      ).length;
    const events = [visibleCount()];
    const positions: Array<{ x: number; y: number }> = [];
    const record = () => {
      const count = visibleCount();
      if (events[events.length - 1] !== count) events.push(count);
      const box = document
        .querySelector(".emoji-suggestion-bar")
        ?.closest(".tippy-box");
      if (count === 1 && box instanceof HTMLElement) {
        const rect = box.getBoundingClientRect();
        positions.push({ x: rect.x, y: rect.y });
      }
    };
    const observer = new MutationObserver(record);
    observer.observe(document.body, {
      attributes: true,
      childList: true,
      subtree: true,
      attributeFilter: ["data-state", "style"],
    });
    const probe = { events, positions, observer, frameId: 0, stopped: false };
    const sampleFrame = () => {
      record();
      if (!probe.stopped) probe.frameId = requestAnimationFrame(sampleFrame);
    };
    sampleFrame();
    (window as any).__emojiStablePopupProbe__ = probe;
  });
}

async function expectPopupStayedStable(page: Page) {
  await page.waitForTimeout(300);
  const suggestion = page.locator(".emoji-suggestion-bar");
  await expect(suggestion).toBeVisible();
  const probe = await page.evaluate(() => {
    const current = (window as any).__emojiStablePopupProbe__ as {
      events: number[];
      positions: Array<{ x: number; y: number }>;
      observer: MutationObserver;
      frameId: number;
      stopped: boolean;
    };
    current.stopped = true;
    cancelAnimationFrame(current.frameId);
    current.observer.disconnect();
    return { events: current.events, positions: current.positions };
  });

  expect(probe.events).toEqual([1]);
  expect(probe.positions.length).toBeGreaterThan(1);
  const xs = probe.positions.map(({ x }) => x);
  const ys = probe.positions.map(({ y }) => y);
  expect(Math.max(...xs) - Math.min(...xs)).toBeLessThanOrEqual(1);
  expect(Math.max(...ys) - Math.min(...ys)).toBeLessThanOrEqual(1);
}

test.describe("@chat @emoji emoji suggestion lifecycle", () => {
  test.beforeEach(async ({ authedPage }) => {
    await openEmojiSuggestion(authedPage);
  });

  test("mouse selection closes once without flashing back", async ({
    authedPage,
  }) => {
    const editor = authedPage.locator(".wk-messageinput-editor .ProseMirror");
    const suggestion = authedPage.locator(".emoji-suggestion-bar");

    await authedPage.evaluate(() => {
      const visibleCount = () =>
        Array.from(document.querySelectorAll(".emoji-suggestion-bar")).filter(
          (bar) => {
            const box = bar.closest(".tippy-box");
            return box?.getAttribute("data-state") === "visible";
          }
        ).length;
      const events = [visibleCount()];
      const record = () => {
        const count = visibleCount();
        if (events[events.length - 1] !== count) events.push(count);
      };
      const observer = new MutationObserver(record);
      observer.observe(document.body, {
        attributes: true,
        childList: true,
        subtree: true,
        attributeFilter: ["data-state"],
      });
      const probe = {
        events,
        observer,
        frameId: 0,
        stopped: false,
      };
      const sampleFrame = () => {
        record();
        if (!probe.stopped) probe.frameId = requestAnimationFrame(sampleFrame);
      };
      probe.frameId = requestAnimationFrame(sampleFrame);
      (window as any).__emojiPopupProbe__ = probe;
    });

    await suggestion.locator(".emoji-suggestion-cell").first().click();
    await expect(editor).toContainText("[使命必达]");
    await expect(suggestion).toHaveCount(0);
    await authedPage.waitForTimeout(300);

    const events = await authedPage.evaluate(() => {
      const probe = (window as any).__emojiPopupProbe__ as {
        events: number[];
        observer: MutationObserver;
        frameId: number;
        stopped: boolean;
      };
      probe.stopped = true;
      cancelAnimationFrame(probe.frameId);
      probe.observer.disconnect();
      return probe.events;
    });
    const firstClosed = events.indexOf(0);
    expect(firstClosed).toBeGreaterThan(0);
    expect(events.slice(firstClosed + 1)).not.toContain(1);
  });

  test("clicking the focused editor keeps the popup stable", async ({
    authedPage,
  }) => {
    const editor = authedPage.locator(".wk-messageinput-editor .ProseMirror");
    const editorBox = await editor.boundingBox();
    expect(editorBox).not.toBeNull();

    await startStablePopupProbe(authedPage);
    await editor.click({
      position: {
        x: Math.max(1, editorBox!.width - 4),
        y: editorBox!.height / 2,
      },
    });

    await expectPopupStayedStable(authedPage);
  });

  test("clicking the composer row gap keeps the popup stable", async ({
    authedPage,
  }) => {
    const row = authedPage.locator(".wk-messageinput-row");
    const inputBox = authedPage.locator(".wk-messageinput-inputbox");
    const [rowBox, inputBounds] = await Promise.all([
      row.boundingBox(),
      inputBox.boundingBox(),
    ]);
    expect(rowBox).not.toBeNull();
    expect(inputBounds).not.toBeNull();
    const gapPoint = {
      x: inputBounds!.x + inputBounds!.width + 8,
      y: rowBox!.y + rowBox!.height / 2,
    };
    const gapTargetsRow = await authedPage.evaluate(({ x, y }) => {
      return document
        .elementFromPoint(x, y)
        ?.classList.contains("wk-messageinput-row");
    }, gapPoint);
    expect(gapTargetsRow).toBe(true);

    await startStablePopupProbe(authedPage);
    await row.click({
      position: {
        x: gapPoint.x - rowBox!.x,
        y: gapPoint.y - rowBox!.y,
      },
    });

    await expectPopupStayedStable(authedPage);
  });
});
