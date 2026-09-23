import { beforeEach, describe, expect, it, vi } from "vitest";
import APIClient from "../APIClient";
import WorkspaceGroupService, { type WorkspaceGroupReadScope } from "../WorkspaceGroupService";

vi.mock("../APIClient", () => ({ default: { shared: { get: vi.fn() } } }));

const target = { channelId: "group-1", channelType: 2 as const };
const get = vi.mocked(APIClient.shared.get);
let group: Record<string, unknown>;
let relation: Record<string, unknown>;
let workspace: Record<string, unknown>;
let user: Record<string, unknown>;
let scope: WorkspaceGroupReadScope;
const resolve = () => WorkspaceGroupService.getContext(target, scope);

describe("WorkspaceGroupService Web reads", () => {
  beforeEach(() => {
    group = { group_no: "group-1", name: "Group", space_id: "space-1", project_id: "project-1", role: 1 };
    // This is the server's restricted GroupProjectRelation projection.
    relation = { group_no: "group-1", name: "Group", project_id: "project-1", linked_by: "user-2" };
    workspace = { project_id: "project-1", space_id: "space-1", name: "Workspace", role: "member" };
    user = { uid: "user-2", name: "Linking actor" };
    scope = { spaceId: "space-1", signal: new AbortController().signal, assertCurrent: vi.fn() };
    get.mockReset().mockImplementation(async path => {
      if (path === "groups/group-1") return group;
      if (path === "groups/group-1/project") return relation;
      if (path === "projects/project-1") return workspace;
      if (path === "users/user-2?group_no=group-1") return user;
      throw new Error(`Unexpected request: ${path}`);
    });
  });

  it("queries relation, workspace and actor through Web APIClient with an explicit Space", async () => {
    expect(await resolve()).toEqual({
      ...target, projectId: "project-1", projectName: "Workspace", groupName: "Group",
      linkedBy: "user-2", linkedByName: "Linking actor", linkedAt: "", source: "unknown",
      canOpen: true, canManage: true, isAllMemberGroup: false,
    });
    expect(get.mock.calls.map(([path, config]) => [path, config?.headers, config?.timeout])).toEqual([
      ["groups/group-1", { "X-Space-Id": "space-1" }, 5000],
      ["groups/group-1/project", { "X-Space-Id": "space-1", "X-Workspace-ID": "project-1" }, 5000],
      ["projects/project-1", { "X-Space-Id": "space-1", "X-Workspace-ID": "project-1" }, 5000],
      ["users/user-2?group_no=group-1", { "X-Space-Id": "space-1" }, 1500],
    ]);
    expect(get.mock.calls.every(([, config]) => config?.signal === scope.signal)).toBe(true);
  });

  it("unwraps nested data/entity envelopes and camel-case metadata", async () => {
    group = { data: { group } };
    relation = { data: { relation: {
      groupNo: "group-1", projectId: "project-1", linkedBy: "user-3", linkedByName: "Recorded actor",
      projectLinkSource: "created_in_project", linkedAt: "2026-08-15",
    } } };
    workspace = { data: { workspace } };
    expect(await resolve()).toMatchObject({
      projectName: "Workspace", linkedBy: "user-3", linkedByName: "Recorded actor", source: "created_in_project",
      linkedAt: "2026-08-15", canManage: true,
    });
    expect(get).toHaveBeenCalledTimes(3);
  });

  it.each(["", null])("treats an explicit empty project (%s) as unlinked", async projectId => {
    relation.project_id = projectId;
    expect(await resolve()).toBeNull();
    expect(get).toHaveBeenCalledTimes(2);
  });

  it.each([{}, { data: {} }, { group_no: "group-1" }, { group_no: "other", project_id: "project-1" }])(
    "does not turn a malformed relation into an authoritative unlinked result: %j", async data => {
      relation = data;
      await expect(resolve()).rejects.toThrow("Invalid workspace relation response");
    },
  );

  it.each(["", " \n "])("does not display an empty workspace name: %j", async name => {
    workspace.name = name;
    await expect(resolve()).rejects.toThrow("Workspace name unavailable");
  });

  it("uses a verified relation name when workspace detail is inaccessible", async () => {
    relation.project_name = "Recorded workspace";
    get.mockImplementation(async path => {
      if (path === "groups/group-1") return group;
      if (path === "groups/group-1/project") return relation;
      throw { status: 403 };
    });
    expect(await resolve()).toMatchObject({
      projectName: "Recorded workspace", linkedByName: "", canOpen: false, canManage: false,
      manageDisabledReason: "unavailable",
    });
  });

  it.each([{ project_id: "other" }, { space_id: "other" }])("never displays unrelated workspace metadata: %j", async identity => {
    relation.project_name = "Recorded workspace";
    workspace = { ...workspace, ...identity, name: "Unrelated secret", all_member_group_no: "group-1" };
    expect(await resolve()).toMatchObject({
      projectName: "Recorded workspace", canOpen: false, canManage: false, isAllMemberGroup: false,
    });
  });

  it.each([
    ["group-1", { status: 403 }], ["group-1/project", { normalized: { httpStatus: 404 } }],
  ])("hides inaccessible membership/relation responses", async (path, error) => {
    get.mockImplementation(async input => {
      if (input === `groups/${path}`) throw error;
      return group;
    });
    expect(await resolve()).toBeNull();
  });

  it("keeps network and server failures retryable", async () => {
    for (const error of [new Error("network"), { status: 500 }, { status: 429 }]) {
      get.mockRejectedValueOnce(error);
      await expect(resolve()).rejects.toBe(error);
    }
  });

  it.each([
    { role: 0 }, { is_member: false }, { can_read: false }, { space_id: "other" },
  ])("fails closed for group membership and scope: %j", async overrides => {
    Object.assign(group, overrides);
    const result = await resolve();
    if ("role" in overrides) expect(result).toMatchObject({ canOpen: true, canManage: false });
    else expect(result).toBeNull();
  });

  it.each([
    { is_member: false }, { can_read: false }, { role: "viewer" }, { role: undefined },
  ])("requires workspace membership as well as group management: %j", async overrides => {
    Object.assign(workspace, overrides);
    expect(await resolve()).toMatchObject({ canManage: false, manageDisabledReason: "workspace_membership" });
  });

  it("respects explicit management denial and system groups", async () => {
    relation.can_manage = false;
    expect(await resolve()).toMatchObject({ canManage: false, manageDisabledReason: "denied" });
    delete relation.can_manage;
    workspace.all_member_group_no = "group-1";
    expect(await resolve()).toMatchObject({ canManage: false, isAllMemberGroup: true, manageDisabledReason: "system_group" });
  });

  it("does not hide the workspace if the optional actor lookup fails or returns the wrong user", async () => {
    user = { uid: "other", name: "Not the actor" };
    expect(await resolve()).toMatchObject({ projectName: "Workspace", linkedByName: "" });
    get.mockImplementation(async path => {
      if (path === "groups/group-1") return group;
      if (path === "groups/group-1/project") return relation;
      if (path === "projects/project-1") return workspace;
      throw new Error("Profile lookup timeout");
    });
    expect(await resolve()).toMatchObject({ projectName: "Workspace", linkedByName: "" });
  });

  it("does not invent missing historical metadata from group ownership or creation time", async () => {
    relation.linked_by = null;
    group.owner_name = "Not the actor";
    group.created_at = "2020-01-01";
    expect(await resolve()).toMatchObject({ linkedBy: undefined, linkedByName: "", linkedAt: "", source: "unknown" });
    expect(get).toHaveBeenCalledTimes(3);
  });

  it("checks the captured scope before and after each read, including optional enrichment", async () => {
    for (const failAt of [2, 4, 6, 8]) {
      let checks = 0;
      scope.assertCurrent = () => { if (++checks >= failAt) throw new Error("Scope changed"); };
      await expect(resolve()).rejects.toThrow("Scope changed");
    }
  });
});
