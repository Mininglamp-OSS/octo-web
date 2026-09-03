import { describe, expect, it, vi } from "vitest";
import {
  ChatClientStatus,
  ChatClientEvent,
  chatChannelKey,
  type ChatChannelRef,
  type ChatConversationLease,
  type ChatConversationHandle,
  type ChatConnectionAdapter,
  type ChatConversationAdapter,
  type ChatSubscribeAdapter,
  type ChatMessageAdapter,
} from "./types";
import {
  ChatConversationSupersededError,
  ManagedChatClient,
} from "./ManagedChatClient";

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

const channelA: ChatChannelRef = { channelId: "chA", channelType: 1 };
const channelB: ChatChannelRef = { channelId: "chB", channelType: 2 };

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function bootstrapFor(
  channel?: ChatChannelRef
): Parameters<typeof ManagedChatClient.prototype.start>[0] {
  return channel ? { initialChannel: channel } : {};
}

function createHandle(channel: ChatChannelRef): ChatConversationHandle {
  return { channel };
}

function createMockConnectionAdapter() {
  return {
    status: ChatClientStatus.Idle,
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
  } as unknown as ChatConnectionAdapter & {
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  };
}

function createMockConversationAdapter() {
  return {
    openConversation: vi.fn(async (channel: ChatChannelRef) =>
      createHandle(channel)
    ),
    closeConversation: vi.fn(async () => {}),
  } as unknown as ChatConversationAdapter & {
    openConversation: ReturnType<typeof vi.fn>;
    closeConversation: ReturnType<typeof vi.fn>;
  };
}

function createMockSubscribeAdapter() {
  return {
    subscribe: vi.fn(async () => {}),
    unsubscribe: vi.fn(async () => {}),
  } as unknown as ChatSubscribeAdapter & {
    subscribe: ReturnType<typeof vi.fn>;
    unsubscribe: ReturnType<typeof vi.fn>;
  };
}

function createMockMessageAdapter() {
  const messages = [
    { id: "m1", text: "hello" },
    { id: "m2", text: "world" },
  ];
  return {
    loadMessages: vi.fn(async () => messages),
    subscribeMessages: vi.fn(() => () => {}),
    subscribeMessageStatus: vi.fn(() => () => {}),
    sendMessage: vi.fn(async (content: string) => ({
      id: "m3",
      text: content,
    })),
  } as unknown as ChatMessageAdapter<{ id: string; text: string }, string> & {
    loadMessages: ReturnType<typeof vi.fn>;
    subscribeMessages: ReturnType<typeof vi.fn>;
    subscribeMessageStatus: ReturnType<typeof vi.fn>;
    sendMessage: ReturnType<typeof vi.fn>;
  };
}

// --------------------------------------------------------------------------
// chatChannelKey
// --------------------------------------------------------------------------

describe("chatChannelKey", () => {
  it("produces the WuKongIM-compatible channel key", () => {
    expect(chatChannelKey({ channelId: "user_abc", channelType: 1 })).toBe(
      "user_abc-1"
    );
    expect(chatChannelKey({ channelId: "group_xyz", channelType: 2 })).toBe(
      "group_xyz-2"
    );
    expect(chatChannelKey({ channelId: "", channelType: 0 })).toBe("-0");
  });

  it("is symmetric with itself (same key for equal refs)", () => {
    expect(chatChannelKey(channelA)).toBe(chatChannelKey({ ...channelA }));
    expect(chatChannelKey(channelA)).not.toBe(chatChannelKey(channelB));
  });
});

// --------------------------------------------------------------------------
// ManagedChatClient
// --------------------------------------------------------------------------

