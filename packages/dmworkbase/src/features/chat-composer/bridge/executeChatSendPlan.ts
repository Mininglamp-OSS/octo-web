import type {
  ChatSendOperation,
  ChatSendPlan,
  ChatTransportResult,
} from "../domain/sendPlan";
import type { ChatTransportPort } from "./ChatTransportPort";

export interface ChatOperationExecution<TMessage = unknown> {
  operation: ChatSendOperation<TMessage>;
  enqueuedPartIds: string[];
  result?: ChatTransportResult;
  error?: unknown;
}

export interface ChatSendExecution<TMessage = unknown> {
  attemptId: string;
  operations: ChatOperationExecution<TMessage>[];
  enqueuedPartIds: string[];
}

export interface ExecuteChatSendPlanOptions<TMessage = unknown> {
  /** Called immediately for newly enqueued part IDs, before server ack. */
  onPartsEnqueued?: (
    partIds: readonly string[],
    operation: ChatSendOperation<TMessage>,
  ) => void;
}

export class InvalidChatTransportResultError extends Error {
  constructor(
    operation: ChatSendOperation,
    partId: unknown,
    reason = "is not owned by",
  ) {
    super(
      `transport returned part id ${String(partId)} that ${reason} ${operation.kind}`,
    );
    this.name = "InvalidChatTransportResultError";
  }
}

/** Execute operations serially while preserving every partial result. */
export async function executeChatSendPlan<TMessage = unknown>(
  plan: ChatSendPlan<TMessage>,
  transport: ChatTransportPort<TMessage>,
  options: ExecuteChatSendPlanOptions<TMessage> = {},
): Promise<ChatSendExecution<TMessage>> {
  const operations: ChatOperationExecution<TMessage>[] = [];
  let hasEnqueuedOperation = false;

  for (const operation of plan.operations) {
    if (operation.requiresPreviousEnqueue && !hasEnqueuedOperation) {
      operations.push({
        operation,
        enqueuedPartIds: [],
        result: { enqueuedPartIds: [] },
      });
      continue;
    }
    const reportedPartIds = new Set<string>();
    const reportEnqueued = (partIds: readonly string[]) => {
      const allowed = new Set(operation.partIds);
      const seenInBatch = new Set<string>();
      const newlyEnqueued: string[] = [];
      let invalid: { partId: unknown; reason?: string } | undefined;
      partIds.forEach((partId) => {
        if (typeof partId !== "string" || !allowed.has(partId)) {
          invalid ??= { partId };
          return;
        }
        if (seenInBatch.has(partId)) {
          invalid ??= { partId, reason: "is duplicated for" };
          return;
        }
        seenInBatch.add(partId);
        if (reportedPartIds.has(partId)) return;
        reportedPartIds.add(partId);
        newlyEnqueued.push(partId);
      });
      if (newlyEnqueued.length > 0) {
        hasEnqueuedOperation = true;
        options.onPartsEnqueued?.(newlyEnqueued, operation);
      }
      if (invalid) {
        throw new InvalidChatTransportResultError(
          operation,
          invalid.partId,
          invalid.reason,
        );
      }
    };
    try {
      const result = await transport.execute(operation, {
        onEnqueued: reportEnqueued,
      });
      if (!Array.isArray(result.enqueuedPartIds)) {
        throw new TypeError("transport result must contain enqueuedPartIds[]");
      }
      reportEnqueued(result.enqueuedPartIds);
      const enqueuedPartIds = [...reportedPartIds];
      const execution = { operation, enqueuedPartIds, result };
      operations.push(execution);
    } catch (error) {
      operations.push({
        operation,
        enqueuedPartIds: [...reportedPartIds],
        error,
      });
    }
  }

  return {
    attemptId: plan.attemptId,
    operations,
    enqueuedPartIds: operations.flatMap((execution) => execution.enqueuedPartIds),
  };
}
