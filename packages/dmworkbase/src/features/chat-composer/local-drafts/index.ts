import type { ChatComposerAttachmentDraftPort } from "./contract";
export * from "./contract";
type Factory = (channel: { id: string; type: number }) => ChatComposerAttachmentDraftPort;
let factory: Factory | undefined;
/** Only the embedded Client entry point installs a draft capability. */
export function installAttachmentDraftFactory(next: Factory): () => void {
  factory = next;
  return () => { if (factory === next) factory = undefined; };
}
export function createChatComposerAttachmentDraftPort(channel: { id: string; type: number }) {
  return factory?.(channel);
}
