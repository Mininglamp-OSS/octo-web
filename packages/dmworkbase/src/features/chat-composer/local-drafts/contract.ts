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
  /** Explicitly confirmed navigation: attempt current cleanup and waive its guards.
   * Failed requests retain ownership until acknowledged, across editor unmounts.
   * New concurrent work and in-flight staging are not discarded.
   * A rejection reports incomplete cleanup; it must not veto the confirmed move.
   */
  discardUnready(attachmentIds: readonly string[]): void | Promise<void>;
  /** Await inside the captured send transaction, before submitting any messages. */
  beginSend(attachmentIds: readonly string[], files?: RestoredLocalAttachmentDraft[]): {
    ready: Promise<void>;
    /** Settle once with only the unsent IDs (including partial sends).
     * Returns a rejecting Promise on cleanup failure; never throws synchronously.
     * A retry must preserve the same decision. Client retains uncertain sends.
     */
    settle(keepAttachmentIds: readonly string[]): Promise<void>;
  };
  canLeave(attachmentIds: readonly string[]): boolean;
}
