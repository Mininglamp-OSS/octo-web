import { describe, expect, it, vi } from "vitest";
import { Toast } from "@douyinfe/semi-ui";
import {
  Channel,
  ChannelTypeGroup,
  MessageContent,
  MessageText,
} from "wukongimjssdk";
import { FileContent } from "../../../../../Messages/File/FileContent";
import { ImageContent } from "../../../../../Messages/Image/ImageContent";
import type { ChatSendRequest } from "../../../domain";
import { ChatSendOperationRegistry } from "../../../extensions";
import { createConversationChatSendHandler } from "../createConversationChatSendHandler";

vi.mock("@douyinfe/semi-ui", () => ({
  Toast: { error: vi.fn() },
}));

function target() {
  return {
    messageID: "message-1",
    messageSeq: 1,
    fromUID: "user-1",
    channel: { channelID: "channel-1", channelType: ChannelTypeGroup },
    content: new MessageText("sent"),
  };
}

function request(
  overrides: Partial<ChatSendRequest<ReturnType<typeof target>>> = {},
): ChatSendRequest<ReturnType<typeof target>> {
  return {
    attemptId: "attempt-1",
    text: "hello",
    ...overrides,
  };
}

function host(
  sendTextAndWaitAck: (
    content: MessageContent,
    onEnqueued: () => void,
  ) => Promise<boolean>,
) {
  return {
    conversation: {
      sendMessage: vi.fn(async () => target()),
      editMessage: vi.fn(async () => undefined),
    },
    channel: () => new Channel("channel-1", ChannelTypeGroup),
    sendTextAndWaitAck,
    sendMediaAndWait: vi.fn(async () => true),
    sendRichTextMixed: vi.fn(async () => true),
  };
}

const translate = ((key: string) => key) as any;

