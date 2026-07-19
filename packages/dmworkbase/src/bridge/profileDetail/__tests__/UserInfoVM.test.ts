import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateRemark: vi.fn(),
  applyFriend: vi.fn(),
  getUserProfile: vi.fn(),
  fetchChannelInfo: vi.fn(),
  getSubscribes: vi.fn(() => []),
  changeChannelAvatarTag: vi.fn(),
  userInfos: vi.fn(),
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
  ChannelInfo: class {
    channel: unknown;
    title = "";
    logo = "";
    orgData: Record<string, unknown> = {};
  },
  ChannelTypeGroup: 2,
  ChannelTypePerson: 1,
  WKSDK: {
    shared: () => ({
      channelManager: {
        fetchChannelInfo: mocks.fetchChannelInfo,
        getSubscribes: mocks.getSubscribes,
        addSubscriberChangeListener: vi.fn(),
        removeSubscriberChangeListener: vi.fn(),
        getChannelInfo: vi.fn(),
      },
    }),
  },
}));

vi.mock("../../../App", () => ({
  default: {
    shared: {
      changeChannelAvatarTag: mocks.changeChannelAvatarTag,
      userInfos: mocks.userInfos,
    },
    loginInfo: {
      uid: "me",
    },
  },
}));

vi.mock("../../../Service/UserService", () => ({
  default: {
    updateRemark: mocks.updateRemark,
    applyFriend: mocks.applyFriend,
    getUserProfile: mocks.getUserProfile,
  },
}));

import { UserInfoVM } from "../UserInfoVM";

beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset());
  mocks.fetchChannelInfo.mockResolvedValue(undefined);
  mocks.getUserProfile.mockResolvedValue({ uid: "u1", name: "User One" });
});

describe("UserInfoVM profile actions", () => {
  it("saves remark and updates local channel info", async () => {
    mocks.updateRemark.mockResolvedValueOnce(undefined);
    mocks.getUserProfile.mockReturnValueOnce(new Promise(() => undefined));
    const vm = new UserInfoVM("u1");
    (vm as any).mounted = true;
    vm.channelInfo = {
      title: "User One",
      orgData: { remark: "Old" },
    } as any;

    vm.startEditRemark();
    vm.setRemarkDraft(" New ");
    await expect(vm.saveRemark()).resolves.toBe("ok");

    expect(mocks.updateRemark).toHaveBeenCalledWith("u1", "New");
    expect(vm.channelInfo?.orgData?.remark).toBe("New");
    expect(vm.channelInfo?.orgData?.displayName).toBe("New");
    expect(vm.editingRemark).toBe(false);
    expect(vm.savingRemark).toBe(false);
  });

  it("keeps backend remark error message on save failure", async () => {
    mocks.updateRemark.mockRejectedValueOnce({ msg: "remark is too long" });
    const vm = new UserInfoVM("u1");
    (vm as any).mounted = true;
    vm.startEditRemark();
    vm.setRemarkDraft("invalid");

    await expect(vm.saveRemark()).resolves.toBe("failed");

    expect(vm.remarkSaveError).toBe("remark is too long");
    expect(vm.savingRemark).toBe(false);
  });

  it("applies friend with vercode and space", async () => {
    mocks.applyFriend.mockResolvedValueOnce(undefined);
    const vm = new UserInfoVM("u1", undefined, "vc-1");

    await vm.applyFriend("hello", "space-a");

    expect(mocks.applyFriend).toHaveBeenCalledWith({
      uid: "u1",
      remark: "hello",
      vercode: "vc-1",
      spaceId: "space-a",
    });
  });

  it("uses parent group_no when loading profile from a thread", async () => {
    const vm = new UserInfoVM("u1", { channelID: "group-a____thread-1", channelType: 5 } as any);

    await vm.reloadChannelInfo();

    expect(mocks.getUserProfile).toHaveBeenCalledWith("u1", "group-a");
  });

  it("uses parent group subscribers when opened from a thread", () => {
    const vm = new UserInfoVM("u1", { channelID: "group-a____thread-1", channelType: 5 } as any);

    vm.reloadSubscribers();

    expect(mocks.getSubscribes).toHaveBeenCalledWith(
      expect.objectContaining({
        channelID: "group-a",
        channelType: 2,
      })
    );
  });
});
