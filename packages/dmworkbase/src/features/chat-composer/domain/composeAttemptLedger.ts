import type { ChatSendOutcome, PendingSendDraft } from "./types";

export interface ComposeAttempt<TAttachment = unknown> {
  id: string;
  capturedAt: number;
  previewText: string;
  draftText: string;
  attachments: TAttachment[];
  expectedPartIds: string[];
  enqueuedPartIds: string[];
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

let fallbackAttemptSequence = 0;
const fallbackAttemptNamespace = `${Date.now().toString(36)}-${Math.random()
  .toString(36)
  .slice(2)}`;

function createDefaultAttemptId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `compose-${uuid}`;
  fallbackAttemptSequence += 1;
  return `compose-${fallbackAttemptNamespace}-${fallbackAttemptSequence}`;
}

export class ComposeAttemptLedger<TAttachment = unknown> {
  private readonly attempts = new Map<string, ComposeAttempt<TAttachment>>();
  private readonly createId: () => string;
  private readonly now: () => number;

  constructor(options: ComposeAttemptLedgerOptions = {}) {
    this.createId = options.createId ?? createDefaultAttemptId;
    this.now = options.now ?? Date.now;
  }

  capture(input: CaptureComposeAttempt<TAttachment>): ComposeAttempt<TAttachment> {
    const attempt: ComposeAttempt<TAttachment> = {
      id: this.createUniqueId(),
      capturedAt: this.now(),
      previewText: input.previewText,
      draftText: input.draftText,
      attachments: [...(input.attachments ?? [])],
      expectedPartIds: [],
      enqueuedPartIds: [],
    };
    this.attempts.set(attempt.id, attempt);
    return attempt;
  }

  setExpectedPartIds(
    attemptId: string,
    partIds: readonly string[],
  ): boolean {
    const attempt = this.attempts.get(attemptId);
    if (!attempt) return false;
    const expectedPartIds = Array.from(
      new Set(
        [...partIds, ...attempt.enqueuedPartIds].filter(
          (partId): partId is string =>
            typeof partId === "string" && partId.length > 0,
        ),
      ),
    );
    if (
      expectedPartIds.length === attempt.expectedPartIds.length &&
      expectedPartIds.every(
        (partId, index) => partId === attempt.expectedPartIds[index],
      )
    ) {
      return false;
    }
    this.attempts.set(attemptId, { ...attempt, expectedPartIds });
    return true;
  }

  markPartsEnqueued(
    attemptId: string,
    partIds: readonly string[],
  ): boolean {
    const attempt = this.attempts.get(attemptId);
    if (!attempt) return false;
    const expected = new Set(attempt.expectedPartIds);
    const enqueued = new Set(attempt.enqueuedPartIds);
    let changed = false;
    partIds.forEach((partId) => {
      if (!expected.has(partId) || enqueued.has(partId)) return;
      enqueued.add(partId);
      changed = true;
    });
    if (!changed) return false;
    this.attempts.set(attemptId, {
      ...attempt,
      enqueuedPartIds: [...enqueued],
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
      (attempt) =>
        attempt.expectedPartIds.length === 0 ||
        attempt.enqueuedPartIds.length < attempt.expectedPartIds.length,
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
