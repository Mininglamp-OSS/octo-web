import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Issue } from "../types";

const { httpGet } = vi.hoisted(() => ({ httpGet: vi.fn() }));
vi.mock("../http", () => ({ httpGet }));

import { getIssuePreview } from "../issuePreviewApi";

const issue: Issue = {
  id: "issue-4",
  workspace_id: "workspace-1",
  number: 4,
  identifier: "WS-4",
  title: "Webhook preview",
  description: "detail",
  status: "in_progress",
  priority: "low",
  assignee_type: "agent",
  assignee_id: "agent-1",
  creator_type: "member",
  creator_id: "octo-creator-1",
  project_id: "project-1",
  position: 1,
  created_at: "2026-07-21T00:00:00Z",
  updated_at: "2026-07-21T01:00:00Z",
};

describe("getIssuePreview", () => {
  beforeEach(() => {
    httpGet.mockReset();
    httpGet.mockImplementation((path: string) => {
      if (path === "/workspaces") {
        return Promise.resolve([
          { id: "workspace-1", slug: "1", name: "Workspace" },
        ]);
      }
      if (path === "/issues/WS-4") return Promise.resolve(issue);
      if (path === "/workspaces/workspace-1/members") {
        return Promise.resolve([
          {
            user_id: "member-1",
            octo_uid: "octo-creator-1",
            name: "Creator",
          },
        ]);
      }
      if (path === "/agents") {
        return Promise.resolve([{ id: "agent-1", name: "Expert" }]);
      }
      if (path === "/squads") return Promise.resolve([]);
      if (path === "/projects") {
        return Promise.resolve({
          projects: [{ id: "project-1", title: "Project" }],
        });
      }
      if (path.endsWith("/children")) return Promise.resolve({ issues: [] });
      if (path.endsWith("/comments")) return Promise.resolve([]);
      if (path.endsWith("/timeline")) return Promise.resolve([]);
      if (path.endsWith("/task-runs")) return Promise.resolve([]);
      throw new Error(`unexpected path: ${path}`);
    });
  });

  it("loads and enriches a task without changing global workspace context", async () => {
    const resolveMemberName = vi.fn().mockResolvedValue("Octo Creator");
    const result = await getIssuePreview(
      "1",
      "WS-4",
      resolveMemberName
    );

    expect(result?.issue).toMatchObject({
      identifier: "WS-4",
      assignee_name: "Expert",
      creator_name: "Octo Creator",
      project_name: "Project",
    });
    expect(resolveMemberName).toHaveBeenCalledTimes(1);
    expect(resolveMemberName).toHaveBeenCalledWith("octo-creator-1");
    const scopedCalls = httpGet.mock.calls.filter(
      ([path]) => path !== "/workspaces"
    );
    expect(scopedCalls.length).toBeGreaterThan(0);
    for (const call of scopedCalls) {
      expect(call[2]).toEqual({ workspaceSlug: "1" });
    }
  });

  it("returns null when the linked workspace is not visible", async () => {
    expect(await getIssuePreview("missing", "WS-4")).toBeNull();
    expect(httpGet).toHaveBeenCalledTimes(1);
  });

  it("resolves an old raw Octo creator uid without loading the full roster", async () => {
    httpGet.mockImplementation((path: string) => {
      if (path === "/workspaces") {
        return Promise.resolve([
          { id: "workspace-1", slug: "1", name: "Workspace" },
        ]);
      }
      if (path === "/issues/WS-4") {
        return Promise.resolve({
          ...issue,
          creator_id: "removed-octo-user",
          assignee_type: null,
          assignee_id: null,
        });
      }
      if (path === "/workspaces/workspace-1/members") return Promise.resolve([]);
      if (path === "/agents" || path === "/squads") return Promise.resolve([]);
      if (path === "/projects") return Promise.resolve({ projects: [] });
      if (path.endsWith("/children")) return Promise.resolve({ issues: [] });
      if (path.endsWith("/comments") || path.endsWith("/timeline") || path.endsWith("/task-runs")) {
        return Promise.resolve([]);
      }
      throw new Error(`unexpected path: ${path}`);
    });
    const resolveMemberName = vi.fn().mockResolvedValue("Former Member");

    const result = await getIssuePreview("1", "WS-4", resolveMemberName);

    expect(result?.issue.creator_name).toBe("Former Member");
    expect(resolveMemberName).toHaveBeenCalledOnce();
    expect(resolveMemberName).toHaveBeenCalledWith("removed-octo-user");
  });
});
