import { describe, expect, it } from "vitest";
import { ComposeAttemptLedger } from "../domain/composeAttemptLedger";
import { createChatSendOutcome } from "../domain/types";

function ledger() {
  let sequence = 0;
  return new ComposeAttemptLedger({
    createId: () => `attempt-${++sequence}`,
    now: () => 100,
  });
}

describe("createChatSendOutcome", () => {
  it("normalizes every optional result field", () => {
    expect(createChatSendOutcome({ editorConsumed: true })).toEqual({
      editorConsumed: true,
      consumedTopIds: [],
      unsentEditorBlocks: [],
      restoreSendTarget: false,
    });
  });
});

describe("ComposeAttemptLedger", () => {
  it("captures immutable snapshots in insertion order", () => {
    const state = ledger();
    const attachments = [{ id: "file-1" }];
    const first = state.capture({
      previewText: "@Alice hello",
      draftText: "@[u1:Alice] hello",
      attachments,
    });
    attachments.push({ id: "file-2" });
    const second = state.capture({ previewText: "next", draftText: "next" });

    expect(first).toMatchObject({
      id: "attempt-1",
      capturedAt: 100,
      attachments: [{ id: "file-1" }],
      expectedParts: 1,
      enqueuedParts: 0,
    });
    expect(state.orderedPending().map((attempt) => attempt.id)).toEqual([
      first.id,
      second.id,
    ]);
  });

  it("keeps identical text as separate attempts", () => {
    const state = ledger();
    state.capture({ previewText: "same", draftText: "same" });
    state.capture({ previewText: "same", draftText: "same" });
    expect(state.orderedPending().map((attempt) => attempt.id)).toEqual([
      "attempt-1",
      "attempt-2",
    ]);
  });

  it("rejects empty and duplicate ids", () => {
    const empty = new ComposeAttemptLedger({ createId: () => "" });
    expect(() => empty.capture({ previewText: "a", draftText: "a" })).toThrow();

    const duplicate = new ComposeAttemptLedger({ createId: () => "same" });
    duplicate.capture({ previewText: "a", draftText: "a" });
    expect(() =>
      duplicate.capture({ previewText: "b", draftText: "b" }),
    ).toThrow();
  });

  it("tracks expected and enqueued parts without exceeding the plan", () => {
    const state = ledger();
    const attempt = state.capture({ previewText: "mixed", draftText: "mixed" });
    expect(state.setExpectedParts(attempt.id, 3)).toBe(true);
    expect(state.markPartEnqueued(attempt.id)).toBe(true);
    expect(state.markPartEnqueued(attempt.id)).toBe(true);
    expect(state.markPartEnqueued(attempt.id)).toBe(true);
    expect(state.markPartEnqueued(attempt.id)).toBe(false);
    expect(state.orderedPending()[0]).toMatchObject({
      expectedParts: 3,
      enqueuedParts: 3,
    });
    expect(state.pendingPreEnqueueCount()).toBe(0);
  });

  it("does not lower expected parts below parts already enqueued", () => {
    const state = ledger();
    const attempt = state.capture({ previewText: "mixed", draftText: "mixed" });
    state.setExpectedParts(attempt.id, 3);
    state.markPartEnqueued(attempt.id);
    state.markPartEnqueued(attempt.id);
    state.setExpectedParts(attempt.id, 1);
    expect(state.orderedPending()[0].expectedParts).toBe(2);
  });

  it("persists only drafts that have not produced all local bubbles", () => {
    const state = ledger();
    const first = state.capture({ previewText: "A", draftText: "A" });
    state.capture({ previewText: "file", draftText: "" });
    state.capture({ previewText: "B", draftText: "@[u2:Bob] B" });
    state.markPartEnqueued(first.id);

    expect(state.pendingDraftText()).toBe("@[u2:Bob] B");
    expect(state.pendingPreEnqueueCount()).toBe(2);
  });

  it("retains settled attempts until explicit removal", () => {
    const state = ledger();
    const attempt = state.capture({ previewText: "A", draftText: "A" });
    state.markPartEnqueued(attempt.id);
    const outcome = createChatSendOutcome({ editorConsumed: true });

    expect(state.settle(attempt.id, outcome)).toEqual({
      attempt: expect.objectContaining({ id: attempt.id }),
      outcome,
    });
    expect(state.orderedPending()).toHaveLength(1);
    expect(state.remove(attempt.id)).toBe(true);
    expect(state.orderedPending()).toHaveLength(0);
  });

  it("ignores stale progress and removal operations", () => {
    const state = ledger();
    expect(state.setExpectedParts("missing", 2)).toBe(false);
    expect(state.markPartEnqueued("missing")).toBe(false);
    expect(state.settle("missing", createChatSendOutcome())).toBeUndefined();
    expect(state.remove("missing")).toBe(false);
  });
});
