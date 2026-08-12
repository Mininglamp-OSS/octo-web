import type { ChatSendOutcome, PendingSendDraft } from "./types";

export interface ComposeAttempt<TAttachment = unknown> {
  id: string;
  capturedAt: number;
  previewText: string;
  draftText: string;
  attachments: TAttachment[];
  expectedParts: number;
  enqueuedParts: number;
}

export interface CaptureComposeAttempt<TAttachment = unknown> {
  previewText: string;
  draftText: string;
  attachments?: TAttachment[];
}

export interface LedgerSettlement<TAttachment = unknown> {
  attempt: ComposeAttempt<TAttachment>;
  outcome: ChatSendOutcome;
}

export interface ComposeAttemptLedgerOptions {
  createId?: () => string;
  now?: () => number;
}

export class ComposeAttemptLedger<TAttachment = unknown> {
  private readonly attempts = new Map<string, ComposeAttempt<TAttachment>>();
  private readonly createId: () => string;
  private readonly now: () => number;

  constructor(options: ComposeAttemptLedgerOptions = {}) {
    let sequence = 0;
    this.createId = options.createId ?? (() => `compose-${++sequence}`);
    this.now = options.now ?? Date.now;
  }

  capture(input: CaptureComposeAttempt<TAttachment>): ComposeAttempt<TAttachment> {
    const attempt: ComposeAttempt<TAttachment> = {
      id: this.createUniqueId(),
      capturedAt: this.now(),
      previewText: input.previewText,
      draftText: input.draftText,
      attachments: [...(input.attachments ?? [])],
      expectedParts: 1,
      enqueuedParts: 0,
    };
    this.attempts.set(attempt.id, attempt);
    return attempt;
  }

  setExpectedParts(attemptId: string, count: number): boolean {
    const attempt = this.attempts.get(attemptId);
    if (!attempt) return false;
    const expectedParts = Math.max(
      1,
      attempt.enqueuedParts,
      Number.isFinite(count) ? Math.floor(count) : 1,
    );
    if (attempt.expectedParts === expectedParts) return false;
    this.attempts.set(attemptId, { ...attempt, expectedParts });
    return true;
  }

  markPartEnqueued(attemptId: string): boolean {
    const attempt = this.attempts.get(attemptId);
    if (!attempt || attempt.enqueuedParts >= attempt.expectedParts) return false;
    this.attempts.set(attemptId, {
      ...attempt,
      enqueuedParts: attempt.enqueuedParts + 1,
    });
    return true;
  }

  settle(
    attemptId: string,
    outcome: ChatSendOutcome,
  ): LedgerSettlement<TAttachment> | undefined {
    const attempt = this.attempts.get(attemptId);
    return attempt ? { attempt, outcome } : undefined;
  }

  remove(attemptId: string): boolean {
    return this.attempts.delete(attemptId);
  }

  orderedPending(): ComposeAttempt<TAttachment>[] {
    return Array.from(this.attempts.values());
  }

  orderedPreEnqueue(): ComposeAttempt<TAttachment>[] {
    return this.orderedPending().filter(
      (attempt) => attempt.enqueuedParts < attempt.expectedParts,
    );
  }

  pendingDraftText(): string {
    return this.orderedPreEnqueueDrafts()
      .map((attempt) => attempt.draftText)
      .filter((draft) => draft.trim() !== "")
      .join("\n");
  }

  orderedPendingDrafts(): PendingSendDraft[] {
    return this.orderedPending().map(({ id, draftText }) => ({
      attemptId: id,
      draftText,
    }));
  }

  orderedPreEnqueueDrafts(): PendingSendDraft[] {
    return this.orderedPreEnqueue().map(({ id, draftText }) => ({
      attemptId: id,
      draftText,
    }));
  }

  pendingPreEnqueueCount(): number {
    return this.orderedPreEnqueue().length;
  }

  private createUniqueId(): string {
    const id = this.createId();
    if (!id || this.attempts.has(id)) {
      throw new Error(`duplicate or empty compose attempt id: ${id}`);
    }
    return id;
  }
}
