import { Channel, ChannelTypeGroup, ChannelTypePerson } from "wukongimjssdk";
import { describe, expect, it, vi } from "vitest";

import {
  addChannelSettingSubscribers,
  clearChannelSettingMessages,
  createGroupFromChannelSettingPrivateChat,
  exitChannelSettingGroup,
  leaveChannelSettingThread,
  muteChannelSetting,
  remarkChannelSetting,
  removeChannelSettingSubscribers,
  saveChannelSetting,
  topChannelSetting,
  transferChannelSettingOwner,
  updateChannelSettingField,
  updateChannelSettingMyGroupNickname,
  updateChannelSettingThreadName,
  type ChannelSettingActionRuntime,
} from "../channelSettingActions";
import { ChannelField } from "../../../Service/DataSource/DataSource";
import {
  ChannelTypeCommunityTopic,
  SubscriberStatus,
} from "../../../Service/Const";

vi.mock("../../../App", () => ({
  default: {},
}));

vi.mock("../../../im-runtime/currentChannelRuntime", () => ({
  clearCurrentImChannelSubscribersLocallyRemoved: vi.fn(),
  deleteCurrentImChannelInfo: vi.fn(),
  fetchCurrentImChannelInfo: vi.fn(),
  getCurrentImChannelSubscribers: vi.fn(() => []),
  getCurrentImChannelSubscribersCacheRaw: vi.fn(() => undefined),
  markCurrentImChannelSubscribersLocallyRemoved: vi.fn(),
  notifyCurrentImSubscriberChangeListeners: vi.fn(),
  setCurrentImChannelSubscribersCache: vi.fn(),
  syncCurrentImChannelSubscribers: vi.fn(),
}));

