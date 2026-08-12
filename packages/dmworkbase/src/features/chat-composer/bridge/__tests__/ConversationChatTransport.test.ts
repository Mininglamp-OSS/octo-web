import { describe, expect, it, vi } from "vitest";
import { MessageContent, MessageText } from "wukongimjssdk";
import type { ChatSendOperation } from "../../submission/buildChatSendPlan";
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

    const result = await transport.execute(operation);
    const content = host.sendMessage.mock.calls[0][0] as MessageText;

    expect(result).toEqual({ enqueuedPartIds: ["text:0"], messageId: "sent-1" });
    expect(content.text).toBe("hello");
    expect(content.mention?.uids).toEqual(["user-2"]);
    expect(content.reply.messageID).toBe("message-1");
    expect(content.reply.messageSeq).toBe(7);
    expect(content.encode().byteLength).toBeGreaterThan(0);
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

    const result = await transport.execute(operation);
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
    const mediaResult = await transport.execute(media);
    const richResult = await transport.execute(rich);

    expect(mediaResult.enqueuedPartIds).toEqual(["top:0"]);
    expect(richResult.enqueuedPartIds).toEqual(["editor:0", "editor:1"]);
    expect(sendImageFile).toHaveBeenCalledWith(file);
    expect(sendRichTextMixed).toHaveBeenCalledWith(
      expect.any(Array),
      undefined,
    );
  });

  it("does not claim media was enqueued when its Conversation helper is unavailable", async () => {
    const transport = new ConversationChatTransport(conversation());
    const operation: ChatSendOperation = {
      kind: "send_media",
      partIds: ["file:0"],
      attachment: {
        id: "file:0",
        file: new File(["text"], "notes.txt", { type: "text/plain" }),
      },
    };

    await expect(transport.execute(operation)).rejects.toBeInstanceOf(
      UnsupportedChatSendOperationError,
    );
  });
});
