import type { EditorComposeDocument, UnsentEditorBlock } from "../domain";
import type {
  ComposeRecoveryPayload,
  ComposeRecoveryRecord,
} from "../recovery";

export interface ChatComposerRestoreOffsets {
  blocks: number;
  topAttachments: number;
}

export interface ChatComposerRestorePrefix {
  blockMarkerIds: string[];
  topAttachmentIds: string[];
}

export interface ChatComposerConsumeContext {
  getRestoreOffsets(
    livePrefix?: ChatComposerRestorePrefix,
  ): ChatComposerRestoreOffsets;
  onRestored(
    offsets: ChatComposerRestoreOffsets,
    restoredPrefix?: Partial<ChatComposerRestorePrefix>,
  ): void;
  onRestoreCompose(): void;
  onRestoreSendTarget(): void;
  onRestoreError(error: unknown, step: string): void;
}

export interface ChatComposerConsumedCompose {
  ids: {
    topIds: string[];
    editorPartIds: string[];
  };
  compose: {
    restoreEditor(): void;
    restoreEditorBlocks(blocks: UnsentEditorBlock[]): void;
    restoreSendTarget(): void;
    disposeEditorParts(ids: string[]): void;
    disposeTopAttachments(ids: string[]): void;
    restoreTopAttachments(ids: string[]): void;
    onRestoreError?(error: unknown, step: string): void;
  };
  snapshot: EditorComposeDocument;
  recovery: ComposeRecoveryPayload;
}

/** Editor and attachment ownership operations needed by the coordinator. */
export interface ChatComposerEditorPort {
  consume(context: ChatComposerConsumeContext): ChatComposerConsumedCompose;
  handoffRecovery(recovery: ComposeRecoveryRecord): void;
}
