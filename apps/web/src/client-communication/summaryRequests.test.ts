import { beforeEach, describe, expect, it, vi } from "vitest";
import { installSummaryRequests } from "./summaryRequests";
import type { OctoBuddyCommunicationBridge, SummaryCapabilityRequest } from "./hostBridge";

const messaging = vi.hoisted(() => ({
  loadConversationMembers: vi.fn(async () => ["member"]),
  notifySummaryCompleted: vi.fn(async () => {}),
  requestForward: vi.fn(),
}));
vi.mock("@dmwork/summary/messaging", () => ({ legacySummaryMessagingPort: messaging }));
beforeEach(() => vi.clearAllMocks());
describe("runtime summary capabilities", () => {
  it("serves data operations without mounting UI, and waits for UI only for forwarding", async () => {
    let receive!: (request: SummaryCapabilityRequest) => void;
    const host = {
      onSummaryRequest: vi.fn(callback => { receive = callback; return () => {}; }),
      respondSummaryRequest: vi.fn(),
    };
    let ready!: () => void;
    const ensureUi = vi.fn(() => new Promise<void>(resolve => { ready = resolve; }));
    const dispose = installSummaryRequests(host as unknown as OctoBuddyCommunicationBridge, {
      capture: () => () => true, ensureUi,
    });
    receive({ requestId: "members", spaceId: "s", operation: "loadConversationMembers", payload: {} });
    await vi.waitFor(() => expect(host.respondSummaryRequest).toHaveBeenCalledWith({ requestId: "members", ok: true, result: ["member"] }));
    expect(ensureUi).not.toHaveBeenCalled();
    receive({ requestId: "forward", spaceId: "s", operation: "requestForward", payload: { content: "x" } });
    await vi.waitFor(() => expect(ensureUi).toHaveBeenCalledOnce());
    expect(messaging.requestForward).not.toHaveBeenCalled();
    ready();
    await vi.waitFor(() => expect(messaging.requestForward).toHaveBeenCalledOnce());
    const callbacks = messaging.requestForward.mock.calls[0][0];
    callbacks.onCancel();
    callbacks.onComplete({});
    expect(host.respondSummaryRequest.mock.calls.filter(([r]) => r.requestId === "forward")).toEqual([
      [{ requestId: "forward", ok: true, result: null }],
    ]);
    dispose();
  });
  it("rejects a forward that becomes stale while UI is loading", async () => {
    let receive!: (request: SummaryCapabilityRequest) => void;
    let active = true;
    let ready!: () => void;
    const host = {
      onSummaryRequest: (callback: typeof receive) => { receive = callback; return () => {}; },
      respondSummaryRequest: vi.fn(),
    };
    const ensureUi = vi.fn(() => new Promise<void>(resolve => { ready = resolve; }));
    const dispose = installSummaryRequests(host as unknown as OctoBuddyCommunicationBridge, {
      capture: () => () => active, ensureUi,
    });
    receive({ requestId: "f", spaceId: "s", operation: "requestForward", payload: {} });
    await vi.waitFor(() => expect(ensureUi).toHaveBeenCalled());
    active = false;
    ready();
    await vi.waitFor(() => expect(host.respondSummaryRequest).toHaveBeenCalledWith({
      requestId: "f", ok: false, error: "Summary request context expired",
    }));
    expect(messaging.requestForward).not.toHaveBeenCalled();
    dispose();
  });
});
