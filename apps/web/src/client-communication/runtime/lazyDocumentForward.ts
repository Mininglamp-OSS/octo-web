import type { DocumentForwardRequest, OctoBuddyCommunicationBridge } from "../hostBridge";
import type { RuntimeScope } from "../../client-feature/runtimeContract";
import { supportsDocumentForward } from "../documentForward";

export function installLazyDocumentForward(
  host: OctoBuddyCommunicationBridge,
  owner: { isCurrent(scope: RuntimeScope): boolean },
  ensureUi: () => Promise<void>,
) {
  const listeners = new Set<(request: DocumentForwardRequest) => void>();
  const waiting = new Map<string, DocumentForwardRequest>();
  let disposed = false;
  const fail = (request: DocumentForwardRequest, cancelled = false) => {
    host.respondDocumentForward?.({
      requestId: request.requestId,
      ...(cancelled ? { ok: true, result: null } : { ok: false, error: "Document forward context expired" }),
    });
  };
  const off = supportsDocumentForward(host) ? host.onDocumentForward!(request => {
    if (disposed || !request.runtimeScope || !owner.isCurrent(request.runtimeScope)) {
      fail(request);
      return;
    }
    if (waiting.has(request.requestId)) return;
    waiting.set(request.requestId, request);
    void ensureUi().then(() => {
      if (!waiting.delete(request.requestId)) return;
      if (disposed || !owner.isCurrent(request.runtimeScope!) || !listeners.size) {
        fail(request);
        return;
      }
      for (const listener of [...listeners]) listener(request);
    }).catch(() => {
      if (waiting.delete(request.requestId)) fail(request);
    });
  }) : () => {};
  const offCancel = host.onDocumentForwardCancel?.(({ requestId }) => {
    const request = waiting.get(requestId);
    if (!request) return;
    waiting.delete(requestId);
    fail(request, true);
  });
  return {
    subscribe(listener: (request: DocumentForwardRequest) => void): () => void {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    invalidate(): void {
      for (const request of waiting.values()) fail(request);
      waiting.clear();
    },
    dispose(): void {
      disposed = true;
      off();
      offCancel?.();
      this.invalidate();
      listeners.clear();
    },
  };
}
