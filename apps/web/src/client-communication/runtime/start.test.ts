import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CommunicationBootstrap, OctoBuddyCommunicationBridge } from "../hostBridge";
import { startCommunicationRuntime } from "./start";
import { getDocumentPreviewBody } from "@octo/base/src/Service/DocumentPreviewService";
import type { DocumentPreviewResponse } from "@octo/base/src/Service/DocumentPreviewService";
import APIClient from "@octo/base/src/Service/APIClient";
import { resetDocPreviewCache } from "@octo/base/src/Messages/DocumentShareCard/preview";

const f = vi.hoisted(() => ({
  store: {
    retain: vi.fn(() => vi.fn()), subscribe: vi.fn(() => vi.fn()),
    getSnapshot: vi.fn(() => ({ freshness: "ready" })), refresh: vi.fn(async () => {}), dispose: vi.fn(),
  },
  unread: { getSnapshot: vi.fn(() => 12), subscribe: vi.fn(() => vi.fn()) },
  gate: { setAllowed: vi.fn(), dispose: vi.fn() },
  sdk: { disconnect: vi.fn() },
  mount: vi.fn(async () => vi.fn()),
  app: {
    shared: { currentSpaceId: "s", notifyListener: vi.fn() },
    config: {},
    apiClient: { logoutCallback: undefined as (() => void) | undefined },
    loginInfo: { logout: vi.fn() },
  },
}));
vi.mock("@octo/base", () => ({
  applyImSpaceContext: vi.fn(({ space_id }) => { f.app.shared.currentSpaceId = space_id; }),
  getCurrentImConversationStore: () => f.store,
  getCurrentImUnreadObserver: () => f.unread,
  installImReadAttentionGate: () => f.gate,
  ThemeMode: { dark: 1, light: 0 }, WKApp: f.app, i18n: { setLocale: vi.fn() },
}));
vi.mock("@octo/base/src/im-runtime/connectStatus", () => ({ isImConnected: () => true }));
vi.mock("wukongimjssdk", () => ({ WKSDK: { shared: () => f.sdk } }));
vi.mock("@dmwork/summary/src/runtime/desktopAttention", () => ({ createDesktopSummaryAttention: vi.fn() }));
vi.mock("../mountUi", () => ({ mountCommunicationUi: f.mount }));
vi.mock("@octo/base/src/Messages/DocumentShareCard/preview", () => ({ resetDocPreviewCache: vi.fn() }));

