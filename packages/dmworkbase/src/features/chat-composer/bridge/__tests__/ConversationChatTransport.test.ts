import { describe, expect, it, vi } from "vitest";
import { MessageContent, MessageText } from "wukongimjssdk";
import type {
  ChatSendOperation,
  ExtensionChatSendOperation,
} from "../../domain";
import { ChatSendOperationRegistry } from "../ChatSendOperationRegistry";
import {
  ConversationChatTransport,
  UnsupportedChatSendOperationError,
} from "../ConversationChatTransport";

function target() {
  return {
    messageID: "message-1",
    messageSeq: 7,
    fromUID: "user-1",
    channel: { channelID: "channel-1", channelType: 2 },
    content: new MessageText("quoted"),
  };
}

function conversation() {
  const sendMessage = vi.fn(async (_content: MessageContent) => ({
    ...target(),
    messageID: "sent-1",
  }));
  const editMessage = vi.fn(
    async (
      _messageID: String,
      _messageSeq: number,
      _channelID: String,
      _channelType: number,
      _content: String,
    ): Promise<void> => undefined,
  );
  return {
    sendMessage,
    editMessage,
  };
}

function transportEvents() {
  return { onEnqueued: vi.fn() };
}

describe("ConversationChatTransport", () => {
  it("maps text operations to sendMessage and preserves reply/mention metadata", async () => {
    const host = conversation();
    const transport = new ConversationChatTransport(host);
    const operation: ChatSendOperation<ReturnType<typeof target>> = {
      kind: "send_text",
      partIds: ["text:0"],
      text: "hello",
      mention: {
        all: false,
        uids: ["user-2"],
        entities: [{ uid: "user-2", offset: 0, length: 5 }],
        humans: 1,
      },
      sendTarget: {
        replyMessage: target(),
        handlerType: 1,
        restore: vi.fn(),
      },
    };

    const events = transportEvents();
    const result = await transport.execute(operation, events);
    const content = host.sendMessage.mock.calls[0][0] as MessageText;

    expect(result).toEqual({ enqueuedPartIds: ["text:0"], messageId: "sent-1" });
    expect(content.text).toBe("hello");
    expect(content.mention?.uids).toEqual(["user-2"]);
    expect(content.reply.messageID).toBe("message-1");
    expect(content.reply.messageSeq).toBe(7);
    expect(content.encode().byteLength).toBeGreaterThan(0);
    expect(events.onEnqueued).toHaveBeenCalledWith(["text:0"]);
  });

  it("maps edit operations to the existing editMessage signature", async () => {
    const host = conversation();
    const transport = new ConversationChatTransport(host);
    const operation: ChatSendOperation<ReturnType<typeof target>> = {
      kind: "edit_text",
      partIds: ["text:0"],
      text: "edited",
      sendTarget: {
        replyMessage: target(),
        handlerType: 2,
        restore: vi.fn(),
      },
    };

    const events = transportEvents();
    const result = await transport.execute(operation, events);
    const args = host.editMessage.mock.calls[0];

    expect(result).toEqual({ enqueuedPartIds: ["text:0"] });
    expect(args.slice(0, 4)).toEqual([
      "message-1",
      7,
      "channel-1",
      2,
    ]);
    expect(JSON.parse(String(args[4]))).toMatchObject({
      type: 1,
      content: "edited",
    });
    expect(events.onEnqueued).toHaveBeenCalledWith(["text:0"]);
  });

  it("routes media and rich text through injected Conversation send helpers", async () => {
    const host = conversation();
    const sendImageFile = vi.fn(async () => true);
    const sendRichTextMixed = vi.fn(async () => true);
    const transport = new ConversationChatTransport(host, {
      sendImageFile,
      sendRichTextMixed,
    });
    const file = new File(["image"], "photo.png", { type: "image/png" });

    const media: ChatSendOperation<ReturnType<typeof target>> = {
      kind: "send_media",
      partIds: ["top:0"],
      attachment: { id: "top:0", file },
    };
    const rich: ChatSendOperation<ReturnType<typeof target>> = {
      kind: "send_rich_text",
      partIds: ["editor:0", "editor:1"],
      blocks: [
        { type: "text", text: "look", restoreText: "look" },
        { type: "image", id: "editor:1", file },
      ],
    };
    const mediaEvents = transportEvents();
    const richEvents = transportEvents();
    const mediaResult = await transport.execute(media, mediaEvents);
    const richResult = await transport.execute(rich, richEvents);

    expect(mediaResult.enqueuedPartIds).toEqual(["top:0"]);
    expect(richResult.enqueuedPartIds).toEqual(["editor:0", "editor:1"]);
    expect(sendImageFile).toHaveBeenCalledWith(file, expect.any(Function));
    expect(sendRichTextMixed).toHaveBeenCalledWith(
      expect.any(Array),
      undefined,
      expect.any(Function),
    );
  });

  it("does not claim media was enqueued when its Conversation helper is unavailable", async () => {
    const transport = new ConversationChatTransport<ReturnType<typeof target>>(
      conversation(),
    );
    const operation: ChatSendOperation<ReturnType<typeof target>> = {
      kind: "send_media",
      partIds: ["file:0"],
      attachment: {
        id: "file:0",
        file: new File(["text"], "notes.txt", { type: "text/plain" }),
      },
    };

    await expect(
      transport.execute(operation, transportEvents()),
    ).rejects.toBeInstanceOf(
      UnsupportedChatSendOperationError,
    );
  });

  it("allows a compatibility handler to override a built-in operation", async () => {
    const host = conversation();
    const executeExtension = vi.fn(async (operation) => ({
      enqueuedPartIds: operation.partIds,
      messageId: "extension-message",
    }));
    const transport = new ConversationChatTransport<ReturnType<typeof target>>(host, {
      operationHandlers: { send_text: executeExtension },
    });
    const operation: ChatSendOperation<ReturnType<typeof target>> = {
      kind: "send_text",
      partIds: ["extension:0"],
      text: "extension payload",
    };

    const events = transportEvents();
    await expect(transport.execute(operation, events)).resolves.toEqual({
      enqueuedPartIds: ["extension:0"],
      messageId: "extension-message",
    });
    expect(executeExtension).toHaveBeenCalledWith(operation, events);
    expect(host.sendMessage).not.toHaveBeenCalled();
  });

  it("executes a new extension kind through the public registry", async () => {
    type LocationOperation = ExtensionChatSendOperation<
      ReturnType<typeof target>,
      { latitude: number; longitude: number }
    > & { kind: "extension:location" };
    const operationRegistry =
      new ChatSendOperationRegistry<ReturnType<typeof target>>();
    const executeLocation = vi.fn(async (operation: LocationOperation) => ({
      enqueuedPartIds: operation.partIds,
      messageId: "location-message",
    }));
    operationRegistry.register<LocationOperation>(
      "extension:location",
      executeLocation,
    );
    const transport = new ConversationChatTransport(conversation(), {
      operationRegistry,
    });
    const operation: LocationOperation = {
      kind: "extension:location",
      partIds: ["location:0"],
      payload: { latitude: 31.2, longitude: 121.5 },
    };

    const events = transportEvents();
    await expect(transport.execute(operation, events)).resolves.toEqual({
      enqueuedPartIds: ["location:0"],
      messageId: "location-message",
    });
    expect(executeLocation).toHaveBeenCalledWith(operation, events);
  });

  it("rejects an unregistered extension kind", async () => {
    const transport = new ConversationChatTransport(conversation());

    await expect(
      transport.execute(
        {
          kind: "extension:unknown",
          partIds: ["unknown:0"],
          payload: {},
        },
        transportEvents(),
      ),
    ).rejects.toBeInstanceOf(UnsupportedChatSendOperationError);
  });
});
