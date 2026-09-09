import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@octo/base", () => ({
  WKApp: { shared: { currentSpaceId: "space-a" } },
}));
import { WKApp } from "@octo/base";
import { installSummaryNavigation } from "./summaryNavigation";

describe("artifact summary card navigation", () => {
  beforeEach(() => {
    WKApp.openSummaryDetail = undefined;
    WKApp.openSummarySharePreview = undefined;
    WKApp.openSummaryShareDetail = undefined;
  });

  it("routes task numbers, preview and detail through the host", async () => {
    const openSummary = vi.fn(async () => {});
    const cleanup = installSummaryNavigation({ openSummary }, vi.fn());
    const originConversation = { channelId: "group-a", channelType: 2 };
    WKApp.openSummaryDetail?.("ST202607145kstyh08");
    WKApp.openSummarySharePreview?.("share-a", "space-a", originConversation);
    await WKApp.openSummaryShareDetail?.("share-a", "space-a", originConversation);
    await Promise.resolve();
    expect(openSummary.mock.calls.map(([input]) => input)).toEqual([
      { route: { view: "detail", taskId: "ST202607145kstyh08" }, spaceId: "space-a" },
      { route: { view: "share", shareId: "share-a", preview: true, originConversation }, spaceId: "space-a" },
      { route: { view: "share", shareId: "share-a", originConversation }, spaceId: "space-a" },
    ]);
    cleanup();
    expect(WKApp.openSummaryDetail).toBeUndefined();
  });

  it("reports host failures and restores previous Web hooks on cleanup", async () => {
    const previous = vi.fn();
    WKApp.openSummaryDetail = previous;
    const error = new Error("feature disabled");
    const onError = vi.fn();
    const cleanup = installSummaryNavigation({ openSummary: vi.fn().mockRejectedValue(error) }, onError);
    WKApp.openSummaryDetail?.(17);
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(error));
    cleanup();
    expect(WKApp.openSummaryDetail).toBe(previous);
  });
});
