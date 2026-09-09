import {
  installDocumentPreviewTransport,
} from "@octo/base/src/Service/DocumentPreviewService";
import { resetDocPreviewCache } from "@octo/base/src/Messages/DocumentShareCard/preview";
import type { OctoBuddyCommunicationBridge } from "./hostBridge";

export function installHostDocumentPreview(
  bridge: OctoBuddyCommunicationBridge,
  initialSpaceId: string,
): () => void {
  if (!bridge.getDocumentPreview) return () => {};
  let revision = 0;
  let active = true;
  let spaceId = initialSpaceId;
  const getPreview = bridge.getDocumentPreview.bind(bridge);
  const uninstall = installDocumentPreviewTransport(async (input) => {
    if (!active) return { ok: false };
    const captured = revision;
    const result = await getPreview(input);
    if (!active || captured !== revision) return { ok: false };
    if (!result.ok && result.status === 401) {
      bridge.reportAuthExpired("Document preview session expired");
    }
    return result;
  });
  resetDocPreviewCache();
  const offCommand = bridge.onCommand((command) => {
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
    active = false;
    revision++;
    offCommand();
    uninstall();
    resetDocPreviewCache();
  };
}
