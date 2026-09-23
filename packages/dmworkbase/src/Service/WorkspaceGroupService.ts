import APIClient from "./APIClient";
import type { WorkspaceGroupContext, WorkspaceGroupTarget } from "../features/workspaceGroup/contract";

export interface WorkspaceGroupReadScope {
  spaceId: string;
  signal?: AbortSignal;
  assertCurrent(): void;
}

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue =>
  value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
const text = (value: unknown): string => typeof value === "string" ? value.trim() : "";
const first = (value: RecordValue, keys: string[]): unknown =>
  keys.map(key => value[key]).find(item => item !== undefined && item !== null);
const granted = (value: unknown): boolean => value === true || value === 1 || value === "true" || value === "1";
const rejected = (value: unknown): boolean => value !== undefined && value !== null && !granted(value);
const flag = (value: RecordValue, snake: string, camel: string): unknown => first(value, [snake, camel]);
const id = (value: unknown): string => {
  const result = text(value);
  return result && result.length <= 256 && !/[^\x21-\x7e]/.test(result) ? result : "";
};
const inaccessible = (error: unknown): boolean => {
  const value = record(error);
  const status = record(value.normalized).httpStatus ?? value.status;
  return status === 403 || status === 404;
};
const one = (value: unknown, keys: string[]): RecordValue => {
  let result = record(value);
  for (let depth = 0; depth < 4; depth++) {
    const nested = first(result, [...keys, "item", "data"]);
    if (!nested || typeof nested !== "object" || Array.isArray(nested)) break;
    result = record(nested);
  }
  return result;
};

function managementPermission(
  group: RecordValue, relation: RecordValue, workspace: RecordValue, isAllMemberGroup: boolean,
): Pick<WorkspaceGroupContext, "canManage" | "manageDisabledReason"> {
  const deny = (manageDisabledReason: WorkspaceGroupContext["manageDisabledReason"]) =>
    ({ canManage: false, manageDisabledReason });
  if (isAllMemberGroup) return deny("system_group");
  if (!Object.keys(workspace).length) return deny("unavailable");
  const member = flag(workspace, "is_member", "isMember");
  const role = first(workspace, ["my_role", "myRole", "role", "membership_role", "member_role"]);
  const knownRole = (typeof role === "string" || typeof role === "number")
    && ["owner", "admin", "member", "0", "1", "2"].includes(String(role));
  if (rejected(member) || rejected(flag(workspace, "can_read", "canRead"))
    || (role !== undefined && !knownRole) || (!granted(member) && !knownRole)) return deny("workspace_membership");
  const groupRole = first(group, ["role", "my_role", "myRole", "member_role", "memberRole", "group_role", "groupRole"]);
  if (![1, 2, "1", "2"].includes(groupRole as number | string)) return deny("group_role");
  if (rejected(flag(group, "can_manage", "canManage"))
    || rejected(flag(relation, "can_manage", "canManage"))) return deny("denied");
  return { canManage: true };
}

async function read(
  path: string, scope: WorkspaceGroupReadScope, workspaceId?: string, timeout = 5000,
): Promise<unknown> {
  scope.assertCurrent();
  const result = await APIClient.shared.get(path, {
    headers: { "X-Space-Id": scope.spaceId, ...(workspaceId ? { "X-Workspace-ID": workspaceId } : {}) },
    signal: scope.signal,
    timeout,
  });
  scope.assertCurrent();
  return result;
}

async function linkingPerson(
  relation: RecordValue, groupNo: string, scope: WorkspaceGroupReadScope,
): Promise<string> {
  const name = text(first(relation, ["linked_by_name", "linkedByName"]));
  const uid = text(first(relation, ["linked_by", "linkedBy"]));
  if (name || !uid || uid.length > 256) return name;
  try {
    const user = one(await read(
      `users/${encodeURIComponent(uid)}?group_no=${encodeURIComponent(groupNo)}`, scope, undefined, 1500,
    ), ["user"]);
    return text(user.uid) === uid ? text(user.name) : "";
  } catch {
    // Optional profile hydration must not hide a valid workspace relation.
    scope.assertCurrent();
    return "";
  }
}

