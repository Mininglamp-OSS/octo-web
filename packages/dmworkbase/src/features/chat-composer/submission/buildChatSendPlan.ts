import type {
  AttachmentFile,
  ChatMention,
  ChatSendRequest,
  EditorContentBlock,
  SendTargetSnapshot,
} from "../domain/types";

export type ChatSendOperationKind =
  | "edit_text"
  | "send_text"
  | "send_media"
  | "send_rich_text"
  | `extension:${string}`;

export interface ChatSendOperationBase<TMessage> {
  kind: ChatSendOperationKind;
  partIds: string[];
  sendTarget?: SendTargetSnapshot<TMessage>;
  requiresPreviousEnqueue?: boolean;
}

export type BuiltInChatSendOperation<TMessage = unknown> =
  | (ChatSendOperationBase<TMessage> & {
      kind: "edit_text";
      text: string;
      mention?: ChatMention;
    })
  | (ChatSendOperationBase<TMessage> & {
      kind: "send_text";
      text: string;
      mention?: ChatMention;
    })
  | (ChatSendOperationBase<TMessage> & {
      kind: "send_media";
      attachment: AttachmentFile;
    })
  | (ChatSendOperationBase<TMessage> & {
      kind: "send_rich_text";
      blocks: EditorContentBlock[];
    });

export type ExtensionChatSendOperation<
  TMessage = unknown,
  TPayload = unknown,
> = ChatSendOperationBase<TMessage> & {
  kind: `extension:${string}`;
  payload: TPayload;
};

export type ChatSendOperation<TMessage = unknown> =
  | BuiltInChatSendOperation<TMessage>
  | ExtensionChatSendOperation<TMessage>;

export interface ChatSendPlan<TMessage = unknown> {
  attemptId: string;
  operations: ChatSendOperation<TMessage>[];
}

const FALLBACK_TEXT_PART_ID = "text:0";

