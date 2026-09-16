import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WKSDK, { Channel, Conversation } from "wukongimjssdk";

const app = vi.hoisted(() => ({
  shared: { currentSpaceId: "space-a", spaceRevision: 0 },
  loginInfo: { uid: "user-a", token: "token-a", sessionRevision: 0 },
  apiClient: { config: { apiURL: "https://api.invalid", originRevision: 0 } },
}));
vi.mock("../App", () => ({ default: app }));

import { syncCurrentImConversations } from "./currentConversationSync";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function conversation(id: string, version = 1): Conversation {
  const value = new Conversation();
  value.channel = new Channel(id, 2);
  value.remoteExtra.version = version;
  return value;
}

const sdk = WKSDK.shared();
const provider = vi.fn<() => Promise<Conversation[]>>();

beforeEach(() => {
  app.shared.currentSpaceId = "space-a";
  app.shared.spaceRevision++;
  app.loginInfo.uid = "user-a";
  app.loginInfo.token = "token-a";
  app.loginInfo.sessionRevision++;
  app.apiClient.config.apiURL = "https://api.invalid";
  app.apiClient.config.originRevision++;
  provider.mockReset().mockResolvedValue([]);
  sdk.config.provider.syncConversationsCallback = provider;
  sdk.conversationManager.conversations = [];
  sdk.conversationManager.maxExtraVersion = 0;
  vi.spyOn(sdk.reminderManager, "sync").mockResolvedValue(undefined);
});

afterEach(() => vi.restoreAllMocks());