describe("createConversationChatSendHandler", () => {
  it("owns plan progress, transport execution and settlement", async () => {
    const setExpectedPartIds = vi.fn();
    const markPartsEnqueued = vi.fn();
    const sendTextAndWaitAck = vi.fn(async (_content, onEnqueued) => {
      onEnqueued();
      return true;
    });
    const handler = createConversationChatSendHandler(
      host(sendTextAndWaitAck),
    );

    await expect(
      handler(
        request({
          sendProgress: { setExpectedPartIds, markPartsEnqueued },
        }),
      ),
    ).resolves.toMatchObject({
      editorConsumed: true,
      unsentEditorBlocks: [],
    });

    expect(setExpectedPartIds).toHaveBeenCalledWith(["text:0"]);
    expect(markPartsEnqueued).toHaveBeenCalledWith(["text:0"]);
    expect(sendTextAndWaitAck).toHaveBeenCalledOnce();
  });

  it("uses the injected operation registry in the production send path", async () => {
    const operationRegistry = new ChatSendOperationRegistry();
    const operationHandler = vi.fn(async (operation, events) => {
      events.onEnqueued(operation.partIds);
      return { enqueuedPartIds: operation.partIds };
    });
    operationRegistry.register("send_text", operationHandler);
    const sendTextAndWaitAck = vi.fn(async () => true);
    const handler = createConversationChatSendHandler(
      host(sendTextAndWaitAck),
      { operationRegistry },
    );

    await expect(handler(request())).resolves.toMatchObject({
      editorConsumed: true,
    });

    expect(operationHandler).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "send_text", text: "hello" }),
      expect.objectContaining({ onEnqueued: expect.any(Function) }),
    );
    expect(sendTextAndWaitAck).not.toHaveBeenCalled();
  });

  it("keeps enqueue evidence when ack waiting rejects", async () => {
    const markPartsEnqueued = vi.fn();
    const toastError = vi.fn();
    const sendTextAndWaitAck = vi.fn(async (_content, onEnqueued) => {
      onEnqueued();
      throw new Error("ack timeout");
    });
    const handler = createConversationChatSendHandler(
      host(sendTextAndWaitAck),
      { translate, toastError },
    );

    await expect(
      handler(
        request({
          sendProgress: {
            setExpectedPartIds: vi.fn(),
            markPartsEnqueued,
          },
        }),
      ),
    ).resolves.toMatchObject({ editorConsumed: true });
    expect(markPartsEnqueued).toHaveBeenCalledWith(["text:0"]);
    expect(toastError).toHaveBeenCalledOnce();
    expect(toastError).toHaveBeenCalledWith(
      "base.conversation.message.sendFailed",
    );
  });

  it("prechecks and builds image content before sending media", async () => {
    const file = new File(["image"], "photo.png", { type: "image/png" });
    const precheckUpload = vi.fn(async () => undefined);
    const currentHost = host(async (_content, onEnqueued) => {
      onEnqueued();
      return true;
    });
    currentHost.sendMediaAndWait = vi.fn(async (_content, onEnqueued) => {
      onEnqueued();
      return true;
    });
    const handler = createConversationChatSendHandler(currentHost, {
      precheckUpload,
      readImagePreview: vi.fn(async () => "data:image/png;base64,a"),
      measureImage: vi.fn(async () => ({ width: 320, height: 180 })),
      translate,
      toastError: vi.fn(),
    });

    await expect(
      handler(
        request({
          text: "",
          topFiles: [{ id: "image-1", file }],
        }),
      ),
    ).resolves.toMatchObject({
      editorConsumed: true,
      consumedTopIds: ["image-1"],
    });

    expect(precheckUpload).toHaveBeenCalledWith(
      file,
      expect.any(Channel),
      "png",
    );
    const content = currentHost.sendMediaAndWait.mock.calls[0][0];
    expect(content).toBeInstanceOf(ImageContent);
    expect(content).toMatchObject({ width: 320, height: 180, file });
  });

  it("keeps a file attachment when upload precheck rejects", async () => {
    const file = new File(["text"], "notes.txt", { type: "text/plain" });
    const toastError = vi.fn();
    const currentHost = host(async (_content, onEnqueued) => {
      onEnqueued();
      return true;
    });
    const handler = createConversationChatSendHandler(currentHost, {
      precheckUpload: vi.fn(async () => {
        throw { msg: "blocked" };
      }),
      translate,
      toastError,
    });

    await expect(
      handler(
        request({
          text: "",
          topFiles: [{ id: "file-1", file }],
        }),
      ),
    ).resolves.toMatchObject({
      editorConsumed: false,
      consumedTopIds: [],
    });

    expect(currentHost.sendMediaAndWait).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(
      "base.conversation.upload.fileFailed",
    );
    expect(toastError).toHaveBeenCalledOnce();
  });

  it("preserves the default toast receiver", async () => {
    const file = new File(["text"], "notes.txt", { type: "text/plain" });
    vi.mocked(Toast.error).mockImplementationOnce(function () {
      expect(this).toBe(Toast);
      return undefined as never;
    });
    const handler = createConversationChatSendHandler(
      host(async (_content, onEnqueued) => {
        onEnqueued();
        return true;
      }),
      {
        precheckUpload: vi.fn(async () => {
          throw { msg: "blocked" };
        }),
        translate,
      },
    );

    await handler(request({ text: "", topFiles: [{ id: "file-1", file }] }));

    expect(Toast.error).toHaveBeenCalledWith(
      "base.conversation.upload.fileFailed",
    );
  });

  it("builds file content after upload precheck succeeds", async () => {
    const file = new File(["text"], "notes.txt", { type: "text/plain" });
    const currentHost = host(async (_content, onEnqueued) => {
      onEnqueued();
      return true;
    });
    currentHost.sendMediaAndWait = vi.fn(async (_content, onEnqueued) => {
      onEnqueued();
      return true;
    });
    const handler = createConversationChatSendHandler(currentHost, {
      precheckUpload: vi.fn(async () => undefined),
      translate,
      toastError: vi.fn(),
    });

    await handler(
      request({ text: "", topFiles: [{ id: "file-1", file }] }),
    );

    const content = currentHost.sendMediaAndWait.mock.calls[0][0];
    expect(content).toBeInstanceOf(FileContent);
    expect(content).toMatchObject({
      file,
      name: "notes.txt",
      extension: "txt",
      size: file.size,
    });
  });

  it("does not send an image when its local preview cannot be read", async () => {
    const file = new File(["image"], "photo.png", { type: "image/png" });
    const toastError = vi.fn();
    const currentHost = host(async (_content, onEnqueued) => {
      onEnqueued();
      return true;
    });
    const handler = createConversationChatSendHandler(currentHost, {
      precheckUpload: vi.fn(async () => undefined),
      readImagePreview: vi.fn(async () => ""),
      translate,
      toastError,
    });

    await handler(
      request({ text: "", topFiles: [{ id: "image-1", file }] }),
    );

    expect(currentHost.sendMediaAndWait).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(
      "base.conversation.upload.imageReadFailed",
    );
  });

  it("does not duplicate an error already toasted by the host", async () => {
    const toastError = vi.fn();
    const error = Object.assign(new Error("already reported"), {
      toasted: true,
    });
    const handler = createConversationChatSendHandler(
      host(async () => {
        throw error;
      }),
      { translate, toastError },
    );

    await handler(request());

    expect(toastError).not.toHaveBeenCalled();
  });

  it("reports a media send failure once after precheck succeeds", async () => {
    const file = new File(["text"], "notes.txt", { type: "text/plain" });
    const toastError = vi.fn();
    const currentHost = host(async (_content, onEnqueued) => {
      onEnqueued();
      return true;
    });
    currentHost.sendMediaAndWait = vi.fn(async () => {
      throw new Error("send failed");
    });
    const handler = createConversationChatSendHandler(currentHost, {
      precheckUpload: vi.fn(async () => undefined),
      translate,
      toastError,
    });

    await handler(request({ text: "", topFiles: [{ id: "file-1", file }] }));

    expect(toastError).toHaveBeenCalledOnce();
    expect(toastError).toHaveBeenCalledWith(
      "base.conversation.upload.fileSendFailed",
    );
  });
});
