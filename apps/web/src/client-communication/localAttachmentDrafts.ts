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
    bridge.localAttachmentDraftsVersion !== 1 ||
    typeof bridge.stageAttachmentDraft !== "function" ||
    typeof bridge.listAttachmentDrafts !== "function" ||
    typeof bridge.readAttachmentDraft !== "function" ||
    typeof bridge.removeAttachmentDraft !== "function"
  ) {
    return () => {};
  }
  const host: LocalAttachmentDraftHost = {
    version: 1,
    stage: (input) => bridge.stageAttachmentDraft!(input),
    list: (input) => bridge.listAttachmentDrafts!(input),
    read: (input) => bridge.readAttachmentDraft!(input),
    remove: (input) => bridge.removeAttachmentDraft!(input),
  };
  let active = true;
  let spaceId = initialSpaceId;
  const disposeHost = installLocalAttachmentDraftHost(host);
  const offCommand = bridge.onCommand((command) => {
    if (command.type === "spaceChanged") {
      if (command.space.id === spaceId) return;
      spaceId = command.space.id;
      invalidateLocalAttachmentDraftHost(host);
      return;
    }
    if (command.type === "sessionRevoked" && active) {
      active = false;
      invalidateLocalAttachmentDraftHost(host);
      disposeHost();
    }
  });
  return () => {
    if (active) {
      invalidateLocalAttachmentDraftHost(host);
      disposeHost();
    }
    active = false;
    offCommand();
  };
}
