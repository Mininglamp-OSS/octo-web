import { ChannelTypeGroup, ChannelTypePerson } from "wukongimjssdk";
import { describe, expect, it, vi } from "vitest";

import {
  buildGroupCreateCandidateContacts,
  collectSpaceMembers,
  loadGroupCreateCandidates,
  submitGroupCreateAction,
} from "./groupCreateRuntime";
import type { GroupCreateRuntime } from "./types";

vi.mock("@octo/base", () => ({
  WKApp: {},
  getCurrentImChannelInfo: vi.fn(),
  getCurrentImChannelSubscribers: vi.fn(),
  syncCurrentImChannelSubscribers: vi.fn(),
}));

vi.mock("@octo/base/src/Utils/const", () => ({
  SuperGroup: "super-group",
}));

function createRuntime(
  overrides: Partial<GroupCreateRuntime> = {}
): GroupCreateRuntime {
  return {
    addSubscribers: vi.fn(),
    createChannel: vi.fn(),
    getAvatarUser: vi.fn((uid) => `avatar:${uid}`),
    getContactsList: vi.fn(() => []),
    getCurrentChannelInfo: vi.fn(() => ({})),
    getCurrentChannelSubscribers: vi.fn(() => []),
    getCurrentSpaceId: vi.fn(() => undefined),
    getLoginUid: vi.fn(() => "self"),
    getSpaceMembers: vi.fn(() => Promise.resolve([])),
    getSuperGroupSubscribers: vi.fn(() => Promise.resolve([])),
    showConversation: vi.fn(),
    syncCurrentChannelSubscribers: vi.fn(() => Promise.resolve(undefined)),
    ...overrides,
  };
}

describe("group create runtime bridge", () => {
  it("filters existing subscribers, system accounts and current user when requested", () => {
    expect(
      buildGroupCreateCandidateContacts({
        contacts: [
          { uid: "existing", name: "Existing" },
          { uid: "botfather", name: "Botfather" },
          { uid: "fileHelper", name: "File Helper" },
          { uid: "self", name: "Self" },
          { uid: "alice", name: "Alice", robot: 1 },
        ],
        excludedUids: ["existing"],
        currentUid: "self",
        excludeCurrentUid: true,
        avatarForUid: (uid) => `avatar:${uid}`,
      })
    ).toEqual([
      {
        uid: "alice",
        name: "Alice",
        avatar: "avatar:alice",
        robot: 1,
      },
    ]);
  });

  it("collects space members by page until the last page", async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce([
        { uid: "u1", name: "User 1" },
        { uid: "u2", name: "User 2" },
      ])
      .mockResolvedValueOnce([{ uid: "u3", name: "User 3" }]);

    await expect(
      collectSpaceMembers(fetchPage, { pageSize: 2, maxPages: 5 })
    ).resolves.toEqual([
      { uid: "u1", name: "User 1" },
      { uid: "u2", name: "User 2" },
      { uid: "u3", name: "User 3" },
    ]);
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(fetchPage).toHaveBeenNthCalledWith(1, 1, 2);
    expect(fetchPage).toHaveBeenNthCalledWith(2, 2, 2);
  });

  it("loads space candidates after syncing current group subscribers", async () => {
    const runtime = createRuntime({
      getCurrentSpaceId: vi.fn(() => "space-1"),
      getCurrentChannelSubscribers: vi.fn(() => [{ uid: "existing" }]),
      getSpaceMembers: vi.fn((spaceId, page) =>
        Promise.resolve(
          page === 1
            ? [
                { uid: "existing", name: "Existing" },
                { uid: "self", name: "Self" },
                { uid: "botfather", name: "Botfather" },
                { uid: "alice", name: "Alice", avatar: "alice.png", robot: 1 },
              ]
            : []
        )
      ),
    });

    await expect(
      loadGroupCreateCandidates({
        channel: { channelID: "group-1", channelType: ChannelTypeGroup },
        runtime,
      })
    ).resolves.toEqual([
      {
        uid: "alice",
        name: "Alice",
        avatar: "alice.png",
        robot: true,
      },
    ]);
    expect(runtime.syncCurrentChannelSubscribers).toHaveBeenCalledTimes(1);
  });

  it("falls back to contacts list when space members cannot be loaded", async () => {
    const runtime = createRuntime({
      getCurrentSpaceId: vi.fn(() => "space-1"),
      getContactsList: vi.fn(() => [{ uid: "alice", name: "Alice", robot: 0 }]),
      getSpaceMembers: vi.fn(() => Promise.reject(new Error("network"))),
    });

    await expect(
      loadGroupCreateCandidates({
        channel: { channelID: "", channelType: ChannelTypePerson },
        runtime,
      })
    ).resolves.toEqual([
      {
        uid: "alice",
        name: "Alice",
        avatar: "avatar:alice",
        robot: 0,
      },
    ]);
  });

  it("creates a group with avatar options and opens the created conversation", async () => {
    const runtime = createRuntime({
      createChannel: vi.fn(() => Promise.resolve({ group_no: "group-created" })),
    });

    await submitGroupCreateAction({
      action: "createGroup",
      channel: { channelID: "", channelType: ChannelTypePerson },
      selectedUids: ["alice"],
      createOptions: {
        categoryId: "category-1",
        name: "Team",
        avatarText: "T",
        avatarColor: 2,
      },
      keepSidebarTab: true,
      runtime,
    });

    expect(runtime.createChannel).toHaveBeenCalledWith(["alice"], {
      categoryId: "category-1",
      name: "Team",
      avatarText: "T",
      avatarColor: 2,
    });
    expect(runtime.showConversation).toHaveBeenCalledWith(
      expect.objectContaining({ channelID: "group-created" }),
      { fromSidebarList: true }
    );
  });

  it("creates a group from a private chat by including self and peer", async () => {
    const runtime = createRuntime({
      createChannel: vi.fn(() => Promise.resolve({ group_no: "group-created" })),
    });

    await submitGroupCreateAction({
      action: "addMember",
      channel: { channelID: "peer", channelType: ChannelTypePerson },
      selectedUids: ["alice", "peer"],
      runtime,
    });

    expect(runtime.createChannel).toHaveBeenCalledWith([
      "self",
      "peer",
      "alice",
    ]);
    expect(runtime.showConversation).toHaveBeenCalledWith(
      expect.objectContaining({ channelID: "group-created" })
    );
  });

  it("adds subscribers directly for an existing group", async () => {
    const runtime = createRuntime();

    await submitGroupCreateAction({
      action: "addMember",
      channel: { channelID: "group-1", channelType: ChannelTypeGroup },
      selectedUids: ["alice", "bob"],
      runtime,
    });

    expect(runtime.addSubscribers).toHaveBeenCalledWith(
      expect.objectContaining({ channelID: "group-1" }),
      ["alice", "bob"]
    );
    expect(runtime.createChannel).not.toHaveBeenCalled();
  });
});
