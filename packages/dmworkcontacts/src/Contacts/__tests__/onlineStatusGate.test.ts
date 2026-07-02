import { describe, expect, it } from "vitest";
import { shouldShowOnlineStatus, selectOnlineStatusUids } from "../onlineStatusGate";

describe("shouldShowOnlineStatus", () => {
  it("shows the online badge only for AI (robot) items", () => {
    expect(shouldShowOnlineStatus({ robot: true })).toBe(true);
  });

  it("hides the online badge for human contacts", () => {
    expect(shouldShowOnlineStatus({ robot: false })).toBe(false);
    expect(shouldShowOnlineStatus({})).toBe(false);
    expect(shouldShowOnlineStatus(null)).toBe(false);
    expect(shouldShowOnlineStatus(undefined)).toBe(false);
  });
});

describe("selectOnlineStatusUids", () => {
  it("prefetches only AI uids and skips humans", () => {
    const items = [
      { uid: "ai_1", robot: true },
      { uid: "human_1", robot: false },
      { uid: "human_2" },
      { uid: "ai_2", robot: true },
    ];
    expect(selectOnlineStatusUids(items)).toEqual(["ai_1", "ai_2"]);
  });

  it("drops AI items without a uid", () => {
    expect(selectOnlineStatusUids([{ robot: true }, { uid: "", robot: true }])).toEqual([]);
  });
});
