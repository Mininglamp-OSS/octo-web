import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted mocks shared across module mocks ──
const hoisted = vi.hoisted(() => ({
  getChannelInfo: vi.fn(),
  setChannleInfoForCache: vi.fn(),
  notifyListeners: vi.fn(),
  emit: vi.fn(),
}));

vi.mock("wukongimjssdk", () => {
  class Channel {
    channelID: string;
    channelType: number;
    constructor(id: string, type: number) {
      this.channelID = id;
      this.channelType = type;
    }
  }
  return {
    Channel,
    WKSDK: {
      shared: () => ({
        channelManager: {
          getChannelInfo: hoisted.getChannelInfo,
          setChannleInfoForCache: hoisted.setChannleInfoForCache,
          notifyListeners: hoisted.notifyListeners,
        },
      }),
    },
  };
});

vi.mock("../../App", () => ({
  __esModule: true,
  default: {
    mittBus: { emit: hoisted.emit },
  },
}));

import { Channel } from "wukongimjssdk";
import { syncThreadArchiveState } from "../threadArchiveSync";
import { ThreadStatus } from "../Thread";

const THREAD_CHANNEL_ID = "g1____t1";
const ChannelTypeCommunityTopic = 5;

beforeEach(() => {
  hoisted.getChannelInfo.mockReset().mockReturnValue(undefined);
  hoisted.setChannleInfoForCache.mockReset();
  hoisted.notifyListeners.mockReset();
  hoisted.emit.mockReset();
});

describe("syncThreadArchiveState", () => {
  it("有 live channelInfo 时：原地写回权威 status → setCache → notifyListeners → emit", () => {
    const channelInfo: any = {
      channel: { channelID: THREAD_CHANNEL_ID, channelType: ChannelTypeCommunityTopic },
      title: "Thread 1",
      orgData: { thread: { status: ThreadStatus.Active }, displayName: "Thread 1" },
    };
    hoisted.getChannelInfo.mockReturnValue(channelInfo);

    syncThreadArchiveState(THREAD_CHANNEL_ID, ThreadStatus.Archived);

    // 权威 status 写回，且保留其它字段（title/displayName）
    expect(channelInfo.orgData.thread.status).toBe(ThreadStatus.Archived);
    expect(channelInfo.title).toBe("Thread 1");
    expect(channelInfo.orgData.displayName).toBe("Thread 1");
    expect(hoisted.setChannleInfoForCache).toHaveBeenCalledWith(channelInfo);
    expect(hoisted.notifyListeners).toHaveBeenCalledWith(channelInfo);
    expect(hoisted.emit).toHaveBeenCalledWith("sidebar-reload");
  });

  it("取消归档：写回 Active", () => {
    const channelInfo: any = {
      channel: { channelID: THREAD_CHANNEL_ID, channelType: ChannelTypeCommunityTopic },
      orgData: { thread: { status: ThreadStatus.Archived } },
    };
    hoisted.getChannelInfo.mockReturnValue(channelInfo);

    syncThreadArchiveState(THREAD_CHANNEL_ID, ThreadStatus.Active);

    expect(channelInfo.orgData.thread.status).toBe(ThreadStatus.Active);
    expect(hoisted.notifyListeners).toHaveBeenCalledWith(channelInfo);
  });

  it("channelInfo.orgData 缺失时补建 orgData.thread 再写回", () => {
    const channelInfo: any = {
      channel: { channelID: THREAD_CHANNEL_ID, channelType: ChannelTypeCommunityTopic },
    };
    hoisted.getChannelInfo.mockReturnValue(channelInfo);

    syncThreadArchiveState(THREAD_CHANNEL_ID, ThreadStatus.Archived);

    expect(channelInfo.orgData.thread.status).toBe(ThreadStatus.Archived);
    expect(hoisted.setChannleInfoForCache).toHaveBeenCalledWith(channelInfo);
  });

  it("没有 live channelInfo（sidebar-only 子区）：不伪造缓存，仍 emit 兜底", () => {
    hoisted.getChannelInfo.mockReturnValue(undefined);

    syncThreadArchiveState(THREAD_CHANNEL_ID, ThreadStatus.Archived);

    expect(hoisted.setChannleInfoForCache).not.toHaveBeenCalled();
    expect(hoisted.notifyListeners).not.toHaveBeenCalled();
    expect(hoisted.emit).toHaveBeenCalledWith("sidebar-reload");
  });

  it("接受 channelID 字符串时按 CommunityTopic 构造频道", () => {
    syncThreadArchiveState(THREAD_CHANNEL_ID, ThreadStatus.Archived);

    const passed = hoisted.getChannelInfo.mock.calls[0][0] as Channel;
    expect(passed.channelID).toBe(THREAD_CHANNEL_ID);
    expect(passed.channelType).toBe(ChannelTypeCommunityTopic);
  });

  it("接受已构造好的 Channel 时直接复用该对象", () => {
    const channel = new Channel(THREAD_CHANNEL_ID, ChannelTypeCommunityTopic);
    syncThreadArchiveState(channel, ThreadStatus.Archived);

    expect(hoisted.getChannelInfo).toHaveBeenCalledWith(channel);
  });

  it("channelID 为空时短路，不触发任何同步副作用", () => {
    syncThreadArchiveState("", ThreadStatus.Archived);

    expect(hoisted.getChannelInfo).not.toHaveBeenCalled();
    expect(hoisted.setChannleInfoForCache).not.toHaveBeenCalled();
    expect(hoisted.notifyListeners).not.toHaveBeenCalled();
    expect(hoisted.emit).not.toHaveBeenCalled();
  });
});
