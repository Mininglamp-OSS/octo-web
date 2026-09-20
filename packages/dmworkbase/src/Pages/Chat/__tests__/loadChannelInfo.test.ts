import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WKSDK, { Channel, ChannelInfo } from "wukongimjssdk";

const app = vi.hoisted(() => ({
  shared: { currentSpaceId: "a", spaceRevision: 0 },
  loginInfo: { uid: "user", token: "token", sessionRevision: 0 },
  apiClient: { config: { apiURL: "https://api.invalid", originRevision: 0 } },
}));
vi.mock("../../../App", () => ({ default: app }));
vi.mock("@octo/base", async () => ({
  ChannelTypeCommunityTopic: (await import("../../../Service/Const")).ChannelTypeCommunityTopic,
  parseThreadChannelId: (await import("../../../Service/Thread")).parseThreadChannelId,
}));
import { loadChatChannelInfo } from "../loadChannelInfo";
import { fetchImChannelInfo } from "../../../im-runtime/channelRuntime";
import { getImChannelDisplayName } from "../../../im-runtime/channelDisplayName";
import { captureCurrentImConversationSyncContext } from "../../../im-runtime/conversationSyncContext";
import { createChannelInfoCallback } from "../../../../../dmworkdatasource/src/im-callbacks/channelInfo";

const sdk = WKSDK.shared();
const channel = new Channel("peer", 1);
const freshInfo = () => Object.assign(new ChannelInfo(), {
  channel, title: "Known contact", orgData: { displayName: "Known contact" },
});
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
let callback = vi.fn<() => Promise<ChannelInfo>>();
let cleanups: Array<() => void> = [];

beforeEach(() => {
  app.shared.currentSpaceId = "a";
  app.shared.spaceRevision++;
  app.loginInfo.sessionRevision++;
  sdk.channelManager.channelInfocacheMap = {};
  sdk.conversationManager.conversations = [];
  callback = vi.fn<() => Promise<ChannelInfo>>().mockResolvedValue(freshInfo());
  sdk.config.provider.channelInfoCallback = callback;
});
afterEach(() => {
  cleanups.splice(0).forEach(dispose => dispose());
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function start(onLoading = vi.fn()) {
  cleanups.push(loadChatChannelInfo(channel, onLoading));
  return onLoading;
}

describe("chat channel info lifecycle", () => {
  function installDataSource(getChannel: ReturnType<typeof vi.fn>) {
    sdk.config.provider.channelInfoCallback = createChannelInfoCallback({
      getChannel,
      threadGet: vi.fn(),
      extractUID: uid => uid,
      getSubscribeCacheMap: () => new Map(),
      captureContext: captureCurrentImConversationSyncContext,
    });
  }

  it("recovers a failed first request through the real datasource without creating Recents", async () => {
    vi.useFakeTimers();
    const getChannel = vi.fn()
      .mockRejectedValueOnce({ status: 503 })
      .mockResolvedValue({
        channel: { channel_id: "peer", channel_type: 1 },
        name: "Known contact",
        remark: "My contact",
      });
    installDataSource(getChannel);
    const loading = start();
    await flush();
    expect(getChannel).toHaveBeenCalledTimes(1);
    expect(sdk.channelManager.getChannelInfo(channel)).toBeUndefined();
    expect(loading).toHaveBeenLastCalledWith(true);

    await vi.advanceTimersByTimeAsync(300);
    expect(getChannel).toHaveBeenCalledTimes(2);
    expect(getImChannelDisplayName(sdk.channelManager.getChannelInfo(channel))).toBe("My contact");
    expect(loading).toHaveBeenLastCalledWith(false);
    expect(sdk.conversationManager.conversations).toEqual([]);
  });

  it("bounds repeated failures and recovers on a later activation after the cooldown", async () => {
    vi.useFakeTimers();
    const getChannel = vi.fn().mockRejectedValue({ status: 503 });
    installDataSource(getChannel);
    const loading = start();
    await vi.runAllTimersAsync();
    expect(getChannel).toHaveBeenCalledTimes(3);
    expect(loading).toHaveBeenLastCalledWith(false);
    expect(sdk.channelManager.getChannelInfo(channel)).toBeUndefined();

    cleanups.splice(0).forEach(dispose => dispose());
    start();
    await flush();
    expect(getChannel).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(30_000);
    getChannel.mockResolvedValue({
      channel: { channel_id: "peer", channel_type: 1 }, name: "Known contact",
    });
    cleanups.splice(0).forEach(dispose => dispose());
    start();
    await flush();
    expect(getChannel).toHaveBeenCalledTimes(4);
    expect(getImChannelDisplayName(sdk.channelManager.getChannelInfo(channel))).toBe("Known contact");
  });

  it("repairs a legacy empty cache without adding a recent conversation", async () => {
    sdk.channelManager.setChannleInfoForCache(Object.assign(new ChannelInfo(), {
      channel, title: "", orgData: {},
    }));
    const onLoading = start();
    await flush();
    expect(callback).toHaveBeenCalledTimes(1);
    expect(onLoading.mock.calls).toEqual([[true], [false]]);
    expect(getImChannelDisplayName(sdk.channelManager.getChannelInfo(channel))).toBe("Known contact");
    expect(sdk.conversationManager.conversations).toEqual([]);
  });

  it("does not fetch when a title-only host seed already supplies a name", async () => {
    sdk.channelManager.setChannleInfoForCache(Object.assign(freshInfo(), { orgData: {} }));
    const onLoading = start();
    await flush();
    expect(onLoading.mock.calls).toEqual([[false]]);
    expect(callback).not.toHaveBeenCalled();
  });

  it("waits for an existing SDK fetch rather than starting another one", async () => {
    let resolve!: (info: ChannelInfo) => void;
    callback.mockImplementation(() => new Promise(done => { resolve = done; }));
    const pending = fetchImChannelInfo(sdk, channel);
    const onLoading = start();
    await flush();
    expect(callback).toHaveBeenCalledTimes(1);
    resolve(freshInfo());
    await pending;
    await flush();
    expect(callback).toHaveBeenCalledTimes(1);
    expect(onLoading).toHaveBeenLastCalledWith(false);
  });

  it("stops loading on failure and can recover when the conversation is reopened", async () => {
    callback.mockRejectedValueOnce({ status: 403 });
    const first = start();
    await flush();
    expect(first.mock.calls).toEqual([[true], [false]]);
    expect(sdk.channelManager.getChannelInfo(channel)).toBeUndefined();
    const second = start();
    await flush();
    expect(second).toHaveBeenLastCalledWith(false);
    expect(callback).toHaveBeenCalledTimes(2);
    expect(getImChannelDisplayName(sdk.channelManager.getChannelInfo(channel))).toBe("Known contact");
  });

  it.each(["unmount", "space", "session", "origin"])("drops late results after %s", async (transition) => {
    let resolve!: (info: ChannelInfo) => void;
    callback.mockImplementation(() => new Promise(done => { resolve = done; }));
    const loading = start();
    await flush();
    if (transition === "unmount") cleanups[0]();
    if (transition === "space") app.shared.spaceRevision++;
    if (transition === "session") app.loginInfo.sessionRevision++;
    if (transition === "origin") app.apiClient.config.originRevision++;
    resolve(freshInfo());
    await flush();
    expect(sdk.channelManager.getChannelInfo(channel)).toBeUndefined();
    expect(loading.mock.calls).toEqual([[true]]);
  });
});
