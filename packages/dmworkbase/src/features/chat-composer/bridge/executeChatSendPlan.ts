import type { ChatSendOperation, ChatSendPlan } from "../submission/buildChatSendPlan";
import type { ChatTransportPort, ChatTransportResult } from "./ChatTransportPort";

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
  /** Called once per operation that produced at least one local enqueue. */
  onOperationEnqueued?: (
    execution: ChatOperationExecution<TMessage>,
  ) => void;
}

export class InvalidChatTransportResultError extends Error {
  constructor(operation: ChatSendOperation, partId: unknown) {
    super(
      `transport returned part id ${String(partId)} not owned by ${operation.kind}`,
    );
    this.name = "InvalidChatTransportResultError";
  }
}

function validateResult(
  operation: ChatSendOperation,
  result: ChatTransportResult,
): string[] {
  if (!Array.isArray(result.enqueuedPartIds)) {
    throw new TypeError("transport result must contain enqueuedPartIds[]");
  }
  const allowed = new Set(operation.partIds);
  const seen = new Set<string>();
  for (const partId of result.enqueuedPartIds) {
    if (typeof partId !== "string" || !allowed.has(partId)) {
      throw new InvalidChatTransportResultError(operation, partId);
    }
    if (seen.has(partId)) {
      throw new InvalidChatTransportResultError(operation, partId);
    }
    seen.add(partId);
  }
  return [...result.enqueuedPartIds];
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
    try {
      const result = await transport.execute(operation);
      const enqueuedPartIds = validateResult(operation, result);
      const execution = { operation, enqueuedPartIds, result };
      operations.push(execution);
      if (enqueuedPartIds.length > 0) {
        hasEnqueuedOperation = true;
        options.onOperationEnqueued?.(execution);
      }
    } catch (error) {
      operations.push({ operation, enqueuedPartIds: [], error });
    }
  }

  return {
    attemptId: plan.attemptId,
    operations,
    enqueuedPartIds: operations.flatMap((execution) => execution.enqueuedPartIds),
  };
}
