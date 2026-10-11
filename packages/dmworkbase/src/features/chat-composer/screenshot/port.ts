/** The channel identity the screenshot staleness check needs, structurally typed. */
export interface ScreenshotChannelSnapshot {
  channelID: string;
  channelType: number;
}

/**
 * The narrow slice of the conversation the screenshot toolbar needs.
 *
 * Declared structurally rather than importing `Components/Conversation/context` or the SDK, so this
 * feature keeps its dependency boundary: `ConversationContext` satisfies this shape without changes.
 */
export interface ScreenshotConversationPort {
  channel(): ScreenshotChannelSnapshot;
  addPendingAttachments(files: File[], source?: "paste" | "upload"): Promise<string | null>;
  messageInputContext(): { focus(): void } | undefined;
}