const runtime = { version: 1 as const, ownerId: "o", contextId: "c", epoch: 1, summaryAttention: "disabled" as const };
const bootstrap = {
  runtime, space: { id: "s", name: "" }, initialPage: "chat", initialPresentation: "workspace",
} as CommunicationBootstrap;
beforeEach(() => {
  vi.clearAllMocks();
  f.app.apiClient.logoutCallback = undefined;
  f.app.shared.currentSpaceId = "s";
  vi.spyOn(APIClient.shared, "get").mockResolvedValue({ fallback: true });
});
afterEach(() => vi.restoreAllMocks());
function hostFixture() {
  let command!: (command: unknown) => void;
  const legacy = new Set<(command: unknown) => void>();
  const host = {
    reportRuntimeReady: vi.fn(async () => {}),
    reportRuntimeSnapshot: vi.fn(),
    reportRuntimeCommandResult: vi.fn(),
    reportAuthExpired: vi.fn(),
    getDocumentPreview: vi.fn(async (): Promise<DocumentPreviewResponse> => ({ ok: true, body: {} })),
    onRuntimeCommand: vi.fn(fn => { command = fn; return vi.fn(); }),
    onCommand: vi.fn(fn => { legacy.add(fn); return vi.fn(() => { legacy.delete(fn); }); }),
  };
  return { host: host as unknown as OctoBuddyCommunicationBridge, methods: host,
    send: (payload: object) => command({ version: 1, ownerId: "o", contextId: "c", epoch: 1, ...payload }),
    legacy: (payload: object) => { for (const listener of legacy) listener(payload); },
    listenerCount: () => legacy.size,
  };
}
describe("communication runtime composition", () => {
  it("holds shared data with no UI, ignores unscoped navigation, then mounts the same owner", async () => {
    const h = hostFixture();
    const owner = await startCommunicationRuntime(h.host, bootstrap);
    expect(f.store.retain).toHaveBeenCalledOnce();
    expect(f.unread.subscribe).toHaveBeenCalledOnce();
    expect(f.mount).not.toHaveBeenCalled();
    expect(h.methods.reportRuntimeSnapshot).toHaveBeenLastCalledWith(expect.objectContaining({
      badges: { messages: { status: "ready", count: 12 }, summary: { status: "unavailable", count: null } },
    }));
    h.legacy({ type: "navigate", page: "chat" });
    expect(f.mount).not.toHaveBeenCalled();
    h.send({ type: "navigate", page: "contacts" });
    await vi.waitFor(() => expect(f.mount).toHaveBeenCalledOnce());
    h.send({ type: "navigate", page: "chat" });
    await Promise.resolve();
    expect(f.mount).toHaveBeenCalledOnce();
    expect(f.store.retain).toHaveBeenCalledOnce();
    owner.dispose();
    expect(f.sdk.disconnect).toHaveBeenCalledOnce();
    expect(f.gate.dispose).toHaveBeenCalledOnce();
  });
  it("releases runtime on authentication expiry and restores the auth callback", async () => {
    const previous = vi.fn();
    f.app.apiClient.logoutCallback = previous;
    const h = hostFixture();
    await startCommunicationRuntime(h.host, bootstrap);
    f.app.apiClient.logoutCallback!();
    expect(f.sdk.disconnect).toHaveBeenCalledOnce();
    expect(f.app.apiClient.logoutCallback).toBe(previous);
    expect(previous).toHaveBeenCalledOnce();
    h.send({ type: "navigate", page: "chat" });
    expect(f.mount).not.toHaveBeenCalled();
  });
  it("fails before acquiring data when runtime bridge is incomplete", async () => {
    await expect(startCommunicationRuntime({} as OctoBuddyCommunicationBridge, bootstrap)).rejects.toThrow("protocol");
    expect(f.store.retain).not.toHaveBeenCalled();
  });
  it("requires and forwards the runtime command result port", async () => {
    const h = hostFixture();
    const missingPort = await startCommunicationRuntime({ ...h.host, reportRuntimeCommandResult: undefined }, bootstrap)
      .then(owner => { owner.dispose(); return undefined; }, error => error);
    expect(missingPort).toBeInstanceOf(Error);
    expect(missingPort.message).toContain("protocol");
    expect(f.store.retain).not.toHaveBeenCalled();
    const owner = await startCommunicationRuntime(h.host, bootstrap);
    try {
      h.send({ type: "invalidateSummary", requestId: "refresh", reason: "mutation" });
      expect(h.methods.reportRuntimeCommandResult).toHaveBeenCalledWith({
        version: 1, ownerId: "o", contextId: "c", epoch: 1, requestId: "refresh", accepted: false,
      });
    } finally { owner.dispose(); }
  });

  it.each(["switch", "roundtrip", "dispose", "revoke"] as const)(
    "rejects the old preview 401 after owner %s without expiring current auth", async (transition) => {
      const h = hostFixture();
      const owner = await startCommunicationRuntime(h.host, bootstrap);
      let finish!: (result: DocumentPreviewResponse) => void;
      h.methods.getDocumentPreview.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
      try {
        const pending = getDocumentPreviewBody({ docId: "d", kind: "doc" }, "s")
          .then(body => ({ body }), error => ({ error }));
        expect(h.methods.getDocumentPreview).toHaveBeenCalledOnce();
        if (transition === "dispose") owner.dispose();
        else if (transition === "revoke") h.legacy({ type: "sessionRevoked" });
        else {
          h.send({ type: "spaceChanged", next: { contextId: "b", epoch: 2, space: { id: "b", name: "B" } } });
          if (transition === "roundtrip") {
            h.send({ type: "spaceChanged", contextId: "b", epoch: 2,
              next: { contextId: "a2", epoch: 3, space: { id: "s", name: "A" } } });
          }
        }
        expect(resetDocPreviewCache).toHaveBeenCalledTimes(transition === "roundtrip" ? 3 : 2);
        finish({ ok: false, status: 401 });
        expect(await pending).toMatchObject({ error: { status: undefined } });
        expect(h.methods.reportAuthExpired).not.toHaveBeenCalled();
        expect(f.mount).not.toHaveBeenCalled();
        if (transition !== "dispose" && transition !== "revoke") {
          h.methods.getDocumentPreview.mockResolvedValueOnce({ ok: false, status: 401 });
          await expect(getDocumentPreviewBody({ docId: "current", kind: "doc" }, "")).rejects.toMatchObject({ status: 401 });
          expect(h.methods.reportAuthExpired).toHaveBeenCalledOnce();
        }
      } finally { owner.dispose(); }
    },
  );

  it("unregisters preview and listeners on dispose, then installs a fresh owner", async () => {
    const http = vi.spyOn(APIClient.shared, "get").mockResolvedValue({ fallback: true });
    const h = hostFixture();
    const owner = await startCommunicationRuntime(h.host, bootstrap);
    await getDocumentPreviewBody({ docId: "d", kind: "doc" }, "");
    owner.dispose();
    owner.dispose();
    expect(h.listenerCount()).toBe(0);
    expect(resetDocPreviewCache).toHaveBeenCalledTimes(2);
    await expect(getDocumentPreviewBody({ docId: "d", kind: "doc" }, "")).resolves.toEqual({ fallback: true });
    expect(h.methods.getDocumentPreview).toHaveBeenCalledOnce();
    const next = hostFixture();
    const restarted = await startCommunicationRuntime(next.host, bootstrap);
    try {
      owner.dispose();
      await getDocumentPreviewBody({ docId: "d", kind: "doc" }, "");
      expect(next.methods.getDocumentPreview).toHaveBeenCalledOnce();
      expect(http).toHaveBeenCalledOnce();
    } finally { restarted.dispose(); }
  });

  it("unregisters preview and listeners if runtime startup fails", async () => {
    const h = hostFixture();
    h.methods.reportRuntimeReady.mockRejectedValueOnce(new Error("startup failed"));
    await expect(startCommunicationRuntime(h.host, bootstrap)).rejects.toThrow("startup failed");
    expect(h.listenerCount()).toBe(0);
    expect(resetDocPreviewCache).toHaveBeenCalledTimes(2);
    await expect(getDocumentPreviewBody({ docId: "d", kind: "doc" }, "")).resolves.toEqual({ fallback: true });
    expect(h.methods.getDocumentPreview).not.toHaveBeenCalled();
  });
});