describe("current conversation sync on the installed SDK", () => {
  it("characterizes SDK.sync committing before its returned promise is observed", async () => {
    const response = [conversation("sdk")];
    provider.mockResolvedValueOnce(response);
    await sdk.conversationManager.sync({});
    expect(sdk.conversationManager.conversations).toBe(response);
    expect(sdk.reminderManager.sync).toHaveBeenCalledOnce();
  });

  it("commits through the guarded provider path and preserves SDK extra/reminder hydration", async () => {
    const originalSync = vi.spyOn(sdk.conversationManager, "sync");
    const response = [conversation("first", 3), conversation("second", 8)];
    provider.mockResolvedValueOnce(response);
    const result = await syncCurrentImConversations();

    expect(result?.conversations).toBe(response);
    expect(result?.isCurrent()).toBe(true);
    expect(originalSync).not.toHaveBeenCalled();
    expect(sdk.conversationManager.conversations).toBe(response);
    expect(sdk.conversationManager.maxExtraVersion).toBe(8);
    expect(sdk.reminderManager.sync).toHaveBeenCalledOnce();
  });

  it("does not let an older same-Space response overwrite a newer SDK snapshot", async () => {
    const old = deferred<Conversation[]>();
    const response = [conversation("new", 3)];
    provider.mockReturnValueOnce(old.promise).mockResolvedValueOnce(response);
    const oldRequest = syncCurrentImConversations();
    await syncCurrentImConversations();
    old.resolve([conversation("old", 999)]);

    expect(await oldRequest).toBeUndefined();
    expect(sdk.conversationManager.conversations).toBe(response);
    expect(sdk.conversationManager.maxExtraVersion).toBe(3);
    expect(sdk.reminderManager.sync).toHaveBeenCalledOnce();
  });

  it.each(["space", "session", "origin"] as const)(
    "rejects %s A -> B -> A results even without a replacement request",
    async (field) => {
      const response = deferred<Conversation[]>();
      const existing = [conversation("existing")];
      sdk.conversationManager.conversations = existing;
      provider.mockReturnValueOnce(response.promise);
      const request = syncCurrentImConversations();
      if (field === "space") app.shared.spaceRevision += 2;
      if (field === "session") app.loginInfo.sessionRevision += 2;
      if (field === "origin") app.apiClient.config.originRevision += 2;
      response.resolve([conversation("stale", 100)]);

      expect(await request).toBeUndefined();
      expect(sdk.conversationManager.conversations).toBe(existing);
      expect(sdk.conversationManager.maxExtraVersion).toBe(0);
      expect(sdk.reminderManager.sync).not.toHaveBeenCalled();
    },
  );

  it("checks scope again between provider resolution and the cache commit microtask", async () => {
    provider.mockImplementationOnce(() => {
      const response = Promise.resolve([conversation("stale")]);
      void response.then(() => { app.shared.currentSpaceId = "space-b"; });
      return response;
    });

    expect(await syncCurrentImConversations()).toBeUndefined();
    expect(sdk.conversationManager.conversations).toEqual([]);
    expect(sdk.reminderManager.sync).not.toHaveBeenCalled();
  });

  it("invalidates accepted results before a caller applies delayed pins", async () => {
    const old = await syncCurrentImConversations();
    await syncCurrentImConversations();
    expect(old?.isCurrent()).toBe(false);
  });

  it("defers SDK and reminder writes until the owner commits its prepared snapshot", async () => {
    const existing = [conversation("existing")];
    const response = [conversation("raw")];
    const accepted = [conversation("prepared", 5)];
    sdk.conversationManager.conversations = existing;
    provider.mockResolvedValueOnce(response);
    const result = await syncCurrentImConversations({ deferCommit: true });
    expect(sdk.conversationManager.conversations).toBe(existing);
    expect(sdk.reminderManager.sync).not.toHaveBeenCalled();
    expect(result?.commit(accepted)).toBe(true);
    expect(sdk.conversationManager.conversations).toBe(accepted);
    expect(sdk.reminderManager.sync).toHaveBeenCalledOnce();
    expect(result?.commit(response)).toBe(false);
    expect(sdk.conversationManager.conversations).toBe(accepted);
  });

  it("cannot commit a deferred snapshot after its request is superseded", async () => {
    const result = await syncCurrentImConversations({ deferCommit: true });
    await syncCurrentImConversations();
    const accepted = sdk.conversationManager.conversations;
    expect(result?.commit([conversation("late")])).toBe(false);
    expect(sdk.conversationManager.conversations).toBe(accepted);
  });

  it("revokes both provider conversion and SDK commit after its owner stops", async () => {
    const response = deferred<Conversation[]>();
    let active = true;
    let providerCanCommit: (() => boolean) | undefined;
    sdk.config.provider.syncConversationsCallback = (filter: { canCommit: () => boolean }) => {
      providerCanCommit = filter.canCommit;
      return response.promise;
    };
    const request = syncCurrentImConversations({ canCommit: () => active });
    expect(providerCanCommit?.()).toBe(true);
    active = false;
    expect(providerCanCommit?.()).toBe(false);
    response.resolve([conversation("stopped")]);
    expect(await request).toBeUndefined();
    expect(sdk.conversationManager.conversations).toEqual([]);
    expect(sdk.reminderManager.sync).not.toHaveBeenCalled();
  });

  it("lets initial title hydration reuse Chat's pending or accepted request", async () => {
    const response = deferred<Conversation[]>();
    provider.mockReturnValueOnce(response.promise);
    const chat = syncCurrentImConversations();
    const title = syncCurrentImConversations({ reuseCurrent: true });
    expect(title).toBe(chat);
    response.resolve([conversation("chat")]);
    const result = await chat;
    expect(await title).toBe(result);
    expect(await syncCurrentImConversations({ reuseCurrent: true })).toBe(result);
    expect(result?.isCurrent()).toBe(true);
    expect(provider).toHaveBeenCalledOnce();
  });

  it("allows retries after an active error without modifying the existing cache", async () => {
    const existing = [conversation("existing")];
    sdk.conversationManager.conversations = existing;
    provider.mockRejectedValueOnce(new Error("offline"));
    await expect(syncCurrentImConversations()).rejects.toThrow("offline");
    expect(sdk.conversationManager.conversations).toBe(existing);
    expect((await syncCurrentImConversations({ reuseCurrent: true }))?.isCurrent()).toBe(true);
    expect(provider).toHaveBeenCalledTimes(2);
  });

  it("ignores a stale failure without clearing the newer request", async () => {
    const old = deferred<Conversation[]>();
    const current = deferred<Conversation[]>();
    provider.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    const oldRequest = syncCurrentImConversations();
    const currentRequest = syncCurrentImConversations();
    old.reject(new Error("old offline"));
    expect(await oldRequest).toBeUndefined();
    expect(syncCurrentImConversations({ reuseCurrent: true })).toBe(currentRequest);
    current.resolve([]);
    expect((await currentRequest)?.isCurrent()).toBe(true);
  });

  it("revokes requests when the provider is replaced", async () => {
    const response = deferred<Conversation[]>();
    provider.mockReturnValueOnce(response.promise);
    const request = syncCurrentImConversations();
    sdk.config.provider.syncConversationsCallback = async () => [];
    response.resolve([conversation("stale")]);
    expect(await request).toBeUndefined();
    expect(sdk.conversationManager.conversations).toEqual([]);
  });

  it.each(["sync", "async"] as const)("isolates %s reminder failures from successful sync", async (mode) => {
    const error = new Error("reminders offline");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const sync = vi.mocked(sdk.reminderManager.sync);
    if (mode === "sync") sync.mockImplementationOnce(() => { throw error; });
    else sync.mockRejectedValueOnce(error);

    expect((await syncCurrentImConversations())?.isCurrent()).toBe(true);
    expect(log).toHaveBeenCalledWith("[im-conversation-sync] reminder sync failed", error);
  });
});
