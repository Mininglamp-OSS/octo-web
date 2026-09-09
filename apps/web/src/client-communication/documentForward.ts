import type { WKBaseContext } from "@octo/base/src/Components/WKBase";
import type { OctoBuddyCommunicationBridge } from "./hostBridge";

export function supportsDocumentForward(bridge: OctoBuddyCommunicationBridge): boolean {
  return [
    bridge.onDocumentForward, bridge.onDocumentForwardCancel, bridge.grantDocumentForward,
    bridge.authorizeDocumentForward, bridge.respondDocumentForward,
  ].every((method) => typeof method === "function");
}

/** No Docs dependency or API routes: the originating artifact owns document grants. */
export function installDocumentForward(
  bridge: OctoBuddyCommunicationBridge,
  host: { getSpaceId(): string; getContext(): WKBaseContext },
): () => void {
  if (!supportsDocumentForward(bridge)) return () => {};
  let disposed = false;
  const operations = new Map<string, () => void>();
  const offRequest = bridge.onDocumentForward!((request) => {
    let active = true;
    let closePicker: (() => void) | void;
    const isActive = () => !disposed && active && request.spaceId === host.getSpaceId();
    const respond = (response: { ok: boolean; result?: unknown; error?: string }) => {
      if (!active) return;
      active = false;
      operations.delete(request.requestId);
      bridge.respondDocumentForward!({ requestId: request.requestId, ...response });
    };
    const cancel = () => {
      if (!active) return;
      respond({ ok: true, result: null });
      closePicker?.();
    };
    operations.set(request.requestId, cancel);
    try {
      if (!isActive()) throw new Error("Document forward context expired");
      const input = request.input;
      closePicker = host.getContext().showConversationSelect(undefined, input.modalTitle, {
        messageTitle: input.title,
        link: input.link,
        shareAsCard: input.shareAsCard,
        docId: input.docId,
        spaceId: input.spaceId,
        kind: input.kind,
        ownerName: input.ownerName,
        updatedAt: input.updatedAt,
        canGrant: input.canGrant,
        disabledReason: input.disabledReason,
        defaultRole: input.defaultRole,
        isActive,
        beforeSend: async () => {
          if (!isActive()) throw new Error("Document forward context expired");
          await bridge.authorizeDocumentForward!({ requestId: request.requestId });
          if (!isActive()) throw new Error("Document forward context expired");
        },
        grantAccess: input.canGrant ? async (uids, role) => {
          if (!isActive()) throw new Error("Document forward context expired");
          const result = await bridge.grantDocumentForward!({ requestId: request.requestId, uids, role });
          if (!isActive()) throw new Error("Document forward context expired");
          return result;
        } : undefined,
        onResult: (result) => {
          if (!isActive()) respond({ ok: false, error: "Document forward context expired" });
          else respond({ ok: true, result });
        },
        onError: () => respond({ ok: false, error: "Document forwarding failed" }),
      }, cancel);
    } catch {
      respond({ ok: false, error: "Document forwarding unavailable" });
    }
  });
  const cancelAll = () => {
    for (const cancel of [...operations.values()]) cancel();
  };
  const offCancel = bridge.onDocumentForwardCancel!(({ requestId }) => operations.get(requestId)?.());
  const offCommand = bridge.onCommand((command) => {
    // Host layout changes may hide and restore the same view. The originating Docs
    // runtime owns cancellation; visibility alone must not dismiss its picker.
    if (command.type === "sessionRevoked" ||
        (command.type === "spaceChanged" && command.space.id !== host.getSpaceId())) cancelAll();
  });
  return () => {
    disposed = true;
    cancelAll();
    offRequest();
    offCancel();
    offCommand();
  };
}
