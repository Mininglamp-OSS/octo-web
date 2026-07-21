import { describe, expect, it } from "vitest";
import { searchContacts } from "./searchContacts";

describe("searchContacts", () => {
  const source = {
    currentUid: "self",
    spaceMembers: [
      { uid: "self", name: "Self" },
      { uid: "human", name: "**Alice**", robot: 0 },
      { uid: "member-bot", name: "Helper AI", robot: 1 },
    ],
    spaceBots: [
      { uid: "member-bot", name: "Helper AI" },
      { uid: "extra-bot", name: "Extra AI" },
    ],
    myGroups: [{ group_no: "group-1", name: "Alice Group" }],
  };

  it("keeps current matching, exclusion and extra-bot dedup behavior", () => {
    expect(searchContacts("alice", source)).toEqual({
      contacts: [{ uid: "human", name: "**Alice**", robot: 0 }],
      groups: [{ group_no: "group-1", name: "Alice Group" }],
    });
    expect(
      searchContacts("ai", source).contacts.map((item) => item.uid)
    ).toEqual(["member-bot", "extra-bot"]);
    expect(searchContacts("self", source).contacts).toEqual([]);
  });
});
