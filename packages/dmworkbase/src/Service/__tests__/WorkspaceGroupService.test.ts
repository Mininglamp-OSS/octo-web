import { beforeEach, describe, expect, it, vi } from "vitest";
import APIClient from "../APIClient";
import WorkspaceGroupService, { type WorkspaceGroupReadScope } from "../WorkspaceGroupService";
import { i18n } from "../../i18n/instance";

vi.mock("../APIClient", () => ({ default: { shared: { get: vi.fn() } } }));

const target = { channelId: "group-1", channelType: 2 as const };
const get = vi.mocked(APIClient.shared.get);
let group: Record<string, unknown>;
let relation: Record<string, unknown>;
let workspace: Record<string, unknown>;
let user: Record<string, unknown>;
let scope: WorkspaceGroupReadScope;
const resolve = () => WorkspaceGroupService.getContext(target, scope);
const restrictedRelation = (): Record<string, unknown> =>
  ({ group_no: "group-1", name: "Group", project_id: "project-1", linked_by: "user-2" });
const successfulGet = async (path: string): Promise<unknown> => {
  if (path === "groups/group-1") return group;
  if (path === "groups/group-1/project") return relation;
  if (path === "projects/project-1") return workspace;
  if (path === "users/user-2") return user;
  throw new Error(`Unexpected request: ${path}`);
};

