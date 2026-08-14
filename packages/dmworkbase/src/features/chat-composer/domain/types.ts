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
}

export type EditorContentBlock =
  | { type: "text"; text: string; restoreText: string; mention?: ChatMention }
  | { type: "image"; id: string; file: File }
  | { type: "file"; id: string; file: File }
  | ExtensionEditorContentBlock;

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
