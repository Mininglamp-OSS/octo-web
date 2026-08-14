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
    blockKeys: [],
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

  pendingSendCount(): number {
    return this.ledger.orderedPending().length;
  }

  pendingPreEnqueueCount(): number {
    return this.ledger.pendingPreEnqueueCount();
  }

  pendingSendDrafts(): PendingSendDraft[] {
    return this.ledger.orderedPendingDrafts();
  }

  pendingPreEnqueueDrafts(): PendingSendDraft[] {
    return this.ledger.orderedPreEnqueueDrafts();
  }

  pendingSendText(): string {
    return this.ledger.pendingDraftText();
  }

  resetRestoreOffsets(): void {
    this.restoreOffsets = { blocks: 0, topAttachments: 0 };
    this.restorePrefix = { blockKeys: [], topAttachmentIds: [] };
  }

  getRestoreOffsets(
    livePrefix?: ChatComposerRestorePrefix,
  ): ChatComposerRestoreOffsets {
    if (livePrefix) {
      return {
        blocks: this.hasPrefix(
          livePrefix.blockKeys,
          this.restorePrefix.blockKeys,
        )
          ? this.restoreOffsets.blocks
          : 0,
        topAttachments: this.hasPrefix(
          livePrefix.topAttachmentIds,
          this.restorePrefix.topAttachmentIds,
        )
          ? this.restoreOffsets.topAttachments
          : 0,
      };
    }
    return { ...this.restoreOffsets };
  }

  advanceRestoreOffsets(
    offsets: ChatComposerRestoreOffsets,
    restoredPrefix?: Partial<ChatComposerRestorePrefix>,
  ): void {
    this.restoreOffsets = {
      blocks: restoredPrefix?.blockKeys
        ? restoredPrefix.blockKeys.length
        : this.restoreOffsets.blocks + offsets.blocks,
      topAttachments: restoredPrefix?.topAttachmentIds
        ? restoredPrefix.topAttachmentIds.length
        : this.restoreOffsets.topAttachments + offsets.topAttachments,
    };
    if (restoredPrefix?.blockKeys) {
      this.restorePrefix.blockKeys = [...restoredPrefix.blockKeys];
    }
    if (restoredPrefix?.topAttachmentIds) {
      this.restorePrefix.topAttachmentIds = [
        ...restoredPrefix.topAttachmentIds,
      ];
    }
  }

  private hasPrefix(
    values: readonly string[],
    prefix: readonly string[],
  ): boolean {
    return (
      prefix.length <= values.length &&
      prefix.every((value, index) => values[index] === value)
    );
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
