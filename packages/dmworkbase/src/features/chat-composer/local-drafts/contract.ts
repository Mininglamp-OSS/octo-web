export interface RestoredLocalAttachmentDraft {
  id: string;
  file: File;
  source: "upload" | "paste";
  position?: number;
}

/** Optional desktop capability. Browser composers never install this port. */
export interface ChatComposerAttachmentDraftPort {
  restore(): Promise<{ attachments: RestoredLocalAttachmentDraft[]; failedCount: number }>;
  stage(input: RestoredLocalAttachmentDraft, position?: number): Promise<boolean>;
  syncLive(attachmentIds: readonly string[], files?: RestoredLocalAttachmentDraft[]): void;
  discardUnready(attachmentIds: readonly string[]): void | Promise<void>;
  /** Await inside the captured send transaction, before submitting any messages. */
  beginSend(attachmentIds: readonly string[], files?: RestoredLocalAttachmentDraft[]): {
    ready: Promise<void>;
    settle(keepAttachmentIds: readonly string[]): Promise<void>;
  };
  canLeave(attachmentIds: readonly string[]): boolean;
}
