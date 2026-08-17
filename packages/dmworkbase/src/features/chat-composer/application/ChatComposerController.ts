import {
  ComposeAttemptLedger,
  type CaptureComposeAttempt,
  type ChatSendOutcome,
  type ComposeAttempt,
  type LedgerSettlement,
  type PendingSendDraft,
} from "../domain";
import type {
  ChatComposerRestoreOffsets,
  ChatComposerRestorePrefix,
} from "../ports";
import {
  createSendQueue,
  enqueueSettledSend,
  type SendQueue,
} from "./sendFlow";

export interface ChatComposerControllerSnapshot<TAttachment = unknown> {
  pending: ComposeAttempt<TAttachment>[];
  preEnqueue: ComposeAttempt<TAttachment>[];
}

export interface ChatComposerControllerOptions<TAttachment = unknown> {
  ledger?: ComposeAttemptLedger<TAttachment>;
  sendQueue?: SendQueue;
}

type ChatComposerControllerListener<TAttachment> = (
  snapshot: ChatComposerControllerSnapshot<TAttachment>,
) => void;

/** Application-owned state for send ordering, attempt progress and recovery. */
export class ChatComposerController<TAttachment = unknown> {
  private readonly ledger: ComposeAttemptLedger<TAttachment>;
  private readonly sendQueue: SendQueue;
  private readonly listeners = new Set<
    ChatComposerControllerListener<TAttachment>
  >();
  private restoreOffsets: ChatComposerRestoreOffsets = {
    blocks: 0,
    topAttachments: 0,
  };
  private restorePrefix: ChatComposerRestorePrefix = {
    blockMarkerIds: [],
    topAttachmentIds: [],
  };

  constructor(options: ChatComposerControllerOptions<TAttachment> = {}) {
    this.ledger = options.ledger ?? new ComposeAttemptLedger<TAttachment>();
    this.sendQueue = options.sendQueue ?? createSendQueue();
  }

  subscribe(listener: ChatComposerControllerListener<TAttachment>): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  capture(
    input: CaptureComposeAttempt<TAttachment>,
  ): ComposeAttempt<TAttachment> {
    const attempt = this.ledger.capture(input);
    this.publish();
    return attempt;
  }

  setExpectedPartIds(attemptId: string, partIds: readonly string[]): void {
    if (this.ledger.setExpectedPartIds(attemptId, partIds)) this.publish();
  }

  markPartsEnqueued(attemptId: string, partIds: readonly string[]): void {
    if (this.ledger.markPartsEnqueued(attemptId, partIds)) this.publish();
  }

  settle(
    attemptId: string,
    outcome: ChatSendOutcome,
  ): LedgerSettlement<TAttachment> | undefined {
    return this.ledger.settle(attemptId, outcome);
  }

  enqueueAttempt<T>(attemptId: string, task: () => Promise<T>): Promise<T> {
    return enqueueSettledSend(this.sendQueue, task, () => {
      this.release(attemptId);
    });
  }

  pendingSendCount(channelKey?: string): number {
    return this.ledger.pendingCount(channelKey);
  }

  pendingPreEnqueueCount(channelKey?: string): number {
    return this.ledger.pendingPreEnqueueCount(channelKey);
  }

  pendingSendDrafts(channelKey?: string): PendingSendDraft[] {
    return this.ledger.orderedPendingDrafts(channelKey);
  }

  pendingPreEnqueueDrafts(channelKey?: string): PendingSendDraft[] {
    return this.ledger.orderedPreEnqueueDrafts(channelKey);
  }

  pendingSendText(channelKey?: string): string {
    return this.ledger.pendingDraftText(channelKey);
  }

  resetRestoreOffsets(): void {
    this.restoreOffsets = { blocks: 0, topAttachments: 0 };
    this.restorePrefix = { blockMarkerIds: [], topAttachmentIds: [] };
  }

  getRestoreOffsets(
    livePrefix?: ChatComposerRestorePrefix,
  ): ChatComposerRestoreOffsets {
    if (livePrefix) {
      return {
        blocks: this.matchingPrefixLength(
          livePrefix.blockMarkerIds,
          this.restorePrefix.blockMarkerIds,
          this.restoreOffsets.blocks,
        ),
        topAttachments: this.matchingPrefixLength(
          livePrefix.topAttachmentIds,
          this.restorePrefix.topAttachmentIds,
          this.restoreOffsets.topAttachments,
        ),
      };
    }
    return { ...this.restoreOffsets };
  }

  advanceRestoreOffsets(
    offsets: ChatComposerRestoreOffsets,
    restoredPrefix?: Partial<ChatComposerRestorePrefix>,
  ): void {
    this.restoreOffsets = {
      blocks: restoredPrefix?.blockMarkerIds
        ? restoredPrefix.blockMarkerIds.length
        : this.restoreOffsets.blocks + offsets.blocks,
      topAttachments: restoredPrefix?.topAttachmentIds
        ? restoredPrefix.topAttachmentIds.length
        : this.restoreOffsets.topAttachments + offsets.topAttachments,
    };
    if (restoredPrefix?.blockMarkerIds) {
      this.restorePrefix.blockMarkerIds = [
        ...restoredPrefix.blockMarkerIds,
      ];
    }
    if (restoredPrefix?.topAttachmentIds) {
      this.restorePrefix.topAttachmentIds = [
        ...restoredPrefix.topAttachmentIds,
      ];
    }
  }

  private matchingPrefixLength(
    values: readonly string[],
    prefix: readonly string[],
    fallbackOffset: number,
  ): number {
    if (prefix.length === 0) return fallbackOffset;
    const limit = Math.min(values.length, prefix.length, fallbackOffset);
    let length = 0;
    while (length < limit && values[length] === prefix[length]) length += 1;
    return length;
  }

  private release(attemptId: string): void {
    if (this.ledger.remove(attemptId)) this.publish();
  }

  private snapshot(): ChatComposerControllerSnapshot<TAttachment> {
    return {
      pending: this.ledger.orderedPending(),
      preEnqueue: this.ledger.orderedPreEnqueue(),
    };
  }

  private publish(): void {
    if (this.listeners.size === 0) return;
    const snapshot = this.snapshot();
    this.listeners.forEach((listener) => listener(snapshot));
  }
}