const WorkspaceGroupService = {
  async getContext(target: WorkspaceGroupTarget, scope: WorkspaceGroupReadScope): Promise<WorkspaceGroupContext | null> {
    scope.assertCurrent();
    if (target.channelType !== 2 || !id(target.channelId) || !id(scope.spaceId)) {
      throw new Error("Invalid workspace group scope");
    }
    const groupPath = `groups/${encodeURIComponent(target.channelId)}`;
    let group: RecordValue;
    let relation: RecordValue;
    try {
      group = one(await read(groupPath, scope), ["group"]);
      const groupNo = text(first(group, ["group_no", "groupNo"]));
      if (!groupNo) throw new Error("Invalid workspace group response");
      if (groupNo !== target.channelId || rejected(flag(group, "is_member", "isMember"))
        || rejected(flag(group, "can_read", "canRead"))) return null;
      const groupSpace = text(first(group, ["space_id", "spaceId"]));
      if (groupSpace && groupSpace !== scope.spaceId) return null;
      relation = one(await read(groupPath + "/project", scope, id(first(group, ["project_id", "projectId"])) || undefined), ["relation"]);
    } catch (error) {
      scope.assertCurrent();
      if (inaccessible(error)) return null;
      throw error;
    }
    const relationGroup = text(first(relation, ["group_no", "groupNo"]));
    const rawProjectId = relation.project_id !== undefined ? relation.project_id : relation.projectId;
    // Only an explicit empty relation is authoritative. Malformed success bodies
    // must enter the recovery path instead of silently hiding a linked workspace.
    if (relationGroup !== target.channelId) throw new Error("Invalid workspace relation response");
    if (rawProjectId === "" || rawProjectId === null) return null;
    const projectId = id(rawProjectId);
    if (!projectId) throw new Error("Invalid workspace relation response");
    const relationSpace = text(first(relation, ["space_id", "spaceId"]));
    if (relationSpace && relationSpace !== scope.spaceId) return null;
    let workspace: RecordValue = {};
    try {
      workspace = one(await read(`projects/${encodeURIComponent(projectId)}`, scope, projectId), ["project", "workspace"]);
    } catch (error) {
      scope.assertCurrent();
      if (!inaccessible(error)) throw error;
    }
    const workspaceSpace = text(first(workspace, ["space_id", "spaceId"]));
    const workspaceKnown = text(first(workspace, ["project_id", "projectId", "id"])) === projectId
      && (!workspaceSpace || workspaceSpace === scope.spaceId);
    const verifiedWorkspace = workspaceKnown ? workspace : {};
    const projectName = (workspaceKnown ? text(workspace.name) : "")
      || text(first(relation, ["project_name", "projectName"]));
    if (!projectName) throw new Error("Workspace name unavailable");
    const isAllMemberGroup = text(first(verifiedWorkspace, ["all_member_group_no", "allMemberGroupNo"])) === target.channelId
      || granted(flag(group, "is_all_member_group", "isAllMemberGroup"))
      || granted(flag(relation, "is_all_member_group", "isAllMemberGroup"));
    const source = first(relation, ["source", "project_link_source", "projectLinkSource"]);
    return {
      ...target, projectId, projectName,
      groupName: text(first(group, ["name", "group_name", "groupName"])),
      linkedBy: id(first(relation, ["linked_by", "linkedBy"])) || undefined,
      linkedByName: await linkingPerson(relation, target.channelId, scope),
      linkedAt: text(first(relation, ["linked_at", "linkedAt"])),
      source: source === "created_in_project" || source === "linked_existing" ? source : "unknown",
      canOpen: workspaceKnown && !rejected(flag(workspace, "can_read", "canRead")),
      isAllMemberGroup,
      ...managementPermission(group, relation, verifiedWorkspace, isAllMemberGroup),
    };
  },
};

export default WorkspaceGroupService;
