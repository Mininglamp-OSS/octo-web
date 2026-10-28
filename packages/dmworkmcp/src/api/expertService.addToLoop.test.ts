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
  createLoopInstallationKey,
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

  it("installs an expert through the capability endpoint with workspace/key headers", async () => {
    mock.instance.post.mockResolvedValue({
      data: { data: { agent_id: "agent-123" } },
    });

    const res = await installExpertToLoop("expert-1", {
      workspaceId: "w1",
      runtimeId: "rt1",
      idempotencyKey: "expert-operation",
    });

    expect(mock.instance.post).toHaveBeenCalledWith(
      "/market/api/v1/plugins/expert-1/installations",
      { runtime_id: "rt1" },
      {
        headers: {
          "X-Workspace-ID": "w1",
          "Idempotency-Key": "expert-operation",
        },
        timeout: 150_000,
      }
    );
    expect(res).toEqual({ agentId: "agent-123" });
  });

  it("installExpertToLoop rejects when the 2xx envelope has no agent_id", async () => {
    mock.instance.post.mockResolvedValue({ data: { data: {} } });

    await expect(
      installExpertToLoop("e1", {
        workspaceId: "w",
        runtimeId: "r",
        idempotencyKey: "key",
      })
    ).rejects.toThrow();
  });

  it("installs a team through the capability endpoint and returns squadId", async () => {
    mock.instance.post.mockResolvedValue({
      data: { data: { squad_id: "squad-123" } },
    });

    const res = await installSquadToLoop("squad-1", {
      workspaceId: "w1",
      runtimeId: "rt1",
      idempotencyKey: "team-operation",
    });

    expect(mock.instance.post).toHaveBeenCalledWith(
      "/market/api/v1/plugins/squad-1/installations",
      { runtime_id: "rt1" },
      {
        headers: {
          "X-Workspace-ID": "w1",
          "Idempotency-Key": "team-operation",
        },
        timeout: 150_000,
      }
    );
    expect(res).toEqual({ squadId: "squad-123" });
  });

  it("installSquadToLoop rejects on a missing squad_id", async () => {
    mock.instance.post.mockResolvedValue({ data: { data: {} } });

    await expect(
      installSquadToLoop("a/b c", {
        workspaceId: "w",
        runtimeId: "r",
        idempotencyKey: "key",
      })
    ).rejects.toThrow();

    expect(mock.instance.post).toHaveBeenCalledWith(
      "/market/api/v1/plugins/a%2Fb%20c/installations",
      { runtime_id: "r" },
      {
        headers: { "X-Workspace-ID": "w", "Idempotency-Key": "key" },
        timeout: 150_000,
      }
    );
  });

  it("keeps the caller's key when retrying an uncertain outcome and never falls back", async () => {
    mock.instance.post.mockRejectedValueOnce(new Error("timeout"));
    mock.instance.post.mockResolvedValueOnce({
      data: { data: { agent_id: "agent-1" } },
    });
    const options = {
      workspaceId: "workspace",
      runtimeId: "runtime",
      idempotencyKey: "stable-key",
    };
    await expect(installExpertToLoop("expert", options)).rejects.toThrow();
    await expect(installExpertToLoop("expert", options)).resolves.toEqual({
      agentId: "agent-1",
    });
    expect(mock.instance.post).toHaveBeenCalledTimes(2);
    expect(mock.instance.post.mock.calls[0]).toEqual(
      mock.instance.post.mock.calls[1]
    );
    expect(mock.instance.post.mock.calls[0][0]).toBe(
      "/market/api/v1/plugins/expert/installations"
    );
  });

  it("creates distinct printable operation keys without requiring randomUUID", () => {
    const keys = new Set(Array.from({ length: 10 }, createLoopInstallationKey));
    expect(keys.size).toBe(10);
    for (const key of keys)
      expect(key).toMatch(/^[a-f0-9]{8}(?:-[a-f0-9]{8}){3}$/);
  });

  it.each(["CONFLICT", "UPSTREAM_UNAVAILABLE"])(
    "preserves %s installation recovery guidance",
    async (code) => {
      mock.instance.post.mockRejectedValue({
        response: {
          data: {
            error: {
              code,
              message: "Installation outcome needs reconciliation.",
              hint: "Retry with the original key within 24 hours.",
            },
          },
        },
      });
      await expect(
        installExpertToLoop("expert", {
          workspaceId: "workspace",
          runtimeId: "runtime",
          idempotencyKey: "key",
        })
      ).rejects.toThrow(
        "Installation outcome needs reconciliation. Retry with the original key within 24 hours."
      );
    }
  );

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
    expect(calls.filter((u) => u === "/fleet/api/v1/workspaces")).toHaveLength(
      1
    );
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
