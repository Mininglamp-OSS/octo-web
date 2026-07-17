import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock the HTTP layer so the test asserts the request contract without loading
// axios / @octo/base. runtimeApi imports httpGet/httpPatch/currentWorkspaceSlug.
vi.mock("../http", () => ({
  httpGet: vi.fn(),
  httpPatch: vi.fn(),
  currentWorkspaceSlug: vi.fn(() => "ws-slug"),
}));

import { renameMachine } from "../runtimeApi";
import { httpPatch } from "../http";

describe("renameMachine", () => {
  beforeEach(() => {
    vi.mocked(httpPatch).mockReset();
    vi.mocked(httpPatch).mockResolvedValue({} as never);
  });

  it("PATCHes /runtimes/:id with custom_name and apply_to_machine=true", async () => {
    await renameMachine("rt-123", "王登的开发机");
    expect(httpPatch).toHaveBeenCalledWith("/runtimes/rt-123", {
      custom_name: "王登的开发机",
      apply_to_machine: true,
    });
  });

  it("forwards an empty name verbatim (backend treats empty as clear)", async () => {
    await renameMachine("rt-9", "");
    expect(httpPatch).toHaveBeenCalledWith("/runtimes/rt-9", {
      custom_name: "",
      apply_to_machine: true,
    });
  });
});