describe("ManagedChatClient", () => {
  function createClient(opts?: {
    failConnect?: boolean;
    failDisconnect?: boolean;
    failOpenConversation?: boolean;
    withSubscribe?: boolean;
    withMessage?: boolean;
  }) {
    const connAdapter = createMockConnectionAdapter();
    if (opts?.failConnect) {
      connAdapter.connect.mockRejectedValue(new Error("connect failed"));
    }
    if (opts?.failDisconnect) {
      connAdapter.disconnect.mockRejectedValue(new Error("disconnect failed"));
    }

    const convAdapter = createMockConversationAdapter();
    if (opts?.failOpenConversation) {
      convAdapter.openConversation.mockRejectedValue(new Error("open failed"));
    }

    const subAdapter = opts?.withSubscribe
      ? createMockSubscribeAdapter()
      : undefined;

    const msgAdapter = opts?.withMessage
      ? createMockMessageAdapter()
      : undefined;

    const client = new ManagedChatClient(connAdapter, convAdapter, {
      subscribeAdapter: subAdapter,
      messageAdapter: msgAdapter,
    });

    return { client, connAdapter, convAdapter, subAdapter, msgAdapter };
  }

  // -- initial state -------------------------------------------------------

  describe("initial state", () => {
    it("starts idle with no active conversation", () => {
      const { client } = createClient();
      expect(client.status).toBe(ChatClientStatus.Idle);
      expect(client.activeConversation).toBeNull();
      const snap = client.getSnapshot();
      expect(snap.status).toBe(ChatClientStatus.Idle);
      expect(snap.activeConversation).toBeNull();
    });

    it("exposes a messages port even without a message adapter", () => {
      const { client } = createClient();
      expect(client.messages).toBeDefined();
      expect(typeof client.messages.sendMessage).toBe("function");
    });
  });

  // -- start / stop --------------------------------------------------------

  describe("start", () => {
    it("transitions Connecting -> Connected on success", async () => {
      const { client, connAdapter } = createClient();
      const events: ChatClientStatus[] = [];
      client.subscribe(ChatClientEvent.StatusChanged, (s) => events.push(s));

      await client.start(bootstrapFor(channelA));

      expect(connAdapter.connect).toHaveBeenCalledTimes(1);
      expect(client.status).toBe(ChatClientStatus.Connected);
      expect(events).toEqual([
        ChatClientStatus.Connecting,
        ChatClientStatus.Connected,
      ]);
    });

    it("is idempotent — second start is a no-op", async () => {
      const { client, connAdapter } = createClient();
      await client.start(bootstrapFor(channelA));
      expect(connAdapter.connect).toHaveBeenCalledTimes(1);

      await client.start(bootstrapFor(channelA));
      expect(connAdapter.connect).toHaveBeenCalledTimes(1);
    });

    it("does not create a second transport when start is called while disconnected", async () => {
      const { client, connAdapter } = createClient();
      await client.start(bootstrapFor(channelA));
      client.connectionContext.onConnectionLost();

      await client.start(bootstrapFor(channelA));

      expect(client.status).toBe(ChatClientStatus.Disconnected);
      expect(connAdapter.connect).toHaveBeenCalledTimes(1);
    });

    it("sets Failed and rolls back when connection adapter throws", async () => {
      const { client, connAdapter } = createClient({ failConnect: true });
      await expect(client.start(bootstrapFor(channelA))).rejects.toThrow(
        "connect failed"
      );
      expect(client.status).toBe(ChatClientStatus.Failed);
      expect(connAdapter.disconnect).toHaveBeenCalledTimes(1);
    });

    it("retries pending connection cleanup before reconnecting", async () => {
      const { client, connAdapter } = createClient();
      connAdapter.connect
        .mockRejectedValueOnce(new Error("connect failed"))
        .mockResolvedValueOnce(undefined);
      connAdapter.disconnect
        .mockRejectedValueOnce(new Error("rollback failed"))
        .mockResolvedValue(undefined);

      await expect(client.start(bootstrapFor(channelA))).rejects.toThrow(
        /connect failed; rollback failed/
      );
      await client.start(bootstrapFor(channelB));

      expect(connAdapter.disconnect).toHaveBeenCalledTimes(2);
      expect(connAdapter.connect).toHaveBeenCalledTimes(2);
      expect(client.status).toBe(ChatClientStatus.Connected);
    });

    it("queues a stop requested while start is still connecting", async () => {
      const { client, connAdapter } = createClient();
      const connect = deferred<void>();
      connAdapter.connect.mockImplementationOnce(() => connect.promise);

      const starting = client.start(bootstrapFor(channelA));
      const stopping = client.stop();

      connect.resolve();
      await Promise.all([starting, stopping]);

      expect(connAdapter.disconnect).toHaveBeenCalledTimes(1);
      expect(client.status).toBe(ChatClientStatus.Stopped);
    });

    it("shares one in-flight connection across concurrent starts", async () => {
      const { client, connAdapter } = createClient();
      const connect = deferred<void>();
      connAdapter.connect.mockImplementationOnce(() => connect.promise);
      let firstResolved = false;
      let secondResolved = false;

      const first = client.start(bootstrapFor(channelA)).then(() => {
        firstResolved = true;
      });
      const second = client.start(bootstrapFor(channelA)).then(() => {
        secondResolved = true;
      });
      await Promise.resolve();

      expect(connAdapter.connect).toHaveBeenCalledTimes(1);
      expect(firstResolved).toBe(false);
      expect(secondResolved).toBe(false);

      connect.resolve();
      await Promise.all([first, second]);
      expect(connAdapter.connect).toHaveBeenCalledTimes(1);
    });

    it("does not open until a queued stop and restart have both completed", async () => {
      const { client, connAdapter, convAdapter } = createClient();
      const firstConnect = deferred<void>();
      const disconnect = deferred<void>();
      const secondConnect = deferred<void>();
      connAdapter.connect
        .mockImplementationOnce(() => firstConnect.promise)
        .mockImplementationOnce(() => secondConnect.promise);
      connAdapter.disconnect.mockImplementationOnce(() => disconnect.promise);

      const starting = client.start(bootstrapFor(channelA));
      const stopping = client.stop();
      const restarting = client.start(bootstrapFor(channelB));
      const opening = client.openConversation(channelB);

      firstConnect.resolve();
      await vi.waitFor(() => {
        expect(connAdapter.disconnect).toHaveBeenCalledTimes(1);
      });
      expect(convAdapter.openConversation).not.toHaveBeenCalled();

      disconnect.resolve();
      await vi.waitFor(() => {
        expect(connAdapter.connect).toHaveBeenCalledTimes(2);
      });
      expect(convAdapter.openConversation).not.toHaveBeenCalled();

      secondConnect.resolve();
      await Promise.all([starting, stopping, restarting, opening]);
      expect(convAdapter.openConversation).toHaveBeenCalledWith(channelB);
    });
  });

  describe("stop", () => {
    it("transitions to Stopped and releases the conversation", async () => {
      const { client, connAdapter, convAdapter } = createClient();
      await client.start(bootstrapFor(channelA));

      const lease = await client.openConversation(channelB);
      expect(lease.released).toBe(false);

      await client.stop();

      expect(client.status).toBe(ChatClientStatus.Stopped);
      expect(client.activeConversation).toBeNull();
      expect(lease.released).toBe(true);
      expect(connAdapter.disconnect).toHaveBeenCalledTimes(1);
      // closeConversation should have been called with the handle
      expect(convAdapter.closeConversation).toHaveBeenCalledTimes(1);
    });

    it("is idempotent — second stop is a no-op", async () => {
      const { client, connAdapter } = createClient();
      await client.start(bootstrapFor(channelA));
      await client.stop();
      expect(connAdapter.disconnect).toHaveBeenCalledTimes(1);

      await client.stop();
      expect(connAdapter.disconnect).toHaveBeenCalledTimes(1);
    });

    it("keeps event subscriptions across an explicit stop and restart", async () => {
      const { client } = createClient();
      await client.start(bootstrapFor(channelA));

      const statuses: ChatClientStatus[] = [];
      client.subscribe(ChatClientEvent.StatusChanged, (status) => statuses.push(status));

      await client.stop();
      await client.start(bootstrapFor(channelB));

      expect(statuses).toEqual([
        ChatClientStatus.Stopped,
        ChatClientStatus.Connecting,
        ChatClientStatus.Connected,
      ]);
    });

    it("reports a disconnect error after transitioning to Stopped", async () => {
      const { client, connAdapter } = createClient({
        failDisconnect: true,
      });
      await client.start(bootstrapFor(channelA));
      await expect(client.stop()).rejects.toThrow(/disconnect failed/);
      expect(client.status).toBe(ChatClientStatus.Stopped);
    });

    it("reports a prior background release failure from stop", async () => {
      const { client, subAdapter } = createClient({ withSubscribe: true });
      await client.start(bootstrapFor(channelA));
      const lease = await client.openConversation(channelA);
      subAdapter!.unsubscribe.mockRejectedValueOnce(
        new Error("background unsubscribe failed")
      );

      lease.release();
      await vi.waitFor(() => {
        expect(client.status).toBe(ChatClientStatus.Failed);
      });

      await expect(client.stop()).rejects.toThrow(
        /background unsubscribe failed/
      );
      expect(client.status).toBe(ChatClientStatus.Stopped);
    });

    it("queues a restart requested while stop is disconnecting", async () => {
      const { client, connAdapter } = createClient();
      await client.start(bootstrapFor(channelA));
      const disconnect = deferred<void>();
      connAdapter.disconnect.mockImplementationOnce(() => disconnect.promise);

      const stopping = client.stop();
      const restarting = client.start(bootstrapFor(channelB));

      disconnect.resolve();
      await Promise.all([stopping, restarting]);

      expect(connAdapter.connect).toHaveBeenCalledTimes(2);
      expect(client.status).toBe(ChatClientStatus.Connected);
    });

    it("shares one teardown across concurrent stops", async () => {
      const { client, connAdapter } = createClient();
      await client.start(bootstrapFor(channelA));
      const disconnect = deferred<void>();
      connAdapter.disconnect.mockImplementationOnce(() => disconnect.promise);
      let firstResolved = false;
      let secondResolved = false;

      const first = client.stop().then(() => {
        firstResolved = true;
      });
      const second = client.stop().then(() => {
        secondResolved = true;
      });
      await vi.waitFor(() => {
        expect(connAdapter.disconnect).toHaveBeenCalledTimes(1);
      });
      expect(firstResolved).toBe(false);
      expect(secondResolved).toBe(false);

      disconnect.resolve();
      await Promise.all([first, second]);
      expect(connAdapter.disconnect).toHaveBeenCalledTimes(1);
    });
  });

  // -- conversation management ---------------------------------------------

  describe("openConversation", () => {
    it("returns a controlled lease for the requested channel", async () => {
      const { client } = createClient();
      await client.start(bootstrapFor(channelA));

      const lease = await client.openConversation(channelB);
      expect(lease.channel).toBe(channelB);
      expect(lease.released).toBe(false);
      expect(client.activeConversation?.channel).toBe(channelB);
    });

    it("releases the old lease only after the new one is ready", async () => {
      const { client, convAdapter } = createClient();
      await client.start(bootstrapFor(channelA));

      const lease1 = await client.openConversation(channelA);
      expect(lease1.released).toBe(false);

      // At the moment openConversation(channelB) runs, lease1 must still be
      // unreleased (the switch hasn't happened yet).
      let lease1ReleasedDuringOpen = false;
      convAdapter.openConversation.mockImplementationOnce(
        async (ch: ChatChannelRef) => {
          lease1ReleasedDuringOpen = lease1.released;
          return createHandle(ch);
        }
      );

      const lease2 = await client.openConversation(channelB);
      expect(lease1ReleasedDuringOpen).toBe(false);
      expect(lease1.released).toBe(true);
      expect(lease2.released).toBe(false);
      expect(client.activeConversation?.channel).toBe(channelB);
    });

    it("old lease release() does not clear a newer active lease", async () => {
      const { client } = createClient();
      await client.start(bootstrapFor(channelA));

      const lease1 = await client.openConversation(channelA);
      const lease2 = await client.openConversation(channelB);

      // lease1 is already released by this point (switched away).
      // Calling release() again is idempotent and must not touch
      // the current lease (lease2).
      lease1.release();
      expect(client.activeConversation?.channel).toBe(channelB);
      expect(lease2.released).toBe(false);
    });

    it("emits ConversationOpened event", async () => {
      const { client } = createClient();
      await client.start(bootstrapFor(channelA));

      const openedChannels: ChatChannelRef[] = [];
      client.subscribe(ChatClientEvent.ConversationOpened, (ch) =>
        openedChannels.push(ch)
      );

      await client.openConversation(channelB);
      expect(openedChannels).toHaveLength(1);
      expect(openedChannels[0]).toEqual(channelB);
    });

    it("emits ConversationClosed for the replaced lease", async () => {
      const { client } = createClient();
      await client.start(bootstrapFor(channelA));

      const closedChannels: ChatChannelRef[] = [];
      client.subscribe(ChatClientEvent.ConversationClosed, (ch) =>
        closedChannels.push(ch)
      );

      await client.openConversation(channelA);
      await client.openConversation(channelB);

      // Opening channelB should close the channelA lease
      expect(closedChannels).toHaveLength(1);
      expect(closedChannels[0]).toEqual(channelA);
    });

    it("keeps the current lease when opening the replacement fails", async () => {
      const { client, convAdapter } = createClient();
      await client.start(bootstrapFor(channelA));
      const current = await client.openConversation(channelA);
      const closed = vi.fn();
      client.subscribe(ChatClientEvent.ConversationClosed, closed);
      convAdapter.openConversation.mockRejectedValueOnce(
        new Error("open failed")
      );

      await expect(client.openConversation(channelB)).rejects.toThrow(
        "open failed"
      );

      expect(current.released).toBe(false);
      expect(client.activeConversation).toBe(current);
      expect(closed).not.toHaveBeenCalled();
    });

    it("keeps the latest request active when adapter opens resolve out of order", async () => {
      const { client, convAdapter } = createClient();
      await client.start(bootstrapFor(channelA));
      const first = deferred<ChatConversationHandle>();
      const second = deferred<ChatConversationHandle>();
      convAdapter.openConversation
        .mockImplementationOnce(() => first.promise)
        .mockImplementationOnce(() => second.promise);

      const openingA = client
        .openConversation(channelA)
        .catch((error) => error);
      await vi.waitFor(() => {
        expect(convAdapter.openConversation).toHaveBeenCalledTimes(1);
      });
      const openingB = client.openConversation(channelB);

      first.resolve(createHandle(channelA));
      const superseded = await openingA;
      await vi.waitFor(() => {
        expect(convAdapter.openConversation).toHaveBeenCalledTimes(2);
      });
      second.resolve(createHandle(channelB));
      const leaseB = await openingB;

      expect(superseded).toBeInstanceOf(Error);
      expect(superseded.name).toBe("ChatConversationSupersededError");
      expect(leaseB.released).toBe(false);
      expect(client.activeConversation).toBe(leaseB);
      expect(convAdapter.closeConversation).toHaveBeenCalledWith(
        createHandle(channelA)
      );
    });

    it("does not emit opened or closed events for a superseded pending open", async () => {
      const { client, convAdapter } = createClient();
      await client.start(bootstrapFor(channelA));
      const first = deferred<ChatConversationHandle>();
      const opened = vi.fn();
      const closed = vi.fn();
      client.subscribe(ChatClientEvent.ConversationOpened, opened);
      client.subscribe(ChatClientEvent.ConversationClosed, closed);
      convAdapter.openConversation
        .mockImplementationOnce(() => first.promise)
        .mockImplementationOnce(async (requestedChannel: ChatChannelRef) =>
          createHandle(requestedChannel)
        );

      const openingA = client
        .openConversation(channelA)
        .catch((error) => error);
      await vi.waitFor(() => {
        expect(convAdapter.openConversation).toHaveBeenCalledTimes(1);
      });
      const openingB = client.openConversation(channelB);
      first.resolve(createHandle(channelA));
      await openingA;
      await openingB;

      expect(opened).toHaveBeenCalledTimes(1);
      expect(opened).toHaveBeenCalledWith(channelB);
      expect(closed).not.toHaveBeenCalled();
    });

    it("waits for a superseded pending open to be cleaned before stop resolves", async () => {
      const { client, convAdapter } = createClient();
      await client.start(bootstrapFor(channelA));
      const pending = deferred<ChatConversationHandle>();
      const close = deferred<void>();
      convAdapter.openConversation.mockImplementationOnce(
        () => pending.promise
      );
      convAdapter.closeConversation.mockImplementationOnce(() => close.promise);

      const opening = client.openConversation(channelA).catch((error) => error);
      await vi.waitFor(() => {
        expect(convAdapter.openConversation).toHaveBeenCalledTimes(1);
      });
      const stopping = client.stop();
      let stopped = false;
      void stopping.then(() => {
        stopped = true;
      });
      pending.resolve(createHandle(channelA));

      await vi.waitFor(() => {
        expect(convAdapter.closeConversation).toHaveBeenCalledTimes(1);
      });
      expect(stopped).toBe(false);
      close.resolve();
      const superseded = await opening;
      await stopping;

      expect(superseded.name).toBe("ChatConversationSupersededError");
      expect(stopped).toBe(true);
      expect(client.activeConversation).toBeNull();
      expect(client.status).toBe(ChatClientStatus.Stopped);
    });

    it("rejects opening a conversation before start or after stop", async () => {
      const { client } = createClient();
      await expect(client.openConversation(channelA)).rejects.toThrow(
        /not started/
      );

      await client.start(bootstrapFor(channelA));
      await client.stop();

      await expect(client.openConversation(channelA)).rejects.toThrow(
        /not started/
      );
    });

    it("unsubscribes before resubscribing when reopening the same channel", async () => {
      const { client, convAdapter, subAdapter } = createClient({
        withSubscribe: true,
      });
      await client.start(bootstrapFor(channelA));
      await client.openConversation(channelA);
      const calls: string[] = [];
      convAdapter.closeConversation.mockImplementationOnce(async () => {
        calls.push("close");
      });
      subAdapter!.unsubscribe.mockImplementationOnce(async () => {
        calls.push("unsubscribe");
      });
      subAdapter!.subscribe.mockImplementationOnce(async () => {
        calls.push("subscribe");
      });

      const replacement = await client.openConversation({ ...channelA });

      expect(calls).toEqual(["close", "unsubscribe", "subscribe"]);
      expect(replacement.released).toBe(false);
      expect(client.activeConversation).toBe(replacement);
    });

    it("fails closed when old subscription teardown fails", async () => {
      const { client, subAdapter } = createClient({ withSubscribe: true });
      await client.start(bootstrapFor(channelA));
      await client.openConversation(channelA);
      const errors: Error[] = [];
      client.subscribe(ChatClientEvent.Error, (error) => errors.push(error));
      subAdapter!.unsubscribe.mockRejectedValueOnce(
        new Error("unsubscribe failed")
      );

      await expect(client.openConversation(channelB)).rejects.toThrow(
        /unsubscribe failed/
      );

      expect(client.status).toBe(ChatClientStatus.Failed);
      expect(client.activeConversation).toBeNull();
      expect(subAdapter!.subscribe).toHaveBeenCalledTimes(1);
      expect(errors).toHaveLength(1);
    });

    it("discards an open superseded while its subscription is pending", async () => {
      const { client, subAdapter } = createClient({ withSubscribe: true });
      await client.start(bootstrapFor(channelA));
      const firstSubscribe = deferred<void>();
      const calls: string[] = [];
      subAdapter!.subscribe
        .mockImplementationOnce(async () => {
          calls.push("subscribe-stale");
          await firstSubscribe.promise;
        })
        .mockImplementationOnce(async () => {
          calls.push("subscribe-winning");
        });
      subAdapter!.unsubscribe.mockImplementationOnce(async () => {
        calls.push("unsubscribe-stale");
      });

      const firstOpen = client.openConversation(channelA);
      await vi.waitFor(() => {
        expect(subAdapter!.subscribe).toHaveBeenCalledTimes(1);
      });
      const winningOpen = client.openConversation({ ...channelA });
      firstSubscribe.resolve();

      await expect(firstOpen).rejects.toBeInstanceOf(
        ChatConversationSupersededError
      );
      const winningLease = await winningOpen;

      expect(calls).toEqual([
        "subscribe-stale",
        "unsubscribe-stale",
        "subscribe-winning",
      ]);
      expect(client.activeConversation).toBe(winningLease);
      expect(winningLease.released).toBe(false);
    });

    it("discards an open superseded by stop while subscription is pending", async () => {
      const { client, subAdapter } = createClient({ withSubscribe: true });
      await client.start(bootstrapFor(channelA));
      const subscribe = deferred<void>();
      subAdapter!.subscribe.mockImplementationOnce(() => subscribe.promise);
      const events: string[] = [];
      client.subscribe(ChatClientEvent.ConversationOpened, () => {
        events.push("opened");
      });
      client.subscribe(ChatClientEvent.ConversationClosed, () => {
        events.push("closed");
      });

      const opening = client.openConversation(channelA);
      await vi.waitFor(() => {
        expect(subAdapter!.subscribe).toHaveBeenCalledTimes(1);
      });
      const stopping = client.stop();
      subscribe.resolve();

      await expect(opening).rejects.toBeInstanceOf(
        ChatConversationSupersededError
      );
      await stopping;

      expect(events).toEqual([]);
      expect(client.status).toBe(ChatClientStatus.Stopped);
    });

    it("discards an open superseded while the previous lease is tearing down", async () => {
      const { client, convAdapter } = createClient();
      await client.start(bootstrapFor(channelA));
      await client.openConversation(channelA);

      const closePrevious = deferred<void>();
      convAdapter.closeConversation.mockImplementationOnce(
        () => closePrevious.promise
      );

      const staleOpen = client.openConversation(channelB);
      await vi.waitFor(() => {
        expect(convAdapter.closeConversation).toHaveBeenCalledTimes(1);
      });
      const winningOpen = client.openConversation(channelA);
      closePrevious.resolve();

      await expect(staleOpen).rejects.toBeInstanceOf(
        ChatConversationSupersededError
      );
      const winningLease = await winningOpen;

      expect(client.activeConversation).toBe(winningLease);
      expect(winningLease.channel).toBe(channelA);
    });
  });

  // -- controlled lease release() --------------------------------------------

  describe("lease release()", () => {
    it("triggers closeConversation, unsubscribe, and ConversationClosed", async () => {
      const { client, convAdapter, subAdapter } = createClient({
        withSubscribe: true,
      });
      await client.start(bootstrapFor(channelA));

      const lease = await client.openConversation(channelA);
      convAdapter.closeConversation.mockClear();
      subAdapter!.unsubscribe.mockClear();

      lease.release();

      // Release is synchronous to the consumer; adapter teardown is queued.
      expect(lease.released).toBe(true);
      expect(client.activeConversation).toBeNull();
      await vi.waitFor(() => {
        expect(convAdapter.closeConversation).toHaveBeenCalledTimes(1);
        expect(subAdapter!.unsubscribe).toHaveBeenCalledWith(channelA);
      });
    });

    it("is idempotent — second release is a no-op", async () => {
      const { client, convAdapter } = createClient();
      await client.start(bootstrapFor(channelA));

      const lease = await client.openConversation(channelA);
      lease.release();

      convAdapter.closeConversation.mockClear();
      lease.release();

      expect(convAdapter.closeConversation).not.toHaveBeenCalled();
    });

    it("does not clear a newer active lease if called after switch", async () => {
      const { client } = createClient();
      await client.start(bootstrapFor(channelA));

      const lease1 = await client.openConversation(channelA);
      const lease2 = await client.openConversation(channelB);

      // lease1 was already released during switch; double-release is a no-op
      expect(lease1.released).toBe(true);
      expect(lease2.released).toBe(false);

      lease1.release();
      expect(client.activeConversation?.channel).toBe(channelB);
    });
  });

  // -- subscriptions -------------------------------------------------------

  describe("subscribe", () => {
    it("returns an unsubscribe function that stops the listener", async () => {
      const { client } = createClient();
      await client.start(bootstrapFor(channelA));

      const fn = vi.fn();
      const unsub = client.subscribe(ChatClientEvent.StatusChanged, fn);
      unsub();

      await client.stop();
      expect(fn).not.toHaveBeenCalled();
    });

    it("subscribeAdapter.subscribe is called on conversation open", async () => {
      const { client, subAdapter } = createClient({ withSubscribe: true });
      await client.start(bootstrapFor(channelA));

      await client.openConversation(channelA);
      expect(subAdapter!.subscribe).toHaveBeenCalledWith(channelA);
    });

    it("subscribeAdapter.unsubscribe is called on conversation close", async () => {
      const { client, subAdapter } = createClient({ withSubscribe: true });
      await client.start(bootstrapFor(channelA));

      await client.openConversation(channelA);
      await client.openConversation(channelB);

      expect(subAdapter!.unsubscribe).toHaveBeenCalledWith(channelA);
    });
  });

  // -- message port --------------------------------------------------------

  describe("messages port", () => {
    it("forwards loadMessages to the message adapter", async () => {
      const { client, msgAdapter } = createClient({ withMessage: true });
      const result = await client.messages.loadMessages(channelA, {
        older: 10,
      });
      expect(msgAdapter!.loadMessages).toHaveBeenCalledWith(channelA, {
        older: 10,
      });
      expect(result).toEqual([
        { id: "m1", text: "hello" },
        { id: "m2", text: "world" },
      ]);
    });

    it("forwards sendMessage to the message adapter", async () => {
      const { client, msgAdapter } = createClient({ withMessage: true });
      const sent = await client.messages.sendMessage("yo", channelB);
      expect(msgAdapter!.sendMessage).toHaveBeenCalledWith("yo", channelB);
      expect(sent).toEqual({ id: "m3", text: "yo" });
    });

    it("forwards subscribeMessages and returns the disposer", async () => {
      const { client, msgAdapter } = createClient({ withMessage: true });
      const disposer = vi.fn();
      msgAdapter!.subscribeMessages.mockReturnValue(disposer);

      const listener = vi.fn();
      const unsub = client.messages.subscribeMessages(listener);
      expect(msgAdapter!.subscribeMessages).toHaveBeenCalledWith(listener);
      expect(unsub).toBe(disposer);

      unsub();
      expect(disposer).toHaveBeenCalledTimes(1);
    });

    it("forwards subscribeMessageStatus and returns the disposer", async () => {
      const { client, msgAdapter } = createClient({ withMessage: true });
      const disposer = vi.fn();
      msgAdapter!.subscribeMessageStatus.mockReturnValue(disposer);

      const listener = vi.fn();
      const unsub = client.messages.subscribeMessageStatus(listener);
      expect(msgAdapter!.subscribeMessageStatus).toHaveBeenCalledWith(listener);
      expect(unsub).toBe(disposer);

      unsub();
      expect(disposer).toHaveBeenCalledTimes(1);
    });

    it("throws a clear error when no message adapter is configured", async () => {
      const { client } = createClient();

      await expect(client.messages.loadMessages(channelA)).rejects.toThrow(
        /requires a ChatMessageAdapter/
      );
      await expect(client.messages.sendMessage("x", channelA)).rejects.toThrow(
        /requires a ChatMessageAdapter/
      );
      expect(() => client.messages.subscribeMessages(vi.fn())).toThrow(
        /requires a ChatMessageAdapter/
      );
      expect(() => client.messages.subscribeMessageStatus(vi.fn())).toThrow(
        /requires a ChatMessageAdapter/
      );
    });
  });

  // -- connection context callbacks ----------------------------------------

  describe("connection context", () => {
    it("exposes connectionContext to the adapter", () => {
      const { client } = createClient();
      expect(client.connectionContext).toBeDefined();
      expect(typeof client.connectionContext.onConnectionLost).toBe("function");
      expect(typeof client.connectionContext.onConnectionRestored).toBe(
        "function"
      );
    });

    it("onConnectionLost transitions Connected -> Disconnected", async () => {
      const { client } = createClient();
      await client.start(bootstrapFor(channelA));
      expect(client.status).toBe(ChatClientStatus.Connected);

      client.connectionContext.onConnectionLost();
      expect(client.status).toBe(ChatClientStatus.Disconnected);
    });

    it("passes an epoch-scoped context to connect", async () => {
      const { client, connAdapter } = createClient();
      await client.start(bootstrapFor(channelA));

      expect(connAdapter.connect).toHaveBeenCalledWith(
        bootstrapFor(channelA),
        client.connectionContext
      );
    });

    it("preserves a connection loss reported while connect is pending", async () => {
      const { client, connAdapter } = createClient();
      connAdapter.connect.mockImplementationOnce(
        async (_bootstrap: unknown, context: any) => {
          context.onConnectionLost();
        }
      );

      await client.start(bootstrapFor(channelA));

      expect(client.status).toBe(ChatClientStatus.Disconnected);
    });

    it("onConnectionRestored transitions Disconnected -> Connected", async () => {
      const { client } = createClient();
      await client.start(bootstrapFor(channelA));
      client.connectionContext.onConnectionLost();
      expect(client.status).toBe(ChatClientStatus.Disconnected);

      client.connectionContext.onConnectionRestored();
      expect(client.status).toBe(ChatClientStatus.Connected);
    });

    it("onConnectionRestored is a no-op when not disconnected", async () => {
      const { client } = createClient();
      await client.start(bootstrapFor(channelA));
      client.connectionContext.onConnectionRestored();
      expect(client.status).toBe(ChatClientStatus.Connected);
    });

    it("onConnectionLost emits StatusChanged", async () => {
      const { client } = createClient();
      await client.start(bootstrapFor(channelA));

      const events: ChatClientStatus[] = [];
      client.subscribe(ChatClientEvent.StatusChanged, (s) => events.push(s));
      events.length = 0;

      client.connectionContext.onConnectionLost();
      expect(events).toContain(ChatClientStatus.Disconnected);
    });

    it("ignores delayed callbacks from an earlier connection epoch", async () => {
      const { client } = createClient();
      await client.start(bootstrapFor(channelA));
      const staleContext = client.connectionContext;
      await client.stop();
      await client.start(bootstrapFor(channelB));

      staleContext.onConnectionLost();
      expect(client.status).toBe(ChatClientStatus.Connected);

      client.connectionContext.onConnectionLost();
      expect(client.status).toBe(ChatClientStatus.Disconnected);
    });
  });

  // -- getSnapshot ---------------------------------------------------------

  describe("getSnapshot", () => {
    it("reflects status and active conversation", async () => {
      const { client } = createClient();
      await client.start(bootstrapFor(channelA));

      let snap = client.getSnapshot();
      expect(snap.status).toBe(ChatClientStatus.Connected);
      expect(snap.activeConversation).toBeNull();

      await client.openConversation(channelB);
      snap = client.getSnapshot();
      expect(snap.status).toBe(ChatClientStatus.Connected);
      expect(snap.activeConversation).not.toBeNull();
      expect(snap.activeConversation!.channel).toEqual(channelB);
    });
  });
});