describe("WorkspaceGroupService Web reads", () => {
  beforeEach(() => {
    i18n.setLocale("en-US", { persist: false });
    group = { group_no: "group-1", name: "Group", space_id: "space-1", project_id: "project-1", role: 1 };
    // This is the server's restricted GroupProjectRelation projection.
    relation = restrictedRelation();
    workspace = { project_id: "project-1", space_id: "space-1", name: "Workspace", role: "member" };
    user = { uid: "user-2", name: "Linking actor" };
    scope = { spaceId: "space-1", signal: new AbortController().signal, assertCurrent: vi.fn() };
    get.mockReset().mockImplementation(successfulGet);
  });

  it("queries relation, workspace and actor through Web APIClient with an explicit Space", async () => {
    expect(await resolve()).toEqual({
      ...target, projectId: "project-1", projectName: "Workspace", groupName: "Group",
      linkedBy: "user-2", linkedByName: "Linking actor", linkedAt: "", source: "unknown",
      canOpen: true, canManage: true, isAllMemberGroup: false,
    });
    expect(get.mock.calls.map(([path, config]) => [
      path, config?.headers, config?.timeout, config?.param,
    ])).toEqual([
      ["groups/group-1", { "X-Space-Id": "space-1" }, 5000, undefined],
      ["groups/group-1/project", { "X-Space-Id": "space-1" }, 5000, undefined],
      ["projects/project-1", { "X-Space-Id": "space-1" }, 5000, undefined],
      ["users/user-2", { "X-Space-Id": "space-1" }, 1500, { group_no: "group-1" }],
    ]);
    expect(get.mock.calls.every(([, config]) => config?.signal === scope.signal)).toBe(true);
    expect(get.mock.calls.every(([, config]) => config?.suppressAuthExpiredLogout === true)).toBe(true);
  });

  it.each([0, 1, 2])("accepts the server's numeric project my_role=%s and numeric group role", async myRole => {
    workspace = { project_id: "project-1", name: "Workspace", my_role: myRole, capabilities: { can_update: false } };
    expect(await resolve()).toMatchObject({ canOpen: true, canManage: true });
    group.role = 0;
    expect(await resolve()).toMatchObject({ canOpen: true, canManage: false, manageDisabledReason: "group_role" });
  });

  it("does not guess group management from undocumented role aliases", async () => {
    delete group.role;
    group.my_role = 1;
    expect(await resolve()).toMatchObject({ canManage: false, manageDisabledReason: "group_role" });
    group.role = 1;
    delete workspace.role;
    workspace.membership_role = "owner";
    expect(await resolve()).toMatchObject({ canManage: false, manageDisabledReason: "workspace_membership" });
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

  it("stops unwrapping at entity markers and preserves each entity's own payload", async () => {
    group = {
      group_no: "group-1", project_id: "project-1", name: "Group", role: 1,
      data: { group_no: "wrong-group" }, item: { project_id: "wrong-project" },
    };
    relation = {
      group_no: "group-1", project_id: "project-1", linked_by: "user-2", linked_by_name: "Recorded actor",
      data: { project_id: "wrong-project" }, item: { group_no: "wrong-group" },
    };
    workspace = {
      project_id: "project-1", space_id: "space-1", name: "Workspace", role: "member",
      data: { project_id: "wrong-project" }, item: { id: "wrong-project" },
    };
    expect(await resolve()).toMatchObject({
      projectName: "Workspace", groupName: "Group", linkedBy: "user-2", linkedByName: "Recorded actor",
      canOpen: true, canManage: true,
    });
    expect(get).toHaveBeenCalledTimes(3);
  });

  it("keeps a named entity's own data/item payload", async () => {
    group = { data: { group: {
      group_no: "group-1", project_id: "project-1", name: "Group", role: 1,
      data: { group_no: "wrong-group" }, item: { project_id: "wrong-project" },
    } } };
    relation = { data: { relation: {
      group_no: "group-1", project_id: "project-1", linked_by: "user-2", linked_by_name: "Recorded actor",
      data: { project_id: "wrong-project" }, item: { group_no: "wrong-group" },
    } } };
    workspace = { data: { workspace: {
      project_id: "project-1", space_id: "space-1", name: "Workspace", role: "member",
      data: { project_id: "wrong-project" }, item: { id: "wrong-project" },
    } } };
    expect(await resolve()).toMatchObject({
      projectName: "Workspace", groupName: "Group", linkedBy: "user-2", linkedByName: "Recorded actor",
    });
    expect(get).toHaveBeenCalledTimes(3);
  });

  it("sanitizes relation-provided actor display names", async () => {
    relation.linked_by_name = " \u200E张三\u202E ";
    expect(await resolve()).toMatchObject({
      projectName: "Workspace", groupName: "Group", linkedByName: "张三",
    });
    expect(get).toHaveBeenCalledTimes(3);
  });

  it("preserves trimmed project and group names beyond the actor-name bound", async () => {
    const projectName = "p".repeat(257);
    const groupName = "g".repeat(257);
    workspace.name = ` \u200E${projectName}\u202E `;
    group.name = ` \u2066${groupName}\u2069 `;
    expect(await resolve()).toMatchObject({ projectName, groupName });
  });

  it.each([
    ["x".repeat(257)],
    ["\u202E".repeat(300)],
  ])("hydrates when a relation-provided display name normalizes to empty", async linkedByName => {
    relation.linked_by_name = linkedByName;
    expect(await resolve()).toMatchObject({ linkedByName: "Linking actor" });
    expect(get.mock.calls.map(([path]) => path)).toEqual([
      "groups/group-1", "groups/group-1/project", "projects/project-1", "users/user-2",
    ]);
    expect(get.mock.calls[3][1]?.param).toEqual({ group_no: "group-1" });
  });

  it.each([
    [{ name: "Nickname", remark: "Viewer remark", real_name: "真实姓名", realname_verified: true }, "真实姓名"],
    [{ name: "Nickname", remark: "Viewer remark", real_name: "Real name", realname_verified: false }, "Viewer remark"],
    [{ name: "Nickname", remark: "", real_name: "Real name", realname_verified: "0" }, "Nickname"],
    [{ name: "Nickname", remark: " \u200EViewer remark\u2069 ", realname_verified: false }, "Viewer remark"],
  ])("uses the DisplayName priority for hydrated actors: %j", async (profile, expected) => {
    user = { uid: "user-2", ...profile };
    expect(await resolve()).toMatchObject({ linkedByName: expected });
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

  it.each(["", " \n "])("keeps a successful project detail with a missing name retryable: %j", async name => {
    workspace.name = name;
    await expect(resolve()).rejects.toThrow("Workspace name unavailable");
  });

  it.each([
    ["en-US", 403, "Workspace unavailable"],
    ["en-US", 404, "Workspace unavailable"],
    ["zh-CN", 403, "工作空间暂不可用"],
    ["zh-CN", 404, "工作空间暂不可用"],
  ] as const)("retains the verified relation for %s project detail with status %s", async (locale, status, projectName) => {
    i18n.setLocale(locale, { persist: false });
    relation = restrictedRelation();
    get.mockImplementation(async path => {
      if (path === "projects/project-1") throw { normalized: { httpStatus: status } };
      return successfulGet(path);
    });
    expect(await resolve()).toMatchObject({
      ...target, projectId: "project-1", projectName, groupName: "Group",
      canOpen: false, canManage: false, manageDisabledReason: "unavailable",
    });
    expect(get.mock.calls.map(([path]) => path)).toContain("projects/project-1");
  });

  it.each([
    ["project ID", "en-US", { project_id: "other" }, "Workspace unavailable"],
    ["Space", "en-US", { space_id: "other" }, "Workspace unavailable"],
    ["project ID", "zh-CN", { project_id: "other" }, "工作空间暂不可用"],
    ["Space", "zh-CN", { space_id: "other" }, "工作空间暂不可用"],
  ] as const)("does not trust mismatched %s detail in %s", async (_identityName, locale, identity, projectName) => {
    i18n.setLocale(locale, { persist: false });
    relation = restrictedRelation();
    workspace = { ...workspace, ...identity, name: "Unrelated secret", all_member_group_no: "group-1" };
    expect(await resolve()).toMatchObject({
      ...target, projectId: "project-1", projectName, groupName: "Group",
      canOpen: false, canManage: false, isAllMemberGroup: false, manageDisabledReason: "unavailable",
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
    ["network", new Error("network")],
    ["5xx", { status: 500 }],
    ["429", { status: 429 }],
  ])("keeps transient project %s failures retryable and recovers", async (_label, error) => {
    get.mockImplementation(async path => {
      if (path === "projects/project-1") throw error;
      return successfulGet(path);
    });
    await expect(resolve()).rejects.toBe(error);

    get.mockImplementation(successfulGet);
    expect(await resolve()).toMatchObject({
      projectId: "project-1", projectName: "Workspace", canOpen: true, canManage: true,
    });
  });

  it("rejects project 403 recovery when scope is invalidated in the catch", async () => {
    let projectForbidden = false;
    get.mockImplementation(async path => {
      if (path === "projects/project-1") {
        projectForbidden = true;
        throw { normalized: { httpStatus: 403 } };
      }
      return successfulGet(path);
    });
    scope.assertCurrent = () => {
      if (projectForbidden) throw new Error("Scope changed");
    };
    await expect(resolve()).rejects.toThrow("Scope changed");
  });

  it("recovers on a later read after project 403", async () => {
    let projectForbidden = true;
    get.mockImplementation(async path => {
      if (path === "projects/project-1" && projectForbidden) {
        projectForbidden = false;
        throw { normalized: { httpStatus: 403 } };
      }
      return successfulGet(path);
    });
    expect(await resolve()).toMatchObject({
      projectName: "Workspace unavailable", canOpen: false, canManage: false,
      manageDisabledReason: "unavailable",
    });
    expect(await resolve()).toMatchObject({
      projectName: "Workspace", canOpen: true, canManage: true,
    });
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
