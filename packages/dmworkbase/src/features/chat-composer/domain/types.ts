export interface ChatMentionEntity {
  uid: string;
  offset: number;
  length: number;
}

/** Wire-compatible mention metadata produced by the composer parser. */
export interface ChatMention {
  all: boolean;
  uids?: string[];
  entities?: ChatMentionEntity[];
  humans?: number;
  ais?: number;
}

export interface AttachmentFile {
  id: string;
  file: File;
}

export interface ExtensionEditorContentBlock<TPayload = unknown> {
  type: `extension:${string}`;
  id: string;
  payload: TPayload;
  /** True only when the extension operation serializes reply/edit target data. */
  acceptsSendTarget?: boolean;
}

export type EditorContentBlock =
  | { type: "text"; text: string; restoreText: string; mention?: ChatMention }
  | { type: "image"; id: string; file: File }
  | { type: "file"; id: string; file: File }
  | ExtensionEditorContentBlock;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFileLike(value: unknown): value is File {
  return isRecord(value) && typeof value.name === "string";
}

export function isAttachmentFile(value: unknown): value is AttachmentFile {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    isFileLike(value.file)
  );
}

export function isEditorContentBlock(
  value: unknown,
): value is EditorContentBlock {
  if (!isRecord(value) || typeof value.type !== "string") return false;

  if (value.type === "text") {
    return (
      typeof value.text === "string" && typeof value.restoreText === "string"
    );
  }

  if (value.type === "image" || value.type === "file") {
    return (
      typeof value.id === "string" &&
      value.id.trim() !== "" &&
      isFileLike(value.file)
    );
  }

  return (
    /^extension:.+/.test(value.type) &&
    typeof value.id === "string" &&
    value.id.trim() !== "" &&
    "payload" in value &&
    (value.acceptsSendTarget === undefined ||
      typeof value.acceptsSendTarget === "boolean")
  );
}

function cloneMention(mention: ChatMention | undefined): ChatMention | undefined {
  if (!mention) return undefined;
  return {
    ...mention,
    uids: mention.uids ? [...mention.uids] : undefined,
    entities: mention.entities?.map((entity) => ({ ...entity })),
  };
}

function cloneExtensionPayload<T>(payload: T): T {
  if (typeof globalThis.structuredClone !== "function") {
    throw new Error("structuredClone is required for extension payloads");
  }
  return globalThis.structuredClone(payload);
}

/** Clone mutable transaction data while preserving owned File references. */
export function cloneEditorContentBlocks(
  blocks: readonly EditorContentBlock[],
): EditorContentBlock[] {
  return blocks.map((block) => {
    if (block.type === "text") {
      return { ...block, mention: cloneMention(block.mention) };
    }
    if (block.type === "image" || block.type === "file") {
      return { ...block };
    }
    return {
      ...block,
      payload: cloneExtensionPayload(block.payload),
    };
  });
}

/** Reply/edit target captured synchronously with the compose. */
export interface SendTargetSnapshot<TMessage = unknown> {
  replyMessage?: TMessage;
  handlerType: number;
  restore: () => void;
}

export interface SendDraftSnapshot {
  revision: number;
  remoteDraft: string;
  draftText: string;
  protectedPendingAttemptIds: string[];
}

/** Draft text owned by one captured compose attempt. */
export interface PendingSendDraft {
  attemptId: string;
  draftText: string;
}

export interface SendProgressSnapshot {
  setExpectedPartIds: (partIds: readonly string[]) => void;
  markPartsEnqueued: (partIds: readonly string[]) => void;
}

export type UnsentEditorBlock =
  | { type: "attachment"; id: string }
  | { type: "extension"; id: string }
  | { type: "text"; text: string };

/** Immutable request captured before the serial send queue starts execution. */
export interface ChatSendRequest<TMessage = unknown> {
  attemptId: string;
  text: string;
  mention?: ChatMention;
  topFiles?: AttachmentFile[];
  editorBlocks?: EditorContentBlock[];
  sendTarget?: SendTargetSnapshot<TMessage>;
  sendDraft?: SendDraftSnapshot;
  sendProgress?: SendProgressSnapshot;
}

/** Explicit result of executing a captured request. */
export interface ChatSendOutcome {
  editorConsumed: boolean;
  consumedTopIds: string[];
  unsentEditorBlocks: UnsentEditorBlock[];
  restoreSendTarget: boolean;
}

/** Emitted after consumed compose resources have been restored or disposed. */
export interface ChatSendSettlement {
  attemptId: string;
  outcome: ChatSendOutcome;
  sendDraft?: SendDraftSnapshot;
  restoreFailed: boolean;
}

export type ChatComposerSendRejectReason =
  | "editor-not-ready"
  | "message-too-long"
  | "unsupported-content"
  | "send-host-unavailable"
  | "empty-compose";

export interface ChatComposerSendRejection {
  kind: "rejected";
  editorConsumed: false;
  reason: ChatComposerSendRejectReason;
  attemptId?: never;
  outcome?: never;
}

export interface ChatComposerSendAttemptResult {
  kind: "attempted";
  editorConsumed: boolean;
  attemptId: string;
  outcome: ChatSendOutcome;
  reason?: never;
}

/** Explicit result returned by the imperative composer send surface. */
export type ChatComposerSendResult =
  | ChatComposerSendRejection
  | ChatComposerSendAttemptResult;

export function rejectChatComposerSend(
  reason: ChatComposerSendRejectReason
): ChatComposerSendRejection {
  return { kind: "rejected", editorConsumed: false, reason };
}

export function createChatSendOutcome(
  overrides: Partial<ChatSendOutcome> = {}
): ChatSendOutcome {
  return {
    editorConsumed: overrides.editorConsumed ?? false,
    consumedTopIds: overrides.consumedTopIds ?? [],
    unsentEditorBlocks: overrides.unsentEditorBlocks ?? [],
    restoreSendTarget: overrides.restoreSendTarget ?? false,
  };
}
