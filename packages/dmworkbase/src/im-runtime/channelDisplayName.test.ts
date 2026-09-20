import { describe, expect, it } from "vitest";
import { getImChannelDisplayName, seedImChannelDisplayName } from "./channelDisplayName";
import type { ImChannelInfoLike } from "./channelRuntime";

const channel = { channelID: "raw-uid", channelType: 1 };

describe("channel display name", () => {
  it("preserves remarks before display names and titles", () => {
    expect(getImChannelDisplayName({
      channel, title: "Title", orgData: { remark: " My remark ", displayName: "Display" },
    })).toBe("My remark");
  });
  it("uses the title when host-seeded metadata has no display name", () => {
    expect(getImChannelDisplayName({ channel, title: "Known contact", orgData: {} })).toBe("Known contact");
  });
  it("skips whitespace or malformed names", () => {
    expect(getImChannelDisplayName({
      channel, title: "Title", orgData: { remark: {}, displayName: "   " },
    })).toBe("Title");
  });
  it("does not expose an old synthetic UID as a title", () => {
    expect(getImChannelDisplayName({ channel, title: "raw-uid", orgData: {} })).toBe("");
    expect(getImChannelDisplayName()).toBe("");
    expect(getImChannelDisplayName({ channel, orgData: {} })).toBe("");
  });
  it("accepts an explicit display name or remark that happens to match the UID", () => {
    expect(getImChannelDisplayName({ channel, orgData: { displayName: "raw-uid" } })).toBe("raw-uid");
    expect(getImChannelDisplayName({ channel, orgData: { remark: "raw-uid" } })).toBe("raw-uid");
  });

  it("seeds a host name into both title and displayName", () => {
    const info: ImChannelInfoLike = { channel };
    seedImChannelDisplayName(info, " Host name ", { robot: 1 });
    expect(info).toEqual({
      channel, title: "Host name", orgData: { displayName: "Host name", robot: 1 },
    });
  });

  it("preserves cached remarks and unrelated metadata when seeding a new name", () => {
    const info: ImChannelInfoLike = {
      channel, title: "Old name", orgData: { remark: "My remark", displayName: "My remark", online: 1 },
    };
    seedImChannelDisplayName(info, "New name", { displayName: "New name", remark: "", robot: 1 });
    expect(info.title).toBe("New name");
    expect(info.orgData).toEqual({ remark: "My remark", displayName: "My remark", online: 1, robot: 1 });
  });

  it("keeps a known title with nameless hints and never manufactures a UID name", () => {
    const known: ImChannelInfoLike = { channel, title: "Known name" };
    seedImChannelDisplayName(known, " ", { displayName: "" });
    expect(getImChannelDisplayName(known)).toBe("Known name");
    const empty: ImChannelInfoLike = { channel };
    seedImChannelDisplayName(empty, undefined, { robot: 1 });
    expect(empty.title).toBeUndefined();
    expect(getImChannelDisplayName(empty)).toBe("");
  });
});
