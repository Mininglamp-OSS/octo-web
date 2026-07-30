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
  fetchCurrentImChannelInfo: vi.fn(),
  getCurrentImChannelInfo: vi.fn(),
  getCurrentImChannelSubscribers: vi.fn(),
  notifyCurrentImSubscriberChangeListeners: vi.fn(),
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
    fetchCurrentChannelInfo: vi.fn(() => Promise.resolve(undefined)),
    fetchChannelSubscriber: vi.fn((channel, uid) =>
      Promise.resolve({ uid, name: `member:${uid}` })
    ),
    getLoginUid: vi.fn(() => "self"),
    getSpaceMembers: vi.fn(() => Promise.resolve([])),
    getSuperGroupSubscribers: vi.fn(() => Promise.resolve([])),
    showConversation: vi.fn(),
    notifyCurrentChannelSubscribers: vi.fn(),
    setCurrentChannelSubscribers: vi.fn(),
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
    expect(runtime.syncCurrentChannelSubscribers).not.toHaveBeenCalled();
    expect(runtime.notifyCurrentChannelSubscribers).not.toHaveBeenCalled();
    expect(runtime.fetchCurrentChannelInfo).not.toHaveBeenCalled();
  });

  it("adds subscribers directly for an existing group and refreshes member state", async () => {
    const runtime = createRuntime({
      getCurrentChannelSubscribers: vi.fn(() => [{ uid: "owner" }]),
    });

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
    expect(runtime.syncCurrentChannelSubscribers).toHaveBeenCalledWith(
      expect.objectContaining({ channelID: "group-1" })
    );
    expect(runtime.notifyCurrentChannelSubscribers).toHaveBeenCalledWith(
      expect.objectContaining({ channelID: "group-1" })
    );
    expect(runtime.fetchCurrentChannelInfo).toHaveBeenCalledWith(
      expect.objectContaining({ channelID: "group-1" })
    );
    expect(runtime.fetchChannelSubscriber).toHaveBeenCalledWith(
      expect.objectContaining({ channelID: "group-1" }),
      "alice"
    );
    expect(runtime.fetchChannelSubscriber).toHaveBeenCalledWith(
      expect.objectContaining({ channelID: "group-1" }),
      "bob"
    );
    expect(runtime.setCurrentChannelSubscribers).toHaveBeenCalledWith(
      expect.objectContaining({ channelID: "group-1" }),
      [
        { uid: "owner" },
        expect.objectContaining({ uid: "alice", name: "member:alice" }),
        expect.objectContaining({ uid: "bob", name: "member:bob" }),
      ]
    );
  });

  it("does not refresh member state when adding subscribers to an existing group fails", async () => {
    const runtime = createRuntime({
      addSubscribers: vi.fn(() => Promise.reject(new Error("add failed"))),
    });

    await expect(
      submitGroupCreateAction({
        action: "addMember",
        channel: { channelID: "group-1", channelType: ChannelTypeGroup },
        selectedUids: ["alice"],
        runtime,
      })
    ).rejects.toThrow("add failed");

    expect(runtime.syncCurrentChannelSubscribers).not.toHaveBeenCalled();
    expect(runtime.notifyCurrentChannelSubscribers).not.toHaveBeenCalled();
    expect(runtime.fetchCurrentChannelInfo).not.toHaveBeenCalled();
  });

  it("still fills newly added subscribers when existing group sync fails", async () => {
    const runtime = createRuntime({
      getCurrentChannelSubscribers: vi.fn(() => [{ uid: "owner" }]),
      syncCurrentChannelSubscribers: vi.fn(() =>
        Promise.reject(new Error("sync failed"))
      ),
    });

    await submitGroupCreateAction({
      action: "addMember",
      channel: { channelID: "group-1", channelType: ChannelTypeGroup },
      selectedUids: ["alice"],
      runtime,
    });

    expect(runtime.setCurrentChannelSubscribers).toHaveBeenCalledWith(
      expect.objectContaining({ channelID: "group-1" }),
      [
        { uid: "owner" },
        expect.objectContaining({ uid: "alice", name: "member:alice" }),
      ]
    );
    expect(runtime.notifyCurrentChannelSubscribers).toHaveBeenCalledWith(
      expect.objectContaining({ channelID: "group-1" })
    );
    expect(runtime.fetchCurrentChannelInfo).toHaveBeenCalledWith(
      expect.objectContaining({ channelID: "group-1" })
    );
  });
});
