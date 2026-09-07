import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MessageListener, SendackPacket } from "wukongimjssdk";
import type { SyncMessageOptions } from "../../Service/DataSource/DataProvider";
import type ConversationContext from "../../Components/Conversation/context";

const hoisted = vi.hoisted(() => {
  class Channel {
    channelID: string;
    channelType: number;
    constructor(channelID: string, channelType: number) {
      this.channelID = channelID;
      this.channelType = channelType;
    }
  }

  const sdk = {
    chatManager: {
      addMessageListener: vi.fn(),
      removeMessageListener: vi.fn(),
      addMessageStatusListener: vi.fn(),
      removeMessageStatusListener: vi.fn(),
    },
  };

  const syncMessagesFn = vi.fn(async () => []);

  return {
    Channel,
    sdk,
    shared: vi.fn(() => sdk),
    syncMessagesFn,
    wkApp: {
      config: { pageSizeOfMessage: 30 },
      conversationProvider: {
        syncMessages: syncMessagesFn,
      },
    },
  };
});

vi.mock("wukongimjssdk", () => ({
  default: { shared: hoisted.shared },
  WKSDK: { shared: hoisted.shared },
  PullMode: { Down: 0, Up: 1 },
  Channel: hoisted.Channel,
}));

vi.mock("../../App", () => ({
  default: hoisted.wkApp,
}));

/** A minimal MessageContent-shaped payload for send. */
const content = { contentType: 1, contentObj: {} } as never;

