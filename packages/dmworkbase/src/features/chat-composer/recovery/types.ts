import type { UnsentEditorBlock } from "../domain";
import type { EditorComposeDocument } from "../editor";

export interface ComposeRecoveryTopAttachment {
  id: string;
  file?: File;
  name?: string;
  size?: number;
  type?: string;
  previewUrl?: string;
}

export interface ComposeRecoveryPayload {
  snapshot: EditorComposeDocument;
  editorAttachments: Array<{ id: string; file: File }>;
  editorObjectUrls: Array<{ id: string; url: string }>;
  topAttachments: ComposeRecoveryTopAttachment[];
}

export interface ComposeRecoveryRecord extends ComposeRecoveryPayload {
  channelKey: string;
  attemptId: string;
  editorBlocks?: UnsentEditorBlock[];
  sendTarget?: { replyMessage?: unknown; handlerType: number };
  expanded: boolean;
}
