import React from "react";
import { describe, expect, it, vi } from "vitest";
import { Channel, ChannelTypeGroup } from "wukongimjssdk";
import { createConversationChatSendHandler } from "../../adapters/conversation";
import { ChatComposerController } from "../../application";
import type { ChatSendRequest } from "../../domain";
import { createDefaultChatComposerExtensions } from "../../ui/createDefaultChatComposerExtensions";

function pendingItem() {
  return {
    id: "attempt-1",
    capturedAt: 1,
    previewText: "caption",
    draftText: "caption",
    attachments: [],
    expectedPartIds: [],
    enqueuedPartIds: [],
  };
}

describe("ChatComposerExtensions", () => {
  it("isolates editor, operation and renderer registrations per instance", () => {
    const extensionsA = createDefaultChatComposerExtensions();
    const extensionsB = createDefaultChatComposerExtensions();

    extensionsA.editor.composeParts.register({
      id: "custom",
      canCapture: (node) => node.type === "custom",
      capture: (node) => ({
        id: "custom-1",
        kind: "custom",
        extensionId: "custom",
        node,
      }),
      toSendBlock: () => undefined,
    });
    extensionsA.send.operations.register("send_text", async () => ({
      enqueuedPartIds: [],
    }));
    extensionsA.render.pending.register({
      id: "custom",
      priority: 100,
      canRender: () => true,
      render: () => "custom-renderer",
    });

    const document = { type: "doc", content: [{ type: "custom" }] };
    expect(
      extensionsA.editor.composeParts.capture(document, {
        attachmentFiles: new Map(),
      }),
    ).toHaveLength(1);
    expect(
      extensionsB.editor.composeParts.capture(document, {
        attachmentFiles: new Map(),
      }),
    ).toHaveLength(0);
    expect(extensionsA.send.operations.has("send_text")).toBe(true);
    expect(extensionsB.send.operations.has("send_text")).toBe(false);
    expect(
      extensionsA.render.pending.render(pendingItem(), {
        sendingLabel: "sending",
        renderAttachment: () => null,
      }),
    ).toBe("custom-renderer");
    expect(
      React.isValidElement(
        extensionsB.render.pending.render(pendingItem(), {
          sendingLabel: "sending",
          renderAttachment: () => null,
        }),
      ),
    ).toBe(true);
  });

  it("carries a default attachment through capture, operation, settle and render", async () => {
    const extensions = createDefaultChatComposerExtensions();
    const file = new File(["image"], "photo.png", { type: "image/png" });
    const [part] = extensions.editor.composeParts.capture(
      {
        type: "doc",
        content: [
          {
            type: "attachment",
            attrs: { id: "image-1", previewUrl: "blob:image-1" },
          },
        ],
      },
      { attachmentFiles: new Map([["image-1", file]]) },
    );
    const block = extensions.editor.composeParts.toSendBlock(part);
    const controller = new ChatComposerController<{
      id: string;
      name: string;
      type: string;
      previewUrl?: string;
    }>();
    const attempt = controller.capture({
      previewText: "",
      draftText: "",
      attachments: [
        {
          id: "image-1",
          name: file.name,
          type: file.type,
          previewUrl: "blob:image-1",
        },
      ],
    });
    const renderAttachment = vi.fn(() => React.createElement("img"));
    expect(
      React.isValidElement(
        extensions.render.pending.render(attempt, {
          sendingLabel: "sending",
          renderAttachment,
        }),
      ),
    ).toBe(true);
    expect(renderAttachment).toHaveBeenCalledWith(
      expect.objectContaining({ id: "image-1" }),
    );

    const operationHandler = vi.fn(async (operation, events) => {
      events.onEnqueued(operation.partIds);
      return { enqueuedPartIds: operation.partIds };
    });
    extensions.send.operations.register("send_media", operationHandler);
    const sendMediaAndWait = vi.fn(async () => true);
    const handler = createConversationChatSendHandler<any>(
      {
        conversation: {
          sendMessage: vi.fn(async () => ({})),
          editMessage: vi.fn(async () => undefined),
        },
        channel: () => new Channel("channel-1", ChannelTypeGroup),
        sendTextAndWaitAck: vi.fn(async () => true),
        sendMediaAndWait,
        sendRichTextMixed: vi.fn(async () => true),
      },
      { operationRegistry: extensions.send.operations },
    );

    await controller.enqueueAttempt(attempt.id, async () => {
      const request: ChatSendRequest = {
        attemptId: attempt.id,
        text: "",
        editorBlocks: [block],
        sendProgress: {
          setExpectedPartIds: (partIds) =>
            controller.setExpectedPartIds(attempt.id, partIds),
          markPartsEnqueued: (partIds) =>
            controller.markPartsEnqueued(attempt.id, partIds),
        },
      };
      const outcome = await handler(request);
      controller.settle(attempt.id, outcome);
      expect(outcome).toMatchObject({
        editorConsumed: true,
        unsentEditorBlocks: [],
      });
    });

    expect(operationHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "send_media",
        partIds: ["editor:0"],
        attachment: { id: "image-1", file },
      }),
      expect.objectContaining({ onEnqueued: expect.any(Function) }),
    );
    expect(sendMediaAndWait).not.toHaveBeenCalled();
    expect(controller.pendingSendCount()).toBe(0);
  });
});
