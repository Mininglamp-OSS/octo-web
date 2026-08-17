import { describe, expect, it, vi } from "vitest";
import type { ChatSendRequest } from "../../domain/types";
import type { ChatSendExecution } from "../executeChatSendPlan";
import { buildChatSendPlan } from "../buildChatSendPlan";
import { executeChatSendPlan } from "../executeChatSendPlan";
import { settleChatSendExecution } from "../settleChatSendExecution";

function request(
  overrides: Partial<ChatSendRequest<string>> = {},
): ChatSendRequest<string> {
  return {
    attemptId: "attempt-1",
    text: "fallback",
    topFiles: [],
    editorBlocks: [],
    ...overrides,
  };
}

function execution(
  overrides: Partial<ChatSendExecution<string>> = {},
): ChatSendExecution<string> {
  return {
    attemptId: "attempt-1",
    operations: [],
    enqueuedPartIds: [],
    ...overrides,
  };
}

describe("settleChatSendExecution", () => {
  it("consumes only top attachments that were enqueued", () => {
    const result = settleChatSendExecution(
      request({
        text: "",
        topFiles: [
          { id: "a", file: new File(["a"], "a.txt") },
          { id: "b", file: new File(["b"], "b.txt") },
        ],
      }),
      execution({ enqueuedPartIds: ["top:a"] }),
    );

    expect(result).toEqual({
      editorConsumed: true,
      consumedTopIds: ["a"],
      unsentEditorBlocks: [],
      restoreSendTarget: false,
    });
  });

  it("restores only failed editor blocks after a partial send", () => {
    const result = settleChatSendExecution(
      request({
        text: "",
        editorBlocks: [
          { type: "text", text: "sent", restoreText: "sent" },
          {
            type: "image",
            id: "image-1",
            file: new File(["image"], "image.png", { type: "image/png" }),
          },
        ],
      }),
      execution({ enqueuedPartIds: ["editor:0"] }),
    );

    expect(result.editorConsumed).toBe(true);
    expect(result.unsentEditorBlocks).toEqual([
      { type: "attachment", id: "image-1" },
    ]);
  });

  it("does not restore empty editor text that the plan intentionally skipped", () => {
    const result = settleChatSendExecution(
      request({
        text: "",
        editorBlocks: [
          { type: "text", text: "", restoreText: "" },
          { type: "text", text: "sent", restoreText: "sent" },
        ],
      }),
      execution({ enqueuedPartIds: ["editor:1"] }),
    );

    expect(result.unsentEditorBlocks).toEqual([]);
  });

  it("restores an extension editor part when its operation did not enqueue", () => {
    const result = settleChatSendExecution(
      request({
        text: "",
        editorBlocks: [
          {
            type: "extension:poll",
            id: "poll-1",
            payload: { question: "Ship it?" },
          },
        ],
      }),
      execution({ enqueuedPartIds: ["other-part"] }),
    );

    expect(result.editorConsumed).toBe(true);
    expect(result.unsentEditorBlocks).toEqual([
      { type: "extension", id: "poll-1" },
    ]);
  });

  it("does not shift settlement indices around malformed runtime blocks", () => {
    const result = settleChatSendExecution(
      request({
        text: "",
        editorBlocks: [
          { type: "extension:", id: "invalid", payload: {} } as never,
          {
            type: "extension:poll",
            id: "poll-1",
            payload: { question: "Ship it?" },
          },
        ],
      }),
      execution({ enqueuedPartIds: ["editor:0"] }),
    );

    expect(result).toEqual({
      editorConsumed: false,
      consumedTopIds: [],
      unsentEditorBlocks: [],
      restoreSendTarget: false,
    });
  });

  it("keeps fallback text when a top attachment succeeded first", () => {
    const result = settleChatSendExecution(
      request({
        text: "retry me",
        topFiles: [{ id: "top-1", file: new File(["x"], "x.txt") }],
      }),
      execution({ enqueuedPartIds: ["top:top-1"] }),
    );

    expect(result).toMatchObject({
      editorConsumed: true,
      consumedTopIds: ["top-1"],
      unsentEditorBlocks: [{ type: "text", text: "retry me" }],
    });
  });

  it("restores a reply target when its first operation did not enqueue", () => {
    const target = { handlerType: 1, restore: vi.fn() };
    const result = settleChatSendExecution(
      request({ sendTarget: target }),
      execution({
        operations: [
          {
            operation: {
              kind: "send_text",
              partIds: ["text:0"],
              text: "fallback",
              sendTarget: target,
            },
            enqueuedPartIds: [],
            error: new Error("failed"),
          },
        ],
      }),
    );

    expect(result.restoreSendTarget).toBe(true);
  });

  it("does not restore editor text after a successful edit", async () => {
    const current = request({
      text: "edited text",
      editorBlocks: [
        { type: "text", text: "edited text", restoreText: "edited text" },
      ],
      sendTarget: { handlerType: 2, replyMessage: "message-to-edit" },
    });
    const plan = buildChatSendPlan(current);
    const completed = await executeChatSendPlan(plan, {
      execute: async (operation) => ({ enqueuedPartIds: operation.partIds }),
    });

    expect(plan.operations[0].partIds).toEqual(["editor:0"]);
    expect(settleChatSendExecution(current, completed)).toEqual({
      editorConsumed: true,
      consumedTopIds: [],
      unsentEditorBlocks: [],
      restoreSendTarget: false,
    });
  });
});
