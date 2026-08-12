import type {
  ChatSendOutcome,
  ChatSendRequest,
  EditorContentBlock,
  UnsentEditorBlock,
} from "../domain/types";
import type { ChatSendExecution } from "./executeChatSendPlan";

function topPartId(id: string, index: number): string {
  return id || `top:${index}`;
}

function editorPartId(index: number): string {
  return `editor:${index}`;
}

function unsentEditorBlock(block: EditorContentBlock): UnsentEditorBlock {
  if (block.type === "text") {
    return { type: "text", text: block.restoreText };
  }
  return { type: "attachment", id: block.id };
}

/**
 * Convert operation-level enqueue results into the outcome consumed by
 * MessageInput. SDK errors and notifications stay in the transport adapter;
 * restoration semantics stay here.
 */
export function settleChatSendExecution<TMessage = unknown>(
  request: ChatSendRequest<TMessage>,
  execution: ChatSendExecution<TMessage>,
): ChatSendOutcome {
  const enqueued = new Set(execution.enqueuedPartIds);
  const topFiles = request.topFiles ?? [];
  const editorBlocks = request.editorBlocks ?? [];
  const editorConsumed = enqueued.size > 0;

  const consumedTopIds = topFiles
    .filter((attachment, index) =>
      enqueued.has(topPartId(attachment.id, index)),
    )
    .map((attachment) => attachment.id);

  const unsentEditorBlocks = editorBlocks.flatMap((block, index) => {
    if (block.type === "text" && block.text.trim() === "") return [];
    return enqueued.has(editorPartId(index)) ? [] : [unsentEditorBlock(block)];
  });

  // A request without editorBlocks still represents editor text in the
  // current adapter. Keep it recoverable if another operation succeeded first.
  if (
    editorBlocks.length === 0 &&
    request.text.trim() !== "" &&
    editorConsumed &&
    !enqueued.has("text:0")
  ) {
    unsentEditorBlocks.push({ type: "text", text: request.text });
  }

  const targetConsumed = execution.operations.some(
    ({ operation, enqueuedPartIds }) =>
      operation.sendTarget !== undefined && enqueuedPartIds.length > 0,
  );

  return {
    editorConsumed,
    consumedTopIds,
    unsentEditorBlocks,
    restoreSendTarget: request.sendTarget !== undefined && !targetConsumed,
  };
}
