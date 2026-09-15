import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WKSDK, { Channel, ChannelInfo } from "wukongimjssdk";

const app = vi.hoisted(() => ({
  shared: { currentSpaceId: "space-a", spaceRevision: 0 },
  loginInfo: { uid: "user-a", token: "token-a", sessionRevision: 0 },
  apiClient: { config: { apiURL: "https://api.invalid", originRevision: 0 } },
}));
vi.mock("../App", () => ({ default: app }));

import { createOwnedChannelInfoFetcher } from "./ownedChannelInfoFetcher";
import { patchImChannelInfoOrgData } from "./channelRuntime";
import * as channelRuntime from "./channelRuntime";

function channel(id = "ch-a", type = 2): Channel {
  return new Channel(id, type);
}

function channelInfo(
  ch: Channel,
  overrides: Partial<ChannelInfo> = {},
): ChannelInfo {
  const info = new ChannelInfo();
  info.channel = ch;
  info.title = overrides.title ?? "Test Channel";
  info.logo = overrides.logo ?? "";
  info.mute = overrides.mute ?? false;
  info.top = overrides.top ?? false;
  info.orgData = overrides.orgData ?? {};
  info.online = overrides.online ?? false;
  info.lastOffline = overrides.lastOffline ?? 0;
  return info;
}

const sdk = WKSDK.shared();
let isCurrent = true;
let callback = vi.fn<() => Promise<ChannelInfo>>();

