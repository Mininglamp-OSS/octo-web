import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const app = vi.hoisted(() => {
  const spaceHandlers = new Set<(payload: any) => void>();
  const messageDeleteListeners: Array<(message: any, preMessage?: any) => void> = [];
  let _spaceRevision = 0;
  let _currentSpaceId = "";
  return {
    _spaceHandlers: spaceHandlers,
    messageDeleteListeners,
    shared: {
      get currentSpaceId() { return _currentSpaceId; },
      set currentSpaceId(value: string) {
        if (value !== _currentSpaceId) _spaceRevision++;
        _currentSpaceId = value;
      },
      get spaceRevision() { return _spaceRevision; },
      channelSpaceMap: new Map<string, string>(),
      channelMySourceSpaceMap: new Map<string, string>(),
      addMessageDeleteListener(listener: (m: any, p?: any) => void) { messageDeleteListeners.push(listener); },
      removeMessageDeleteListener: vi.fn(),
    },
    loginInfo: { uid: "user-a", token: "token-a", sessionRevision: 0 },
    apiClient: { config: { apiURL: "https://api.invalid", originRevision: 0 } },
    menus: { refresh: vi.fn() },
    mittBus: {
      on(ev: string, h: (p: any) => void) { if (ev === "space-changed") spaceHandlers.add(h); },
      off(ev: string, h: (p: any) => void) { if (ev === "space-changed") spaceHandlers.delete(h); },
      emit(ev: string, p?: any) { if (ev === "space-changed") spaceHandlers.forEach(f => f(p)); },
    },
  };
});

const space = vi.hoisted(() => ({
  skipChannel: vi.fn(() => false),
  skipPerson: vi.fn(() => false),
  hasPrefix: vi.fn(() => false),
  pinnedList: vi.fn(() => Promise.resolve([])),
  getSpaceFilteredLastMessage: vi.fn((c: any) => c.lastMessage),
}));

vi.mock("../App", () => ({ default: app }));
vi.mock("../Service/PinnedService", () => ({ default: { list: space.pinnedList } }));
vi.mock("../Service/SpaceService", () => ({
  shouldSkipChannelForSpace: space.skipChannel,
  shouldSkipPersonConversationForSpace: space.skipPerson,
  hasSpacePrefix: space.hasPrefix,
  getSpaceFilteredLastMessage: space.getSpaceFilteredLastMessage,
}));
vi.mock("../Service/ProhibitwordsService", () => ({
  ProhibitwordsService: { shared: { filter: (t: string) => t } },
}));
vi.mock("../Service/Thread", () => ({
  parseThreadChannelId: (id: string) => {
    const parts = id.split("____");
    return parts.length === 2 ? { groupNo: parts[0], shortId: parts[1] } : null;
  },
}));

import WKSDK, { Channel, ConnectStatus, Conversation, ConversationAction } from "wukongimjssdk";
import { getCurrentImConversationStore } from "./currentConversationStore";
import { applyImSpaceContext } from "./spaceContext";

const sdk = WKSDK.shared();

function channel(id: string, type = 2): Channel { return new Channel(id, type); }
function conv(id: string, type = 2, extra: any = {}, ts = 100): Conversation {
  const item = new Conversation(); item.channel = channel(id, type); item.timestamp = ts; item.extra = extra; return item;
}

function bumpRealtime(): void {
  sdk.conversationManager.notifyConversationListeners(
    conv("live", 2, { spaceId: "space-a" }), ConversationAction.add,
  );
}

/** Flush pending microtasks so async retries advance without firing timers. */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

async function primeStore(): Promise<ReturnType<typeof getCurrentImConversationStore>> {
  const store = getCurrentImConversationStore();
  store.retain();
  sdk.config.provider.syncConversationsCallback = async () => [conv("seeded")];
  await store.refresh({ reload: true });
  expect(store.getSnapshot().freshness).toBe("ready");
  return store;
}

/**
 * Start a refresh that will exhaust all 3 attempts (each provider call bumps
 * realtimeRevision -> commit rejected), enter reconcile mode with a 1s timer
 * armed and the Promise still pending. Returns { promise, calls }.
 * Do NOT await the returned promise - the caller must advance time or
 * cancel to settle it.
 */
