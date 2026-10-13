import {
  invalidateLocalAttachmentDraftHost,
  installLocalAttachmentDraftHost,
  type LocalAttachmentDraftHost,
} from "@octo/base/src/features/chat-composer/local-drafts";
import type { OctoBuddyCommunicationBridge } from "./hostBridge";

export function installClientLocalAttachmentDrafts(
  bridge: OctoBuddyCommunicationBridge,
  initialSpaceId: string,
): () => void {
  if (
    bridge.localAttachmentDraftsVersion !== 2 ||
    typeof bridge.stageAttachmentDraft !== "function" ||
    typeof bridge.listAttachmentDrafts !== "function" ||
    typeof bridge.readAttachmentDraft !== "function" ||
    typeof bridge.removeAttachmentDraft !== "function"
  ) {
    if (bridge.localAttachmentDraftsVersion !== undefined) {
      console.warn("[attachment-drafts] unsupported or incomplete Client capability; using attachment leave confirmation", {
        expectedVersion: 2,
        actualVersion: bridge.localAttachmentDraftsVersion,
      });
    }
    return () => {};
  }
  const installForSpace = (spaceId: string) => {
    const host: LocalAttachmentDraftHost = {
      version: 1,
      stage: (input) => bridge.stageAttachmentDraft!({ ...input, spaceId }),
      list: (input) => bridge.listAttachmentDrafts!({ ...input, spaceId }),
      read: (input) => bridge.readAttachmentDraft!({ ...input, spaceId }),
      remove: (input) => bridge.removeAttachmentDraft!({ ...input, spaceId }),
    };
    return {
      host,
      dispose: installLocalAttachmentDraftHost(host),
    };
  };
  let active = true;
  let spaceId = initialSpaceId;
  let installation = installForSpace(spaceId);
  let offCommand = () => {};
  const dispose = () => {
    if (!active) return;
    active = false;
    invalidateLocalAttachmentDraftHost(installation.host);
    installation.dispose();
    offCommand();
  };
  offCommand = bridge.onCommand((command) => {
    if (!active) return;
    if (command.type === "spaceChanged") {
      if (command.space.id === spaceId) return;
      spaceId = command.space.id;
      invalidateLocalAttachmentDraftHost(installation.host);
      installation.dispose();
      installation = installForSpace(spaceId);
      return;
    }
    if (command.type === "sessionRevoked") dispose();
  });
  // Also cover a bridge that synchronously replays revocation on subscription.
  if (!active) offCommand();
  return dispose;
}
