import { describe, expect, it, vi } from "vitest";

import {
  appendUniqueByKey,
  createNamedPinyinSearchIndex,
  rebuildNamedPinyinSearchIndex,
  searchNamedPinyinIndex,
} from "./globalSearchPinyin";

interface NamedItem {
  id: string;
  name: string;
}

const key = (item: NamedItem) => item.id;
const values = (item: NamedItem) => [item.name, item.id];

describe("global search pinyin helpers", () => {
  it("matches Chinese, full pinyin and case-insensitive pinyin", () => {
    const items = [
      { id: "u1", name: "魏娇莹" },
      { id: "u2", name: "Alice" },
    ];
    const index = rebuildNamedPinyinSearchIndex(
      createNamedPinyinSearchIndex<NamedItem>(),
      items,
      key,
      values
    );

    expect(searchNamedPinyinIndex("魏娇", index)).toEqual([items[0]]);
    expect(searchNamedPinyinIndex("weijiao", index)).toEqual([items[0]]);
    expect(searchNamedPinyinIndex("WEIJIAO", index)).toEqual([items[0]]);
    expect(searchNamedPinyinIndex("", index)).toEqual(items);
  });

  it("rebuilds the authoritative pool and reuses unchanged conversions", () => {
    const toPinyin = vi.fn((name: string) =>
      name === "魏娇莹" ? "weijiaoying" : name
    );
    const first = rebuildNamedPinyinSearchIndex(
      createNamedPinyinSearchIndex<NamedItem>(),
      [
        { id: "u1", name: "魏娇莹" },
        { id: "u2", name: "Alice" },
      ],
      key,
      values,
      toPinyin
    );
    toPinyin.mockClear();

    const rebuilt = rebuildNamedPinyinSearchIndex(
      first,
      [
        { id: "u1", name: "魏娇莹" },
        { id: "u3", name: "Bob" },
      ],
      key,
      values,
      toPinyin
    );

    expect(searchNamedPinyinIndex("alice", rebuilt)).toEqual([]);
    expect(searchNamedPinyinIndex("weijiao", rebuilt)[0].id).toBe("u1");
    expect(toPinyin).toHaveBeenCalledTimes(2);
  });

  it("keeps existing order and appends only new keys", () => {
    const server = [{ id: "server", name: "Server" }];
    const result = appendUniqueByKey(
      server,
      [server[0], { id: "local", name: "Local" }],
      key
    );

    expect(result.map((item) => item.id)).toEqual(["server", "local"]);
  });

  it("converts a 10,000-name pool once and reuses the index", () => {
    const items = Array.from({ length: 10_000 }, (_, index) => ({
      id: `u${index}`,
      name: index === 9_999 ? "魏娇莹" : `User ${index}`,
    }));
    const toPinyin = vi.fn((name: string) =>
      name === "魏娇莹" ? "weijiaoying" : name
    );
    const index = rebuildNamedPinyinSearchIndex(
      createNamedPinyinSearchIndex<NamedItem>(),
      items,
      key,
      (item) => [item.name],
      toPinyin
    );

    for (let count = 0; count < 20; count += 1) {
      expect(searchNamedPinyinIndex("weijiao", index)).toHaveLength(1);
    }
    expect(toPinyin).toHaveBeenCalledTimes(10_000);
  });
});
