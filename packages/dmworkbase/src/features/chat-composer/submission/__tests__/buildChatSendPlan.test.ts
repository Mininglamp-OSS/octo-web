import { describe, expect, it } from "vitest";

import { buildChatSendPlan } from "../buildChatSendPlan";
import type {
  AttachmentFile,
  ChatMention,
  ChatSendRequest,
  EditorContentBlock,
  SendTargetSnapshot,
} from "../../domain/types";

function file(name: string, type: string): File {
  return new File(["content"], name, { type });
}

function attachment(id: string, name: string, type: string): AttachmentFile {
  return { id, file: file(name, type) };
}

function request(
  overrides: Partial<ChatSendRequest<string>> = {}
): ChatSendRequest<string> {
  return {
    attemptId: "attempt-1",
    text: "",
    ...overrides,
  };
}

function target(
  handlerType: number,
  replyMessage = "reply"
): SendTargetSnapshot<string> {
  return {
    handlerType,
    replyMessage,
    restore: () => undefined,
  };
}

const mention: ChatMention = { all: false, uids: ["u1"] };

describe("buildChatSendPlan", () => {
  it("aggregates top images and mixed editor blocks into one rich-text operation", () => {
    const editorBlocks: EditorContentBlock[] = [
      { type: "text", text: "caption", restoreText: "caption", mention },
      {
        type: "image",
        id: "editor-image",
        file: file("editor.png", "image/png"),
      },
    ];

    const plan = buildChatSendPlan(
      request({
        topFiles: [attachment("top-image", "top.png", "image/png")],
        editorBlocks,
      })
    );

    expect(plan).toMatchObject({
      attemptId: "attempt-1",
      operations: [
        {
          kind: "send_rich_text",
          partIds: ["top-image", "editor:0", "editor:1"],
          blocks: [
            { type: "image", id: "top-image" },
            { type: "text", text: "caption" },
            { type: "image", id: "editor-image" },
          ],
        },
      ],
    });
    expect(plan.operations[0].sendTarget).toBeUndefined();
  });

  it("does not duplicate top images as media operations", () => {
    const plan = buildChatSendPlan(
      request({
        topFiles: [attachment("top-image", "top.jpg", "image/jpeg")],
        editorBlocks: [
          { type: "text", text: "text", restoreText: "text" },
          {
            type: "image",
            id: "editor-image",
            file: file("editor.jpg", "image/jpeg"),
          },
        ],
      })
    );

    expect(plan.operations).toHaveLength(1);
    expect(plan.operations[0].kind).toBe("send_rich_text");
    expect(plan.operations.some(({ kind }) => kind === "send_media")).toBe(
      false
    );
    expect(plan.operations[0].partIds).toContain("top-image");
  });

  it("keeps top files before editor blocks in document order", () => {
    const plan = buildChatSendPlan(
      request({
        topFiles: [attachment("top-file", "notes.pdf", "application/pdf")],
        editorBlocks: [
          { type: "text", text: "first", restoreText: "first", mention },
          {
            type: "image",
            id: "editor-image",
            file: file("image.png", "image/png"),
          },
          {
            type: "file",
            id: "editor-file",
            file: file("file.pdf", "application/pdf"),
          },
        ],
      })
    );

    expect(plan.operations.map(({ kind }) => kind)).toEqual([
      "send_media",
      "send_text",
      "send_media",
      "send_media",
    ]);
    expect(plan.operations.map(({ partIds }) => partIds[0])).toEqual([
      "top-file",
      "editor:0",
      "editor:1",
      "editor:2",
    ]);
    expect(plan.operations[1]).toMatchObject({ text: "first", mention });
  });

  it("creates only an edit operation for an edit target", () => {
    const sendTarget = target(2, "message-to-edit");
    const plan = buildChatSendPlan(
      request({
        text: "edited",
        mention,
        topFiles: [attachment("top-file", "file.pdf", "application/pdf")],
        editorBlocks: [
          { type: "image", id: "image", file: file("image.png", "image/png") },
        ],
        sendTarget,
      })
    );

    expect(plan.operations).toEqual([
      {
        kind: "edit_text",
        partIds: ["text:0"],
        text: "edited",
        mention,
        sendTarget,
      },
    ]);
  });

  it("uses fallback text when there are no editor blocks", () => {
    const plan = buildChatSendPlan(request({ text: "fallback", mention }));

    expect(plan.operations).toEqual([
      {
        kind: "send_text",
        partIds: ["text:0"],
        text: "fallback",
        mention,
      },
    ]);
  });

  it("sends attachments without inventing an empty text operation", () => {
    const sendTarget = target(1);
    const plan = buildChatSendPlan(
      request({
        topFiles: [attachment("top-file", "file.pdf", "application/pdf")],
        editorBlocks: [
          {
            type: "image",
            id: "editor-image",
            file: file("image.png", "image/png"),
          },
        ],
        sendTarget,
      })
    );

    expect(plan.operations.map(({ kind }) => kind)).toEqual([
      "send_media",
      "send_media",
    ]);
    expect(plan.operations[0].sendTarget).toBe(sendTarget);
    expect(plan.operations[1].sendTarget).toBeUndefined();
  });

  it("does not send an empty reply, except for an edit target", () => {
    expect(
      buildChatSendPlan(request({ sendTarget: target(1) })).operations
    ).toEqual([]);
    expect(
      buildChatSendPlan(request({ sendTarget: target(2) })).operations
    ).toHaveLength(1);
  });

  it("returns an empty plan for empty or unknown input", () => {
    expect(buildChatSendPlan(undefined as never)).toEqual({
      attemptId: "",
      operations: [],
    });
    expect(
      buildChatSendPlan(
        request({
          topFiles: [null as never],
          editorBlocks: [{ type: "unknown" } as never],
        })
      ).operations
    ).toEqual([]);
  });
});
