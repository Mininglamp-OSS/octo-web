import { describe, expect, it, vi } from "vitest";
import {
  buildContactsSearchIndex,
  createEmptyContactsSearchIndex,
  searchContacts,
} from "./searchContacts";

describe("contacts search index", () => {
  const source = {
    currentUid: "self",
    spaceMembers: [
      { uid: "self", name: "Self" },
      { uid: "human", name: "**魏娇莹**", robot: 0 },
      { uid: "member-bot", name: "Helper AI", robot: 1 },
    ],
    spaceBots: [
      { uid: "member-bot", name: "Helper AI" },
      { uid: "extra-bot", name: "Extra AI" },
    ],
    myGroups: [{ group_no: "group-1", name: "魏娇莹 Group" }],
  };

  it("matches Chinese names, full pinyin and case-insensitive pinyin", () => {
    const index = buildContactsSearchIndex(source);

    expect(
      searchContacts("魏娇", index).contacts.map((item) => item.uid)
    ).toEqual(["human"]);
    expect(
      searchContacts("weijiao", index).contacts.map((item) => item.uid)
    ).toEqual(["human"]);
    expect(
      searchContacts("WEIJIAO", index).groups.map((item) => item.group_no)
    ).toEqual(["group-1"]);
  });

  it("preserves current-user exclusion and extra-bot deduplication", () => {
    const index = buildContactsSearchIndex(source);

    expect(
      searchContacts("ai", index).contacts.map((item) => item.uid)
    ).toEqual(["member-bot", "extra-bot"]);
    expect(searchContacts("self", index).contacts).toEqual([]);
  });

  it("returns no results before the current Space index is ready", () => {
    expect(searchContacts("alice", createEmptyContactsSearchIndex())).toEqual({
      contacts: [],
      groups: [],
    });
  });

  it("converts 10,000 names once and reuses the index for repeated queries", () => {
    const toPinyin = vi.fn((name: string) =>
      name === "魏娇莹" ? "weijiaoying" : name
    );
    const largeSource = {
      currentUid: "self",
      spaceMembers: Array.from({ length: 10_000 }, (_, index) => ({
        uid: `user-${index}`,
        name: index === 9_999 ? "魏娇莹" : `User ${index}`,
      })),
      spaceBots: [],
      myGroups: [],
    };
    const index = buildContactsSearchIndex(largeSource, toPinyin);
    const startedAt = performance.now();

    for (let count = 0; count < 20; count += 1) {
      expect(searchContacts("weijiao", index).contacts).toHaveLength(1);
    }

    expect(toPinyin).toHaveBeenCalledTimes(10_000);
    const averageQueryMs = (performance.now() - startedAt) / 20;
    expect(averageQueryMs).toBeLessThan(15);
  });
});
