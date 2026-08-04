import { afterEach, describe, expect, it, vi } from "vitest";
import { IDBFactory, IDBKeyRange as FakeIDBKeyRange } from "fake-indexeddb";
import {
  IndexedDbAlertClaimStore,
  InMemoryAlertClaimStore,
  SingleAlertCoordinator,
  type SingleAlertCoordinatorOptions,
} from "./singleAlertCoordinator";

type TestBroadcastChannel = NonNullable<
  SingleAlertCoordinatorOptions["channel"]
>;
type TestBroadcastMessage = Parameters<TestBroadcastChannel["postMessage"]>[0];
type TestBroadcastListener = Parameters<
  NonNullable<TestBroadcastChannel["addEventListener"]>
>[1];

class TestChannel implements TestBroadcastChannel {
  private readonly listeners = new Set<TestBroadcastListener>();

  postMessage(): void {}

  addEventListener(_type: "message", listener: TestBroadcastListener): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: "message", listener: TestBroadcastListener): void {
    this.listeners.delete(listener);
  }

  emit(message: TestBroadcastMessage): void {
    for (const listener of this.listeners) listener({ data: message });
  }
}

function immediateCoordinator(
  claimStore: InMemoryAlertClaimStore
): SingleAlertCoordinator {
  return new SingleAlertCoordinator({
    claimStore,
    settlementMs: 0,
    suppressionGraceMs: 0,
  });
}

