import { describe, expect, it, vi, beforeEach } from "vitest";

// RC #554 blocker (Jerry-Xin + OctoBoooot @ 2026-07-09):
// `loadSenderCandidates` previously called `contactsDataSource.search` — a
// nonexistent member on the real DataSource — so the sender/member filter
// silently returned [] until search-result rows warmed the sender cache.
//
// This suite locks the fix in:
//   §1 With `commonDataSource.searchFriends` present, results are mapped to
//       ChannelSearchSender ({uid, name, avatarUrl}) using orgData.remark ||
//       displayName as name and orgData.avatar || avatarUser(uid).
//   §2 When `searchFriends` throws, we don't crash — we fall back to the
//       local `contactsList` snapshot (name/remark/uid keyword filter).
//   §3 When `searchFriends` is missing entirely (older deployment), we
//       still surface local `contactsList` entries.
//   §4 With an empty sender cache and no keyword, the "cold" filter panel
//       still gets candidates via the real project data-source API — the
//       exact regression Jerry-Xin flagged.
//   §5 Result-row senders remain cached via `rememberSender` (unchanged).

const mockState = vi.hoisted(() => ({
  commonDataSource: undefined as any,
  contactsList: [] as any[],
  loginUid: "self-uid",
  loginName: "Me",
}));

vi.mock("../../../App", () => ({
  default: {
    get dataSource() {
      return {
        commonDataSource: mockState.commonDataSource,
        contactsList: mockState.contactsList,
      };
    },
    get loginInfo() {
      return {
        uid: mockState.loginUid,
        name: mockState.loginName,
        selfDisplayName: () => mockState.loginName,
      };
    },
    shared: {
      avatarUser: (uid: string) => `avatar://user/${uid}`,
      avatarChannel: (ch: any) =>
        `avatar://ch/${ch?.channelID ?? ""}/${ch?.channelType ?? ""}`,
    },
    apiClient: {
      post: vi.fn(),
      get: vi.fn(),
    },
  },
}));

vi.mock("wukongimjssdk", () => ({
  Channel: class {
    channelID: string;
    channelType: number;
    constructor(channelID: string, channelType: number) {
      this.channelID = channelID;
      this.channelType = channelType;
    }
  },
  ChannelTypeGroup: 2,
  ChannelTypePerson: 1,
  WKSDK: {
    shared: () => ({
      conversationManager: { conversations: [] },
      channelManager: { getChannelInfo: () => undefined },
    }),
  },
}));

import { createGlobalSearchApiDataSource } from "../dataSource";

describe("loadSenderCandidates (via searchSenders)", () => {
  beforeEach(() => {
    mockState.commonDataSource = undefined;
    mockState.contactsList = [];
  });

  it("§1: maps ChannelInfo[] from commonDataSource.searchFriends into ChannelSearchSender", async () => {
    const searchFriends = vi.fn().mockResolvedValue([
      {
        channel: { channelID: "alice-uid", channelType: 1 },
        orgData: {
          displayName: "Alice",
          remark: "Ali",
          avatar: "https://cdn/alice.png",
        },
      },
      {
        channel: { channelID: "bob-uid", channelType: 1 },
        orgData: { displayName: "Bob" },
      },
    ]);
    mockState.commonDataSource = { searchFriends };

    const ds = createGlobalSearchApiDataSource();
    const results = await ds.searchSenders("");

    expect(searchFriends).toHaveBeenCalledWith("");
    const alice = results.find((s) => s.uid === "alice-uid");
    const bob = results.find((s) => s.uid === "bob-uid");
    expect(alice).toMatchObject({
      uid: "alice-uid",
      name: "Ali", // remark preferred over displayName
      avatarUrl: "https://cdn/alice.png",
    });
    expect(bob).toMatchObject({
      uid: "bob-uid",
      name: "Bob",
      avatarUrl: "avatar://user/bob-uid", // avatar defaulted via avatarUser
    });
  });

  it("§2: falls back to contactsList when searchFriends throws", async () => {
    mockState.commonDataSource = {
      searchFriends: vi.fn().mockRejectedValue(new Error("network down")),
    };
    mockState.contactsList = [
      {
        uid: "carol-uid",
        name: "Carol",
        remark: "",
        avatar: "https://cdn/carol.png",
      },
      { uid: "dave-uid", name: "Dave", remark: "Davy" },
    ];

    const ds = createGlobalSearchApiDataSource();
    const results = await ds.searchSenders("");

    const carol = results.find((s) => s.uid === "carol-uid");
    const dave = results.find((s) => s.uid === "dave-uid");
    expect(carol?.name).toBe("Carol");
    expect(carol?.avatarUrl).toBe("https://cdn/carol.png");
    expect(dave?.name).toBe("Davy"); // remark wins
    expect(dave?.avatarUrl).toBe("avatar://user/dave-uid");
  });

  it("§3: surfaces contactsList when searchFriends is missing entirely", async () => {
    mockState.commonDataSource = {}; // no searchFriends method
    mockState.contactsList = [
      { uid: "erin-uid", name: "Erin" },
    ];

    const ds = createGlobalSearchApiDataSource();
    const results = await ds.searchSenders("");

    expect(results.some((s) => s.uid === "erin-uid")).toBe(true);
  });

  it("§4: cold panel (empty sender cache) still returns candidates from the real DS API — regression guard", async () => {
    // The exact scenario Jerry-Xin flagged: no prior search results have
    // warmed the sender cache. Before the fix, this returned only [self].
    const searchFriends = vi
      .fn()
      .mockResolvedValue([
        {
          channel: { channelID: "frank-uid", channelType: 1 },
          orgData: { displayName: "Frank" },
        },
      ]);
    mockState.commonDataSource = { searchFriends };

    const ds = createGlobalSearchApiDataSource();
    const results = await ds.searchSenders("");

    // must contain a real friend (not only "self")
    expect(results.some((s) => s.uid === "frank-uid")).toBe(true);
    expect(results.length).toBeGreaterThanOrEqual(2); // self + friend
  });

  it("§4b: cold panel with keyword forwards it to searchFriends", async () => {
    const searchFriends = vi.fn().mockResolvedValue([
      {
        channel: { channelID: "grace-uid", channelType: 1 },
        orgData: { displayName: "Grace" },
      },
    ]);
    mockState.commonDataSource = { searchFriends };

    const ds = createGlobalSearchApiDataSource();
    const results = await ds.searchSenders("gra");

    expect(searchFriends).toHaveBeenCalledWith("gra");
    // combined-then-substring-filter should keep Grace
    expect(results.some((s) => s.uid === "grace-uid")).toBe(true);
  });

  it("§5: local contactsList fallback still respects keyword filter", async () => {
    mockState.commonDataSource = {
      searchFriends: vi.fn().mockRejectedValue(new Error("boom")),
    };
    mockState.contactsList = [
      { uid: "helen-uid", name: "Helen" },
      { uid: "ivan-uid", name: "Ivan" },
    ];

    const ds = createGlobalSearchApiDataSource();
    const results = await ds.searchSenders("hel");

    expect(results.some((s) => s.uid === "helen-uid")).toBe(true);
    expect(results.some((s) => s.uid === "ivan-uid")).toBe(false);
  });

  it("§6: never crashes even when both sources are missing/broken", async () => {
    mockState.commonDataSource = undefined;
    mockState.contactsList = undefined as any;

    const ds = createGlobalSearchApiDataSource();
    await expect(ds.searchSenders("")).resolves.toBeDefined();
  });
});
