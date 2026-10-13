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
  const offCommand = bridge.onCommand((command) => {
    if (command.type === "spaceChanged") {
      if (command.space.id === spaceId) return;
      spaceId = command.space.id;
      invalidateLocalAttachmentDraftHost(installation.host);
      installation.dispose();
      installation = installForSpace(spaceId);
      return;
    }
    if (command.type === "sessionRevoked" && active) {
      active = false;
      invalidateLocalAttachmentDraftHost(installation.host);
      installation.dispose();
    }
  });
  return () => {
    if (active) {
      invalidateLocalAttachmentDraftHost(installation.host);
      installation.dispose();
    }
    active = false;
    offCommand();
  };
}
