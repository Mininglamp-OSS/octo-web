import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WKSDK, {
  Channel,
  ChannelInfo,
  ChannelTypeGroup,
  ChannelTypePerson,
  ConnectStatus,
  Conversation,
  Message,
  MessageText,
} from "wukongimjssdk";

const state = vi.hoisted(() => {
  let spaceId = "";
  let spaceRevision = 0;
  const messageDeleteListeners = new Set<(...args: unknown[]) => void>();
  return {
    app: {
      shared: {
        get currentSpaceId() { return spaceId; },
        set currentSpaceId(value: string) {
          if (value !== spaceId) spaceRevision++;
          spaceId = value;
        },
        get spaceRevision() { return spaceRevision; },
        channelSpaceMap: new Map<string, string>(),
        channelMySourceSpaceMap: new Map<string, string>(),
        openChannel: undefined as unknown,
        addMessageDeleteListener(listener: (...args: unknown[]) => void) {
          messageDeleteListeners.add(listener);
        },
        removeMessageDeleteListener(listener: (...args: unknown[]) => void) {
          messageDeleteListeners.delete(listener);
        },
        notifyListener: vi.fn(),
      },
      loginInfo: { uid: "review-user", token: "review-token", sessionRevision: 0 },
      apiClient: { config: { apiURL: "https://review.invalid", originRevision: 0 } },
      config: { appName: "Octo" },
      currentMenuId: "chat",
      menus: { refresh: vi.fn() },
      routeRight: { popToRoot: vi.fn() },
    },
    pinnedList: vi.fn(),
    messageDeleteListeners,
  };
});

vi.mock("../App", async () => {
  const { default: mitt } = await import("mitt");
  return { default: { ...state.app, mittBus: mitt() } };
});
vi.mock("../Service/PinnedService", () => ({
  default: { list: state.pinnedList },
}));
vi.mock("../Service/ProhibitwordsService", () => ({
  ProhibitwordsService: { shared: { filter: (text: string) => text } },
}));
vi.mock("../Service/Dap", () => ({
  Dap: { shared: { track: vi.fn() } },
}));
vi.mock("../EndpointCommon", () => ({
  ShowConversationOptions: class {},
}));
vi.mock("../Utils/download", () => ({
  downloadFile: vi.fn(),
}));
vi.mock("react-scroll", () => ({
  animateScroll: { scrollTo: vi.fn() },
}));
vi.mock("../index", async () => ({
  ChannelTypeCommunityTopic: (await import("../Service/Const")).ChannelTypeCommunityTopic,
  parseThreadChannelId: (await import("../Service/Thread")).parseThreadChannelId,
}));

import WKApp from "../App";
import { ChatVM } from "../Pages/Chat/vm";
import { ConversationWrap } from "../Service/Model";
import APIClient from "../Service/APIClient";
import { ChannelTypeCommunityTopic } from "../Service/Const";
import { syncGroupDisbandState, GroupStatusDisband } from "../Utils/groupDisband";
import { muteChannelSetting } from "../bridge/channelSetting/channelSettingActions";
import { stripSpacePrefix } from "../Service/SpacePrefix";
import { createChannelInfoCallback } from "../../../dmworkdatasource/src/im-callbacks/channelInfo";
import { fetchImChannelInfo } from "./channelRuntime";
import { getCurrentImConversationStore } from "./currentConversationStore";
import { applyImSpaceContext } from "./spaceContext";

const sdk = WKSDK.shared();
const cleanups: Array<() => void> = [];
const syncQuery = vi.fn<() => Promise<Conversation[]>>();

function deferred<T>(cleanupValue: T) {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  cleanups.push(() => resolve(cleanupValue));
  return { promise, resolve };
}

// A macrotask drains provider, SDK and runtime promise continuations without
// coupling the tests to the number of internal await statements.
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function conversation(id: string, type = ChannelTypePerson): Conversation {
  const item = new Conversation();
  item.channel = new Channel(id, type);
  item.timestamp = 100;
  item.extra = {};
  return item;
}

