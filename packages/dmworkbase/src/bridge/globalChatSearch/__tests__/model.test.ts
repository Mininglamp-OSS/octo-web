import { describe, expect, it } from "vitest";
import { defaultGlobalSearchFilters } from "../../../Service/SearchTypes";
import { canRunGlobalGroupSearch, drillDownFilters } from "../model";

describe("global chat search model", () => {
  it("requires a keyword or a messages-applicable filter for L1", () => {
    const filters = defaultGlobalSearchFilters();
    expect(canRunGlobalGroupSearch("", filters)).toBe(false);
    expect(
      canRunGlobalGroupSearch("", {
        ...filters,
        channelTypes: [2, 5],
        contentTypes: [1],
        datePreset: "today",
      })
    ).toBe(true);
    expect(canRunGlobalGroupSearch("", { ...filters, fileExts: ["pdf"] })).toBe(
      false
    );
    expect(canRunGlobalGroupSearch("octo", filters)).toBe(true);
    expect(
      canRunGlobalGroupSearch("", { ...filters, senderUids: ["u1"] })
    ).toBe(true);
  });

  it("keeps the selected thread identity for L2", () => {
    const filters = defaultGlobalSearchFilters();
    const next = drillDownFilters(filters, {
      channelId: "group____thread",
      channelType: 5,
      name: "需求评审",
    });
    expect(next.channels).toEqual([
      {
        channelId: "group____thread",
        channelType: 5,
        name: "需求评审",
      },
    ]);
    expect(next.sort).toBe("time_desc");
  });

  it("replaces an overview scope with the selected conversation", () => {
    const filters = {
      ...defaultGlobalSearchFilters(),
      channels: [{ channelId: "old", channelType: 2 }],
      senderUids: ["u1"],
    };
    const next = drillDownFilters(filters, {
      channelId: "peer",
      channelType: 1,
      name: "Alice",
    });
    expect(next.channels).toHaveLength(1);
    expect(next.channels[0]?.channelId).toBe("peer");
    expect(next.senderUids).toEqual(["u1"]);
  });
});
