import { describe, expect, it, vi } from "vitest";
import { createChatSendOutcome } from "../../domain";
import { ChatComposerController } from "../ChatComposerController";

describe("ChatComposerController", () => {
  it("publishes attempt progress and exposes pending draft state", () => {
    const controller = new ChatComposerController<string>();
    const snapshots: string[][] = [];
    controller.subscribe(({ preEnqueue }) => {
      snapshots.push(preEnqueue.map(({ id }) => id));
    });

    const attempt = controller.capture({
      previewText: "hello",
      draftText: "draft",
      attachments: ["attachment"],
    });
    controller.setExpectedPartIds(attempt.id, ["text:0"]);
    controller.markPartsEnqueued(attempt.id, ["text:0"]);

    expect(controller.pendingSendCount()).toBe(1);
    expect(controller.pendingPreEnqueueCount()).toBe(0);
    expect(controller.pendingSendDrafts()).toEqual([
      { attemptId: attempt.id, draftText: "draft" },
    ]);
    expect(controller.pendingPreEnqueueDrafts()).toEqual([]);
    expect(controller.pendingSendText()).toBe("");
    expect(snapshots.at(-1)).toEqual([]);
  });

  it("serializes attempts and releases each one after its task settles", async () => {
    const controller = new ChatComposerController();
    const first = controller.capture({ previewText: "a", draftText: "a" });
    const second = controller.capture({ previewText: "b", draftText: "b" });
    const order: string[] = [];
    let finishFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => {
      finishFirst = resolve;
    });

    const firstSend = controller.enqueueAttempt(first.id, async () => {
      order.push("first:start");
      await firstGate;
      order.push("first:end");
      return true;
    });
    const secondSend = controller.enqueueAttempt(second.id, async () => {
      order.push("second");
      return true;
    });

    await vi.waitFor(() => expect(order).toEqual(["first:start"]));
    expect(controller.pendingSendCount()).toBe(2);
    finishFirst?.();
    await expect(Promise.all([firstSend, secondSend])).resolves.toEqual([
      true,
      true,
    ]);

    expect(order).toEqual(["first:start", "first:end", "second"]);
    expect(controller.pendingSendCount()).toBe(0);
  });

  it("releases a rejected attempt and continues with the next queued send", async () => {
    const controller = new ChatComposerController();
    const first = controller.capture({ previewText: "a", draftText: "a" });
    const second = controller.capture({ previewText: "b", draftText: "b" });
    const order: string[] = [];

    const failedSend = controller.enqueueAttempt(first.id, async () => {
      order.push("first");
      throw new Error("send failed");
    });
    const nextSend = controller.enqueueAttempt(second.id, async () => {
      order.push("second");
      return true;
    });

    await expect(failedSend).rejects.toThrow("send failed");
    await expect(nextSend).resolves.toBe(true);
    expect(order).toEqual(["first", "second"]);
    expect(controller.pendingSendCount()).toBe(0);
  });

  it("keeps settlement lookup and restore offsets inside the controller", () => {
    const controller = new ChatComposerController();
    const attempt = controller.capture({ previewText: "a", draftText: "a" });
    const outcome = createChatSendOutcome({ editorConsumed: true });

    expect(controller.settle(attempt.id, outcome)).toEqual({
      attempt,
      outcome,
    });
    controller.advanceRestoreOffsets({ blocks: 2, topAttachments: 1 });
    controller.advanceRestoreOffsets({ blocks: 1, topAttachments: 3 });
    expect(controller.getRestoreOffsets()).toEqual({
      blocks: 3,
      topAttachments: 4,
    });
    controller.resetRestoreOffsets();
    expect(controller.getRestoreOffsets()).toEqual({
      blocks: 0,
      topAttachments: 0,
    });
  });

  it("uses restore offsets only while their live prefixes still match", () => {
    const controller = new ChatComposerController();
    controller.advanceRestoreOffsets(
      { blocks: 1, topAttachments: 1 },
      { blockMarkerIds: ["block-a"], topAttachmentIds: ["top-a"] },
    );

    expect(
      controller.getRestoreOffsets({
        blockMarkerIds: ["block-a", "live-block"],
        topAttachmentIds: ["top-a", "live-top"],
      }),
    ).toEqual({ blocks: 1, topAttachments: 1 });
    expect(
      controller.getRestoreOffsets({
        blockMarkerIds: ["edited-block"],
        topAttachmentIds: ["top-a", "live-top"],
      }),
    ).toEqual({ blocks: 0, topAttachments: 1 });
    expect(
      controller.getRestoreOffsets({
        blockMarkerIds: ["block-a", "live-block"],
        topAttachmentIds: ["live-top"],
      }),
    ).toEqual({ blocks: 1, topAttachments: 0 });
  });
});