function channelInfo(channel: Channel, title = "current", top = false): ChannelInfo {
  const info = new ChannelInfo();
  info.channel = channel;
  info.title = title;
  info.top = top;
  info.orgData = { space_id: "space-a" };
  return info;
}

function message(channel: Channel, seq: number): Message {
  const item = new Message();
  item.channel = channel;
  item.messageSeq = seq;
  item.timestamp = 100 + seq;
  item.fromUID = "another-user";
  item.header.reddot = true;
  item.content = new MessageText(`message ${seq}`);
  return item;
}

function retainStore() {
  const store = getCurrentImConversationStore();
  const release = store.retain();
  cleanups.push(release);
  return { store, release };
}

beforeEach(() => {
  vi.clearAllMocks();
  WKApp.mittBus.all.clear();
  state.messageDeleteListeners.clear();
  WKApp.shared.currentSpaceId = "space-a";
  WKApp.shared.channelSpaceMap.clear();
  WKApp.shared.channelMySourceSpaceMap.clear();
  WKApp.shared.openChannel = undefined;
  WKApp.currentMenuId = "chat";
  state.app.loginInfo.sessionRevision++;
  state.app.apiClient.config.originRevision++;
  state.pinnedList.mockReset().mockResolvedValue([]);
  syncQuery.mockReset().mockResolvedValue([]);
  sdk.config.uid = "review-user";
  sdk.config.provider.syncConversationsCallback = syncQuery;
  sdk.config.provider.channelInfoCallback = async (channel) => channelInfo(channel);
  sdk.conversationManager.conversations = [];
  sdk.conversationManager.openConversation = undefined;
  sdk.conversationManager.maxExtraVersion = 0;
  sdk.channelManager.channelInfocacheMap = {};
  sdk.channelManager.requestQueueMap.clear();
  sdk.channelManager.subscribeCacheMap.clear();
  sdk.connectManager.status = ConnectStatus.Disconnect;
  vi.spyOn(sdk.reminderManager, "sync").mockResolvedValue(undefined);
});

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  getCurrentImConversationStore().dispose();
  await settle();
  WKApp.mittBus.all.clear();
  vi.restoreAllMocks();
});

