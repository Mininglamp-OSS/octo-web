import {
  ComposeAttemptLedger,
  type CaptureComposeAttempt,
  type ChatSendOutcome,
  type ComposeAttempt,
  type LedgerSettlement,
  type PendingSendDraft,
} from "../domain";
import {
  createSendQueue,
  enqueueSettledSend,
  type SendQueue,
} from "./sendFlow";

export interface ChatComposerRestoreOffsets {
  blocks: number;
  topAttachments: number;
}

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
  }

  getRestoreOffsets(): ChatComposerRestoreOffsets {
    return { ...this.restoreOffsets };
  }

  advanceRestoreOffsets(offsets: ChatComposerRestoreOffsets): void {
    this.restoreOffsets = {
      blocks: this.restoreOffsets.blocks + offsets.blocks,
      topAttachments:
        this.restoreOffsets.topAttachments + offsets.topAttachments,
    };
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