function createRuntime(
  overrides: Partial<ChannelSettingActionRuntime> = {}
): ChannelSettingActionRuntime {
  return {
    addSubscribers: vi.fn(() => Promise.resolve()),
    clearConversationMessages: vi.fn(() => Promise.resolve()),
    createChannel: vi.fn(() => Promise.resolve(undefined)),
    deleteConversation: vi.fn(() => Promise.resolve()),
    deleteCurrentChannelInfo: vi.fn(),
    exitChannel: vi.fn(() => Promise.resolve()),
    fetchCurrentChannelInfo: vi.fn(() => Promise.resolve(undefined)),
    fetchChannelSubscriber: vi.fn((channel, uid) =>
      Promise.resolve({ uid, name: `member:${uid}` })
    ),
    getCurrentChannelSubscribers: vi.fn(() => []),
    getCurrentChannelInfo: vi.fn(() => undefined),
    getPendingChannelInfoFetch: vi.fn(() => undefined),
    getCurrentChannelSubscribersRaw: vi.fn(() => undefined),
    findConversation: vi.fn(),
    getLoginUid: vi.fn(() => "self"),
    invokeClearChannelMessages: vi.fn(),
    leaveThread: vi.fn(() => Promise.resolve()),
    muteChannel: vi.fn(() => Promise.resolve()),
    removeLocalConversationAndCloseIfOpen: vi.fn(),
    removeSubscribers: vi.fn(() => Promise.resolve()),
    remarkChannel: vi.fn(() => Promise.resolve()),
    saveChannel: vi.fn(() => Promise.resolve()),
    showConversation: vi.fn(),
    clearRemovedChannelSubscribers: vi.fn(),
    markRemovedChannelSubscribers: vi.fn(),
    notifyCurrentChannelSubscribers: vi.fn(),
    notifyCurrentChannelInfo: vi.fn(),
    setCurrentChannelSubscribers: vi.fn(),
    setCurrentChannelInfo: vi.fn(),
    syncCurrentChannelSubscribers: vi.fn(() => Promise.resolve()),
    topChannel: vi.fn(() => Promise.resolve()),
    transferOwner: vi.fn(() => Promise.resolve()),
    updateChannelField: vi.fn(() => Promise.resolve()),
    updateSubscriberAttr: vi.fn(() => Promise.resolve()),
    updateThread: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
}

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("channel setting actions", () => {
  it("creates a group from private chat members and opens the conversation", async () => {
    const runtime = createRuntime({
      createChannel: vi.fn(() => Promise.resolve({ group_no: "group-1" })),
    });
    const channel = new Channel("peer", ChannelTypePerson);

    await createGroupFromChannelSettingPrivateChat({
      channel,
      selectedUids: ["alice", "bob"],
      runtime,
    });

    expect(runtime.createChannel).toHaveBeenCalledWith([
      "self",
      "peer",
      "alice",
      "bob",
    ]);
    expect(runtime.showConversation).toHaveBeenCalledWith(
      expect.objectContaining({ channelID: "group-1", channelType: 2 })
    );
  });

  it("adds and removes subscribers then refreshes member and channel caches", async () => {
    const runtime = createRuntime();
    const channel = new Channel("group-1", ChannelTypeGroup);

    await addChannelSettingSubscribers({
      channel,
      uids: ["alice"],
      runtime,
    });
    await removeChannelSettingSubscribers({
      channel,
      uids: ["bob"],
      runtime,
    });

    expect(runtime.addSubscribers).toHaveBeenCalledWith(channel, ["alice"]);
    expect(runtime.removeSubscribers).toHaveBeenCalledWith(channel, ["bob"]);
    expect(runtime.clearRemovedChannelSubscribers).toHaveBeenCalledWith(
      channel,
      ["alice"]
    );
    expect(runtime.markRemovedChannelSubscribers).toHaveBeenCalledWith(
      channel,
      ["bob"]
    );
    expect(runtime.syncCurrentChannelSubscribers).toHaveBeenCalledTimes(2);
    expect(runtime.syncCurrentChannelSubscribers).toHaveBeenNthCalledWith(
      1,
      channel
    );
    expect(runtime.syncCurrentChannelSubscribers).toHaveBeenNthCalledWith(
      2,
      channel
    );
    expect(runtime.notifyCurrentChannelSubscribers).toHaveBeenCalledTimes(2);
    expect(runtime.notifyCurrentChannelSubscribers).toHaveBeenNthCalledWith(
      1,
      channel
    );
    expect(runtime.notifyCurrentChannelSubscribers).toHaveBeenNthCalledWith(
      2,
      channel
    );
    expect(runtime.fetchCurrentChannelInfo).toHaveBeenCalledTimes(2);
    expect(runtime.fetchCurrentChannelInfo).toHaveBeenNthCalledWith(1, channel);
    expect(runtime.fetchCurrentChannelInfo).toHaveBeenNthCalledWith(2, channel);
  });

  it("removes deleted subscribers from the local cache after the server succeeds", async () => {
    const runtime = createRuntime({
      getCurrentChannelSubscribers: vi.fn(() => [
        { uid: "owner" },
        { uid: "alice" },
        { uid: "bob" },
      ]),
    });
    const channel = new Channel("group-1", ChannelTypeGroup);

    await removeChannelSettingSubscribers({
      channel,
      uids: ["alice", "bob"],
      runtime,
    });

    expect(runtime.setCurrentChannelSubscribers).toHaveBeenCalledWith(channel, [
      { uid: "owner" },
    ]);
    expect(runtime.notifyCurrentChannelSubscribers).toHaveBeenCalledWith(
      channel
    );
  });

  it("fills newly added subscribers when sync leaves the local cache incomplete", async () => {
    const runtime = createRuntime({
      getCurrentChannelSubscribers: vi
        .fn()
        .mockReturnValueOnce([{ uid: "owner" }])
        .mockReturnValueOnce([{ uid: "owner" }, { uid: "synced" }]),
      fetchChannelSubscriber: vi.fn((channel, uid) =>
        Promise.resolve({ uid, name: `member:${uid}` })
      ),
    });
    const channel = new Channel("group-1", ChannelTypeGroup);

    await addChannelSettingSubscribers({
      channel,
      uids: ["alice"],
      runtime,
    });

    expect(runtime.fetchChannelSubscriber).toHaveBeenCalledWith(
      channel,
      "alice"
    );
    expect(runtime.setCurrentChannelSubscribers).toHaveBeenCalledWith(channel, [
      { uid: "owner" },
      { uid: "synced" },
      expect.objectContaining({
        uid: "alice",
        name: "member:alice",
        channel,
        status: SubscriberStatus.normal,
      }),
    ]);
    expect(runtime.notifyCurrentChannelSubscribers).toHaveBeenCalledWith(
      channel
    );
  });

  it("refetches and normalizes a cached subscriber that is not renderable yet", async () => {
    const runtime = createRuntime({
      getCurrentChannelSubscribers: vi
        .fn()
        .mockReturnValueOnce([{ uid: "alice" }])
        .mockReturnValueOnce([{ uid: "alice" }]),
      fetchChannelSubscriber: vi.fn((channel, uid) =>
        Promise.resolve({ uid, name: `member:${uid}` })
      ),
    });
    const channel = new Channel("group-1", ChannelTypeGroup);

    await addChannelSettingSubscribers({
      channel,
      uids: ["alice"],
      runtime,
    });

    expect(runtime.fetchChannelSubscriber).toHaveBeenCalledWith(
      channel,
      "alice"
    );
    expect(runtime.setCurrentChannelSubscribers).toHaveBeenCalledWith(channel, [
      expect.objectContaining({
        uid: "alice",
        status: SubscriberStatus.normal,
      }),
    ]);
  });

  it("does not refresh members when adding subscribers fails", async () => {
    const runtime = createRuntime({
      addSubscribers: vi.fn(() => Promise.reject(new Error("add failed"))),
    });
    const channel = new Channel("group-1", ChannelTypeGroup);

    await expect(
      addChannelSettingSubscribers({
        channel,
        uids: ["alice"],
        runtime,
      })
    ).rejects.toThrow("add failed");

    expect(runtime.syncCurrentChannelSubscribers).not.toHaveBeenCalled();
    expect(runtime.notifyCurrentChannelSubscribers).not.toHaveBeenCalled();
    expect(runtime.fetchCurrentChannelInfo).not.toHaveBeenCalled();
  });

  it("still patches removable stale cache when member sync fails after server success", async () => {
    const runtime = createRuntime({
      getCurrentChannelSubscribers: vi.fn(() => [
        { uid: "owner" },
        { uid: "alice" },
      ]),
      syncCurrentChannelSubscribers: vi.fn(() =>
        Promise.reject(new Error("sync failed"))
      ),
    });
    const channel = new Channel("group-1", ChannelTypeGroup);

    await removeChannelSettingSubscribers({
      channel,
      uids: ["alice"],
      runtime,
    });

    expect(runtime.setCurrentChannelSubscribers).toHaveBeenCalledWith(channel, [
      { uid: "owner" },
    ]);
    expect(
      vi.mocked(runtime.setCurrentChannelSubscribers).mock
        .invocationCallOrder[0]
    ).toBeLessThan(
      vi.mocked(runtime.markRemovedChannelSubscribers).mock
        .invocationCallOrder[0]
    );
    expect(
      vi.mocked(runtime.markRemovedChannelSubscribers).mock
        .invocationCallOrder[0]
    ).toBeLessThan(
      vi.mocked(runtime.syncCurrentChannelSubscribers).mock
        .invocationCallOrder[0]
    );
    expect(runtime.notifyCurrentChannelSubscribers).toHaveBeenCalledWith(
      channel
    );
    expect(runtime.fetchCurrentChannelInfo).toHaveBeenCalledWith(channel);
  });

  it("keeps local removal tombstones after sync so stale member-list responses stay filtered", async () => {
    const runtime = createRuntime({
      getCurrentChannelSubscribers: vi
        .fn()
        .mockReturnValueOnce([{ uid: "owner" }, { uid: "hermes" }])
        .mockReturnValueOnce([{ uid: "owner" }]),
    });
    const channel = new Channel("group-1", ChannelTypeGroup);

    await removeChannelSettingSubscribers({
      channel,
      uids: ["hermes"],
      runtime,
    });

    expect(runtime.markRemovedChannelSubscribers).toHaveBeenCalledWith(
      channel,
      ["hermes"]
    );
    expect(runtime.clearRemovedChannelSubscribers).not.toHaveBeenCalledWith(
      channel,
      ["hermes"]
    );
  });

  it("removes members from the local cache before waiting for a later sync", async () => {
    const sync = deferred();
    const runtime = createRuntime({
      getCurrentChannelSubscribers: vi.fn(() => [
        { uid: "owner" },
        { uid: "hermes" },
      ]),
      syncCurrentChannelSubscribers: vi.fn(() => sync.promise),
    });
    const channel = new Channel("group-1", ChannelTypeGroup);

    const remove = removeChannelSettingSubscribers({
      channel,
      uids: ["hermes"],
      runtime,
    });
    await vi.waitFor(() =>
      expect(runtime.setCurrentChannelSubscribers).toHaveBeenCalledWith(
        channel,
        [{ uid: "owner" }]
      )
    );

    sync.resolve();
    await remove;

    expect(runtime.notifyCurrentChannelSubscribers).toHaveBeenCalledWith(
      channel
    );
  });

  it("reapplies cache removal when a successful sync still returns a stale active member", async () => {
    const runtime = createRuntime({
      getCurrentChannelSubscribers: vi
        .fn()
        .mockReturnValueOnce([{ uid: "owner" }, { uid: "hermes" }])
        .mockReturnValueOnce([{ uid: "owner" }, { uid: "hermes" }]),
    });
    const channel = new Channel("group-1", ChannelTypeGroup);

    await removeChannelSettingSubscribers({
      channel,
      uids: ["hermes"],
      runtime,
    });

    expect(runtime.setCurrentChannelSubscribers).toHaveBeenCalledTimes(2);
    expect(runtime.setCurrentChannelSubscribers).toHaveBeenNthCalledWith(
      1,
      channel,
      [{ uid: "owner" }]
    );
    expect(runtime.setCurrentChannelSubscribers).toHaveBeenNthCalledWith(
      2,
      channel,
      [{ uid: "owner" }]
    );
    expect(runtime.notifyCurrentChannelSubscribers).toHaveBeenCalledTimes(2);
    expect(runtime.clearRemovedChannelSubscribers).not.toHaveBeenCalledWith(
      channel,
      ["hermes"]
    );
  });

  it("updates group fields and current user's group nickname", async () => {
    const runtime = createRuntime();
    const channel = new Channel("group-1", ChannelTypeGroup);

    await updateChannelSettingField({
      channel,
      field: ChannelField.channelName,
      value: "New name",
      runtime,
    });
    await updateChannelSettingMyGroupNickname({
      channel,
      remark: "My nick",
      runtime,
    });

    expect(runtime.updateChannelField).toHaveBeenCalledWith(
      channel,
      ChannelField.channelName,
      "New name"
    );
    expect(runtime.updateSubscriberAttr).toHaveBeenCalledWith(channel, "self", {
      remark: "My nick",
    });
  });

  it("updates channel preference settings through the runtime", async () => {
    const runtime = createRuntime();
    const channel = new Channel("group-1", ChannelTypeGroup);

    await muteChannelSetting({ channel, mute: true, runtime });
    await topChannelSetting({ channel, top: true, runtime });
    await saveChannelSetting({ channel, save: false, runtime });
    await remarkChannelSetting({ channel, remark: "remark", runtime });

    expect(runtime.muteChannel).toHaveBeenCalledWith(channel, true);
    expect(runtime.topChannel).toHaveBeenCalledWith(channel, true);
    expect(runtime.saveChannel).toHaveBeenCalledWith(channel, false);
    expect(runtime.remarkChannel).toHaveBeenCalledWith(channel, "remark");
  });

  it("reapplies the latest saved thread mute after an older fetch resolves last", async () => {
    const oldFetch = deferred();
    const channel = new Channel(
      "group-1____thread-1",
      ChannelTypeCommunityTopic
    );
    let cachedChannelInfo = {
      channel,
      mute: false,
      orgData: { thread: { status: 1, mute: 0 } },
    } as any;
    const runtime = createRuntime({
      getCurrentChannelInfo: vi.fn(() => cachedChannelInfo),
      getPendingChannelInfoFetch: vi.fn(() => oldFetch.promise),
    });

    await muteChannelSetting({ channel, mute: true, runtime });

    expect(cachedChannelInfo.mute).toBe(true);
    expect(cachedChannelInfo.orgData.thread.mute).toBe(1);
    expect(runtime.setCurrentChannelInfo).toHaveBeenCalledTimes(1);

    // The SDK's older request lands after the PUT and replaces the cache object.
    cachedChannelInfo = {
      channel,
      mute: false,
      orgData: { thread: { status: 1, mute: 0 } },
    } as any;
    oldFetch.resolve();
    await oldFetch.promise;
    await Promise.resolve();

    expect(cachedChannelInfo.mute).toBe(true);
    expect(cachedChannelInfo.orgData.thread.mute).toBe(1);
    expect(runtime.setCurrentChannelInfo).toHaveBeenCalledTimes(2);
    expect(runtime.notifyCurrentChannelInfo).toHaveBeenCalledTimes(2);
  });

  it("transfers owner and refreshes subscriber and channel caches", async () => {
    const runtime = createRuntime();
    const channel = new Channel("group-1", ChannelTypeGroup);

    await transferChannelSettingOwner({
      channel,
      uid: "alice",
      runtime,
    });

    expect(runtime.transferOwner).toHaveBeenCalledWith(channel, "alice");
    expect(runtime.syncCurrentChannelSubscribers).toHaveBeenCalledWith(channel);
    expect(runtime.fetchCurrentChannelInfo).toHaveBeenCalledWith(channel);
  });

  it("clears conversation messages when a conversation exists", async () => {
    const conversation = { lastMessage: { messageID: "m1" } };
    const runtime = createRuntime({
      findConversation: vi.fn(() => conversation),
    });
    const channel = new Channel("group-1", ChannelTypeGroup);

    await clearChannelSettingMessages({ channel, runtime });

    expect(runtime.clearConversationMessages).toHaveBeenCalledWith(
      conversation
    );
    expect(conversation.lastMessage).toBeUndefined();
    expect(runtime.invokeClearChannelMessages).toHaveBeenCalledWith(channel);
  });

  it("does nothing when clearing messages without a conversation", async () => {
    const runtime = createRuntime({
      findConversation: vi.fn(() => undefined),
    });

    await clearChannelSettingMessages({
      channel: new Channel("group-1", ChannelTypeGroup),
      runtime,
    });

    expect(runtime.clearConversationMessages).not.toHaveBeenCalled();
    expect(runtime.invokeClearChannelMessages).not.toHaveBeenCalled();
  });

  it("exits a group and removes the local conversation even if delete fails", async () => {
    const onDeleteConversationError = vi.fn();
    const runtime = createRuntime({
      deleteConversation: vi.fn(() =>
        Promise.reject(new Error("delete failed"))
      ),
    });
    const channel = new Channel("group-1", ChannelTypeGroup);

    await exitChannelSettingGroup({
      channel,
      runtime,
      onDeleteConversationError,
    });

    expect(runtime.exitChannel).toHaveBeenCalledWith(channel);
    expect(onDeleteConversationError).toHaveBeenCalledTimes(1);
    expect(runtime.removeLocalConversationAndCloseIfOpen).toHaveBeenCalledWith(
      channel
    );
  });

  it("updates thread name then refreshes channel info", async () => {
    const runtime = createRuntime();
    const channel = new Channel("group-1@thread", 12);

    await updateChannelSettingThreadName({
      channel,
      groupNo: "group-1",
      shortId: "T-1",
      name: "Thread name",
      runtime,
    });

    expect(runtime.updateThread).toHaveBeenCalledWith("group-1", "T-1", {
      name: "Thread name",
    });
    expect(runtime.deleteCurrentChannelInfo).toHaveBeenCalledWith(channel);
    expect(runtime.fetchCurrentChannelInfo).toHaveBeenCalledWith(channel);
  });

  it("leaves a thread and removes local conversation", async () => {
    const runtime = createRuntime();
    const channel = new Channel("group-1@thread", 12);

    await leaveChannelSettingThread({
      channel,
      shortId: "T-1",
      runtime,
    });

    expect(runtime.leaveThread).toHaveBeenCalledWith("T-1");
    expect(runtime.deleteConversation).toHaveBeenCalledWith(channel);
    expect(runtime.removeLocalConversationAndCloseIfOpen).toHaveBeenCalledWith(
      channel
    );
  });
});
