import { describe, expect, it } from "vitest";
import {
  activeGlobalSearchFilterCount,
  hasGlobalSearchCriteria,
  selectedGlobalSearchFilterValueCount,
} from "../filterState";
import { activeChannelSearchFilterCount } from "../../ChannelSearch/filterState";
import { defaultGlobalSearchFilters } from "../types";
import type { GlobalSearchFilters } from "../types";

function withOverrides(
  overrides: Partial<GlobalSearchFilters>
): GlobalSearchFilters {
  return { ...defaultGlobalSearchFilters(), ...overrides };
}

describe("hasGlobalSearchCriteria", () => {
  it("distinguishes the initial empty state from a real filtered search", () => {
    const defaults = defaultGlobalSearchFilters();
    expect(hasGlobalSearchCriteria("messages", "", defaults)).toBe(false);
    expect(hasGlobalSearchCriteria("files", "", defaults)).toBe(false);
    expect(hasGlobalSearchCriteria("messages", "octo", defaults)).toBe(true);
  });

  it("counts common filters on both tabs", () => {
    const filters = withOverrides({ datePreset: "today" });
    expect(hasGlobalSearchCriteria("messages", "", filters)).toBe(true);
    expect(hasGlobalSearchCriteria("files", "", filters)).toBe(true);
  });

  it("only counts tab-specific filters on their applicable tab", () => {
    const messageFilters = withOverrides({ contentTypes: [1] });
    expect(hasGlobalSearchCriteria("messages", "", messageFilters)).toBe(true);
    expect(hasGlobalSearchCriteria("files", "", messageFilters)).toBe(false);

    const fileFilters = withOverrides({ fileExts: ["pdf"] });
    expect(hasGlobalSearchCriteria("files", "", fileFilters)).toBe(true);
    expect(hasGlobalSearchCriteria("messages", "", fileFilters)).toBe(false);
  });
});

describe("activeGlobalSearchFilterCount", () => {
  it("returns 0 for the default filters", () => {
    expect(activeGlobalSearchFilterCount(defaultGlobalSearchFilters())).toBe(0);
  });

  it("counts sender uids as one active filter", () => {
    expect(
      activeGlobalSearchFilterCount(withOverrides({ senderUids: ["u1", "u2"] }))
    ).toBe(1);
  });

  it("counts memberUids separately from senderUids", () => {
    expect(
      activeGlobalSearchFilterCount(
        withOverrides({ senderUids: ["u1"], memberUids: ["u9"] })
      )
    ).toBe(2);
  });

  it("counts multi-select memberUids as a single active filter", () => {
    expect(
      activeGlobalSearchFilterCount(
        withOverrides({ memberUids: ["u1", "u2", "u3"] })
      )
    ).toBe(1);
  });

  it("counts each independent filter dimension exactly once", () => {
    const all = withOverrides({
      senderUids: ["u1"],
      memberUids: ["u9"],
      channels: [{ channelId: "g1", channelType: 2 }],
      channelTypes: [1, 2],
      contentTypes: [1, 14],
      fileExts: ["pdf"],
      fileSizeMin: 1024,
      sort: "time_asc",
      datePreset: "today",
    });
    // sender + member + channels + channelTypes + contentTypes + fileExts +
    // fileSize + sort + date = 9
    expect(activeGlobalSearchFilterCount(all)).toBe(9);
  });

  it("treats fileSize as one filter regardless of whether min/max/both are set", () => {
    expect(
      activeGlobalSearchFilterCount(withOverrides({ fileSizeMin: 100 }))
    ).toBe(1);
    expect(
      activeGlobalSearchFilterCount(withOverrides({ fileSizeMax: 100 }))
    ).toBe(1);
    expect(
      activeGlobalSearchFilterCount(
        withOverrides({ fileSizeMin: 100, fileSizeMax: 200 })
      )
    ).toBe(1);
  });

  it("ignores fileSizeMin/Max when both are zero-ish", () => {
    expect(
      activeGlobalSearchFilterCount(
        withOverrides({ fileSizeMin: 0, fileSizeMax: 0 })
      )
    ).toBe(0);
  });

  it("counts custom date range (startAt/endAt) as one active filter", () => {
    expect(
      activeGlobalSearchFilterCount(
        withOverrides({ startAt: 1767225600, endAt: 1767830399 })
      )
    ).toBe(1);
  });

  it("does not touch ChannelSearch's counter (independent implementation)", () => {
    // A GlobalSearch-only filter (channels) does not exist on
    // ChannelSearchFilters; passing minimal ChannelSearch filters must still
    // return 0 there and >0 here for our filters.
    const global = withOverrides({
      channels: [{ channelId: "g1", channelType: 2 }],
      fileExts: ["pdf"],
    });
    expect(activeGlobalSearchFilterCount(global)).toBe(2);

    // Sanity: baseline ChannelSearch filter count is 0 for its own defaults.
    expect(
      activeChannelSearchFilterCount({ senderUids: [], sort: "time_desc" })
    ).toBe(0);
  });
});

describe("selectedGlobalSearchFilterValueCount", () => {
  it("counts every selected value for the WeCom-style badge", () => {
    expect(
      selectedGlobalSearchFilterValueCount(
        withOverrides({
          senderUids: ["sender"],
          memberUids: ["member"],
          channelTypes: [1, 2],
          contentTypes: [1, 14],
        })
      )
    ).toBe(6);
  });

  it("counts date and file ranges as one value each", () => {
    expect(
      selectedGlobalSearchFilterValueCount(
        withOverrides({
          startAt: 1,
          endAt: 2,
          fileSizeMin: 1024,
          fileSizeMax: 2048,
        })
      )
    ).toBe(2);
  });

  it("counts group + thread backend values as one visible group option", () => {
    expect(
      selectedGlobalSearchFilterValueCount(
        withOverrides({ channelTypes: [2, 5] })
      )
    ).toBe(1);
  });
});
