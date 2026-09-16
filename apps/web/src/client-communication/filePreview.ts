import {
  cancelHostAttachmentRequests,
  getWebAttachmentHost,
  setWebAttachmentHost,
  notifyHostAttachmentClosed,
  notifyHostAttachmentState,
  parseAttachmentPreviewClosed,
  parseAttachmentPreviewState,
} from "@octo/base/src/features/filePreview/attachmentHost";
import type { LayoutAttachmentHost } from "@octo/base/src/features/filePreview/hostPreviewLayout";
import type { OctoBuddyCommunicationBridge } from "./hostBridge";

export function installHostFilePreview(
  bridge: OctoBuddyCommunicationBridge,
  initialSpaceId: string,
): () => void {
  if (typeof bridge.openFilePreview !== "function" || typeof bridge.cancelFilePreview !== "function") return () => {};
  const open = bridge.openFilePreview.bind(bridge);
  const cancel = bridge.cancelFilePreview.bind(bridge);
  let active = true;
  let spaceId = initialSpaceId;
  let revision = 0;

  const host: LayoutAttachmentHost = {
    async openFilePreview(request) {
      if (!active) return { status: "cancelled" };
      const captured = revision;
      const result = await open(request);
      return active && revision === captured ? result : { status: "cancelled" };
    },
    cancelFilePreview: cancel,
  };
  if (bridge.openFilePreviewInPlace && bridge.setFilePreviewLayout) {
    const openInPlace = bridge.openFilePreviewInPlace.bind(bridge);
    const layout = bridge.setFilePreviewLayout.bind(bridge);
    host.openFilePreviewInPlace = async (request) => {
      if (!active) return { status: "cancelled" };
      const captured = revision;
      const result = await openInPlace(request);
      return active && captured === revision ? result : { status: "cancelled" };
    };
    host.setFilePreviewLayout = (value) => active ? layout(value) : Promise.resolve();
  }
  setWebAttachmentHost(host);

  const offCommand = bridge.onCommand((command) => {
    if (!command || typeof command !== "object") return;
    if (command.type === "filePreviewState" && getWebAttachmentHost() === host) {
      let state;
      try {
        state = parseAttachmentPreviewState(command);
      } catch {
        // Malformed host events must not reach the active React surface.
        return;
      }
      notifyHostAttachmentState(state);
      return;
    }
    if (command.type === "filePreviewClosed" && getWebAttachmentHost() === host) {
      let closed;
      try {
        closed = parseAttachmentPreviewClosed(command);
      } catch {
        return;
      }
      notifyHostAttachmentClosed(closed.requestId);
      return;
    }
    if (command.type === "spaceChanged") {
      if (command.space.id === spaceId) return;
      spaceId = command.space.id;
    }
    if (command.type === "spaceChanged" || command.type === "sessionRevoked") {
      revision++;
      if (getWebAttachmentHost() === host) cancelHostAttachmentRequests();
      if (command.type === "sessionRevoked") active = false;
    }
  });

  return () => {
    active = false;
    revision++;
    offCommand();
    if (getWebAttachmentHost() === host) setWebAttachmentHost(null);
  };
}
