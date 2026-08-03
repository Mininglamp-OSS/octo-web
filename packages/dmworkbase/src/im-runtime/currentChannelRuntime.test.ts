import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  addCurrentImChannelInfoListener,
  addCurrentImSubscriberChangeListener,
  deleteCurrentImChannelInfo,
  fetchCurrentImChannelInfo,
  getCurrentImChannelInfo,
  getCurrentImChannelSubscriberOfMe,
  getCurrentImChannelSubscribers,
  notifyCurrentImChannelInfoListeners,
  notifyCurrentImSubscriberChangeListeners,
  setCurrentImChannelInfoCache,
  setCurrentImChannelSubscribersCache,
  syncCurrentImChannelSubscribers,
} from "./currentChannelRuntime";

const hoisted = vi.hoisted(() => {
  const sdk = {
    channelManager: {
      addListener: vi.fn(),
      deleteChannelInfo: vi.fn(),
      fetchChannelInfo: vi.fn(),
      getChannelInfo: vi.fn(),
      getSubscribes: vi.fn(),
      getSubscribeOfMe: vi.fn(),
      notifyListeners: vi.fn(),
      setChannleInfoForCache: vi.fn(),
      subscribeCacheMap: new Map(),
      addSubscriberChangeListener: vi.fn(),
      removeListener: vi.fn(),
      removeSubscriberChangeListener: vi.fn(),
      notifySubscribeChangeListeners: vi.fn(),
      syncSubscribes: vi.fn(),
    },
  };
  return {
    sdk,
    shared: vi.fn(() => sdk),
  };
});

vi.mock("wukongimjssdk", () => ({
  default: {
    shared: hoisted.shared,
  },
}));