beforeEach(() => {
  app.shared.currentSpaceId = "space-a";
  app.shared.spaceRevision++;
  app.loginInfo.uid = "user-a";
  app.loginInfo.token = "token-a";
  app.loginInfo.sessionRevision++;
  app.apiClient.config.apiURL = "https://api.invalid";
  app.apiClient.config.originRevision++;
  isCurrent = true;
  callback = vi.fn<() => Promise<ChannelInfo>>();
  sdk.config.provider.channelInfoCallback = callback;
  sdk.channelManager.channelInfocacheMap = {};
  vi.spyOn(sdk.channelManager, "getChannelInfo").mockImplementation(
    (ch: Channel) =>
      sdk.channelManager.channelInfocacheMap[ch.getChannelKey()],
  );
  // Passthrough spy: keep the real implementation so the write-generation
  // revision is bumped on every cache write (needed by the in-place guards).
  vi.spyOn(channelRuntime, "setImChannelInfoCache");
  vi.spyOn(channelRuntime, "notifyImChannelInfoListeners");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createOwnedChannelInfoFetcher", () => {
  it("returns undefined when provider callback is absent", async () => {
    sdk.config.provider.channelInfoCallback =
      undefined as unknown as typeof callback;
    const fetch = createOwnedChannelInfoFetcher(sdk, () => isCurrent);
    const result = await fetch(channel());
    expect(result).toBeUndefined();
    expect(channelRuntime.setImChannelInfoCache).not.toHaveBeenCalled();
  });

  it("factory created before callback is installed, later fetches work", async () => {
    sdk.config.provider.channelInfoCallback =
      undefined as unknown as typeof callback;
    const fetch = createOwnedChannelInfoFetcher(sdk, () => isCurrent);
    const preResult = await fetch(channel());
    expect(preResult).toBeUndefined();

    const installed = vi.fn<() => Promise<ChannelInfo>>();
    sdk.config.provider.channelInfoCallback = installed;
    const ch = channel("ch-late", 2);
    const info = channelInfo(ch, { title: "Late" });
    installed.mockResolvedValue(info);
    const result = await fetch(ch);
    expect(result).toBe(info);
    expect(channelRuntime.setImChannelInfoCache).toHaveBeenCalledWith(sdk, info);
  });

  it("returns undefined when not current at call time", async () => {
    const fetch = createOwnedChannelInfoFetcher(sdk, () => false);
    const result = await fetch(channel());
    expect(result).toBeUndefined();
    expect(callback).not.toHaveBeenCalled();
  });

  it("re-captures context per request after a Space switch", async () => {
    const fetch = createOwnedChannelInfoFetcher(sdk, () => true);
    const ch1 = channel("p1");
    callback.mockResolvedValueOnce(channelInfo(ch1, { title: "ok" }));
    expect(await fetch(ch1)).toBeTruthy();

    app.shared.currentSpaceId = "space-b";
    app.shared.spaceRevision++;
    const ch2 = channel("p2");
    callback.mockResolvedValueOnce(channelInfo(ch2, { title: "new-space" }));
    const r2 = await fetch(ch2);
    expect(r2?.title).toBe("new-space");
  });

  it("propagates provider failure when still current", async () => {
    callback.mockRejectedValue(new Error("network error"));
    const fetch = createOwnedChannelInfoFetcher(sdk, () => isCurrent);
    await expect(fetch(channel())).rejects.toThrow("network error");
    expect(channelRuntime.setImChannelInfoCache).not.toHaveBeenCalled();
  });

  it("sets cache and notifies on success", async () => {
    const ch = channel("ch-success", 2);
    const info = channelInfo(ch, { title: "Success" });
    callback.mockResolvedValue(info);
    const fetch = createOwnedChannelInfoFetcher(sdk, () => isCurrent);
    const result = await fetch(ch);
    expect(result).toBe(info);
    expect(channelRuntime.setImChannelInfoCache).toHaveBeenCalledWith(sdk, info);
    expect(channelRuntime.notifyImChannelInfoListeners).toHaveBeenCalledWith(sdk, info);
  });

  it("does not write when result arrives after owner disposal", async () => {
    const ch = channel("ch-dispose", 2);
    const info = channelInfo(ch, { title: "Disposed" });
    callback.mockImplementationOnce(async () => {
      isCurrent = false;
      return info;
    });
    const fetch = createOwnedChannelInfoFetcher(sdk, () => isCurrent);
    const result = await fetch(ch);
    expect(result).toBeUndefined();
    expect(channelRuntime.setImChannelInfoCache).not.toHaveBeenCalled();
  });

  it("does not write when cache entry for that channel was replaced during flight", async () => {
    const ch = channel("ch-entry", 2);
    const info = channelInfo(ch, { title: "Original" });
    callback.mockImplementationOnce(async () => {
      sdk.channelManager.channelInfocacheMap[ch.getChannelKey()] =
        channelInfo(ch, { title: "Newer" });
      return info;
    });
    const fetch = createOwnedChannelInfoFetcher(sdk, () => isCurrent);
    const result = await fetch(ch);
    expect(result).toBeUndefined();
    expect(channelRuntime.setImChannelInfoCache).not.toHaveBeenCalled();
  });

  it("does not write when provider changed during flight", async () => {
    const ch = channel("ch-provider", 2);
    const info = channelInfo(ch, { title: "Changed provider" });
    callback.mockImplementationOnce(async () => {
      sdk.config.provider = {
        ...sdk.config.provider,
        channelInfoCallback: vi.fn(),
      } as typeof sdk.config.provider;
      return info;
    });
    const fetch = createOwnedChannelInfoFetcher(sdk, () => isCurrent);
    const result = await fetch(ch);
    expect(result).toBeUndefined();
    expect(channelRuntime.setImChannelInfoCache).not.toHaveBeenCalled();
  });

  it("does not write when callback changed during flight", async () => {
    const ch = channel("ch-callback", 2);
    const info = channelInfo(ch, { title: "Changed callback" });
    callback.mockImplementationOnce(async () => {
      sdk.config.provider.channelInfoCallback = vi.fn();
      return info;
    });
    const fetch = createOwnedChannelInfoFetcher(sdk, () => isCurrent);
    const result = await fetch(ch);
    expect(result).toBeUndefined();
    expect(channelRuntime.setImChannelInfoCache).not.toHaveBeenCalled();
  });

  it("callback replaced during pending: old result dropped, new invocation uses latest", async () => {
    const ch = channel("ch-swap", 2);
    let oldResolver!: (v: ChannelInfo) => void;
    const oldCallback = vi.fn(
      () => new Promise<ChannelInfo>((resolve) => { oldResolver = resolve; }),
    );
    sdk.config.provider.channelInfoCallback = oldCallback;
    let newResolver!: (v: ChannelInfo) => void;
    const newCallback = vi.fn(
      () => new Promise<ChannelInfo>((resolve) => { newResolver = resolve; }),
    );

    const fetch = createOwnedChannelInfoFetcher(sdk, () => isCurrent);
    const oldPending = fetch(ch);
    expect(oldCallback).toHaveBeenCalledTimes(1);

    // Replace callback while request is in-flight
    sdk.config.provider.channelInfoCallback = newCallback;
    // Next fetch must NOT reuse stale pending (isCurrent false due to callback mismatch)
    const freshResult = fetch(ch);
    expect(oldCallback).toHaveBeenCalledTimes(1);
    expect(newCallback).toHaveBeenCalledTimes(1);

    oldResolver(channelInfo(ch, { title: "Old loaded" }));
    expect(await oldPending).toBeUndefined(); // old response rejected
    expect(channelRuntime.setImChannelInfoCache).not.toHaveBeenCalled();

    newResolver(channelInfo(ch, { title: "New loaded" }));
    const r2 = await freshResult;
    expect(r2?.title).toBe("New loaded");
    expect(channelRuntime.setImChannelInfoCache).toHaveBeenCalledTimes(1);
    expect(
      sdk.channelManager.channelInfocacheMap[ch.getChannelKey()]?.title,
    ).toBe("New loaded");
  });

  it("does not write when WKSDK.shared() changes during flight", async () => {
    const mockSdk = {} as unknown as typeof sdk;
    const sharedSpy = vi.spyOn(WKSDK, "shared" as never);
    const ch = channel("ch-shared", 2);
    const info = channelInfo(ch, { title: "Shared changed" });
    callback.mockImplementationOnce(async () => {
      sharedSpy.mockReturnValue(mockSdk);
      return info;
    });
    const fetch = createOwnedChannelInfoFetcher(sdk, () => isCurrent);
    const result = await fetch(ch);
    expect(result).toBeUndefined();
    expect(channelRuntime.setImChannelInfoCache).not.toHaveBeenCalled();
  });

  it("coalesces concurrent requests for the same channel and writes once", async () => {
    const ch = channel("ch-coalesce", 2);
    const info = channelInfo(ch, { title: "Coalesced" });
    let resolveCallback!: (value: ChannelInfo) => void;
    callback.mockImplementationOnce(
      () => new Promise<ChannelInfo>((resolve) => { resolveCallback = resolve; }),
    );
    const fetch = createOwnedChannelInfoFetcher(sdk, () => isCurrent);
    const first = fetch(ch);
    const second = fetch(ch);
    expect(callback).toHaveBeenCalledTimes(1);
    resolveCallback(info);
    const [r1, r2] = await Promise.all([first, second]);
    expect(r1).toBe(info);
    expect(r2).toBe(info);
    expect(channelRuntime.setImChannelInfoCache).toHaveBeenCalledTimes(1);
  });

  it("does not reuse stale pending after context change", async () => {
    const ch = channel("ch-stale-pending", 2);
    let slowResolver!: (v: ChannelInfo) => void;
    const info = channelInfo(ch, { title: "Fresh" });
    callback.mockImplementationOnce(
      () => new Promise((resolve) => { slowResolver = resolve; }),
    );
    callback.mockImplementationOnce(
      () => new Promise((r) => setTimeout(() => r(channelInfo(ch, { title: "Fresh2" })), 10)),
    );
    const fetch = createOwnedChannelInfoFetcher(sdk, () => isCurrent);
    const staleResult = fetch(ch);
    app.shared.currentSpaceId = "space-b";
    app.shared.spaceRevision++;
    const second = fetch(ch);
    expect(callback).toHaveBeenCalledTimes(2);
    slowResolver(info);
    expect(await staleResult).toBeUndefined();
    const r2 = await second;
    expect(r2?.title).toBe("Fresh2");
  });

  it("does not coalesce requests for different channels", async () => {
    const chA = channel("ch-a", 2);
    const chB = channel("ch-b", 2);
    const infoA = channelInfo(chA, { title: "A" });
    const infoB = channelInfo(chB, { title: "B" });
    callback.mockResolvedValueOnce(infoA);
    callback.mockResolvedValueOnce(infoB);
    const fetch = createOwnedChannelInfoFetcher(sdk, () => isCurrent);
    const results = await Promise.all([fetch(chA), fetch(chB)]);
    expect(results[0]).toBe(infoA);
    expect(results[1]).toBe(infoB);
    expect(callback).toHaveBeenCalledTimes(2);
  });

  it("does not write when channelInfo.channel is missing", async () => {
    const ch = channel("ch-nullinfo", 2);
    const info = channelInfo(ch, { title: "Missing channel" });
    delete (info as Partial<ChannelInfo>).channel;
    callback.mockResolvedValue(info);
    const fetch = createOwnedChannelInfoFetcher(sdk, () => isCurrent);
    const result = await fetch(ch);
    expect(result).toBeUndefined();
    expect(channelRuntime.setImChannelInfoCache).not.toHaveBeenCalled();
  });

  it("does not write when returned channel is not isEqual to requested channel", async () => {
    const reqCh = channel("req-ch", 2);
    const diffCh = channel("diff-ch", 2);
    const info = channelInfo(diffCh, { title: "Wrong channel" });
    callback.mockResolvedValue(info);
    const fetch = createOwnedChannelInfoFetcher(sdk, () => isCurrent);
    const result = await fetch(reqCh);
    expect(result).toBeUndefined();
    expect(channelRuntime.setImChannelInfoCache).not.toHaveBeenCalled();
  });

  it("invokes callback with provider as this", async () => {
    const ch = channel("ch-this", 2);
    let capturedThis: unknown = undefined;
    callback.mockImplementationOnce(function (this: unknown) {
      capturedThis = this;
      return Promise.resolve(channelInfo(ch));
    });
    const fetch = createOwnedChannelInfoFetcher(sdk, () => isCurrent);
    await fetch(ch);
    expect(capturedThis).toBe(sdk.config.provider);
  });

  it("calls callback synchronously", async () => {
    const ch = channel("ch-sync", 2);
    const info = channelInfo(ch);
    callback.mockImplementationOnce(() => {
      expect(callback).toHaveBeenCalled();
      return Promise.resolve(info);
    });
    const fetch = createOwnedChannelInfoFetcher(sdk, () => isCurrent);
    const spy = vi.fn();
    const p = fetch(ch).then(spy);
    expect(callback).toHaveBeenCalled();
    await p;
    expect(spy).toHaveBeenCalledWith(info);
  });

  it("rejects on sync throw from callback", async () => {
    const ch = channel("ch-syncthrow", 2);
    callback.mockImplementationOnce(() => {
      throw new Error("sync boom");
    });
    const fetch = createOwnedChannelInfoFetcher(sdk, () => isCurrent);
    await expect(fetch(ch)).rejects.toThrow("sync boom");
    expect(callback).toHaveBeenCalled();
    expect(channelRuntime.setImChannelInfoCache).not.toHaveBeenCalled();
  });

  it("does not write when context changed during flight of an in-flight request", async () => {
    const ch = channel("ch-ctx-flight", 2);
    const info = channelInfo(ch, { title: "Ctx changed mid-flight" });
    callback.mockImplementationOnce(async () => {
      app.shared.currentSpaceId = "space-b";
      app.shared.spaceRevision++;
      return info;
    });
    const fetch = createOwnedChannelInfoFetcher(sdk, () => isCurrent);
    const result = await fetch(ch);
    expect(result).toBeUndefined();
    expect(channelRuntime.setImChannelInfoCache).not.toHaveBeenCalled();
  });

  it("writes a Space-prefixed person back under the requested channel when the datasource returns its bare uid", async () => {
    const spaceId = "0123456789abcdef0123456789abcdef";
    const ch = channel(`s${spaceId}_peer`, 1);
    const bare = channel("peer", 1);
    const info = channelInfo(bare, { title: "Peer Name" });
    callback.mockResolvedValue(info);
    const fetch = createOwnedChannelInfoFetcher(sdk, () => isCurrent);
    const result = await fetch(ch);
    expect(result).toBe(info);
    expect(result?.channel).toBe(ch);
    expect(channelRuntime.setImChannelInfoCache).toHaveBeenCalledWith(sdk, info);
    expect(channelRuntime.notifyImChannelInfoListeners).toHaveBeenCalledWith(sdk, info);
    expect(sdk.channelManager.channelInfocacheMap[ch.getChannelKey()]?.title).toBe("Peer Name");
  });

  it("rejects a prefixed-alias with a different Space prefix than requested", async () => {
    const spaceA = "0123456789abcdef0123456789abcdef";
    const spaceB = "ffffffffffffffffffffffffffffffff";
    const ch = channel(`s${spaceA}_peer`, 1);
    const wrong = channel(`s${spaceB}_peer`, 1);
    const info = channelInfo(wrong, { title: "Different space" });
    callback.mockResolvedValue(info);
    const fetch = createOwnedChannelInfoFetcher(sdk, () => isCurrent);
    const result = await fetch(ch);
    expect(result).toBeUndefined();
    expect(channelRuntime.setImChannelInfoCache).not.toHaveBeenCalled();
  });

  it("registers owned fetches in the shared pending tracker for the muted channel", async () => {
    const ch = channel("ch-pending-reg", 2);
    const info = channelInfo(ch);
    let resolveCallback!: (v: ChannelInfo) => void;
    callback.mockImplementationOnce(
      () => new Promise<ChannelInfo>((resolve) => { resolveCallback = resolve; }),
    );
    const fetch = createOwnedChannelInfoFetcher(sdk, () => isCurrent);
    const pending = fetch(ch);
    const shared = channelRuntime.getPendingImChannelInfoFetches(sdk, ch);
    expect(shared).toHaveLength(1);
    resolveCallback(info);
    await pending;
    expect(channelRuntime.getPendingImChannelInfoFetches(sdk, ch)).toBeUndefined();
  });

  it("does not commit after an in-place status mutation (syncGroupDisbandState) that calls set/notify", async () => {
    const ch = channel("ch-inplace-status", 2);
    const initial = channelInfo(ch);
    initial.orgData.status = 1;
    channelRuntime.setImChannelInfoCache(sdk, initial);
    channelRuntime.notifyImChannelInfoListeners(sdk, initial);
    const stale = channelInfo(ch);
    stale.orgData.status = 1;
    callback.mockImplementationOnce(async () => {
      patchImChannelInfoOrgData(initial, { status: 2 });
      channelRuntime.setImChannelInfoCache(sdk, initial);    // bump revision
      channelRuntime.notifyImChannelInfoListeners(sdk, initial);
      return stale;
    });
    const fetch = createOwnedChannelInfoFetcher(sdk, () => isCurrent);
    const result = await fetch(ch);
    expect(result).toBeUndefined();
    // owned fetch did not undo the disband write
    expect(sdk.channelManager.channelInfocacheMap[ch.getChannelKey()]?.orgData.status).toBe(2);
  });

  it("does not commit after an in-place top mutation that calls set/notify", async () => {
    const ch = channel("ch-inplace-top", 2);
    const initial = channelInfo(ch);
    initial.top = false;
    channelRuntime.setImChannelInfoCache(sdk, initial);
    channelRuntime.notifyImChannelInfoListeners(sdk, initial);
    const stale = channelInfo(ch);
    stale.top = false;
    callback.mockImplementationOnce(async () => {
      initial.top = true;
      channelRuntime.setImChannelInfoCache(sdk, initial);
      channelRuntime.notifyImChannelInfoListeners(sdk, initial);
      return stale;
    });
    const fetch = createOwnedChannelInfoFetcher(sdk, () => isCurrent);
    const result = await fetch(ch);
    expect(result).toBeUndefined();
    expect(sdk.channelManager.channelInfocacheMap[ch.getChannelKey()]?.top).toBe(true);
  });

  it("does not commit after an in-place thread.status mutation that calls set/notify", async () => {
    const ch = channel("ch-inplace-thread", 2);
    const initial = channelInfo(ch);
    initial.orgData.thread = { status: 0, mute: 0 };
    channelRuntime.setImChannelInfoCache(sdk, initial);
    channelRuntime.notifyImChannelInfoListeners(sdk, initial);
    const stale = channelInfo(ch);
    stale.orgData.thread = { status: 0, mute: 0 };
    callback.mockImplementationOnce(async () => {
      initial.orgData.thread = { ...initial.orgData.thread, status: 1 };
      channelRuntime.setImChannelInfoCache(sdk, initial);
      channelRuntime.notifyImChannelInfoListeners(sdk, initial);
      return stale;
    });
    const fetch = createOwnedChannelInfoFetcher(sdk, () => isCurrent);
    const result = await fetch(ch);
    expect(result).toBeUndefined();
    expect(sdk.channelManager.channelInfocacheMap[ch.getChannelKey()]?.orgData.thread.status).toBe(1);
  });

  it("detects a notification-only in-place update without enumerating business fields", async () => {
    const ch = channel("notification-only");
    const initial = channelInfo(ch, { title: "before" });
    channelRuntime.setImChannelInfoCache(sdk, initial);
    callback.mockImplementationOnce(async () => {
      initial.title = "after";
      channelRuntime.notifyImChannelInfoListeners(sdk, initial);
      return channelInfo(ch, { title: "stale" });
    });
    const fetch = createOwnedChannelInfoFetcher(sdk, () => isCurrent);

    expect(await fetch(ch)).toBeUndefined();
    expect(sdk.channelManager.getChannelInfo(ch)?.title).toBe("after");
  });

  it.each(["failure", "expired"] as const)(
    "settles and removes a tracked %s request without granting deferred repair rights",
    async (outcome) => {
      const ch = channel(`tracked-${outcome}`);
      let resolve!: (info: ChannelInfo) => void;
      let reject!: (error: Error) => void;
      callback.mockImplementationOnce(() => new Promise((yes, no) => {
        resolve = yes;
        reject = no;
      }));
      const fetch = createOwnedChannelInfoFetcher(sdk, () => isCurrent);
      const request = fetch(ch);
      const result = Promise.allSettled([request]);
      const waiting = channelRuntime.getPendingImChannelInfoFetch(sdk, ch);
      expect(waiting).toBeDefined();
      expect(channelRuntime.isChannelInfoFetchResultCurrent(request)).toBe(false);

      if (outcome === "failure") reject(new Error("offline"));
      else {
        isCurrent = false;
        resolve(channelInfo(ch));
      }
      expect((await result)[0].status).toBe(outcome === "failure" ? "rejected" : "fulfilled");
      await waiting;
      expect(channelRuntime.getPendingImChannelInfoFetches(sdk, ch)).toBeUndefined();
      expect(channelRuntime.isChannelInfoFetchResultCurrent(request)).toBe(false);
    },
  );

  it("revokes deferred repair rights when a successful request's owner exits", async () => {
    const ch = channel("accepted-owner");
    callback.mockResolvedValueOnce(channelInfo(ch));
    const fetch = createOwnedChannelInfoFetcher(sdk, () => isCurrent);
    const request = fetch(ch);
    await request;
    expect(channelRuntime.isChannelInfoFetchResultCurrent(request)).toBe(true);

    isCurrent = false;
    expect(channelRuntime.isChannelInfoFetchResultCurrent(request)).toBe(false);
  });
});
