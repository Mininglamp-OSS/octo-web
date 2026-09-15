import type { SummaryCompletionNotice, SummaryConversationTarget } from "@dmwork/summary/messaging";
import type { OctoBuddyCommunicationBridge, SummaryCapabilityRequest } from "./hostBridge";

export function installSummaryRequests(
  bridge: OctoBuddyCommunicationBridge,
  context: {
    capture(request: SummaryCapabilityRequest): () => boolean;
    ensureUi?(): Promise<void>;
  },
): () => void {
  if (!bridge.onSummaryRequest || !bridge.respondSummaryRequest) return () => {};
  let disposed = false;
  const pending = new Set<() => void>();
  const off = bridge.onSummaryRequest((request) => {
    const current = context.capture(request);
    let responded = false;
    const isActive = () => !disposed && !responded && current();
    const respond = (response: { ok: boolean; result?: unknown; error?: string }) => {
      if (responded) return;
      const valid = isActive();
      responded = true;
      pending.delete(expire);
      bridge.respondSummaryRequest!({
        requestId: request.requestId,
        ...(valid ? response : { ok: false, error: "Summary request context expired" }),
      });
    };
    const expire = () => respond({ ok: false, error: "Summary request context expired" });
    pending.add(expire);
    const assertActive = () => {
      if (!isActive()) throw new Error("Summary request context expired");
    };
    const run = async () => {
      assertActive();
      const { legacySummaryMessagingPort } = await import("@dmwork/summary/messaging");
      assertActive();
      if (request.operation === "loadConversationMembers") {
        const result = await legacySummaryMessagingPort.loadConversationMembers(request.payload as SummaryConversationTarget);
        respond({ ok: true, result });
      } else if (request.operation === "notifySummaryCompleted") {
        await legacySummaryMessagingPort.notifySummaryCompleted(request.payload as SummaryCompletionNotice, { isActive });
        respond({ ok: true });
      } else if (request.operation === "requestForward") {
        await context.ensureUi?.();
        assertActive();
        const input = request.payload as { content?: unknown; title?: unknown };
        legacySummaryMessagingPort.requestForward({
          isActive,
          content: typeof input?.content === "string" ? input.content : "",
          title: typeof input?.title === "string" ? input.title : "",
          onComplete: (result) => respond({ ok: true, result }),
          onError: (error) => respond({ ok: false, error: error instanceof Error ? error.message : String(error) }),
          onCancel: () => respond({ ok: true, result: null }),
        });
      } else {
        throw new Error("Unsupported summary capability");
      }
    };
    void run().catch((error) => respond({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  });
  return () => {
    disposed = true;
    off();
    for (const expire of [...pending]) expire();
  };
}