function countIndexedDbClaims(indexedDb: IDBFactory): Promise<number> {
  return new Promise((resolve, reject) => {
    const openRequest = indexedDb.open("octo-message-attention", 1);
    openRequest.onerror = () => reject(openRequest.error);
    openRequest.onsuccess = () => {
      const database = openRequest.result;
      const transaction = database.transaction("alert-claims", "readonly");
      const countRequest = transaction.objectStore("alert-claims").count();
      countRequest.onerror = () => reject(countRequest.error);
      countRequest.onsuccess = () => resolve(countRequest.result);
    };
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SingleAlertCoordinator", () => {
  it("allows one alert for the same account and message", async () => {
    const store = new InMemoryAlertClaimStore();
    const first = immediateCoordinator(store);
    const second = immediateCoordinator(store);
    const alert = vi.fn();

    await Promise.all([
      first.runOnce({ accountId: "u1", messageId: "m1", alert }),
      second.runOnce({ accountId: "u1", messageId: "m1", alert }),
    ]);

    expect(alert).toHaveBeenCalledTimes(1);
  });

  it("falls back to clientMsgNo and keeps accounts isolated", async () => {
    const coordinator = immediateCoordinator(new InMemoryAlertClaimStore());
    const alert = vi.fn();

    await coordinator.runOnce({ accountId: "u1", clientMsgNo: "c1", alert });
    await coordinator.runOnce({ accountId: "u2", clientMsgNo: "c1", alert });

    expect(alert).toHaveBeenCalledTimes(2);
  });

  it("does not claim messages without a stable id", async () => {
    const coordinator = immediateCoordinator(new InMemoryAlertClaimStore());
    const alert = vi.fn();

    expect(await coordinator.runOnce({ accountId: "u1", alert })).toBe(false);
    expect(alert).not.toHaveBeenCalled();
  });

  it("lets a visible tab suppress before a background alert", async () => {
    const store = new InMemoryAlertClaimStore();
    const visibleTab = immediateCoordinator(store);
    const backgroundTab = immediateCoordinator(store);
    const alert = vi.fn();

    expect(
      await visibleTab.claimOnly({ accountId: "u1", messageId: "m1" })
    ).toBe(true);
    expect(
      await backgroundTab.runOnce({ accountId: "u1", messageId: "m1", alert })
    ).toBe(false);
    expect(alert).not.toHaveBeenCalled();
  });

  it("rechecks attention before committing the terminal alert", async () => {
    let now = 1_000;
    const coordinator = new SingleAlertCoordinator({
      claimStore: new InMemoryAlertClaimStore(),
      settlementMs: 500,
      now: () => now,
      wait: async (delayMs) => {
        now += delayMs;
      },
    });
    const alert = vi.fn();

    expect(
      await coordinator.runOnce({
        accountId: "u1",
        messageId: "m1",
        shouldSuppress: () => true,
        alert,
      })
    ).toBe(false);
    expect(alert).not.toHaveBeenCalled();
  });

  it("persists suppression when a pending tab becomes foreground before the deadline", async () => {
    const store = new InMemoryAlertClaimStore();
    let now = 1_000;
    let visible = false;
    let attentionChanged: (() => void) | undefined;
    let releaseWait: (() => void) | undefined;
    let markWaiting: (() => void) | undefined;
    const waiting = new Promise<void>((resolve) => {
      markWaiting = resolve;
    });
    const unsubscribe = vi.fn();
    const coordinator = new SingleAlertCoordinator({
      claimStore: store,
      settlementMs: 500,
      now: () => now,
      wait: () =>
        new Promise<void>((resolve) => {
          releaseWait = resolve;
          markWaiting?.();
        }),
    });
    const alert = vi.fn();

    const result = coordinator.runOnce({
      accountId: "u1",
      messageId: "m1",
      shouldSuppress: () => visible,
      subscribeSuppressionChanges: (listener) => {
        attentionChanged = listener;
        return unsubscribe;
      },
      alert,
    });
    await waiting;

    visible = true;
    attentionChanged?.();
    await vi.waitFor(async () => {
      await expect(
        store.prepare(JSON.stringify(["u1", "m1"]), 1_500, now)
      ).resolves.toEqual({ state: "suppressed", readyAt: now });
    });

    now += 500;
    releaseWait?.();
    await expect(result).resolves.toBe(false);
    expect(alert).not.toHaveBeenCalled();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("gives a foreground signal at the deadline priority over a background commit", async () => {
    const store = new InMemoryAlertClaimStore();
    let now = 1_000;
    let visible = false;
    let foregroundChanged: (() => void) | undefined;
    const backgroundWaits: Array<() => void> = [];
    const foregroundWaits: Array<() => void> = [];
    const background = new SingleAlertCoordinator({
      claimStore: store,
      settlementMs: 500,
      suppressionGraceMs: 50,
      now: () => now,
      wait: (delayMs) => {
        if (delayMs <= 50) {
          now = Math.max(now, 1_550);
          return Promise.resolve();
        }
        return new Promise<void>((resolve) => {
          backgroundWaits.push(resolve);
        });
      },
    });
    const foreground = new SingleAlertCoordinator({
      claimStore: store,
      settlementMs: 500,
      suppressionGraceMs: 50,
      now: () => now,
      wait: (delayMs) => {
        if (delayMs <= 50) {
          now = Math.max(now, 1_550);
          return Promise.resolve();
        }
        return new Promise<void>((resolve) => {
          foregroundWaits.push(resolve);
        });
      },
    });
    const alert = vi.fn();
    const backgroundResult = background.runOnce({
      accountId: "u1",
      messageId: "m1",
      shouldSuppress: () => false,
      subscribeSuppressionChanges: () => () => undefined,
      alert,
    });
    const foregroundResult = foreground.runOnce({
      accountId: "u1",
      messageId: "m1",
      shouldSuppress: () => visible,
      subscribeSuppressionChanges: (listener) => {
        foregroundChanged = listener;
        return () => undefined;
      },
      alert,
    });
    await vi.waitFor(() => {
      expect(backgroundWaits).toHaveLength(1);
      expect(foregroundWaits).toHaveLength(1);
    });

    // Do not wait for the foreground transaction first: release the shared
    // deadline and signal visibility in the same turn to exercise the race.
    now = 1_500;
    visible = true;
    foregroundChanged?.();
    backgroundWaits.shift()?.();
    foregroundWaits.shift()?.();

    await expect(backgroundResult).resolves.toBe(false);
    await expect(foregroundResult).resolves.toBe(false);
    expect(alert).not.toHaveBeenCalled();
  });

  it("uses the default settlement window for a non-finite option", async () => {
    let now = 1_000;
    const waits: number[] = [];
    const coordinator = new SingleAlertCoordinator({
      claimStore: new InMemoryAlertClaimStore(),
      settlementMs: Number.NaN,
      now: () => now,
      wait: async (delayMs) => {
        waits.push(delayMs);
        now += delayMs;
      },
    });

    await coordinator.runOnce({
      accountId: "u1",
      messageId: "m1",
      alert: () => undefined,
    });

    expect(waits).toEqual([500]);
  });

  it("treats BroadcastChannel as a wake-up hint, not a terminal decision", async () => {
    const channel = new TestChannel();
    const waitResolvers: Array<() => void> = [];
    let now = 1_000;
    const coordinator = new SingleAlertCoordinator({
      claimStore: new InMemoryAlertClaimStore(),
      channel,
      settlementMs: 500,
      now: () => now,
      wait: () =>
        new Promise<void>((resolve) => {
          waitResolvers.push(resolve);
        }),
    });
    const alert = vi.fn();

    const result = coordinator.runOnce({
      accountId: "u1",
      messageId: "m1",
      alert,
    });
    await vi.waitFor(() => expect(waitResolvers).toHaveLength(1));

    channel.emit({
      type: "settled",
      key: JSON.stringify(["u1", "m1"]),
      state: "suppressed",
    });
    await vi.waitFor(() => expect(waitResolvers).toHaveLength(2));
    expect(alert).not.toHaveBeenCalled();

    now += 500;
    waitResolvers[1]();
    await expect(result).resolves.toBe(true);
    expect(alert).toHaveBeenCalledTimes(1);
    coordinator.close();
  });

  it("lets a foreground tab suppress an IndexedDB pending record after the background tab starts", async () => {
    vi.stubGlobal("IDBKeyRange", FakeIDBKeyRange);
    const indexedDb = new IDBFactory();
    const backgroundStore = new IndexedDbAlertClaimStore(indexedDb);
    const foregroundStore = new IndexedDbAlertClaimStore(indexedDb);
    let now = 10_000;
    let releaseWait: (() => void) | undefined;
    let markWaiting: (() => void) | undefined;
    const waiting = new Promise<void>((resolve) => {
      markWaiting = resolve;
    });
    const backgroundTab = new SingleAlertCoordinator({
      claimStore: backgroundStore,
      settlementMs: 500,
      now: () => now,
      wait: () =>
        new Promise<void>((resolve) => {
          releaseWait = resolve;
          markWaiting?.();
        }),
    });
    const foregroundTab = new SingleAlertCoordinator({
      claimStore: foregroundStore,
      settlementMs: 500,
      now: () => now,
    });
    const alert = vi.fn();

    const backgroundResult = backgroundTab.runOnce({
      accountId: "u1",
      messageId: "m1",
      alert,
    });
    await waiting;

    expect(
      await foregroundTab.claimOnly({ accountId: "u1", messageId: "m1" })
    ).toBe(true);
    now += 500;
    releaseWait?.();

    await expect(backgroundResult).resolves.toBe(false);
    expect(alert).not.toHaveBeenCalled();
  });

  it("atomically commits one alert across independent IndexedDB-backed tabs", async () => {
    vi.stubGlobal("IDBKeyRange", FakeIDBKeyRange);
    const indexedDb = new IDBFactory();
    const firstTab = new SingleAlertCoordinator({
      claimStore: new IndexedDbAlertClaimStore(indexedDb),
      settlementMs: 0,
    });
    const secondTab = new SingleAlertCoordinator({
      claimStore: new IndexedDbAlertClaimStore(indexedDb),
      settlementMs: 0,
    });
    const alert = vi.fn();

    await Promise.all([
      firstTab.runOnce({ accountId: "u1", messageId: "m1", alert }),
      secondTab.runOnce({ accountId: "u1", messageId: "m1", alert }),
    ]);

    expect(alert).toHaveBeenCalledTimes(1);
  });
});

describe("IndexedDbAlertClaimStore cleanup", () => {
  it("enforces a hard record cap and evicts the oldest claims", async () => {
    vi.stubGlobal("IDBKeyRange", FakeIDBKeyRange);
    const indexedDb = new IDBFactory();
    const store = new IndexedDbAlertClaimStore(indexedDb, {
      ttlMs: 10_000,
      maxRecords: 3,
    });

    for (let index = 0; index < 5; index += 1) {
      await store.suppress(`message-${index}`, index);
    }

    expect(await countIndexedDbClaims(indexedDb)).toBe(3);
    await expect(store.prepare("message-0", 100, 10)).resolves.toEqual({
      state: "pending",
      readyAt: 100,
    });
    expect(await countIndexedDbClaims(indexedDb)).toBe(3);
  });

  it("removes expired claims while preserving the hard cap", async () => {
    vi.stubGlobal("IDBKeyRange", FakeIDBKeyRange);
    const indexedDb = new IDBFactory();
    const store = new IndexedDbAlertClaimStore(indexedDb, {
      ttlMs: 10,
      maxRecords: 3,
    });

    await store.suppress("expired-1", 0);
    await store.suppress("expired-2", 1);
    await store.suppress("current", 20);

    expect(await countIndexedDbClaims(indexedDb)).toBe(1);
  });
});
