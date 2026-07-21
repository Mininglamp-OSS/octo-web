import { describe, expect, it, vi } from "vitest";
import {
  addImChannelInfoListener,
  addImSubscriberChangeListener,
  deleteImChannelInfo,
  fetchImChannelInfo,
  getImChannelInfo,
  getImChannelSubscriberOfMe,
  getImChannelSubscribers,
  getImSubscribeCacheMap,
  notifyImChannelInfoListeners,
  notifyImSubscriberChangeListeners,
  patchImChannelInfoOrgData,
  setImChannelSubscribersCache,
  setImChannelInfoCache,
  syncImChannelSubscribers,
  type ImChannelInfoLike,
  type ImChannelCacheRuntimeSdk,
  type ImChannelRuntimeSdk,
  type ImChannelSubscribersRuntimeSdk,
  type ImSubscribeCacheRuntimeSdk,
} from "./channelRuntime";

function createSdk() {
  return {
    channelManager: {
      getChannelInfo: vi.fn(),
      fetchChannelInfo: vi.fn(),
      setChannleInfoForCache: vi.fn(),
      notifyListeners: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      deleteChannelInfo: vi.fn(),
      getSubscribes: vi.fn(),
      getSubscribeOfMe: vi.fn(),
      syncSubscribes: vi.fn(),
      subscribeCacheMap: new Map(),
      addSubscriberChangeListener: vi.fn(),
      removeSubscriberChangeListener: vi.fn(),
      notifySubscribeChangeListeners: vi.fn(),
    },
  } satisfies ImChannelRuntimeSdk &
    ImChannelCacheRuntimeSdk &
    ImChannelSubscribersRuntimeSdk &
    ImSubscribeCacheRuntimeSdk;
}

