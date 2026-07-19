import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getBotProfile: vi.fn(),
  updateDescription: vi.fn(),
  updateRemark: vi.fn(),
  applyFriend: vi.fn(),
  uploadAvatar: vi.fn(),
  getReportStatus: vi.fn(),
}));

vi.mock("../../../Service/BotProfileService", () => ({
  default: {
    getBotProfile: mocks.getBotProfile,
    updateDescription: mocks.updateDescription,
    updateRemark: mocks.updateRemark,
    applyFriend: mocks.applyFriend,
    uploadAvatar: mocks.uploadAvatar,
  },
}));

vi.mock("../../../Service/AgentCardService", () => ({
  default: {
    getReportStatus: mocks.getReportStatus,
  },
}));

import BotDetailVM, {
  parseBotCommands,
  stripBotDetailDisplayName,
  type BotDetailRuntime,
} from "../BotDetailVM";

function createRuntime(overrides: Partial<BotDetailRuntime> = {}): BotDetailRuntime {
  return {
    getLoginUid: () => "owner-1",
    getToken: () => "token-a",
    getSpaceId: () => "space-a",
    fetchChannelInfo: vi.fn(),
    refreshChannelInfo: vi.fn().mockResolvedValue(undefined),
    onAvatarChanged: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.useRealTimers();
  Object.values(mocks).forEach((mock) => mock.mockReset());
});

describe("BotDetailVM", () => {
  it("loads bot profile and report status for owner", async () => {
    mocks.getBotProfile.mockResolvedValueOnce({
      name: "Bot One",
      username: "bot_one",
      remark: "Work Bot",
      bot_description: "desc",
      bot_creator_uid: "owner-1",
      bot_creator_name: "Owner",
      bot_commands: "[]",
      follow: 1,
    });
    mocks.getReportStatus.mockResolvedValueOnce(true);
    const vm = new BotDetailVM("bot1", createRuntime());
    vm.mount();

    await vm.loadBotInfo();
    await Promise.resolve();

    expect(vm.state.loading).toBe(false);
    expect(vm.state.name).toBe("Bot One");
    expect(vm.state.isFriend).toBe(true);
    expect(vm.isOwner()).toBe(true);
    expect(mocks.getReportStatus).toHaveBeenCalledWith("bot1");
    expect(vm.state.reported).toBe(true);
  });

  it("falls back to channel info when profile load fails", async () => {
    mocks.getBotProfile.mockRejectedValueOnce(new Error("boom"));
    const runtime = createRuntime({
      fetchChannelInfo: vi.fn().mockResolvedValueOnce({
        title: "Cached Bot",
        orgData: {
          remark: "Cached Remark",
          bot_description: "cached desc",
          bot_creator_uid: "someone",
          bot_creator_name: "Someone",
          bot_commands: "[]",
          follow: 0,
        },
      }),
    });
    const vm = new BotDetailVM("bot1", runtime);
    vm.mount();

    await vm.loadBotInfo();

    expect(vm.state.loading).toBe(false);
    expect(vm.state.name).toBe("Cached Bot");
    expect(vm.state.remark).toBe("Cached Remark");
    expect(vm.isOwner()).toBe(false);
  });

  it("drops stale profile responses after uid changes", async () => {
    let resolveFirst!: (value: unknown) => void;
    mocks.getBotProfile
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce({
        name: "Bot Two",
        username: "bot_two",
        bot_creator_uid: "owner-1",
        follow: 0,
      });
    mocks.getReportStatus.mockResolvedValue(false);
    const vm = new BotDetailVM("bot1", createRuntime());
    vm.mount();

    const firstLoad = vm.loadBotInfo();
    vm.setUid("bot2");
    resolveFirst({
      name: "Bot One",
      username: "bot_one",
      bot_creator_uid: "owner-1",
      follow: 1,
    });
    await firstLoad;
    await Promise.resolve();

    expect(vm.currentUid()).toBe("bot2");
    expect(vm.state.name).toBe("Bot Two");
    expect(vm.state.username).toBe("bot_two");
  });

  it("reloads the same bot after uid is cleared on close", async () => {
    mocks.getBotProfile
      .mockResolvedValueOnce({
        name: "Bot One",
        username: "bot_one",
        bot_creator_uid: "owner-1",
        follow: 1,
      })
      .mockResolvedValueOnce({
        name: "Bot One Reloaded",
        username: "bot_one",
        bot_creator_uid: "owner-1",
        follow: 0,
      });
    mocks.getReportStatus.mockResolvedValue(false);
    const vm = new BotDetailVM("bot1", createRuntime());
    vm.mount();

    await vm.loadBotInfo();
    vm.setUid("");
    await vm.setUid("bot1");
    await Promise.resolve();

    expect(mocks.getBotProfile).toHaveBeenCalledTimes(2);
    expect(mocks.getBotProfile).toHaveBeenNthCalledWith(1, "bot1");
    expect(mocks.getBotProfile).toHaveBeenNthCalledWith(2, "bot1");
    expect(vm.state.name).toBe("Bot One Reloaded");
    expect(vm.state.isFriend).toBe(false);
  });

  it("saves remark and refreshes channel info", async () => {
    mocks.updateRemark.mockResolvedValueOnce(undefined);
    const runtime = createRuntime();
    const vm = new BotDetailVM("bot1", runtime);
    vm.mount();
    vm.state.remark = "Old";
    vm.startEditRemark();
    vm.setRemarkDraft(" New ");

    await expect(vm.saveRemark()).resolves.toBe("ok");

    expect(mocks.updateRemark).toHaveBeenCalledWith("bot1", "New");
    expect(vm.state.remark).toBe("New");
    expect(vm.state.editingRemark).toBe(false);
    expect(runtime.refreshChannelInfo).toHaveBeenCalledWith("bot1");
  });

  it("submits friend apply with current space", async () => {
    mocks.applyFriend.mockResolvedValueOnce(undefined);
    const vm = new BotDetailVM("bot1", createRuntime());
    vm.mount();
    vm.showApplyInput("hello");

    await expect(vm.submitApply()).resolves.toBe("ok");

    expect(mocks.applyFriend).toHaveBeenCalledWith({
      uid: "bot1",
      remark: "hello",
      spaceId: "space-a",
    });
    expect(vm.state.showApplyInput).toBe(false);
    expect(vm.state.applying).toBe(false);
  });

  it("uploads avatar with token and reports avatar refresh", async () => {
    const file = new File(["avatar"], "avatar.png", { type: "image/png" });
    mocks.uploadAvatar.mockResolvedValueOnce(undefined);
    const runtime = createRuntime();
    const vm = new BotDetailVM("bot1", runtime);
    vm.mount();

    await expect(vm.uploadAvatar(file)).resolves.toBe("ok");

    expect(mocks.uploadAvatar).toHaveBeenCalledWith("bot1", file, "token-a");
    expect(runtime.onAvatarChanged).toHaveBeenCalledWith("bot1");
    expect(vm.state.uploadingAvatar).toBe(false);
  });
});

describe("BotDetailVM helpers", () => {
  it("strips markdown display markers", () => {
    expect(stripBotDetailDisplayName("**Bot**")).toBe("Bot");
  });

  it("parses command arrays defensively", () => {
    expect(parseBotCommands('[{"cmd":"/help","remark":"Help"}]')).toEqual([
      { cmd: "/help", remark: "Help" },
    ]);
    expect(parseBotCommands("{bad")).toEqual([]);
    expect(parseBotCommands("{}")).toEqual([]);
  });
});
