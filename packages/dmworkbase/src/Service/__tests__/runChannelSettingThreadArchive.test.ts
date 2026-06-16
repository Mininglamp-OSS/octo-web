import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted mocks shared across module mocks ──
const hoisted = vi.hoisted(() => ({
  threadArchive: vi.fn(),
  threadUnarchive: vi.fn(),
  toastSuccess: vi.fn(),
  syncThreadArchiveState: vi.fn(),
}));

vi.mock("../../App", () => ({
  __esModule: true,
  default: {
    dataSource: {
      channelDataSource: {
        threadArchive: hoisted.threadArchive,
        threadUnarchive: hoisted.threadUnarchive,
      },
    },
  },
}));

vi.mock("@douyinfe/semi-ui", () => ({
  Toast: { success: hoisted.toastSuccess },
}));

vi.mock("../threadArchiveSync", () => ({
  syncThreadArchiveState: hoisted.syncThreadArchiveState,
}));

vi.mock("../../i18n", () => ({ t: (key: string) => key }));

vi.mock("wukongimjssdk", () => ({
  Channel: class {
    channelID: string;
    channelType: number;
    constructor(id: string, type: number) {
      this.channelID = id;
      this.channelType = type;
    }
  },
}));

import { Channel } from "wukongimjssdk";
import { runChannelSettingThreadArchive } from "../threadArchiveAction";
import { ThreadStatus } from "../Thread";

const ChannelTypeCommunityTopic = 5;

beforeEach(() => {
  hoisted.threadArchive.mockReset().mockResolvedValue(undefined);
  hoisted.threadUnarchive.mockReset().mockResolvedValue(undefined);
  hoisted.toastSuccess.mockReset();
  hoisted.syncThreadArchiveState.mockReset();
});

describe("runChannelSettingThreadArchive (issue #345 入口3 onOk)", () => {
  const channel = new Channel("g1____t1", ChannelTypeCommunityTopic);

  it("归档成功：调用 threadArchive，并以权威 Archived 走 syncThreadArchiveState", async () => {
    await runChannelSettingThreadArchive({
      channel,
      groupNo: "g1",
      shortId: "t1",
      isArchived: false,
    });

    expect(hoisted.threadArchive).toHaveBeenCalledWith("g1", "t1");
    expect(hoisted.threadUnarchive).not.toHaveBeenCalled();
    expect(hoisted.toastSuccess).toHaveBeenCalledWith(
      "base.module.thread.archiveSuccess"
    );
    expect(hoisted.syncThreadArchiveState).toHaveBeenCalledWith(
      channel,
      ThreadStatus.Archived
    );
  });

  it("取消归档成功：调用 threadUnarchive，并以权威 Active 走 syncThreadArchiveState", async () => {
    await runChannelSettingThreadArchive({
      channel,
      groupNo: "g1",
      shortId: "t1",
      isArchived: true,
    });

    expect(hoisted.threadUnarchive).toHaveBeenCalledWith("g1", "t1");
    expect(hoisted.threadArchive).not.toHaveBeenCalled();
    expect(hoisted.toastSuccess).toHaveBeenCalledWith(
      "base.module.thread.unarchiveSuccess"
    );
    expect(hoisted.syncThreadArchiveState).toHaveBeenCalledWith(
      channel,
      ThreadStatus.Active
    );
  });

  it("接口失败时向上抛出，不 Toast.success、不同步 sidebar", async () => {
    hoisted.threadArchive.mockRejectedValue(new Error("boom"));

    await expect(
      runChannelSettingThreadArchive({
        channel,
        groupNo: "g1",
        shortId: "t1",
        isArchived: false,
      })
    ).rejects.toThrow("boom");

    expect(hoisted.toastSuccess).not.toHaveBeenCalled();
    expect(hoisted.syncThreadArchiveState).not.toHaveBeenCalled();
  });

  it("非子区类型的 channel 也按 CommunityTopic 重建后再同步", async () => {
    const groupChannel = new Channel("g1____t1", 2 /* group */);

    await runChannelSettingThreadArchive({
      channel: groupChannel,
      groupNo: "g1",
      shortId: "t1",
      isArchived: false,
    });

    const passed = hoisted.syncThreadArchiveState.mock.calls[0][0] as Channel;
    expect(passed.channelType).toBe(ChannelTypeCommunityTopic);
    expect(passed.channelID).toBe("g1____t1");
  });
});
