import { describe, expect, it, vi, beforeEach } from "vitest";

// expertService creates its own axios instance at module load and unwraps the
// `{data:...}` envelope. Mock axios so we can pin the exact request shape (URL /
// method / body / query) and the wire→TS mapping without a real backend.
const mock = vi.hoisted(() => ({
  instance: {
    interceptors: { request: { use: () => {} }, response: { use: () => {} } },
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
    shared: { currentSpaceId: "sp", logout: () => {} },
  },
  buildAcceptLanguage: () => "en-US",
  t: (key: string) => key,
  DEFAULT_REQUEST_TIMEOUT_MS: 20000,
}));

import {
  installExpertToLoop,
  listLoopRuntimes,
  listLoopWorkspaces,
} from "./expertService";

describe("expertService add-to-loop wire contract", () => {
  beforeEach(() => {
    mock.instance.get.mockReset();
    mock.instance.post.mockReset();
  });

  it("listLoopWorkspaces GETs /fleet/api/workspaces and maps the wire", async () => {
    mock.instance.get.mockResolvedValue({
      data: [{ id: "w1", name: "Workspace One" }],
    });

    const res = await listLoopWorkspaces();

    expect(mock.instance.get).toHaveBeenCalledWith("/fleet/api/workspaces", {
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

  it("listLoopRuntimes passes workspace_id as a query param and maps status", async () => {
    mock.instance.get.mockResolvedValue({
      data: [{ id: "rt1", name: "Runtime One", status: "online" }],
    });

    const res = await listLoopRuntimes("w1");

    expect(mock.instance.get).toHaveBeenCalledWith("/fleet/api/runtimes", {
      params: { workspace_id: "w1" },
    });
    expect(res).toEqual([{ id: "rt1", name: "Runtime One", status: "online" }]);
  });

  it("installExpertToLoop POSTs /experts/{id}/install with snake_case body and returns agentId", async () => {
    mock.instance.post.mockResolvedValue({
      data: { data: { agent_id: "agent-123" } },
    });

    const res = await installExpertToLoop("expert-1", {
      workspaceId: "w1",
      runtimeId: "rt1",
    });

    expect(mock.instance.post).toHaveBeenCalledWith(
      "/market/api/v1/experts/expert-1/install",
      { workspace_id: "w1", runtime_id: "rt1" }
    );
    expect(res).toEqual({ agentId: "agent-123" });
  });

  it("installExpertToLoop URL-encodes the expert id", async () => {
    mock.instance.post.mockResolvedValue({ data: { data: {} } });

    await installExpertToLoop("a/b c", { workspaceId: "w", runtimeId: "r" });

    expect(mock.instance.post).toHaveBeenCalledWith(
      "/market/api/v1/experts/a%2Fb%20c/install",
      { workspace_id: "w", runtime_id: "r" }
    );
  });
});