function startReconcile(
  store: ReturnType<typeof getCurrentImConversationStore>,
): { promise: Promise<void>; get calls(): number } {
  const ref = { calls: 0 };
  sdk.config.provider.syncConversationsCallback = async () => {
    ref.calls++;
    bumpRealtime();
    return [conv("conflicted")];
  };
  const promise = store.refresh({ reload: true });
  return { promise, get calls() { return ref.calls; } };
}

beforeEach(() => {
  vi.useFakeTimers();
  app.shared.currentSpaceId = "";
  app.shared.channelSpaceMap.clear();
  app.shared.channelMySourceSpaceMap.clear();
  app.messageDeleteListeners.length = 0;
  app._spaceHandlers.clear();
  app.loginInfo.uid = "user-a";
  app.loginInfo.token = "token-a";
  app.loginInfo.sessionRevision++;
  app.apiClient.config.apiURL = "https://api.invalid";
  app.apiClient.config.originRevision++;
  app.menus.refresh = vi.fn();
  app.shared.removeMessageDeleteListener = vi.fn();
  space.skipChannel.mockReset().mockReturnValue(false);
  space.skipPerson.mockReset().mockReturnValue(false);
  space.hasPrefix.mockReset().mockReturnValue(false);
  space.pinnedList.mockReset().mockResolvedValue([]);
  space.getSpaceFilteredLastMessage.mockImplementation((c: any) => c.lastMessage);
  sdk.config.provider.syncConversationsCallback = async () => [];
  sdk.conversationManager.conversations = [];
  sdk.conversationManager.maxExtraVersion = 0;
  sdk.connectManager.status = ConnectStatus.Disconnect;
  vi.spyOn(sdk.channelManager, "getChannelInfo").mockReturnValue(undefined);
  vi.spyOn(sdk.channelManager, "fetchChannelInfo").mockResolvedValue(undefined);
  vi.spyOn(sdk.reminderManager, "sync").mockResolvedValue(undefined);
});

