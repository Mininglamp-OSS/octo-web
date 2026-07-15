import { describe, expect, it } from "vitest";
import {
  buildMentionDropdownItems,
  MENTION_UID_AIS,
  MENTION_UID_HUMANS,
  mentionUidStateFromRobot,
} from "../mentionRender";

const members = [
  { uid: "u1", name: "Alice" },
  { uid: "bot1", name: "BuildBot", orgData: { robot: 1 } },
  { uid: "u2", name: "张三" },
];

const baseArgs = {
  members,
  iconResolver: () => "",
  externalResolver: () => ({ isExternal: false, sourceSpaceName: "" }),
  stickyIcon: "",
};

describe("buildMentionDropdownItems", () => {
  it("prepends broadcast mentions for an empty group query", () => {
    const items = buildMentionDropdownItems({
      ...baseArgs,
      query: "",
    });

    expect(items.map((item) => item.uid)).toEqual([
      MENTION_UID_HUMANS,
      MENTION_UID_AIS,
      "u1",
      "bot1",
      "u2",
    ]);
  });

  it("omits broadcast mentions when disabled for direct chats", () => {
    const items = buildMentionDropdownItems({
      ...baseArgs,
      query: "",
      includeBroadcastMentions: false,
    });

    expect(items.map((item) => item.uid)).toEqual(["u1", "bot1", "u2"]);
  });

  it("keeps broadcast mentions hidden while filtering members", () => {
    const items = buildMentionDropdownItems({
      ...baseArgs,
      query: "Ali",
    });

    expect(items.map((item) => item.uid)).toEqual(["u1"]);
  });

  it.each(["zhangsan", "ZHANGSAN", "san", "zs"])(
    "matches Chinese member names with the pinyin query %s",
    (query) => {
      const items = buildMentionDropdownItems({
        ...baseArgs,
        query,
      });

      expect(items.map((item) => item.uid)).toEqual(["u2"]);
    },
  );
});

describe("mentionUidStateFromRobot", () => {
  it("classifies only explicit robot metadata as bot or user", () => {
    expect(mentionUidStateFromRobot(1)).toBe("bot");
    expect(mentionUidStateFromRobot(0)).toBe("user");
  });

  it("treats missing or malformed robot metadata as unknown", () => {
    expect(mentionUidStateFromRobot(undefined)).toBe("unknown");
    expect(mentionUidStateFromRobot(null)).toBe("unknown");
    expect(mentionUidStateFromRobot("1")).toBe("unknown");
    expect(mentionUidStateFromRobot(true)).toBe("unknown");
  });
});
