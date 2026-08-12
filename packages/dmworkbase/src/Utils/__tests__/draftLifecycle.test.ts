import { describe, expect, it } from "vitest";
import {
  resolveDraftAfterSend,
  resolveDraftToPersist,
} from "../draftLifecycle";

const draft = (attemptId: string, draftText: string) => ({
  attemptId,
  draftText,
});

describe("resolveDraftAfterSend", () => {
  it("clears the unchanged remote draft after a successful send", () => {
    expect(
      resolveDraftAfterSend({
        attemptId: "a",
        remoteDraft: "hello",
        remoteDraftAtSend: "hello",
        draftSavedAfterSend: false,
        pendingDrafts: [draft("a", "hello")],
      }),
    ).toBe("");
  });

  it("does not touch live input typed after compose consumption", () => {
    expect(
      resolveDraftAfterSend({
        attemptId: "a",
        liveDraft: "hello",
        remoteDraft: "hello",
        remoteDraftAtSend: "hello",
        draftSavedAfterSend: false,
        pendingDrafts: [draft("a", "hello")],
      }),
    ).toBeUndefined();
  });

  it("does not clear a newer live draft even when its text equals the sent text", () => {
    expect(
      resolveDraftAfterSend({
        attemptId: "a",
        liveDraft: "same text",
        remoteDraft: "",
        remoteDraftAtSend: "",
        draftSavedAfterSend: false,
        pendingDrafts: [draft("a", "same text")],
      }),
    ).toBeUndefined();
  });

  it("clears the provisional draft written for this attempt", () => {
    expect(
      resolveDraftAfterSend({
        attemptId: "a",
        remoteDraft: "A",
        remoteDraftAtSend: "A",
        draftSavedAfterSend: true,
        latestSavedDraft: "A",
        latestSavedDraftSource: "pending",
        latestSavedPendingAttemptIds: ["a"],
        pendingDrafts: [draft("a", "A")],
      }),
    ).toBe("");
  });

  it("reduces queued provisional drafts by attempt ID", () => {
    expect(
      resolveDraftAfterSend({
        attemptId: "a",
        remoteDraft: "A\nB",
        remoteDraftAtSend: "",
        draftSavedAfterSend: true,
        latestSavedDraft: "A\nB",
        latestSavedDraftSource: "pending",
        latestSavedPendingAttemptIds: ["a", "b"],
        pendingDrafts: [draft("a", "A"), draft("b", "B")],
      }),
    ).toBe("B");

    expect(
      resolveDraftAfterSend({
        attemptId: "b",
        remoteDraft: "B",
        remoteDraftAtSend: "",
        draftSavedAfterSend: true,
        latestSavedDraft: "B",
        latestSavedDraftSource: "pending",
        latestSavedPendingAttemptIds: ["b"],
        pendingDrafts: [draft("b", "B")],
      }),
    ).toBe("");
  });

  it("does not confuse identical text attempts", () => {
    expect(
      resolveDraftAfterSend({
        attemptId: "b",
        remoteDraft: "same\nsame",
        remoteDraftAtSend: "",
        draftSavedAfterSend: true,
        latestSavedDraft: "same\nsame",
        latestSavedDraftSource: "pending",
        latestSavedPendingAttemptIds: ["a", "b"],
        pendingDrafts: [draft("a", "same"), draft("b", "same")],
      }),
    ).toBeUndefined();
  });

  it("does not let an attachment-only attempt consume the next text draft", () => {
    expect(
      resolveDraftAfterSend({
        attemptId: "attachment",
        remoteDraft: "B",
        remoteDraftAtSend: "",
        draftSavedAfterSend: true,
        latestSavedDraft: "B",
        latestSavedDraftSource: "pending",
        latestSavedPendingAttemptIds: ["text"],
        pendingDrafts: [draft("attachment", ""), draft("text", "B")],
      }),
    ).toBeUndefined();
  });

  it("does not clear when the executing attempt is not the queue head", () => {
    expect(
      resolveDraftAfterSend({
        attemptId: "b",
        remoteDraft: "A\nB",
        remoteDraftAtSend: "",
        draftSavedAfterSend: true,
        latestSavedDraft: "A\nB",
        latestSavedDraftSource: "pending",
        latestSavedPendingAttemptIds: ["a", "b"],
        pendingDrafts: [draft("a", "A"), draft("b", "B")],
      }),
    ).toBeUndefined();
  });

  it("does not erase a later live draft saved while the send was pending", () => {
    expect(
      resolveDraftAfterSend({
        attemptId: "b",
        remoteDraft: "C",
        remoteDraftAtSend: "",
        draftSavedAfterSend: true,
        latestSavedDraft: "C",
        latestSavedDraftSource: "live",
        pendingDrafts: [draft("b", "B")],
      }),
    ).toBeUndefined();
  });

  it("does not clear a remote draft changed outside this attempt", () => {
    expect(
      resolveDraftAfterSend({
        attemptId: "a",
        remoteDraft: "remote update",
        remoteDraftAtSend: "A",
        draftSavedAfterSend: false,
        pendingDrafts: [draft("a", "A")],
      }),
    ).toBeUndefined();
  });
});

describe("resolveDraftToPersist", () => {
  it("persists live input with live ownership", () => {
    expect(
      resolveDraftToPersist({
        liveDraft: "typing this",
        pendingDrafts: [draft("a", "sent")],
      }),
    ).toEqual({
      draft: "typing this",
      source: "live",
      pendingAttemptIds: [],
    });
  });

  it("persists in-flight drafts with their attempt IDs", () => {
    expect(
      resolveDraftToPersist({
        liveDraft: "",
        pendingDrafts: [draft("a", "A"), draft("attachment", "")],
      }),
    ).toEqual({
      draft: "A",
      source: "pending",
      pendingAttemptIds: ["a"],
    });
  });

  it("persists an empty draft when nothing is live or pending", () => {
    expect(
      resolveDraftToPersist({ liveDraft: "", pendingDrafts: [] }),
    ).toEqual({ draft: "", source: "empty", pendingAttemptIds: [] });
  });
});