describe("legacyChatClient", () => {
  let mod: typeof import("./legacyChatClient");
  let mockContext: ConversationContext;
  let sendMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    mod = await import("./legacyChatClient");

    sendMock = vi.fn(async () => ({}));
    mockContext = { sendMessage: sendMock } as unknown as ConversationContext;
  });

  function capturedOpts(): [unknown, SyncMessageOptions] {
    return hoisted.syncMessagesFn.mock.calls[0] as unknown as [
      unknown,
      SyncMessageOptions
    ];
  }

  // ------------------------------------------------------------------------
  // Load options mapping
  // ------------------------------------------------------------------------

  describe("load options mapping", () => {
    it("older -> Down, anchor-1", async () => {
      await mod
        .createLegacyChatRuntime()
        .client.messages.loadMessages(
          { channelId: "c", channelType: 1 },
          { older: 20, anchor: "100" }
        );
      const [, o] = capturedOpts();
      expect(o.limit).toBe(20);
      expect(o.startMessageSeq).toBe(99);
      expect(o.pullMode).toBe(0);
    });

    it("newer -> Up, anchor as-is", async () => {
      await mod
        .createLegacyChatRuntime()
        .client.messages.loadMessages(
          { channelId: "c", channelType: 1 },
          { newer: 15, anchor: "50" }
        );
      const [, o] = capturedOpts();
      expect(o.limit).toBe(15);
      expect(o.startMessageSeq).toBe(50);
      expect(o.pullMode).toBe(1);
    });

    it("around -> Up, anchor - around/2", async () => {
      await mod
        .createLegacyChatRuntime()
        .client.messages.loadMessages(
          { channelId: "c", channelType: 1 },
          { around: 20, anchor: "100" }
        );
      const [, o] = capturedOpts();
      expect(o.limit).toBe(20);
      expect(o.startMessageSeq).toBe(90);
      expect(o.pullMode).toBe(1);
    });

    it("default pageSize when no options", async () => {
      await mod
        .createLegacyChatRuntime()
        .client.messages.loadMessages({ channelId: "c", channelType: 1 });
      const [, o] = capturedOpts();
      expect(o.limit).toBe(30);
    });

    it("non-numeric anchor clamped to 0", async () => {
      await mod
        .createLegacyChatRuntime()
        .client.messages.loadMessages(
          { channelId: "c", channelType: 1 },
          { older: 10, anchor: "NaN" }
        );
      const [, o] = capturedOpts();
      expect(o.startMessageSeq).toBe(0);
    });
  });

  // ------------------------------------------------------------------------
  // Message and status listener disposer
  // ------------------------------------------------------------------------

  describe("message and status listener disposer", () => {
    it("subscribeMessages disposer removes listener", () => {
      const c = mod.createLegacyChatRuntime().client;
      const fn: MessageListener = vi.fn();
      const unsub = c.messages.subscribeMessages(fn);

      expect(hoisted.sdk.chatManager.addMessageListener).toHaveBeenCalledWith(
        fn
      );

      unsub();
      expect(
        hoisted.sdk.chatManager.removeMessageListener
      ).toHaveBeenCalledWith(fn);
    });

    it("subscribeMessageStatus disposer removes status listener", () => {
      const c = mod.createLegacyChatRuntime().client;
      const fn: (messageId: string, status: SendackPacket) => void = vi.fn();
      const unsub = c.messages.subscribeMessageStatus(fn);

      expect(
        hoisted.sdk.chatManager.addMessageStatusListener
      ).toHaveBeenCalled();

      unsub();
      expect(
        hoisted.sdk.chatManager.removeMessageStatusListener
      ).toHaveBeenCalled();
    });

    it("status listener derives messageId from SendackPacket", () => {
      const c = mod.createLegacyChatRuntime().client;
      const fn: (messageId: string, status: SendackPacket) => void = vi.fn();
      c.messages.subscribeMessageStatus(fn);

      const wrapped = hoisted.sdk.chatManager.addMessageStatusListener.mock
        .calls[0][0] as (p: SendackPacket) => void;

      wrapped({
        messageID: { toString: () => "m42" },
        clientSeq: 0,
      } as unknown as SendackPacket);
      expect(fn).toHaveBeenCalledWith("m42", expect.anything());

      (fn as ReturnType<typeof vi.fn>).mockClear();
      wrapped({ messageID: null, clientSeq: 99 } as unknown as SendackPacket);
      expect(fn).toHaveBeenCalledWith("99", expect.anything());
    });
  });

  // ------------------------------------------------------------------------
  // Context-bound send
  // ------------------------------------------------------------------------

  describe("context-bound send", () => {
    it("rejects when no context bound", async () => {
      const r = mod.createLegacyChatRuntime();
      await expect(
        r.client.messages.sendMessage(content, {
          channelId: "c",
          channelType: 1,
        })
      ).rejects.toThrow("requires a mounted ConversationWindow context");
    });

    it("succeeds after binding context", async () => {
      const r = mod.createLegacyChatRuntime();
      r.bindConversationContext(mockContext);

      const result = await r.client.messages.sendMessage(content, {
        channelId: "c",
        channelType: 1,
      });
      expect(sendMock).toHaveBeenCalledTimes(1);
      expect(result).toEqual({});
    });
  });

  // ------------------------------------------------------------------------
  // Unbind
  // ------------------------------------------------------------------------

  describe("unbind", () => {
    it("send fails after unbind", async () => {
      const r = mod.createLegacyChatRuntime();
      const unbind = r.bindConversationContext(mockContext);

      await r.client.messages.sendMessage(content, {
        channelId: "c",
        channelType: 1,
      });
      expect(sendMock).toHaveBeenCalledTimes(1);

      unbind();

      await expect(
        r.client.messages.sendMessage(content, {
          channelId: "c",
          channelType: 1,
        })
      ).rejects.toThrow("requires a mounted ConversationWindow context");
    });

    it("stale unbind is no-op when context already replaced", async () => {
      const r = mod.createLegacyChatRuntime();
      const unbindA = r.bindConversationContext(mockContext);
      const sendB = vi.fn(async () => ({}));
      const ctxB = { sendMessage: sendB } as unknown as ConversationContext;

      r.bindConversationContext(ctxB);
      unbindA(); // stale — mockContext is no longer active

      await r.client.messages.sendMessage(content, {
        channelId: "c",
        channelType: 1,
      });
      expect(sendB).toHaveBeenCalledTimes(1);
    });
  });

  // ------------------------------------------------------------------------
  // Shared runtime singleton
  // ------------------------------------------------------------------------

  describe("shared runtime singleton", () => {
    it("returns same instance on repeated calls", () => {
      expect(mod.getLegacyChatRuntime()).toBe(mod.getLegacyChatRuntime());
    });

    it("creates a new instance from a fresh module", async () => {
      const first = mod.getLegacyChatRuntime();
      vi.resetModules();
      const freshModule = await import("./legacyChatClient");
      expect(freshModule.getLegacyChatRuntime()).not.toBe(first);
    });

    it("starts the shared client on first access", async () => {
      const runtime = mod.getLegacyChatRuntime();
      await vi.waitFor(() => {
        expect(runtime.client.status).toBe("connected");
      });
    });
  });
});