afterEach(() => {
  const s = getCurrentImConversationStore();
  if (!s.disposed) s.dispose();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("bounded retry + reconcile timer", () => {
  it("caps retries at 3 provider calls and arms one 1s timer; timer settles the promise on success", async () => {
    const store = await primeStore();
    const rc = startReconcile(store); const { promise } = rc;
    await flushMicrotasks();  // flush the 3 sync attempts (microtask-driven)
    expect(rc.calls).toBe(3);
    expect(store.getSnapshot().freshness).toBe("stale");

    // Promise still pending - not settled until timer fires or cancel.
    const settled = Symbol();
    const raced = await Promise.race([promise.then(() => settled), Promise.resolve("pending")]);
    expect(raced).toBe("pending");

    // After timer fires with a clean provider, the promise must settle.
    sdk.config.provider.syncConversationsCallback = async () => [conv("resolved")];
    await vi.advanceTimersByTimeAsync(1000);
    await expect(promise).resolves.toBeUndefined();
    expect(store.getSnapshot().freshness).toBe("ready");
  });

  it("delivers a fresh authoritative snapshot after the delayed reconcile", async () => {
    const store = await primeStore();
    const rc = startReconcile(store); const { promise } = rc;
    await flushMicrotasks();

    const items = [conv("authoritative", 2, { spaceId: "space-a" })];
    sdk.config.provider.syncConversationsCallback = async () => items;
    await vi.advanceTimersByTimeAsync(1000);
    await expect(promise).resolves.toBeUndefined();

    expect(store.getSnapshot().freshness).toBe("ready");
    expect(store.loading).toBe(false);
    expect(store.conversations.map(c => c.channel.channelID)).toEqual(["authoritative"]);
  });

  it("clears the timer on explicit refresh - old promise settles false, new one resolves", async () => {
    const store = await primeStore();
    const oldRc = startReconcile(store); const oldP = oldRc.promise;
    await flushMicrotasks();

    const explicit = vi.fn(async () => [conv("explicit")]);
    sdk.config.provider.syncConversationsCallback = explicit;
    const newP = store.refresh({ reload: true });
    // Old promise must settle (cancellation resolves it).
    await expect(oldP).resolves.toBeUndefined();
    // The new promise must complete.
    await expect(newP).resolves.toBeUndefined();
    expect(store.getSnapshot().freshness).toBe("ready");

    // The old timer must not fire.
    const after = vi.fn(async () => []);
    sdk.config.provider.syncConversationsCallback = after;
    await vi.advanceTimersByTimeAsync(1000);
    expect(after).not.toHaveBeenCalled();
  });

  it("clears the timer on dispose - promise settles without hanging", async () => {
    const store = await primeStore();
    const rc = startReconcile(store); const { promise } = rc;
    await flushMicrotasks();

    const fresh = vi.fn(async () => [conv("never")]);
    sdk.config.provider.syncConversationsCallback = fresh;
    store.dispose();
    await expect(promise).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(1000);
    expect(fresh).not.toHaveBeenCalled();
  });

  it("applies a space change: auto-refreshes once for the new context and cancels the old timer", async () => {
    const store = await primeStore();
    const oldRc = startReconcile(store); const oldP = oldRc.promise;
    await flushMicrotasks();

    const fresh = vi.fn(async () => [conv("post-space", 2, { spaceId: "space-b" })]);
    sdk.config.provider.syncConversationsCallback = fresh;

    applyImSpaceContext({ space_id: "space-b", name: "B" });
    await vi.advanceTimersByTimeAsync(0);

    // Old promise cancelled (space change resets context, requestRevision bumps).
    await expect(oldP).resolves.toBeUndefined();

    // The space-change handler triggered a new refresh for space-b.
    expect(store.getSnapshot().freshness).toBe("ready");
    expect(store.conversations.map(c => c.channel.channelID)).toEqual(["post-space"]);

    // The old timer must not fire.
    await vi.advanceTimersByTimeAsync(1000);
    expect(fresh).toHaveBeenCalledTimes(1);
  });

  it("reports stale with old data while reconciling, then ready after timer", async () => {
    const store = await primeStore();
    const rc = startReconcile(store); const { promise } = rc;
    await flushMicrotasks();

    expect(store.getSnapshot().freshness).toBe("stale");
    expect(store.conversations.map(c => c.channel.channelID)).toContain("seeded");

    sdk.config.provider.syncConversationsCallback = async () => [conv("fresh")];
    await vi.advanceTimersByTimeAsync(1000);
    await expect(promise).resolves.toBeUndefined();
    expect(store.getSnapshot().freshness).toBe("ready");
    expect(store.loading).toBe(false);
  });

  it("keeps a single timer: no duplicate refresh after the reconcile window", async () => {
    const store = await primeStore();
    const rc = startReconcile(store); const { promise } = rc;
    await flushMicrotasks();

    const fresh = vi.fn(async () => [conv("ok")]);
    sdk.config.provider.syncConversationsCallback = fresh;
    await vi.advanceTimersByTimeAsync(1000);
    await expect(promise).resolves.toBeUndefined();
    expect(fresh).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2000);
    expect(fresh).toHaveBeenCalledTimes(1);
  });

  it("partial release (2->1) keeps timer alive; last release (1->0) cancels it", async () => {
    const store = getCurrentImConversationStore();
    const releaseA = store.retain();
    const releaseB = store.retain();

    sdk.config.provider.syncConversationsCallback = async () => [conv("seeded")];
    await store.refresh({ reload: true });

    // Drive into reconcile
    const rc = startReconcile(store); const { promise } = rc;
    await flushMicrotasks();
    expect(rc.calls).toBe(3);

    // Release one holder (2->1): timer must survive, promise stays pending.
    releaseB();
    const stillPending = Symbol();
    const raced1 = await Promise.race([promise.then(() => stillPending), Promise.resolve("pending")]);
    expect(raced1).toBe("pending");

    // Timer fires (clean provider) -> promise settles.
    const surviving = vi.fn(async () => [conv("survived")]);
    sdk.config.provider.syncConversationsCallback = surviving;
    await vi.advanceTimersByTimeAsync(1000);
    await expect(promise).resolves.toBeUndefined();
    expect(surviving).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().freshness).toBe("ready");

    // Drive into reconcile a second time, then release the last holder.
    const rc2 = startReconcile(store); const p2 = rc2.promise;
    await flushMicrotasks();

    const never = vi.fn(async () => [conv("never")]);
    sdk.config.provider.syncConversationsCallback = never;
    releaseA(); // last release -> stop() fires -> cancelReconcile() settles p2
    await expect(p2).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(1000);
    expect(never).not.toHaveBeenCalled();
  });
});
