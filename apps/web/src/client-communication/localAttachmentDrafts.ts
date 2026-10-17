import { conversationDrafts } from "@octo/base/src/features/chat-composer/local-drafts/repository";
import { currentConversationDraftScope } from "@octo/base/src/bridge/conversationDraftScope";
import { installAttachmentDraftFactory } from "@octo/base/src/features/chat-composer/local-drafts";
import { AttachmentDraftCleanup } from "./attachmentDraftCleanup";
import { createClientAttachmentDraftPort } from "./attachmentDraftPort";
import type { OctoBuddyCommunicationBridge } from "./hostBridge";

export function installClientLocalAttachmentDrafts(bridge: OctoBuddyCommunicationBridge, initialSpaceId: string): () => void {
  const draftScope = currentConversationDraftScope();
  const clearDrafts = () => {
    void conversationDrafts.clearAccount(draftScope).catch(error => console.warn("[drafts] logout cleanup failed", error));
  };
  const api = bridge.attachmentDrafts;
  if (!api || api.version !== 4 ||
      ![api.open, api.stage, api.remove, api.prepareSend, api.settleSend].every(method => typeof method === "function")) {
    // Older Clients use the browser provider and still need account cleanup.
    return bridge.onCommand(command => { if (command.type === "sessionRevoked") clearDrafts(); });
  }
  const cleanup = new AttachmentDraftCleanup();
  let active = true;
  let revision = 0;
  let spaceId = initialSpaceId;
  const uninstall = installAttachmentDraftFactory((channel) => {
    const capturedRevision = revision;
    return createClientAttachmentDraftPort(api, { spaceId, channel }, () => active && revision === capturedRevision, undefined, cleanup);
  });
  let off = () => {};
  const dispose = () => {
    if (!active) return;
    active = false;
    cleanup.dispose();
    uninstall();
    off();
  };
  off = bridge.onCommand(command => {
    if (!active) return;
    if (command.type === "sessionRevoked") {
      clearDrafts();
      dispose();
    }
    else if (command.type === "spaceChanged" && command.space.id !== spaceId) {
      revision += 1;
      spaceId = command.space.id;
    }
  });
  if (!active) off();
  return dispose;
}
