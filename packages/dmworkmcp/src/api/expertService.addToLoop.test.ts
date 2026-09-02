import { describe, expect, it, vi, beforeEach } from "vitest";

// expertService creates its own axios instance at module load and unwraps the
// `{data:...}` envelope. Mock axios so we can pin the exact request shape (URL /
// method / body / query) and the wire→TS mapping without a real backend.
const mock = vi.hoisted(() => ({
  logout: vi.fn(),
  responseOnRejected: undefined as
    | ((err: unknown) => Promise<unknown>)
    | undefined,
  instance: {
    interceptors: {
      request: { use: () => {} },
      response: {
        // Capture the rejection handler so a test can drive the 401 logic
        // directly (the real interceptor is what decides whether a 401 tears
        // down the session).
        use: (
          _onFulfilled: unknown,
          onRejected: (err: unknown) => Promise<unknown>
        ) => {
          mock.responseOnRejected = onRejected;
        },
      },
    },
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock("axios", () => ({
  default: {
    create: () => mock.instance,
    isCancel: () => false,
  },
}));

vi.mock("@octo/base", () => ({
  WKApp: {
    loginInfo: { token: "tok" },
    shared: { currentSpaceId: "sp", logout: mock.logout },
  },
  buildAcceptLanguage: () => "en-US",
  t: (key: string) => key,
  DEFAULT_REQUEST_TIMEOUT_MS: 20000,
}));

import {
  clearLoopCache,
  getLoopRuntimes,
  getLoopWorkspaces,
  installExpertToLoop,
  installSquadToLoop,
  listLoopRuntimes,
  listLoopWorkspaces,
  prefetchLoopTargets,
} from "./expertService";

describe("expertService add-to-loop wire contract", () => {
  beforeEach(() => {
    mock.instance.get.mockReset();
    mock.instance.post.mockReset();
    mock.logout.mockReset();
    // The cached getters keep module-level state across tests; reset it so each
    // case starts cold.
    clearLoopCache();
  });

  it("listLoopWorkspaces GETs /fleet/api/v1/workspaces and maps the wire", async () => {
    mock.instance.get.mockResolvedValue({
      data: [{ id: "w1", name: "Workspace One" }],
    });

    const res = await listLoopWorkspaces();

    expect(mock.instance.get).toHaveBeenCalledWith("/fleet/api/v1/workspaces", {
      params: undefined,
    });
    expect(res).toEqual([{ id: "w1", name: "Workspace One" }]);
  });

  it("listLoopWorkspaces falls back to the id when name is missing, and tolerates null data", async () => {
    mock.instance.get.mockResolvedValueOnce({
      data: [{ id: "w2" }],
    });
    expect(await listLoopWorkspaces()).toEqual([{ id: "w2", name: "w2" }]);

    mock.instance.get.mockResolvedValueOnce({ data: null });
    expect(await listLoopWorkspaces()).toEqual([]);
  });

  it("fleet getters fail loud on a non-array payload instead of coercing to []", async () => {
    // A routing miss (no /fleet/api location in prod nginx) answers the SPA
    // fallback: 200 text/html whose body axios leaves as a string. That must
    // reject — an empty list here is indistinguishable from the user genuinely
    // having no workspaces, which is exactly how the install flow shipped
    // silently dead. Pins the fix for PR #1367's P1.
    mock.instance.get.mockResolvedValueOnce({
      data: "<!doctype html><html><head></head><body></body></html>",
    });
    await expect(listLoopWorkspaces()).rejects.toThrow(
      "mcp.expert.loopBadResponse"
    );

    // Same for an unexpected envelope object on the runtimes side.
    mock.instance.get.mockResolvedValueOnce({
      data: { data: [{ id: "rt1" }] },
    });
    await expect(listLoopRuntimes("w1")).rejects.toThrow(
      "mcp.expert.loopBadResponse"
    );
  });

  it("getLoopWorkspaces does not cache a bad-payload rejection", async () => {
    mock.instance.get.mockResolvedValueOnce({ data: "<!doctype html>" });
    await expect(getLoopWorkspaces()).rejects.toThrow();
    // The rejected promise must be evicted so a later open can retry and
    // succeed (e.g. after ops fixes the routing).
    mock.instance.get.mockResolvedValueOnce({ data: [{ id: "w1" }] });
    expect(await getLoopWorkspaces()).toEqual([{ id: "w1", name: "w1" }]);
  });

  it("listLoopRuntimes passes workspace_id as a query param and maps status", async () => {
    mock.instance.get.mockResolvedValue({
      data: [{ id: "rt1", name: "Runtime One", status: "online" }],
    });

    const res = await listLoopRuntimes("w1");

    expect(mock.instance.get).toHaveBeenCalledWith("/fleet/api/v1/runtimes", {
      params: { workspace_id: "w1" },
    });
    expect(res).toEqual([{ id: "rt1", name: "Runtime One", status: "online" }]);
  });

  it("installExpertToLoop POSTs /plugins/install with the plugin id and returns agentId", async () => {
    mock.instance.post.mockResolvedValue({
      data: { data: { agent_id: "agent-123" } },
    });

    const res = await installExpertToLoop("expert-1", {
      workspaceId: "w1",
      runtimeId: "rt1",
    });

    expect(mock.instance.post).toHaveBeenCalledWith(
      "/market/api/v1/plugins/install",
      { plugin_id: "expert-1", workspace_id: "w1", runtime_id: "rt1" }
    );
    expect(res).toEqual({ agentId: "agent-123" });
  });

  it("installExpertToLoop rejects when the 2xx envelope has no agent_id", async () => {
    mock.instance.post.mockResolvedValue({ data: { data: {} } });

    await expect(
      installExpertToLoop("e1", { workspaceId: "w", runtimeId: "r" })
    ).rejects.toThrow();
  });

  it("installSquadToLoop POSTs /plugins/install with the plugin id and returns squadId", async () => {
    mock.instance.post.mockResolvedValue({
      data: { data: { squad_id: "squad-123" } },
    });

    const res = await installSquadToLoop("squad-1", {
      workspaceId: "w1",
      runtimeId: "rt1",
    });

    expect(mock.instance.post).toHaveBeenCalledWith(
      "/market/api/v1/plugins/install",
      { plugin_id: "squad-1", workspace_id: "w1", runtime_id: "rt1" }
    );
    expect(res).toEqual({ squadId: "squad-123" });
  });

  it("installSquadToLoop rejects on a missing squad_id", async () => {
    mock.instance.post.mockResolvedValue({ data: { data: {} } });

    await expect(
      installSquadToLoop("a/b c", { workspaceId: "w", runtimeId: "r" })
    ).rejects.toThrow();

    expect(mock.instance.post).toHaveBeenCalledWith(
      "/market/api/v1/plugins/install",
      { plugin_id: "a/b c", workspace_id: "w", runtime_id: "r" }
    );
  });

  it("getLoopWorkspaces caches within a Space and refetches after clearLoopCache", async () => {
    mock.instance.get.mockResolvedValue({ data: [{ id: "w1", name: "W1" }] });

    const first = await getLoopWorkspaces();
    const second = await getLoopWorkspaces();

    expect(first).toEqual([{ id: "w1", name: "W1" }]);
    expect(second).toBe(first); // served from cache, not refetched
    expect(mock.instance.get).toHaveBeenCalledTimes(1);

    clearLoopCache();
    await getLoopWorkspaces();
    expect(mock.instance.get).toHaveBeenCalledTimes(2);
  });

  it("getLoopRuntimes caches per workspace", async () => {
    mock.instance.get.mockResolvedValue({ data: [{ id: "rt1", name: "RT1" }] });

    await getLoopRuntimes("w1");
    await getLoopRuntimes("w1");
    expect(mock.instance.get).toHaveBeenCalledTimes(1);

    await getLoopRuntimes("w2"); // a different workspace is a distinct fetch
    expect(mock.instance.get).toHaveBeenCalledTimes(2);
  });

  it("prefetchLoopTargets warms workspaces + the first workspace's runtimes", async () => {
    mock.instance.get.mockImplementation((url: string) =>
      url === "/fleet/api/v1/workspaces"
        ? Promise.resolve({ data: [{ id: "w1", name: "W1" }] })
        : Promise.resolve({ data: [{ id: "rt1", name: "RT1" }] })
    );

    prefetchLoopTargets();
    // Both reads are now served from the warmed cache (no extra requests).
    await getLoopWorkspaces();
    await getLoopRuntimes("w1");

    const calls = mock.instance.get.mock.calls.map((c: unknown[]) => c[0]);
    expect(calls.filter((u) => u === "/fleet/api/v1/workspaces")).toHaveLength(1);
    expect(calls.filter((u) => u === "/fleet/api/v1/runtimes")).toHaveLength(1);
  });

  it("logs out on a marketplace 401 but NOT on a fleet 401", async () => {
    const onRejected = mock.responseOnRejected;
    expect(typeof onRejected).toBe("function");

    // A marketplace 401 means the session itself is invalid → tear it down.
    await expect(
      onRejected!({
        config: { url: "/market/api/v1/experts" },
        response: { status: 401 },
      })
    ).rejects.toBeTruthy();
    expect(mock.logout).toHaveBeenCalledTimes(1);

    mock.logout.mockClear();

    // A fleet 401 (secondary service, reached via a different gateway path) must
    // NOT log the user out — otherwise the mount-time prefetch could silently
    // end the session on a fleet-only auth hiccup.
    await expect(
      onRejected!({
        config: { url: "/fleet/api/v1/workspaces" },
        response: { status: 401 },
      })
    ).rejects.toBeTruthy();
    expect(mock.logout).not.toHaveBeenCalled();

    // The fire-and-forget view beacon is exempt too: a 401 on it must never
    // tear down the session.
    await expect(
      onRejected!({
        config: { url: "/market/api/v1/metrics/track" },
        response: { status: 401 },
      })
    ).rejects.toBeTruthy();
    expect(mock.logout).not.toHaveBeenCalled();

    // The exemption is an exact pathname match — a marketplace URL that merely
    // ENDS in the beacon suffix is not the beacon and must still log out.
    await expect(
      onRejected!({
        config: { url: "/market/api/v1/other/metrics/track" },
        response: { status: 401 },
      })
    ).rejects.toBeTruthy();
    expect(mock.logout).toHaveBeenCalledTimes(1);
  });
});