const IMAGE_EXTENSIONS = new Set([
  "bmp",
  "gif",
  "jpeg",
  "jpg",
  "png",
  "svg",
  "webp",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isImageFile(file: unknown): boolean {
  if (!isRecord(file)) return false;

  const type = typeof file.type === "string" ? file.type : "";
  if (type.toLowerCase().startsWith("image/")) return true;

  const name = typeof file.name === "string" ? file.name : "";
  const extension = name.split(".").pop()?.toLowerCase() || "";
  return IMAGE_EXTENSIONS.has(extension);
}

function isAttachment(value: unknown): value is AttachmentFile {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    isRecord(value.file) &&
    typeof value.file.name === "string"
  );
}

function isEditorBlock(value: unknown): value is EditorContentBlock {
  if (!isRecord(value) || typeof value.type !== "string") return false;

  if (value.type === "text") {
    return (
      typeof value.text === "string" && typeof value.restoreText === "string"
    );
  }

  return (
    (value.type === "image" || value.type === "file") &&
    typeof value.id === "string" &&
    isRecord(value.file) &&
    typeof value.file.name === "string"
  );
}

function hasReplyTarget<TMessage>(
  target: SendTargetSnapshot<TMessage> | undefined
): target is SendTargetSnapshot<TMessage> & { replyMessage: TMessage } {
  return (
    !!target &&
    target.replyMessage !== undefined &&
    target.replyMessage !== null
  );
}

function withTarget<TMessage>(
  operation: ChatSendOperation<TMessage>,
  target: SendTargetSnapshot<TMessage> | undefined,
  targetAttached: boolean
): boolean {
  if (!target || targetAttached) return targetAttached;
  operation.sendTarget = target;
  return true;
}

function editorPartId(index: number): string {
  return `editor:${index}`;
}

function topPartId(attachment: AttachmentFile, index: number): string {
  return attachment.id || `top:${index}`;
}

function isNonEmptyText(block: EditorContentBlock): boolean {
  return block.type === "text" && block.text.trim() !== "";
}

function buildEditOperation<TMessage>(
  request: ChatSendRequest<TMessage>
): ChatSendOperation<TMessage> {
  return {
    kind: "edit_text",
    partIds: [FALLBACK_TEXT_PART_ID],
    text: typeof request.text === "string" ? request.text : "",
    mention: request.mention,
    sendTarget: request.sendTarget,
  };
}

/** Build the immutable send work for one captured compose attempt. */
export function buildChatSendPlan<TMessage = unknown>(
  request: ChatSendRequest<TMessage>
): ChatSendPlan<TMessage> {
  if (!isRecord(request)) {
    return { attemptId: "", operations: [] };
  }

  const attemptId =
    typeof request.attemptId === "string" ? request.attemptId : "";
  const text = typeof request.text === "string" ? request.text : "";
  const topFiles = Array.isArray(request.topFiles)
    ? request.topFiles.filter(isAttachment)
    : [];
  const editorBlocks = Array.isArray(request.editorBlocks)
    ? request.editorBlocks.filter(isEditorBlock)
    : [];
  const target = hasReplyTarget(request.sendTarget)
    ? request.sendTarget
    : undefined;

  if (hasReplyTarget(target) && target.handlerType === 2) {
    return {
      attemptId,
      operations: [buildEditOperation(request)],
    };
  }

  const operations: ChatSendOperation<TMessage>[] = [];
  let targetAttached = false;
  const attachTarget = (operation: ChatSendOperation<TMessage>) => {
    targetAttached = withTarget(operation, target, targetAttached);
    operations.push(operation);
  };
  const pushOperation = (operation: ChatSendOperation<TMessage>) => {
    operations.push(operation);
  };

  const topImages = topFiles.filter(({ file }) => isImageFile(file));
  const allTopFilesAreImages = topImages.length === topFiles.length;
  const hasEditorText = editorBlocks.some(isNonEmptyText);
  const hasEditorImage = editorBlocks.some((block) => block.type === "image");
  const hasEditorFile = editorBlocks.some((block) => block.type === "file");
  const editorCanBeRichText =
    hasEditorText && hasEditorImage && !hasEditorFile;
  const topImagesCanJoinRichText =
    allTopFilesAreImages &&
    hasEditorText &&
    !hasEditorFile &&
    (topImages.length > 0 || hasEditorImage);

  if (
    editorBlocks.length > 0 &&
    topImagesCanJoinRichText
  ) {
    const blocks: EditorContentBlock[] = [
      ...topImages.map(({ id, file }) => ({
        type: "image" as const,
        id,
        file,
      })),
      ...editorBlocks,
    ];
    const operation: ChatSendOperation<TMessage> = {
      kind: "send_rich_text",
      partIds: [
        ...topImages.map((attachment, index) => topPartId(attachment, index)),
        ...editorBlocks.map((_, index) => editorPartId(index)),
      ],
      blocks,
    };
    attachTarget(operation);
    return { attemptId, operations };
  }

  topFiles.forEach((attachment, index) => {
    const operation: ChatSendOperation<TMessage> = {
      kind: "send_media",
      partIds: [topPartId(attachment, index)],
      attachment,
    };
    pushOperation(operation);
  });

  if (editorCanBeRichText) {
    const operation: ChatSendOperation<TMessage> = {
      kind: "send_rich_text",
      partIds: editorBlocks.map((_, index) => editorPartId(index)),
      blocks: editorBlocks,
    };
    attachTarget(operation);
    return { attemptId, operations };
  }

  editorBlocks.forEach((block, index) => {
    const partId = editorPartId(index);
    if (block.type === "text") {
      if (block.text.trim() === "") return;
      const operation: ChatSendOperation<TMessage> = {
        kind: "send_text",
        partIds: [partId],
        text: block.text,
        mention: block.mention,
      };
      attachTarget(operation);
      return;
    }

    const operation: ChatSendOperation<TMessage> = {
      kind: "send_media",
      partIds: [partId],
      attachment: { id: block.id, file: block.file },
    };
    pushOperation(operation);
  });

  if (editorBlocks.length === 0 && text.trim() !== "") {
    const operation: ChatSendOperation<TMessage> = {
      kind: "send_text",
      partIds: [FALLBACK_TEXT_PART_ID],
      text,
      mention: request.mention,
    };
    attachTarget(operation);
  }

  if (
    target &&
    !targetAttached &&
    operations.length > 0
  ) {
    pushOperation({
      kind: "send_text",
      partIds: ["reply:empty"],
      text: "",
      sendTarget: target,
      requiresPreviousEnqueue: true,
    });
  }

  return { attemptId, operations };
}
