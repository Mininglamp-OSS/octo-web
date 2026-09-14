import {
  installDocumentPreviewTransport,
} from "@octo/base/src/Service/DocumentPreviewService";
import { resetDocPreviewCache } from "@octo/base/src/Messages/DocumentShareCard/preview";
import type { OctoBuddyCommunicationBridge } from "./hostBridge";

export function installHostDocumentPreview(
  bridge: OctoBuddyCommunicationBridge,
  initialSpaceId: string,
  capture?: () => () => boolean,
): () => void {
  if (!bridge.getDocumentPreview) return () => {};
  let revision = 0;
  let active = true;
  let disposed = false;
  let spaceId = initialSpaceId;
  const getPreview = bridge.getDocumentPreview.bind(bridge);
  const uninstall = installDocumentPreviewTransport(async (input) => {
    const captured = revision;
    const current = capture?.();
    const isActive = () => active && captured === revision && (current?.() ?? true);
    if (!isActive()) return { ok: false };
    let result;
    try {
      result = await getPreview(input);
    } catch (error) {
      if (!isActive()) return { ok: false };
      throw error;
    }
    if (!isActive()) return { ok: false };
    if (!result.ok && result.status === 401) {
      bridge.reportAuthExpired("Document preview session expired");
    }
    return result;
  });
  resetDocPreviewCache();
  // An owner supplies epoch checks and owns invalidation/disposal itself.
  const offCommand = capture ? () => {} : bridge.onCommand((command) => {
    if (command.type === "spaceChanged") {
      if (command.space.id === spaceId) return;
      spaceId = command.space.id;
    }
    if (command.type === "spaceChanged" || command.type === "sessionRevoked") {
      revision++;
      resetDocPreviewCache();
      if (command.type === "sessionRevoked") active = false;
    }
  });
  return () => {
    if (disposed) return;
    disposed = true;
    active = false;
    revision++;
    try {
      offCommand();
    } finally {
      uninstall();
      resetDocPreviewCache();
    }
  };
}
