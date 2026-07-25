import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  httpGet: vi.fn(),
  ensureDirectory: vi.fn(),
}));

vi.mock("../http", () => ({
  httpGet: mocks.httpGet,
  httpPost: vi.fn(),
}));
vi.mock("../directory", () => ({ ensureDirectory: mocks.ensureDirectory }));

import { listRunMessages, listRuns } from "../runsApi";

describe("workspace-scoped run reads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.httpGet.mockResolvedValue([]);
  });

  it("scopes run lists without reading the global Loop directory", async () => {
    await listRuns("issue-1", "linked-workspace");

    expect(mocks.httpGet).toHaveBeenCalledWith(
      "/issues/issue-1/task-runs",
      undefined,
      { workspaceSlug: "linked-workspace" }
    );
    expect(mocks.ensureDirectory).not.toHaveBeenCalled();
  });

  it("scopes initial and incremental run-message reads", async () => {
    await listRunMessages("task-1", undefined, "linked-workspace");
    await listRunMessages("task-1", 12, "linked-workspace");

    expect(mocks.httpGet).toHaveBeenNthCalledWith(
      1,
      "/tasks/task-1/messages",
      { since: undefined },
      { workspaceSlug: "linked-workspace" }
    );
    expect(mocks.httpGet).toHaveBeenNthCalledWith(
      2,
      "/tasks/task-1/messages",
      { since: 12 },
      { workspaceSlug: "linked-workspace" }
    );
  });
});