describe("W1b independent review regressions", () => {
  it("R2: restarting offline in another Space does not expose the stopped owner's snapshot", async () => {
    const { store, release } = retainStore();
    const old = conversation("space-a-secret");
    syncQuery.mockResolvedValueOnce([old]);
    await store.refresh({ reload: true });
    expect(store.getSnapshot().freshness).toBe("ready");

    release();
    applyImSpaceContext({ space_id: "space-b", name: "B" });
    cleanups.push(store.retain());

    expect.soft(store.conversations).toEqual([]);
    expect.soft(sdk.conversationManager.conversations).toEqual([]);
    expect.soft(store.getSnapshot().freshness).not.toBe("ready");
  });

  it("R3: a reentrant refresh cannot hide a Space transition from the mounted ChatVM", () => {
    const { store } = retainStore();
    const response = deferred<Conversation[]>([]);
    syncQuery.mockReturnValue(response.promise);
    cleanups.push(store.subscribe((change) => {
      if (change === "space") void store.refresh();
    }));

    const page = new ChatVM();
    page.didMount();
    cleanups.push(() => page.didUnMount());
    const selected = new ConversationWrap(conversation("old-selected"));
    page.selectedConversation = selected;
    page.showChannelSetting = true;
    WKApp.shared.openChannel = selected.channel;

    applyImSpaceContext({ space_id: "space-b", name: "B" });

    expect.soft(page.selectedConversation).toBeUndefined();
    expect.soft(page.showChannelSetting).toBe(false);
    expect.soft(WKApp.shared.openChannel).toBeUndefined();
    expect.soft(WKApp.routeRight.popToRoot).toHaveBeenCalled();
  });

  it("R4: late metadata cannot reinsert the old Space's group after a notification switches Space", async () => {
    const channel = new Channel("late-pending-group", ChannelTypeGroup);
    const info = channelInfo(channel);
    const metadata = deferred(info);
    sdk.config.provider.channelInfoCallback = () => metadata.promise;
    const { store } = retainStore();
    const nextSpaceResponse = deferred<Conversation[]>([]);
    syncQuery.mockImplementation(() => WKApp.shared.currentSpaceId === "space-a"
      ? Promise.resolve([])
      : nextSpaceResponse.promise);

    const refresh = store.refresh({ reload: true });
    sdk.conversationManager.createEmptyConversation(channel);
    await refresh;
    expect(store.pendingSpaceConversations.has("late-pending-group_2")).toBe(true);
    expect(sdk.conversationManager.findConversation(channel)).toBeUndefined();

    let switched = false;
    cleanups.push(store.subscribe((change) => {
      if (change === "data" && !switched && store.findConversation(channel)) {
        switched = true;
        applyImSpaceContext({ space_id: "space-b", name: "B" });
      }
    }));
    metadata.resolve(info);
    await settle();

    expect(switched).toBe(true);
    expect(WKApp.shared.currentSpaceId).toBe("space-b");
    expect.soft(sdk.conversationManager.findConversation(channel)).toBeUndefined();
    expect.soft(store.findConversation(channel)).toBeUndefined();
  });

  it("R5: ensureSnapshot without a page or retain preserves realtime arrivals while pins are pending", async () => {
    const store = getCurrentImConversationStore();
    const pins = deferred<never[]>([]);
    state.pinnedList.mockReturnValueOnce(pins.promise);
    const snapshot = conversation("http-snapshot");
    const authoritative = [conversation("http-snapshot"), conversation("headless-live")];
    syncQuery.mockResolvedValueOnce([snapshot]).mockResolvedValueOnce(authoritative);
    const refresh = store.ensureSnapshot();
    await settle();

    const liveChannel = new Channel("headless-live", ChannelTypePerson);
    sdk.channelManager.setChannleInfoForCache(channelInfo(liveChannel));
    sdk.conversationManager.createEmptyConversation(liveChannel);
    expect(sdk.conversationManager.findConversation(liveChannel)).toBeDefined();
    pins.resolve([]);
    await refresh;

    expect.soft(sdk.conversationManager.conversations.map((item) => item.channel.channelID).sort())
      .toEqual(["headless-live", "http-snapshot"]);
    expect.soft(store.conversations.map((item) => item.channel.channelID).sort())
      .toEqual(["headless-live", "http-snapshot"]);
    expect(syncQuery).toHaveBeenCalledTimes(2);
  });

  it("R1: reconnect re-reads authority without discarding unread, remoteExtra or the live message", async () => {
    const { store } = retainStore();
    const old = conversation("reconnect-group", ChannelTypeGroup);
    old.unread = 1;
    old.remoteExtra.version = 1;
    old.lastMessage = message(old.channel, 1);
    old.extra.spaceId = "space-a";
    sdk.channelManager.setChannleInfoForCache(channelInfo(old.channel));
    syncQuery.mockResolvedValueOnce([old]);
    await store.refresh({ reload: true });

    const snapshot = conversation("reconnect-group", ChannelTypeGroup);
    snapshot.unread = 5;
    snapshot.remoteExtra.version = 9;
    snapshot.lastMessage = message(snapshot.channel, 5);
    snapshot.extra.spaceId = "space-a";
    const authoritative = conversation("reconnect-group", ChannelTypeGroup);
    authoritative.unread = 6;
    authoritative.remoteExtra.version = 9;
    authoritative.lastMessage = message(authoritative.channel, 6);
    authoritative.extra.spaceId = "space-a";
    const response = deferred<Conversation[]>([]);
    syncQuery.mockClear();
    syncQuery.mockReturnValueOnce(response.promise).mockResolvedValueOnce([authoritative]);
    const refresh = store.refresh({ reload: true });

    // The first response ends at seq 5. A retry observes seq 6 and the server's
    // unread count; the stale local object is not an authoritative baseline.
    sdk.conversationManager.updateOrAddConversation(message(old.channel, 6));
    expect(sdk.conversationManager.findConversation(old.channel)?.unread).toBe(2);
    response.resolve([snapshot]);
    await refresh;

    const accepted = store.findConversation(old.channel)?.conversation;
    expect.soft(accepted?.unread).toBe(6);
    expect.soft(accepted?.remoteExtra.version).toBe(9);
    expect.soft(accepted?.lastMessage?.messageSeq).toBe(6);
    expect.soft(sdk.conversationManager.findConversation(old.channel)).toBe(accepted);
    expect(syncQuery).toHaveBeenCalledTimes(2);
  });

  it("R6: an old owner's channel request cannot commit SDK metadata or maps after dispose", async () => {
    const channel = new Channel("owner-bound-group", ChannelTypeGroup);
    const staleInfo = channelInfo(channel, "old-owner", false);
    const metadata = deferred(staleInfo);
    const infoQuery = vi.fn(() => metadata.promise);
    sdk.config.provider.channelInfoCallback = infoQuery;
    const { store: oldOwner, release } = retainStore();
    sdk.conversationManager.createEmptyConversation(channel);
    expect(infoQuery).toHaveBeenCalledWith(channel);
    release();
    oldOwner.dispose();

    const { store: newOwner } = retainStore();
    const current = conversation(channel.channelID, channel.channelType);
    current.extra = { spaceId: "space-a", top: 1 };
    const freshInfo = channelInfo(channel, "new-owner", true);
    syncQuery.mockImplementationOnce(async () => {
      sdk.channelManager.setChannleInfoForCache(freshInfo);
      WKApp.shared.channelSpaceMap.set("owner-bound-group_2", "space-a");
      return [current];
    });
    await newOwner.refresh({ reload: true });
    expect(newOwner.findConversation(channel)?.extra.top).toBe(1);
    const mapWrites = vi.spyOn(WKApp.shared.channelSpaceMap, "set");

    metadata.resolve(staleInfo);
    await settle();

    expect.soft(sdk.channelManager.getChannelInfo(channel)).toMatchObject({
      title: "new-owner",
      top: true,
      orgData: { space_id: "space-a" },
    });
    expect.soft(newOwner.findConversation(channel)?.extra.top).toBe(1);
    expect.soft(mapWrites).not.toHaveBeenCalled();
  });

  it("R7: an earlier subscriber receives the final snapshot after a one-shot same-reason reentry", () => {
    const { store } = retainStore();
    const first = new Channel("first-publication", ChannelTypePerson);
    const nested = new Channel("nested-publication", ChannelTypePerson);
    sdk.channelManager.setChannleInfoForCache(channelInfo(first));
    sdk.channelManager.setChannleInfoForCache(channelInfo(nested));
    const observed: string[][] = [];
    cleanups.push(store.subscribe((reason) => {
      if (reason === "data") {
        observed.push(store.getSnapshot().conversations.map((item) => item.channel.channelID).sort());
      }
    }));
    let inserted = false;
    cleanups.push(store.subscribe((reason) => {
      if (reason === "data" && !inserted) {
        inserted = true;
        sdk.conversationManager.createEmptyConversation(nested);
      }
    }));

    sdk.conversationManager.createEmptyConversation(first);

    expect(store.conversations).toHaveLength(2);
    expect(observed[observed.length - 1]).toEqual(["first-publication", "nested-publication"]);
  });

  it("R8: page-free ensureSnapshot still reconciles after three rejected reads", async () => {
    vi.useFakeTimers();
    cleanups.push(() => vi.useRealTimers());
    const store = getCurrentImConversationStore();
    const live = new Channel("live-during-initial-hydration", ChannelTypePerson);
    sdk.channelManager.setChannleInfoForCache(channelInfo(live));
    let calls = 0;
    syncQuery.mockImplementation(async () => {
      calls++;
      if (calls <= 3) {
        sdk.conversationManager.updateOrAddConversation(message(live, calls));
        return [conversation("rejected-snapshot")];
      }
      return [conversation("authoritative-after-traffic")];
    });
    const hydration = store.ensureSnapshot();
    await vi.advanceTimersByTimeAsync(0);
    expect(syncQuery).toHaveBeenCalledTimes(3);
    expect(store.conversations.map((item) => item.channel.channelID)).not.toContain("rejected-snapshot");

    await vi.advanceTimersByTimeAsync(1000);
    await hydration;

    expect.soft(syncQuery).toHaveBeenCalledTimes(4);
    expect.soft(store.conversations.map((item) => item.channel.channelID))
      .toEqual(["authoritative-after-traffic"]);
  });

  it("R9: a pending parent fetch does not undo the real in-place group-disband write", async () => {
    const parent = new Channel("cached-parent", ChannelTypeGroup);
    const thread = new Channel("cached-parent____thread", ChannelTypeCommunityTopic);
    const initial = channelInfo(parent);
    initial.orgData.status = 1;
    const stale = channelInfo(parent);
    stale.orgData.status = 1;
    const response = deferred(stale);
    const fetchInfo = vi.fn(() => response.promise);
    sdk.config.provider.channelInfoCallback = fetchInfo;
    sdk.channelManager.setChannleInfoForCache(initial);
    sdk.channelManager.setChannleInfoForCache(channelInfo(thread));
    retainStore();

    // A cached parent without a conversation-derived Space map still needs the
    // realtime parent lookup when its first thread conversation arrives.
    sdk.conversationManager.createEmptyConversation(thread);
    expect(fetchInfo).toHaveBeenCalledWith(parent);
    syncGroupDisbandState(parent);
    expect(sdk.channelManager.getChannelInfo(parent)).toBe(initial);
    expect(initial.orgData.status).toBe(GroupStatusDisband);

    response.resolve(stale);
    await settle();

    expect(sdk.channelManager.getChannelInfo(parent)?.orgData.status).toBe(GroupStatusDisband);
  });

  it.each(["legacy", "owned"] as const)(
    "R10: %s fetch preserves a successful thread mute while the settings view holds invalidated metadata",
    async (path) => {
      const channel = new Channel(`mute-parent____${path}`, ChannelTypeCommunityTopic);
      const displayed = channelInfo(channel);
      displayed.mute = false;
      displayed.orgData.thread = { status: 1, mute: 0 };
      sdk.channelManager.setChannleInfoForCache(displayed);
      WKApp.shared.channelSpaceMap.set("mute-parent_2", "space-a");
      const stale = channelInfo(channel);
      stale.mute = false;
      stale.orgData.thread = { status: 1, mute: 0 };
      const response = deferred(stale);
      const infoQuery = vi.fn(() => response.promise);
      sdk.config.provider.channelInfoCallback = infoQuery;
      const save = vi.spyOn(APIClient.shared, "put").mockResolvedValue(undefined);
      retainStore();

      // Cache invalidation does not notify ChannelSettingVM. Its existing mute
      // toggle remains usable while a message starts the missing-info fetch.
      sdk.channelManager.deleteChannelInfo(channel);
      if (path === "owned") {
        sdk.conversationManager.createEmptyConversation(channel);
      } else {
        void fetchImChannelInfo(sdk, channel);
      }
      expect(infoQuery).toHaveBeenCalledWith(channel);
      await muteChannelSetting({ channel, mute: true });
      expect(save).toHaveBeenCalledWith(`groups/mute-parent/threads/${path}/setting`, { mute: 1 });
      response.resolve(stale);
      await settle();

      expect.soft(sdk.channelManager.getChannelInfo(channel)?.mute).toBe(true);
      expect.soft(sdk.channelManager.getChannelInfo(channel)?.orgData.thread.mute).toBe(1);
    },
  );

  it.each(["legacy", "owned"] as const)(
    "R11: %s fetch hydrates a Space-prefixed person using the real datasource callback",
    async (path) => {
      const spaceId = "0123456789abcdef0123456789abcdef";
      WKApp.shared.currentSpaceId = spaceId;
      const channel = new Channel(`s${spaceId}_peer`, ChannelTypePerson);
      const getChannel = vi.fn().mockResolvedValue({
        channel: { channel_id: "peer", channel_type: ChannelTypePerson },
        name: "Peer Name",
        extra: {},
      });
      sdk.config.provider.channelInfoCallback = createChannelInfoCallback({
        getChannel,
        threadGet: vi.fn(),
        extractUID: stripSpacePrefix,
        getSubscribeCacheMap: () => sdk.channelManager.subscribeCacheMap,
      });
      retainStore();

      if (path === "owned") {
        sdk.conversationManager.createEmptyConversation(channel);
      } else {
        await fetchImChannelInfo(sdk, channel);
      }
      await settle();

      expect(getChannel).toHaveBeenCalledWith("channels/peer/1");
      expect(sdk.channelManager.getChannelInfo(channel)?.title).toBe("Peer Name");
    },
  );

  it("R8 cancellation: the last release settles a reconcile wait and never retries", async () => {
    vi.useFakeTimers();
    cleanups.push(() => vi.useRealTimers());
    const { store, release } = retainStore();
    const live = new Channel("cancel-calibration", ChannelTypePerson);
    sdk.channelManager.setChannleInfoForCache(channelInfo(live));
    let sequence = 0;
    syncQuery.mockImplementation(async () => {
      sdk.conversationManager.updateOrAddConversation(message(live, ++sequence));
      return [conversation("rejected")];
    });
    let settled = false;
    const refresh = store.refresh({ reload: true }).then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(syncQuery).toHaveBeenCalledTimes(3);
    expect(settled).toBe(false);

    release();
    await vi.advanceTimersByTimeAsync(0);

    expect(settled).toBe(true);
    await refresh;
    await vi.advanceTimersByTimeAsync(2000);
    expect(syncQuery).toHaveBeenCalledTimes(3);
  });

  it("R12: a headless hydration's old finally does not stop the new Space's pending sync", async () => {
    const store = getCurrentImConversationStore();
    const oldResponse = deferred<Conversation[]>([]);
    const nextResponse = deferred<Conversation[]>([]);
    syncQuery.mockReturnValueOnce(oldResponse.promise).mockReturnValueOnce(nextResponse.promise);
    const hydration = store.ensureSnapshot();

    applyImSpaceContext({ space_id: "space-b", name: "B" });
    expect(syncQuery).toHaveBeenCalledTimes(2);
    oldResponse.resolve([conversation("old-space")]);
    await settle();
    nextResponse.resolve([conversation("new-space-authority")]);
    await settle();
    await hydration;

    expect.soft(store.conversations.map((item) => item.channel.channelID)).toEqual(["new-space-authority"]);
    expect.soft(sdk.conversationManager.conversations.map((item) => item.channel.channelID))
      .toEqual(["new-space-authority"]);
  });

  it("R13: an expired owned fetch cannot trigger a mute repair against the next owner's cache", async () => {
    const channel = new Channel("repair-parent____thread", ChannelTypeCommunityTopic);
    const stale = channelInfo(channel);
    stale.mute = false;
    stale.orgData.thread = { status: 1, mute: 0 };
    const response = deferred(stale);
    sdk.config.provider.channelInfoCallback = () => response.promise;
    vi.spyOn(APIClient.shared, "put").mockResolvedValue(undefined);
    WKApp.shared.channelSpaceMap.set("repair-parent_2", "space-a");
    const { store: oldOwner, release } = retainStore();
    sdk.conversationManager.createEmptyConversation(channel);
    await muteChannelSetting({ channel, mute: true });
    release();
    oldOwner.dispose();

    // A replacement owner has read a newer server value (for example, another
    // device unmuted the thread). The old owner's callback no longer owns it.
    const fresh = channelInfo(channel, "new-owner");
    fresh.mute = false;
    fresh.orgData.thread = { status: 1, mute: 0 };
    sdk.channelManager.setChannleInfoForCache(fresh);
    retainStore();
    const writes = vi.spyOn(sdk.channelManager, "setChannleInfoForCache");
    response.resolve(stale);
    await settle();

    expect.soft(sdk.channelManager.getChannelInfo(channel)?.mute).toBe(false);
    expect.soft(sdk.channelManager.getChannelInfo(channel)?.orgData.thread.mute).toBe(0);
    expect.soft(writes).not.toHaveBeenCalled();
  });
});
