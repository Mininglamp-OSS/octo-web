import { Channel, ChannelTypeGroup } from "wukongimjssdk";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../App", () => ({
  default: {
    dataSource: {
      channelDataSource: {
        groupDisband: vi.fn(),
        managerAdd: vi.fn(),
        managerRemove: vi.fn(),
        removeBotAdmin: vi.fn(),
        setBotAdmin: vi.fn(),
        subscribers: vi.fn(),
      },
    },
  },
}));

vi.mock("../../../im-runtime/currentChannelRuntime", () => ({
  addCurrentImChannelInfoListener: vi.fn(),
  fetchCurrentImChannelInfo: vi.fn(),
  getCurrentImChannelInfo: vi.fn(),
}));

vi.mock("../../../Utils/groupDisband", () => ({
  syncGroupDisbandState: vi.fn(),
}));

import { GroupRole } from "../../../Service/Const";
import {
  addGroupManagementBotAdmins,
  addGroupManagementManagers,
  disbandGroupManagementGroup,
  GroupManagementActionRuntime,
  loadGroupManagementMembers,
  readGroupManagementAllowNoMention,
  refreshGroupManagementChannelInfo,
  removeGroupManagementBotAdmin,
  removeGroupManagementManager,
  setGroupManagementAllowNoMention,
  subscribeGroupManagementChannelInfo,
  syncGroupManagementDisbandState,
} from "../groupManagementActions";

function createRuntime(
  overrides: Partial<GroupManagementActionRuntime> = {}
): GroupManagementActionRuntime {
  return {
    addChannelInfoListener: vi.fn(() => vi.fn()),
    addManagers: vi.fn(() => Promise.resolve()),
    disbandGroup: vi.fn(() => Promise.resolve()),
    fetchChannelInfo: vi.fn(() => Promise.resolve()),
    getChannelInfo: vi.fn(() => undefined),
    listSubscribers: vi.fn(() => Promise.resolve([])),
    removeBotAdmin: vi.fn(() => Promise.resolve()),
    removeManagers: vi.fn(() => Promise.resolve()),
    setAllowNoMention: vi.fn(() => Promise.resolve()),
    setBotAdmin: vi.fn(() => Promise.resolve()),
    syncDisbandState: vi.fn(),
    ...overrides,
  };
}

describe("group management actions", () => {
  it("loads members by page and separates managers from bot admins", async () => {
    const channel = new Channel("group-1", ChannelTypeGroup);
    const runtime = createRuntime({
      listSubscribers: vi
        .fn()
        .mockResolvedValueOnce([
          { uid: "owner", role: GroupRole.owner },
          { uid: "manager", role: GroupRole.manager },
        ])
        .mockResolvedValueOnce([
          {
            uid: "bot",
            role: GroupRole.normal,
            orgData: { robot: 1, bot_admin: 1 },
          },
        ]),
    });

    const result = await loadGroupManagementMembers({
      channel,
      pageSize: 2,
      runtime,
    });

    expect(runtime.listSubscribers).toHaveBeenCalledTimes(2);
    expect(runtime.listSubscribers).toHaveBeenNthCalledWith(1, channel, {
      limit: 2,
      page: 1,
    });
    expect(runtime.listSubscribers).toHaveBeenNthCalledWith(2, channel, {
      limit: 2,
      page: 2,
    });
    expect(result.managers.map((item) => item.uid)).toEqual([
      "owner",
      "manager",
    ]);
    expect(result.botAdmins.map((item) => item.uid)).toEqual(["bot"]);
  });

  it("routes manager and bot admin mutations through runtime", async () => {
    const channel = new Channel("group-1", ChannelTypeGroup);
    const runtime = createRuntime();

    await addGroupManagementManagers({
      channel,
      uids: ["alice", "bob"],
      runtime,
    });
    await removeGroupManagementManager({ channel, uid: "alice", runtime });
    await removeGroupManagementBotAdmin({ channel, uid: "bot-a", runtime });

    expect(runtime.addManagers).toHaveBeenCalledWith(channel, [
      "alice",
      "bob",
    ]);
    expect(runtime.removeManagers).toHaveBeenCalledWith(channel, ["alice"]);
    expect(runtime.removeBotAdmin).toHaveBeenCalledWith(channel, "bot-a");
  });

  it("adds every selected bot admin and reports partial failures", async () => {
    const channel = new Channel("group-1", ChannelTypeGroup);
    const runtime = createRuntime({
      setBotAdmin: vi.fn((_channel, uid) =>
        uid === "bot-b" ? Promise.reject({ msg: "boom" }) : Promise.resolve()
      ),
    });

    const result = await addGroupManagementBotAdmins({
      channel,
      uids: ["bot-a", "bot-b", "bot-c"],
      runtime,
    });

    expect(runtime.setBotAdmin).toHaveBeenCalledTimes(3);
    expect(result.succeeded).toEqual(["bot-a", "bot-c"]);
    expect(result.failed.map((item) => item.uid)).toEqual(["bot-b"]);
  });

  it("keeps disband api and local sync as separate actions", async () => {
    const channel = new Channel("group-1", ChannelTypeGroup);
    const runtime = createRuntime();

    await disbandGroupManagementGroup({ channel, runtime });
    syncGroupManagementDisbandState({ channel, runtime });

    expect(runtime.disbandGroup).toHaveBeenCalledWith(channel);
    expect(runtime.syncDisbandState).toHaveBeenCalledWith(channel);
  });

  it("sets allow-no-mention and then refreshes channel info", async () => {
    const channel = new Channel("group-1", ChannelTypeGroup);
    const runtime = createRuntime();

    await setGroupManagementAllowNoMention({
      allow: false,
      channel,
      runtime,
    });

    expect(runtime.setAllowNoMention).toHaveBeenCalledWith(false, channel);
    expect(runtime.fetchChannelInfo).toHaveBeenCalledWith(channel);
  });

  it("reads allow-no-mention from current channel info", () => {
    const channel = new Channel("group-1", ChannelTypeGroup);
    const disabled = createRuntime({
      getChannelInfo: vi.fn(() => ({ orgData: { allow_no_mention: 0 } } as any)),
    });
    const missing = createRuntime({
      getChannelInfo: vi.fn(() => ({ orgData: {} } as any)),
    });

    expect(
      readGroupManagementAllowNoMention({ channel, runtime: disabled })
    ).toBe(false);
    expect(readGroupManagementAllowNoMention({ channel, runtime: missing })).toBe(
      true
    );
  });

  it("refreshes and filters channel info listener by channel", async () => {
    const channel = new Channel("group-1", ChannelTypeGroup);
    const other = new Channel("group-2", ChannelTypeGroup);
    const onChange = vi.fn();
    let listener: any;
    const unsubscribe = vi.fn();
    const runtime = createRuntime({
      addChannelInfoListener: vi.fn((nextListener) => {
        listener = nextListener;
        return unsubscribe;
      }),
    });

    const returned = subscribeGroupManagementChannelInfo({
      channel,
      onChange,
      runtime,
    });
    await refreshGroupManagementChannelInfo({ channel, runtime });

    listener({ channel: other });
    listener({ channel });
    returned();

    expect(runtime.fetchChannelInfo).toHaveBeenCalledWith(channel);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
