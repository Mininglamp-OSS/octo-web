/* eslint-disable no-undef -- e2e code runs in Node */
import { test, expect } from "../../fixtures-authed";
import { installMockImRuntime } from "../../_kit/mock-im-runtime";

test.describe("@chat @emoji emoji suggestion lifecycle", () => {
  test("mouse selection closes once without flashing back", async ({
    authedPage,
  }) => {
    await installMockImRuntime(authedPage, {
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

    await authedPage.getByRole("button", { name: "会话" }).click();
    await authedPage.getByRole("button", { name: "最近" }).click();
    await expect(
      authedPage.getByText("Emoji 测试群", { exact: true })
    ).toBeVisible({ timeout: 15_000 });
    await authedPage.getByText("Emoji 测试群", { exact: true }).click();

    const editor = authedPage.locator(".wk-messageinput-editor .ProseMirror");
    await expect(editor).toBeVisible({ timeout: 15_000 });
    await editor.click();
    await editor.pressSequentially("使命");

    const suggestion = authedPage.locator(".emoji-suggestion-bar");
    await expect(suggestion).toBeVisible();

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
});
