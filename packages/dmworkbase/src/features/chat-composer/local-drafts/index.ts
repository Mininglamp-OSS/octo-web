import type { ChatComposerAttachmentDraftPort } from "./contract";
import type { DraftScope } from "./model";
import { createBrowserAttachmentDraftPort } from "./browserPort";
import { withConversationDocument } from "./documentPort";
export * from "./contract";
type Factory = (channel: { id: string; type: number }) => ChatComposerAttachmentDraftPort;
let factory: Factory | undefined;
/** Only the embedded Client entry point installs a draft capability. */
export function installAttachmentDraftFactory(next: Factory): () => void {
  factory = next;
  return () => { if (factory === next) factory = undefined; };
}
export function createChatComposerAttachmentDraftPort(channel: { id: string; type: number }, scope?: DraftScope) {
  const client = factory?.(channel);
  if (!scope?.account) return client;
  return withConversationDocument(client ?? createBrowserAttachmentDraftPort(scope, channel), scope, channel);
}
