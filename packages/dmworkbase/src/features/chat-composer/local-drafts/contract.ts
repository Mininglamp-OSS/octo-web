export type LocalAttachmentDraftSource = "upload" | "paste";

export interface LocalAttachmentDraftChannel {
  id: string;
  type: number;
}

export interface LocalAttachmentDraftMetadata {
  id: string;
  position: number;
  name: string;
  mimeType: string;
  size: number;
  lastModified: number;
  source: LocalAttachmentDraftSource;
  createdAt: number;
  updatedAt: number;
}

export interface LocalAttachmentDraftHost {
  version: 1;
  /**
   * The host installation is bound to one authenticated account and space.
   * Storage must isolate that scope and purge account data when its session ends.
   * Hosts should enforce a bounded local quota rather than grow without limit.
   */
  /**
   * Resolve only after bytes and metadata are durable. Calls that target the
   * same attachment id must be serialized with remove(), including across
   * renderer reloads that share the same backing store.
   */
  stage(input: {
    channel: LocalAttachmentDraftChannel;
    attachment: Omit<LocalAttachmentDraftMetadata, "createdAt" | "updatedAt">;
    bytes: ArrayBuffer;
  }): Promise<LocalAttachmentDraftMetadata>;
  list(input: {
    channel: LocalAttachmentDraftChannel;
  }): Promise<LocalAttachmentDraftMetadata[]>;
  read(input: {
    channel: LocalAttachmentDraftChannel;
    attachmentId: string;
  }): Promise<{
    /**
     * Metadata should describe the same stored record returned by list().
     * The Web runtime retains, rather than deletes, records on a mismatch.
     */
    attachment: LocalAttachmentDraftMetadata;
    bytes: ArrayBuffer | Uint8Array;
  }>;
  remove(input: {
    channel: LocalAttachmentDraftChannel;
    attachmentId: string;
    /** Removal must be idempotent and accept an attachment that is already absent. */
  }): Promise<void>;
}

export interface RestoredLocalAttachmentDraft {
  id: string;
  file: File;
  source: LocalAttachmentDraftSource;
  position?: number;
}

export interface ChatComposerAttachmentDraftPort {
  restore(): Promise<{
    attachments: RestoredLocalAttachmentDraft[];
    failedCount: number;
  }>;
  stage(
    input: RestoredLocalAttachmentDraft,
    position?: number
  ): Promise<boolean>;
  syncLive(attachmentIds: readonly string[]): void;
  discardUnready(attachmentIds: readonly string[]): void;
  beginSend(attachmentIds: readonly string[]): void;
  settleSend(input: {
    attachmentIds: readonly string[];
    keepAttachmentIds: readonly string[];
  }): void;
  canLeave(attachmentIds: readonly string[]): boolean;
}
