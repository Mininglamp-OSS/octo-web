import { describe, expect, it, vi } from "vitest";
import {
  buildGlobalSearchPinyinIndex,
  createNamedPinyinSearchIndex,
  extendNamedPinyinSearchIndex,
  mergeGlobalSearchPinyinResults,
  refreshGlobalSearchGroupCandidates,
  rebuildGlobalSearchPinyinIndex,
  replaceGlobalSearchPinyinMatches,
  searchNamedPinyinIndex,
  searchGlobalSearchPinyinIndex,
} from "./globalSearchPinyin";

describe("global search pinyin index", () => {
  const source = {
    friends: [
      {
        channel_id: "u1",
        channel_type: 1,
        channel_name: "魏娇莹",
      },
    ],
    groups: [
      {
        channel_id: "g1",
        channel_type: 2,
        channel_name: "魏娇莹项目群",
      },
    ],
  };

  it("matches Chinese, full pinyin and case-insensitive pinyin", () => {
    const index = buildGlobalSearchPinyinIndex(source);

    expect(searchGlobalSearchPinyinIndex("魏娇", index).friends).toHaveLength(
      1
    );
    expect(
      searchGlobalSearchPinyinIndex("weijiao", index).friends
    ).toHaveLength(1);
    expect(searchGlobalSearchPinyinIndex("WEIJIAO", index).groups).toHaveLength(
      1
    );
  });

  it("uses the visible remark for matching", () => {
    const index = buildGlobalSearchPinyinIndex({
      friends: [
        {
          channel_id: "u1",
          channel_type: 1,
          channel_name: "原名",
          channel_remark: "魏娇莹",
        },
      ],
      groups: [],
    });

    expect(
      searchGlobalSearchPinyinIndex("weijiao", index).friends
    ).toHaveLength(1);
    expect(
      searchGlobalSearchPinyinIndex("yuanming", index).friends
    ).toHaveLength(0);
  });

  it("keeps server order and appends only non-duplicate local matches", () => {
    const serverFriend = {
      channel_id: "server",
      channel_type: 1,
      channel_name: "Server",
    };
    const duplicateLocal = { ...serverFriend, channel_name: "Local duplicate" };
    const localOnly = {
      channel_id: "local",
      channel_type: 1,
      channel_name: "Local",
    };

    const merged = mergeGlobalSearchPinyinResults(
      { friends: [serverFriend], groups: [], messages: [] },
      { friends: [duplicateLocal, localOnly], groups: [] }
    );

    expect(merged.friends).toEqual([serverFriend, localOnly]);
    expect(merged.messages).toEqual([]);
  });

  it("keeps a later server match when the local index has no match", () => {
    const index = buildGlobalSearchPinyinIndex({ friends: [], groups: [] });
    const localResult = searchGlobalSearchPinyinIndex("later", index);
    const laterServerMatch = {
      channel_id: "later-page-user",
      channel_type: 1,
      channel_name: "Later Server Match",
    };

    const merged = mergeGlobalSearchPinyinResults(
      { friends: [laterServerMatch], groups: [], messages: [] },
      localResult
    );

    expect(merged.friends).toEqual([laterServerMatch]);
  });

  it("converts 10,000 names once and reuses the index", () => {
    const toPinyin = vi.fn((name: string) =>
      name === "魏娇莹" ? "weijiaoying" : name
    );
    const largeSource = {
      friends: Array.from({ length: 10_000 }, (_, index) => ({
        channel_id: `u${index}`,
        channel_type: 1,
        channel_name: index === 9_999 ? "魏娇莹" : `User ${index}`,
      })),
      groups: [],
    };
    const index = buildGlobalSearchPinyinIndex(largeSource, toPinyin);

    for (let count = 0; count < 20; count += 1) {
      expect(
        searchGlobalSearchPinyinIndex("weijiao", index).friends
      ).toHaveLength(1);
    }

    expect(toPinyin).toHaveBeenCalledTimes(10_000);
  });

  it("rebuilds changed snapshots without reconverting unchanged names", () => {
    const toPinyin = vi.fn((name: string) =>
      name === "全能接项目小组" ? "quannengjiexiangmuxiaozu" : name
    );
    const initial = buildGlobalSearchPinyinIndex(source, toPinyin);
    toPinyin.mockClear();

    const rebuilt = rebuildGlobalSearchPinyinIndex(
      initial,
      {
        friends: source.friends,
        groups: [
          ...source.groups,
          {
            channel_id: "g2",
            channel_type: 2,
            channel_name: "全能接项目小组",
          },
        ],
      },
      toPinyin
    );

    expect(toPinyin).toHaveBeenCalledTimes(1);
    expect(
      searchGlobalSearchPinyinIndex("quanneng", rebuilt).groups?.map(
        (item) => item.channel_id
      )
    ).toEqual(["g2"]);

    toPinyin.mockClear();
    const rebuiltAgain = rebuildGlobalSearchPinyinIndex(rebuilt, {
      friends: source.friends,
      groups: [
        ...source.groups,
        {
          channel_id: "g2",
          channel_type: 2,
          channel_name: "全能接项目小组",
        },
      ],
    });
    expect(toPinyin).not.toHaveBeenCalled();
    expect(
      searchGlobalSearchPinyinIndex("quanneng", rebuiltAgain).groups
    ).toHaveLength(1);
  });

  it("rebuilds authoritative snapshots without removed or renamed entries", () => {
    const initial = buildGlobalSearchPinyinIndex({
      friends: [
        {
          channel_id: "u1",
          channel_type: 1,
          channel_name: "魏娇莹",
        },
      ],
      groups: [
        {
          channel_id: "g1",
          channel_type: 2,
          channel_name: "旧项目群",
        },
      ],
    });
    expect(
      searchGlobalSearchPinyinIndex("weijiao", initial).friends
    ).toHaveLength(1);
    expect(
      searchGlobalSearchPinyinIndex("jiuxiangmu", initial).groups
    ).toHaveLength(1);

    const refreshed = buildGlobalSearchPinyinIndex({
      friends: [
        {
          channel_id: "u1",
          channel_type: 1,
          channel_name: "张小明",
        },
      ],
      groups: [],
    });

    expect(searchGlobalSearchPinyinIndex("weijiao", refreshed).friends).toEqual(
      []
    );
    expect(
      searchGlobalSearchPinyinIndex("zhangxiao", refreshed).friends
    ).toHaveLength(1);
    expect(
      searchGlobalSearchPinyinIndex("jiuxiangmu", refreshed).groups
    ).toEqual([]);
  });

  it("replaces previously merged local rows from the latest server baseline", () => {
    const staleLocalFriend = {
      channel_id: "removed-user",
      channel_type: 1,
      channel_name: "已删除联系人",
    };
    const staleLocalGroup = {
      channel_id: "removed-group",
      channel_type: 2,
      channel_name: "已退出群聊",
    };
    const current = {
      friends: [staleLocalFriend],
      groups: [staleLocalGroup],
      messages: [{ message_id: "message-1" }],
    };

    const replaced = replaceGlobalSearchPinyinMatches(
      current,
      { friends: [], groups: [] },
      { friends: [], groups: [] }
    );

    expect(replaced.friends).toEqual([]);
    expect(replaced.groups).toEqual([]);
    expect(replaced.messages).toEqual(current.messages);
  });

  it("keeps the last successful group snapshot on load failure but accepts an authoritative empty snapshot", () => {
    const current = [
      {
        channel_id: "g1",
        channel_type: 2,
        channel_name: "仍可见群聊",
      },
    ];

    expect(refreshGlobalSearchGroupCandidates(current, undefined)).toBe(
      current
    );
    expect(refreshGlobalSearchGroupCandidates(current, [])).toEqual([]);
  });

  it("matches the real group name with the project's pinyin converter", () => {
    const index = buildGlobalSearchPinyinIndex({
      friends: [],
      groups: [
        {
          channel_id: "g2",
          channel_type: 2,
          channel_name: "全能接项目小组",
        },
      ],
    });

    expect(
      searchGlobalSearchPinyinIndex("quanneng", index).groups
    ).toHaveLength(1);
  });

  it("reuses a generic named index for sender, member and channel pickers", () => {
    const toPinyin = vi.fn((value: string) =>
      value === "魏娇莹" ? "weijiaoying" : value
    );
    const index = createNamedPinyinSearchIndex<{ id: string; name: string }>();
    const items = [{ id: "u1", name: "魏娇莹" }];

    extendNamedPinyinSearchIndex(
      index,
      items,
      (item) => item.id,
      (item) => [item.name, item.id],
      toPinyin
    );
    extendNamedPinyinSearchIndex(
      index,
      items,
      (item) => item.id,
      (item) => [item.name, item.id],
      toPinyin
    );

    expect(searchNamedPinyinIndex("weijiao", index)).toEqual(items);
    expect(toPinyin).toHaveBeenCalledTimes(2);
  });
});