describe("currentChannelRuntime", () => {
  beforeEach(() => {
    hoisted.shared.mockClear();
    hoisted.sdk.channelManager.addListener.mockReset();
    hoisted.sdk.channelManager.deleteChannelInfo.mockReset();
    hoisted.sdk.channelManager.fetchChannelInfo.mockReset();
    hoisted.sdk.channelManager.getChannelInfo.mockReset();
    hoisted.sdk.channelManager.getSubscribes.mockReset();
    hoisted.sdk.channelManager.getSubscribeOfMe.mockReset();
    hoisted.sdk.channelManager.notifyListeners.mockReset();
    hoisted.sdk.channelManager.setChannleInfoForCache.mockReset();
    hoisted.sdk.channelManager.subscribeCacheMap.clear();
    hoisted.sdk.channelManager.addSubscriberChangeListener.mockReset();
    hoisted.sdk.channelManager.removeListener.mockReset();
    hoisted.sdk.channelManager.removeSubscriberChangeListener.mockReset();
    hoisted.sdk.channelManager.notifySubscribeChangeListeners.mockReset();
    hoisted.sdk.channelManager.syncSubscribes.mockReset();
  });

  it("reads channel info from the current SDK runtime", () => {
    const channel = { channelID: "g1", channelType: 2 };
    const info = { channel, title: "Group" };
    hoisted.sdk.channelManager.getChannelInfo.mockReturnValueOnce(info);

    expect(getCurrentImChannelInfo(channel)).toBe(info);
    expect(hoisted.shared).toHaveBeenCalledTimes(1);
    expect(hoisted.sdk.channelManager.getChannelInfo).toHaveBeenCalledWith(
      channel
    );
  });

  it("fetches channel info from the current SDK runtime", async () => {
    const channel = { channelID: "g1", channelType: 2 };
    const info = { channel, title: "Group" };
    hoisted.sdk.channelManager.fetchChannelInfo.mockResolvedValueOnce(info);

    await expect(fetchCurrentImChannelInfo(channel)).resolves.toBe(info);
    expect(hoisted.shared).toHaveBeenCalledTimes(1);
    expect(hoisted.sdk.channelManager.fetchChannelInfo).toHaveBeenCalledWith(
      channel
    );
  });

  it("deletes channel info from the current SDK runtime", () => {
    const channel = { channelID: "g1", channelType: 2 };

    deleteCurrentImChannelInfo(channel);

    expect(hoisted.shared).toHaveBeenCalledTimes(1);
    expect(hoisted.sdk.channelManager.deleteChannelInfo).toHaveBeenCalledWith(
      channel
    );
  });

  it("writes channel info to the current SDK runtime cache", () => {
    const channelInfo = {
      channel: { channelID: "g1", channelType: 2 },
      title: "Group",
    };

    setCurrentImChannelInfoCache(channelInfo);

    expect(hoisted.shared).toHaveBeenCalledTimes(1);
    expect(
      hoisted.sdk.channelManager.setChannleInfoForCache
    ).toHaveBeenCalledWith(channelInfo);
  });

  it("notifies channel info listeners through the current SDK runtime", () => {
    const channelInfo = {
      channel: { channelID: "g1", channelType: 2 },
      title: "Group",
    };

    notifyCurrentImChannelInfoListeners(channelInfo);

    expect(hoisted.shared).toHaveBeenCalledTimes(1);
    expect(hoisted.sdk.channelManager.notifyListeners).toHaveBeenCalledWith(
      channelInfo
    );
  });

  it("reads subscribers from the current SDK runtime", () => {
    const channel = { channelID: "g1", channelType: 2 };
    const subscribers = [{ uid: "u1" }];
    hoisted.sdk.channelManager.getSubscribes.mockReturnValueOnce(subscribers);

    expect(getCurrentImChannelSubscribers(channel)).toBe(subscribers);
    expect(hoisted.shared).toHaveBeenCalledTimes(1);
    expect(hoisted.sdk.channelManager.getSubscribes).toHaveBeenCalledWith(
      channel
    );
  });

  it("reads the current user's subscriber from the current SDK runtime", () => {
    const channel = { channelID: "g1", channelType: 2 };
    const subscriber = { uid: "me", role: 1 };
    hoisted.sdk.channelManager.getSubscribeOfMe.mockReturnValueOnce(
      subscriber
    );

    expect(getCurrentImChannelSubscriberOfMe(channel)).toBe(subscriber);
    expect(hoisted.shared).toHaveBeenCalledTimes(1);
    expect(hoisted.sdk.channelManager.getSubscribeOfMe).toHaveBeenCalledWith(
      channel
    );
  });

  it("writes subscribers to the current SDK runtime cache", () => {
    const channel = {
      channelID: "g1",
      channelType: 2,
      getChannelKey: () => "2@g1",
    };
    const subscribers = [{ uid: "u1" }];

    setCurrentImChannelSubscribersCache(channel, subscribers);

    expect(hoisted.shared).toHaveBeenCalledTimes(1);
    expect(hoisted.sdk.channelManager.subscribeCacheMap.get("2@g1")).toBe(
      subscribers
    );
  });

  it("syncs subscribers through the current SDK runtime", async () => {
    const channel = { channelID: "g1", channelType: 2 };
    hoisted.sdk.channelManager.syncSubscribes.mockResolvedValueOnce(undefined);

    await syncCurrentImChannelSubscribers(channel);

    expect(hoisted.shared).toHaveBeenCalledTimes(1);
    expect(hoisted.sdk.channelManager.syncSubscribes).toHaveBeenCalledWith(
      channel
    );
  });

  it("adds and removes channel info listeners through the current SDK runtime", () => {
    const listener = vi.fn();

    const unsubscribe = addCurrentImChannelInfoListener(listener);
    unsubscribe();

    expect(hoisted.shared).toHaveBeenCalledTimes(1);
    expect(hoisted.sdk.channelManager.addListener).toHaveBeenCalledWith(
      listener
    );
    expect(hoisted.sdk.channelManager.removeListener).toHaveBeenCalledWith(
      listener
    );
  });

  it("adds and removes subscriber listeners through the current SDK runtime", () => {
    const listener = vi.fn();

    const unsubscribe = addCurrentImSubscriberChangeListener(listener);
    unsubscribe();

    expect(hoisted.shared).toHaveBeenCalledTimes(1);
    expect(
      hoisted.sdk.channelManager.addSubscriberChangeListener
    ).toHaveBeenCalledWith(listener);
    expect(
      hoisted.sdk.channelManager.removeSubscriberChangeListener
    ).toHaveBeenCalledWith(listener);
  });

  it("notifies subscriber change listeners through the current SDK runtime", () => {
    const channel = { channelID: "g1", channelType: 2 };

    notifyCurrentImSubscriberChangeListeners(channel);

    expect(hoisted.shared).toHaveBeenCalledTimes(1);
    expect(
      hoisted.sdk.channelManager.notifySubscribeChangeListeners
    ).toHaveBeenCalledWith(channel);
  });
});
