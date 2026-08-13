import { describe, expect, it } from "vitest";
import type { ChatSendOperation, ChatSendPlan } from "../../domain";
import {
  executeChatSendPlan,
  InvalidChatTransportResultError,
} from "../executeChatSendPlan";

const operation = (partId: string): ChatSendOperation => ({
  kind: "send_text",
  partIds: [partId],
  text: partId,
});

const plan = (...partIds: string[]): ChatSendPlan => ({
  attemptId: "attempt-1",
  operations: partIds.map(operation),
});

describe("executeChatSendPlan", () => {
  it("executes operations in plan order and flattens enqueued parts", async () => {
    const seen: string[] = [];
    const execution = await executeChatSendPlan(plan("a", "b"), {
      execute: async (current) => {
        seen.push(current.partIds[0]);
        return { enqueuedPartIds: current.partIds };
      },
    });

    expect(seen).toEqual(["a", "b"]);
    expect(execution.enqueuedPartIds).toEqual(["a", "b"]);
    expect(execution.operations.every((item) => !item.error)).toBe(true);
  });

  it("does not call transport for an empty plan", async () => {
    let calls = 0;
    const execution = await executeChatSendPlan(
      { attemptId: "empty", operations: [] },
      { execute: async () => ({ enqueuedPartIds: [] }) },
    );

    calls += execution.operations.length;
    expect(calls).toBe(0);
    expect(execution.enqueuedPartIds).toEqual([]);
  });

  it("keeps valid partial enqueues", async () => {
    const execution = await executeChatSendPlan(
      {
        attemptId: "partial",
        operations: [{ kind: "send_rich_text", partIds: ["a", "b"], blocks: [] }],
      },
      { execute: async () => ({ enqueuedPartIds: ["a"] }) },
    );

    expect(execution.enqueuedPartIds).toEqual(["a"]);
    expect(execution.operations[0].result).toEqual({ enqueuedPartIds: ["a"] });
  });

  it("records a thrown operation and continues with later operations", async () => {
    const seen: string[] = [];
    const execution = await executeChatSendPlan(plan("a", "b"), {
      execute: async (current) => {
        seen.push(current.partIds[0]);
        if (current.partIds[0] === "a") throw new Error("upload failed");
        return { enqueuedPartIds: ["b"] };
      },
    });

    expect(seen).toEqual(["a", "b"]);
    expect(execution.operations[0].error).toBeInstanceOf(Error);
    expect(execution.enqueuedPartIds).toEqual(["b"]);
  });

  it("turns an invalid transport part id into a recorded failure", async () => {
    const execution = await executeChatSendPlan(plan("a", "b"), {
      execute: async (current) => ({
        enqueuedPartIds: current.partIds[0] === "a" ? ["wrong"] : ["b"],
      }),
    });

    expect(execution.operations[0].error).toBeInstanceOf(
      InvalidChatTransportResultError,
    );
    expect(execution.enqueuedPartIds).toEqual(["b"]);
  });

  it("does not mutate the plan or its operation arrays", async () => {
    const input = plan("a");
    const before = JSON.stringify(input);
    await executeChatSendPlan(input, {
      execute: async (current) => ({ enqueuedPartIds: [...current.partIds] }),
    });
    expect(JSON.stringify(input)).toBe(before);
  });

  it("reports one enqueue event per successful operation", async () => {
    const events: string[] = [];
    await executeChatSendPlan(plan("a", "b"), {
      execute: async (current) => ({ enqueuedPartIds: current.partIds }),
    }, {
      onOperationEnqueued: ({ operation }) => events.push(operation.partIds[0]),
    });

    expect(events).toEqual(["a", "b"]);
  });

  it("skips a conditional reply operation when no earlier operation enqueued", async () => {
    let calls = 0;
    const execution = await executeChatSendPlan(
      {
        attemptId: "reply",
        operations: [
          {
            kind: "send_text",
            partIds: ["reply:empty"],
            text: "",
            requiresPreviousEnqueue: true,
          },
        ],
      },
      {
        execute: async () => {
          calls += 1;
          return { enqueuedPartIds: ["reply:empty"] };
        },
      },
    );

    expect(calls).toBe(0);
    expect(execution.enqueuedPartIds).toEqual([]);
  });
});
