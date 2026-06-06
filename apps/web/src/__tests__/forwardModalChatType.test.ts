import { describe, it, expect } from "vitest";
import { Channel } from "wukongimjssdk";

// Import the source file directly to avoid pulling the full @octo/base barrel
// (which loads lottie-web and other browser-only deps). Mirrors the approach in
// threadGroupMd.test.ts.
import { chatTypeToChannelType } from "../../../../packages/dmworkbase/src/Components/ForwardModal/chatTypeToChannelType";
import { candidateToForwardItem } from "../../../../packages/dmworkbase/src/Components/ForwardModal/candidateToForwardItem";

const ChannelTypePerson = 1;
const ChannelTypeGroup = 2;
const ChannelTypeCommunityTopic = 5;

describe("ForwardModal: chatTypeToChannelType", () => {
  it("maps thread -> ChannelTypeCommunityTopic (5)", () => {
    expect(chatTypeToChannelType("thread")).toBe(ChannelTypeCommunityTopic);
  });

  it("maps direct -> ChannelTypePerson (1)", () => {
    expect(chatTypeToChannelType("direct")).toBe(ChannelTypePerson);
  });

  it("maps group -> ChannelTypeGroup (2)", () => {
    expect(chatTypeToChannelType("group")).toBe(ChannelTypeGroup);
  });

  it("maps unknown / undefined -> ChannelTypeGroup (2)", () => {
    expect(chatTypeToChannelType("something-else")).toBe(ChannelTypeGroup);
    expect(chatTypeToChannelType(undefined)).toBe(ChannelTypeGroup);
  });
});

describe("ForwardModal: search candidate -> Channel construction (#273)", () => {
  // Reproduces the search-result mapping in useForwardModal: a selected thread
  // must become Channel(groupNo____shortId, 5), NOT Channel(..., 2). The old
  // "non-direct => group" logic produced type=2 and the backend silently
  // dropped the forwarded message.
  function buildChannel(candidate: { chat_id: string; chat_type: string }): Channel {
    return new Channel(candidate.chat_id, chatTypeToChannelType(candidate.chat_type));
  }

  it("builds a CommunityTopic channel for a thread candidate, keeping the full groupNo____shortId id", () => {
    const channel = buildChannel({
      chat_id: "grp001____tid001",
      chat_type: "thread",
    });
    expect(channel.channelType).toBe(ChannelTypeCommunityTopic);
    expect(channel.channelID).toBe("grp001____tid001");
  });

  it("builds a Person channel for a direct candidate", () => {
    const channel = buildChannel({ chat_id: "u123", chat_type: "direct" });
    expect(channel.channelType).toBe(ChannelTypePerson);
    expect(channel.channelID).toBe("u123");
  });

  it("builds a Group channel for a group candidate", () => {
    const channel = buildChannel({ chat_id: "grp001", chat_type: "group" });
    expect(channel.channelType).toBe(ChannelTypeGroup);
    expect(channel.channelID).toBe("grp001");
  });
});

describe("ForwardModal: candidateToForwardItem (#273)", () => {
  // No local channelInfo cache in tests; inject a stub so the pure function
  // never touches WKSDK.
  const noCache = (_ch: Channel) => undefined;

  it("prefers parent_group_no for a thread's parentChannelID", () => {
    const item = candidateToForwardItem(
      { chat_id: "grp001____tid001", chat_type: "thread", parent_group_no: "grpX" },
      noCache,
    );
    expect(item.parentChannelID).toBe("grpX");
  });

  it("treats numeric parent_group_no 0 as a valid parent (not falsy fallback)", () => {
    const item = candidateToForwardItem(
      { chat_id: "0____tid001", chat_type: "thread", parent_group_no: 0 },
      noCache,
    );
    expect(item.parentChannelID).toBe("0");
  });

  it("converts a numeric parent_group_no to String", () => {
    const item = candidateToForwardItem(
      { chat_id: "grp001____tid001", chat_type: "thread", parent_group_no: 12345 },
      noCache,
    );
    expect(item.parentChannelID).toBe("12345");
    expect(typeof item.parentChannelID).toBe("string");
  });

  it("falls back to parseThreadChannelId(chat_id).groupNo when parent_group_no is missing", () => {
    const item = candidateToForwardItem(
      { chat_id: "grpFallback____tid001", chat_type: "thread" },
      noCache,
    );
    expect(item.parentChannelID).toBe("grpFallback");
  });

  it("treats null parent_group_no like missing and uses the parsed fallback", () => {
    const item = candidateToForwardItem(
      { chat_id: "grpFallback____tid001", chat_type: "thread", parent_group_no: null },
      noCache,
    );
    expect(item.parentChannelID).toBe("grpFallback");
  });

  it("returns undefined parentChannelID (without throwing) when chat_id has no separator", () => {
    let item: ReturnType<typeof candidateToForwardItem> | undefined;
    expect(() => {
      item = candidateToForwardItem(
        { chat_id: "no-separator-id", chat_type: "thread" },
        noCache,
      );
    }).not.toThrow();
    expect(item?.parentChannelID).toBeUndefined();
  });

  it("computes isThread from chat_type", () => {
    expect(
      candidateToForwardItem({ chat_id: "grp001____t", chat_type: "thread" }, noCache).isThread,
    ).toBe(true);
    expect(
      candidateToForwardItem({ chat_id: "grp001", chat_type: "group" }, noCache).isThread,
    ).toBe(false);
    expect(
      candidateToForwardItem({ chat_id: "u1", chat_type: "direct" }, noCache).isThread,
    ).toBe(false);
  });

  it("never sets parentChannelID for non-thread candidates", () => {
    const group = candidateToForwardItem(
      { chat_id: "grp001____x", chat_type: "group" },
      noCache,
    );
    expect(group.parentChannelID).toBeUndefined();
    const direct = candidateToForwardItem(
      { chat_id: "u1____x", chat_type: "direct" },
      noCache,
    );
    expect(direct.parentChannelID).toBeUndefined();
  });

  it("maps channelType for direct / group / thread candidates", () => {
    expect(
      candidateToForwardItem({ chat_id: "u1", chat_type: "direct" }, noCache).channelType,
    ).toBe(ChannelTypePerson);
    expect(
      candidateToForwardItem({ chat_id: "grp001", chat_type: "group" }, noCache).channelType,
    ).toBe(ChannelTypeGroup);
    expect(
      candidateToForwardItem({ chat_id: "grp001____t", chat_type: "thread" }, noCache).channelType,
    ).toBe(ChannelTypeCommunityTopic);
  });

  it("falls back to chat_id for displayName when name is absent", () => {
    expect(
      candidateToForwardItem({ chat_id: "grp001", chat_type: "group" }, noCache).displayName,
    ).toBe("grp001");
    expect(
      candidateToForwardItem(
        { chat_id: "grp001", chat_type: "group", name: "Team" },
        noCache,
      ).displayName,
    ).toBe("Team");
  });

  it("inherits isExternal from cached channelInfo only for groups", () => {
    const externalCache = (_ch: Channel) =>
      ({ orgData: { is_external_group: 1 } } as any);
    expect(
      candidateToForwardItem(
        { chat_id: "grp001", chat_type: "group" },
        externalCache,
      ).isExternal,
    ).toBe(true);
    // A thread with the same cached flag must NOT be marked external.
    expect(
      candidateToForwardItem(
        { chat_id: "grp001____t", chat_type: "thread" },
        externalCache,
      ).isExternal,
    ).toBe(false);
  });
});
