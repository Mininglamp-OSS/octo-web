import { installAttachmentDraftFactory } from "@octo/base/src/features/chat-composer/local-drafts";
import { createClientAttachmentDraftPort } from "./attachmentDraftPort";
import type { OctoBuddyCommunicationBridge } from "./hostBridge";

export function installClientLocalAttachmentDrafts(bridge: OctoBuddyCommunicationBridge, initialSpaceId: string): () => void {
  const api = bridge.attachmentDrafts;
  if (!api || api.version !== 3 ||
      ![api.open, api.stage, api.remove, api.prepareSend, api.settleSend].every(method => typeof method === "function")) return () => {};
  let active = true;
  let revision = 0;
  let spaceId = initialSpaceId;
  const uninstall = installAttachmentDraftFactory((channel) => {
    const capturedRevision = revision;
    return createClientAttachmentDraftPort(api, { spaceId, channel }, () => active && revision === capturedRevision);
  });
  let off = () => {};
  const dispose = () => {
    if (!active) return;
    active = false;
    uninstall();
    off();
  };
  off = bridge.onCommand(command => {
    if (!active) return;
    if (command.type === "sessionRevoked") dispose();
    else if (command.type === "spaceChanged" && command.space.id !== spaceId) {
      revision += 1;
      spaceId = command.space.id;
    }
  });
  if (!active) off();
  return dispose;
}
