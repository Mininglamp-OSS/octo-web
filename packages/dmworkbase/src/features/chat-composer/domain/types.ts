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

export type EditorContentBlock =
  | { type: "text"; text: string; restoreText: string; mention?: ChatMention }
  | { type: "image"; id: string; file: File }
  | { type: "file"; id: string; file: File };

/** Reply/edit target captured synchronously with the compose. */
export interface SendTargetSnapshot<TMessage = unknown> {
  replyMessage?: TMessage;
  handlerType: number;
  restore: () => void;
}

export interface SendDraftSnapshot {
  generation: number;
  remoteDraft: string;
  draftText: string;
}

/** Draft text owned by one captured compose attempt. */
export interface PendingSendDraft {
  attemptId: string;
  draftText: string;
}

export interface SendProgressSnapshot {
  setExpectedParts: (count: number) => void;
  markPartEnqueued: () => void;
}

export type UnsentEditorBlock =
  | { type: "attachment"; id: string }
  | { type: "text"; text: string };

/** Immutable request captured before the serial send queue starts execution. */
export interface ChatSendRequest<TMessage = unknown> {
  attemptId: string;
  text: string;
  mention?: ChatMention;
  attachments?: AttachmentFile[];
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
}

export function createChatSendOutcome(
  overrides: Partial<ChatSendOutcome> = {},
): ChatSendOutcome {
  return {
    editorConsumed: overrides.editorConsumed ?? false,
    consumedTopIds: overrides.consumedTopIds ?? [],
    unsentEditorBlocks: overrides.unsentEditorBlocks ?? [],
    restoreSendTarget: overrides.restoreSendTarget ?? false,
  };
}
