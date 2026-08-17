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
  it("generates IDs that remain unique across ledger instances", () => {
    const first = new ComposeAttemptLedger();
    const second = new ComposeAttemptLedger();

    const firstId = first.capture({ previewText: "A", draftText: "A" }).id;
    const secondId = second.capture({ previewText: "B", draftText: "B" }).id;

    expect(firstId).not.toBe(secondId);
    expect(firstId).toMatch(/^compose-/);
    expect(secondId).toMatch(/^compose-/);
  });

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
      editorBlocks: [],
      attachments: [{ id: "file-1" }],
      expectedPartIds: [],
      enqueuedPartIds: [],
    });
    expect(state.orderedPending().map((attempt) => attempt.id)).toEqual([
      first.id,
      second.id,
    ]);
  });

  it("isolates pending extension payloads from the queued request", () => {
    const state = ledger();
    const editorBlocks = [
      {
        type: "extension:poll" as const,
        id: "poll-1",
        payload: { question: "Ship it?" },
      },
    ];
    const attempt = state.capture({
      previewText: "poll",
      draftText: "",
      editorBlocks,
    });

    (attempt.editorBlocks[0] as typeof editorBlocks[0]).payload.question =
      "Changed by renderer";

    expect(editorBlocks[0].payload.question).toBe("Ship it?");
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

  it("tracks expected and enqueued part IDs without duplicates", () => {
    const state = ledger();
    const attempt = state.capture({ previewText: "mixed", draftText: "mixed" });
    expect(state.setExpectedPartIds(attempt.id, ["a", "b", "c"])).toBe(true);
    expect(state.markPartsEnqueued(attempt.id, ["a"])).toBe(true);
    expect(state.markPartsEnqueued(attempt.id, ["a"])).toBe(false);
    expect(state.markPartsEnqueued(attempt.id, ["b", "c"])).toBe(true);
    expect(state.markPartsEnqueued(attempt.id, ["late"])).toBe(true);
    expect(state.orderedPending()[0]).toMatchObject({
      expectedPartIds: ["a", "b", "c", "late"],
      enqueuedPartIds: ["a", "b", "c", "late"],
    });
    expect(state.pendingPreEnqueueCount()).toBe(0);
  });

  it("does not drop parts already reported enqueued when a plan is replaced", () => {
    const state = ledger();
    const attempt = state.capture({ previewText: "mixed", draftText: "mixed" });
    state.setExpectedPartIds(attempt.id, ["a", "b", "c"]);
    state.markPartsEnqueued(attempt.id, ["a", "b"]);
    state.setExpectedPartIds(attempt.id, ["c"]);
    expect(state.orderedPending()[0].expectedPartIds).toEqual(["c", "a", "b"]);
  });

  it("records enqueue progress even when a host omitted expected-part setup", () => {
    const state = ledger();
    const attempt = state.capture({ previewText: "mixed", draftText: "mixed" });

    expect(state.markPartsEnqueued(attempt.id, ["a", "b"])).toBe(true);
    expect(state.orderedPending()[0]).toMatchObject({
      expectedPartIds: ["a", "b"],
      enqueuedPartIds: ["a", "b"],
    });
  });

  it("keeps a provisional draft until every expected part enqueues", () => {
    const state = ledger();
    const attempt = state.capture({ previewText: "mixed", draftText: "mixed" });
    state.setExpectedPartIds(attempt.id, ["a", "b"]);
    state.markPartsEnqueued(attempt.id, ["a"]);

    expect(state.pendingDraftText()).toBe("mixed");
    expect(state.pendingPreEnqueueCount()).toBe(1);

    state.markPartsEnqueued(attempt.id, ["b"]);
    expect(state.pendingDraftText()).toBe("");
    expect(state.pendingPreEnqueueCount()).toBe(0);
  });

  it("filters pending counts by channel", () => {
    const state = ledger();
    state.capture({ channelKey: "a:2", previewText: "A", draftText: "A" });
    state.capture({ channelKey: "b:2", previewText: "B", draftText: "B" });

    expect(state.pendingCount("a:2")).toBe(1);
    expect(state.pendingPreEnqueueCount("b:2")).toBe(1);
  });

  it("persists only drafts that have not produced all local bubbles", () => {
    const state = ledger();
    const first = state.capture({ previewText: "A", draftText: "A" });
    state.capture({ previewText: "file", draftText: "" });
    state.capture({ previewText: "B", draftText: "@[u2:Bob] B" });
    state.setExpectedPartIds(first.id, ["a"]);
    state.markPartsEnqueued(first.id, ["a"]);

    expect(state.pendingDraftText()).toBe("@[u2:Bob] B");
    expect(state.pendingPreEnqueueCount()).toBe(2);
  });

  it("retains settled attempts until explicit removal", () => {
    const state = ledger();
    const attempt = state.capture({ previewText: "A", draftText: "A" });
    state.setExpectedPartIds(attempt.id, ["a"]);
    state.markPartsEnqueued(attempt.id, ["a"]);
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
    expect(state.setExpectedPartIds("missing", ["a"])).toBe(false);
    expect(state.markPartsEnqueued("missing", ["a"])).toBe(false);
    expect(state.settle("missing", createChatSendOutcome())).toBeUndefined();
    expect(state.remove("missing")).toBe(false);
  });
});