describe("channelRuntime", () => {
  it("reads channel info through the SDK channel manager", () => {
    const sdk = createSdk();
    const channel = { channelID: "g1", channelType: 2 };
    const channelInfo = { channel, title: "Group" };
    sdk.channelManager.getChannelInfo.mockReturnValue(channelInfo);

    expect(getImChannelInfo(sdk, channel)).toBe(channelInfo);
    expect(sdk.channelManager.getChannelInfo).toHaveBeenCalledWith(channel);
  });

  it("fetches channel info through the SDK channel manager", async () => {
    const sdk = createSdk();
    const channel = { channelID: "g1", channelType: 2 };
    const channelInfo = { channel, title: "Group" };
    sdk.channelManager.fetchChannelInfo.mockResolvedValue(channelInfo);

    await expect(fetchImChannelInfo(sdk, channel)).resolves.toBe(channelInfo);
    expect(sdk.channelManager.fetchChannelInfo).toHaveBeenCalledWith(channel);
  });

  it("returns cached channel info when SDK fetch resolves without a value", async () => {
    const sdk = createSdk();
    const channel = { channelID: "g1", channelType: 2 };
    const channelInfo = { channel, title: "Group" };
    sdk.channelManager.fetchChannelInfo.mockResolvedValue(undefined);
    sdk.channelManager.getChannelInfo.mockReturnValue(channelInfo);

    await expect(fetchImChannelInfo(sdk, channel)).resolves.toBe(channelInfo);
    expect(sdk.channelManager.getChannelInfo).toHaveBeenCalledWith(channel);
  });

  it("writes channel info to the SDK channel cache", () => {
    const sdk = createSdk();
    const channelInfo = {
      channel: { channelID: "g1", channelType: 2 },
      title: "Group",
    };

    setImChannelInfoCache(sdk, channelInfo);

    expect(sdk.channelManager.setChannleInfoForCache).toHaveBeenCalledWith(
      channelInfo
    );
  });

  it("notifies SDK channel listeners", () => {
    const sdk = createSdk();
    const channelInfo = {
      channel: { channelID: "g1", channelType: 2 },
      title: "Group",
    };

    notifyImChannelInfoListeners(sdk, channelInfo);

    expect(sdk.channelManager.notifyListeners).toHaveBeenCalledWith(channelInfo);
  });

  it("returns an unsubscribe when adding a channel info listener", () => {
    const sdk = createSdk();
    const listener = vi.fn();

    const unsubscribe = addImChannelInfoListener(sdk, listener);
    unsubscribe();

    expect(sdk.channelManager.addListener).toHaveBeenCalledWith(listener);
    expect(sdk.channelManager.removeListener).toHaveBeenCalledWith(listener);
  });

  it("deletes channel info through the SDK channel manager", () => {
    const sdk = createSdk();
    const channel = { channelID: "g1", channelType: 2 };

    deleteImChannelInfo(sdk, channel);

    expect(sdk.channelManager.deleteChannelInfo).toHaveBeenCalledWith(channel);
  });

  it("reads subscribers through the SDK channel manager", () => {
    const sdk = createSdk();
    const channel = { channelID: "g1", channelType: 2 };
    const subscribers = [{ uid: "u1" }, { uid: "u2" }];
    sdk.channelManager.getSubscribes.mockReturnValue(subscribers);

    expect(getImChannelSubscribers(sdk, channel)).toBe(subscribers);
    expect(sdk.channelManager.getSubscribes).toHaveBeenCalledWith(channel);
  });

  it("normalizes missing subscribers to an empty list", () => {
    const sdk = createSdk();
    const channel = { channelID: "g1", channelType: 2 };
    sdk.channelManager.getSubscribes.mockReturnValue(undefined);

    expect(getImChannelSubscribers(sdk, channel)).toEqual([]);
  });

  it("reads the current user's subscriber through the SDK channel manager", () => {
    const sdk = createSdk();
    const channel = { channelID: "g1", channelType: 2 };
    const subscriber = { uid: "me", role: 1 };
    sdk.channelManager.getSubscribeOfMe.mockReturnValue(subscriber);

    expect(getImChannelSubscriberOfMe(sdk, channel)).toBe(subscriber);
    expect(sdk.channelManager.getSubscribeOfMe).toHaveBeenCalledWith(channel);
  });

  it("syncs subscribers through the SDK channel manager", async () => {
    const sdk = createSdk();
    const channel = { channelID: "g1", channelType: 2 };
    sdk.channelManager.syncSubscribes.mockResolvedValue(undefined);

    await syncImChannelSubscribers(sdk, channel);

    expect(sdk.channelManager.syncSubscribes).toHaveBeenCalledWith(channel);
  });

  it("returns the SDK subscribe cache map", () => {
    const sdk = createSdk();

    expect(getImSubscribeCacheMap(sdk)).toBe(
      sdk.channelManager.subscribeCacheMap
    );
  });

  it("writes subscribers to the SDK subscribe cache", () => {
    const sdk = createSdk();
    const channel = {
      channelID: "g1",
      channelType: 2,
      getChannelKey: () => "2@g1",
    };
    const subscribers = [{ uid: "u1" }, { uid: "u2" }];

    setImChannelSubscribersCache(sdk, channel, subscribers);

    expect(sdk.channelManager.subscribeCacheMap.get("2@g1")).toBe(subscribers);
  });

  it("returns an unsubscribe when adding a subscriber change listener", () => {
    const sdk = createSdk();
    const listener = vi.fn();

    const unsubscribe = addImSubscriberChangeListener(sdk, listener);
    unsubscribe();

    expect(sdk.channelManager.addSubscriberChangeListener).toHaveBeenCalledWith(
      listener
    );
    expect(
      sdk.channelManager.removeSubscriberChangeListener
    ).toHaveBeenCalledWith(listener);
  });

  it("notifies SDK subscriber change listeners", () => {
    const sdk = createSdk();
    const channel = { channelID: "g1", channelType: 2 };

    notifyImSubscriberChangeListeners(sdk, channel);

    expect(
      sdk.channelManager.notifySubscribeChangeListeners
    ).toHaveBeenCalledWith(channel);
  });

  it("patches orgData while preserving existing fields", () => {
    const channelInfo: ImChannelInfoLike = {
      channel: { channelID: "g1____t1", channelType: 5 },
      title: "Thread",
      orgData: {
        displayName: "Thread",
        thread: { status: 0, seq: 1 },
      },
    };

    const result = patchImChannelInfoOrgData(channelInfo, {
      thread: { status: 1 },
    });

    expect(result).toBe(channelInfo);
    expect(channelInfo.orgData).toEqual({
      displayName: "Thread",
      thread: { status: 1 },
    });
  });

  it("creates orgData when patching a channel info without orgData", () => {
    const channelInfo: ImChannelInfoLike = {
      channel: { channelID: "g1____t1", channelType: 5 },
    };

    patchImChannelInfoOrgData(channelInfo, {
      thread: { status: 1 },
    });

    expect(channelInfo.orgData).toEqual({
      thread: { status: 1 },
    });
  });
});
