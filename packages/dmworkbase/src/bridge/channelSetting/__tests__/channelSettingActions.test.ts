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

vi.mock("../../../App", () => ({
  default: {},
}));

vi.mock("../../../im-runtime/currentChannelRuntime", () => ({
  deleteCurrentImChannelInfo: vi.fn(),
  fetchCurrentImChannelInfo: vi.fn(),
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
    syncCurrentChannelSubscribers: vi.fn(() => Promise.resolve()),
    topChannel: vi.fn(() => Promise.resolve()),
    transferOwner: vi.fn(() => Promise.resolve()),
    updateChannelField: vi.fn(() => Promise.resolve()),
    updateSubscriberAttr: vi.fn(() => Promise.resolve()),
    updateThread: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
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

  it("adds and removes subscribers through the runtime", async () => {
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
      deleteConversation: vi.fn(() => Promise.reject(new Error("delete failed"))),
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
