import {
  installLocalAttachmentDraftHost,
  type LocalAttachmentDraftHost,
} from "@octo/base/src/features/chat-composer/local-drafts";
import type { OctoBuddyCommunicationBridge } from "./hostBridge";

export function installClientLocalAttachmentDrafts(
  bridge: OctoBuddyCommunicationBridge
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
  const disposeHost = installLocalAttachmentDraftHost(host);
  const offCommand = bridge.onCommand((command) => {
    if (command.type !== "spaceChanged" && command.type !== "sessionRevoked") {
      return;
    }
    if (!active) return;
    active = false;
    disposeHost();
  });
  return () => {
    if (active) disposeHost();
    active = false;
    offCommand();
  };
}
