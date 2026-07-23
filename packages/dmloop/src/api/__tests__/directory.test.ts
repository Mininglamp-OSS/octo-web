import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@octo/base", () => ({
  WKApp: {
    loginInfo: { token: "token" },
    shared: {
      currentSpaceId: "space-1",
      avatarUser: vi.fn((uid: string) => `avatar:${uid}`),
    },
  },
  SpaceService: {
    shared: {
      getAllMembers: vi.fn(() => Promise.resolve([])),
    },
  },
}));

vi.mock("../http", () => ({
  currentWorkspaceId: vi.fn(() => "ws-1"),
  currentWorkspaceSlug: vi.fn(() => "alpha"),
  httpGet: vi.fn(),
}));

import {
  ensureDirectory,
  invalidateDirectory,
  listAssigneeCandidates,
  listProjectOptions,
} from "../directory";
import { httpGet } from "../http";
import {
  defaultIssueFilters,
  issueFilterOptionIds,
  reconcileIssueFilters,
} from "../../ui/issueFilterPersistence";

describe("directory", () => {
  beforeEach(() => {
    invalidateDirectory();
    vi.mocked(httpGet).mockReset();
  });

  it("keeps display fallback data but rejects authoritative candidates when a candidate source fails", async () => {
    vi.mocked(httpGet).mockImplementation((path: string) => {
      if (path === "/workspaces/ws-1/members") return Promise.reject(new Error("members failed"));
      if (path === "/agents") return Promise.resolve([{ id: "a1", name: "Agent" }]);
      if (path === "/squads") return Promise.resolve([{ id: "s1", name: "Squad" }]);
      if (path === "/projects") return Promise.resolve({ projects: [{ id: "p1", title: "Project" }] });
      return Promise.reject(new Error(`unexpected ${path}`));
    });

    const dir = await ensureDirectory();
    expect(dir.agentName.get("a1")).toBe("Agent");
    expect(dir.projectName.get("p1")).toBe("Project");
    await expect(listAssigneeCandidates()).rejects.toThrow("Assignee directory failed");
    await expect(listProjectOptions()).resolves.toEqual([{ id: "p1", title: "Project" }]);

    const persisted = {
      ...defaultIssueFilters(),
      assigneeIds: ["stored-assignee"],
      creatorIds: ["stored-creator"],
      projectIds: ["p1", "stale-project"],
    };
    const reconciled = reconcileIssueFilters(
      persisted,
      issueFilterOptionIds({
        candidates: [],
        candidatesLoaded: true,
        candidatesSucceeded: false,
        projects: await listProjectOptions(),
        projectsLoaded: true,
        projectsSucceeded: true,
        labels: [],
        labelsLoaded: false,
        labelsSucceeded: false,
      }),
      false,
    );
    expect(reconciled.assigneeIds).toEqual(["stored-assignee"]);
    expect(reconciled.creatorIds).toEqual(["stored-creator"]);
    expect(reconciled.projectIds).toEqual(["p1"]);
  });

  it("rejects authoritative project options when the project source fails", async () => {
    vi.mocked(httpGet).mockImplementation((path: string) => {
      if (path === "/workspaces/ws-1/members") return Promise.resolve([{ user_id: "m1", name: "Member" }]);
      if (path === "/agents") return Promise.resolve([]);
      if (path === "/squads") return Promise.resolve([]);
      if (path === "/projects") return Promise.reject(new Error("projects failed"));
      return Promise.reject(new Error(`unexpected ${path}`));
    });

    await expect(listAssigneeCandidates()).resolves.toEqual([
      { id: "m1", type: "member", name: "Member", octo_uid: null },
    ]);
    await expect(listProjectOptions()).rejects.toThrow("Project directory failed");
  });
});
