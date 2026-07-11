// @octo/loop — Workspace / Members / Invitations API（后端契约联调）
import type { Workspace, WorkspaceMember, Invitation } from "./types";
import { httpGet, httpPost, httpPatch, httpDelete } from "./http";
import { afterDirectoryMutation } from "./directory";

export function listWorkspaces(): Promise<Workspace[]> {
  return httpGet<Workspace[]>("/workspaces");
}

export function listWorkspaceMembers(workspaceId: string): Promise<WorkspaceMember[]> {
  return httpGet<WorkspaceMember[]>(`/workspaces/${workspaceId}/members`);
}

export function createWorkspace(req: {
  name: string;
  slug: string;
  description?: string;
}): Promise<Workspace> {
  return httpPost<Workspace>("/workspaces", req);
}

/** 通用设置：更新 workspace（PATCH）。 */
export function updateWorkspace(
  id: string,
  req: { name?: string; description?: string; context?: string; issue_prefix?: string },
): Promise<Workspace> {
  return httpPatch<Workspace>(`/workspaces/${id}`, req);
}

/** 成员管理：邀请成员（按邮箱，返回 Invitation）。 */
export function inviteMember(
  workspaceId: string,
  req: { email: string; role?: string },
): Promise<Invitation> {
  return httpPost<Invitation>(`/workspaces/${workspaceId}/members`, req);
}

/**
 * 按 octo IM uid 直接加成员（octo web 面，无邮箱邀请/接受环节）。
 * 后端校验目标 uid 属于当前 space 且非 AI，随即物化为 member。
 */
export function addOctoMember(
  workspaceId: string,
  req: { octo_uid: string; role?: string },
): Promise<WorkspaceMember> {
  // 加成员后目录候选(负责人/创建者下拉、内联指派)会变 → 清缓存,下次读重建。
  return httpPost<WorkspaceMember>(`/workspaces/${workspaceId}/octo-members`, req).then(afterDirectoryMutation);
}

/** 修改成员角色。 */
export function updateMemberRole(
  workspaceId: string,
  memberId: string,
  role: string,
): Promise<WorkspaceMember> {
  return httpPatch<WorkspaceMember>(`/workspaces/${workspaceId}/members/${memberId}`, { role });
}

/** 移除成员。 */
export function removeMember(workspaceId: string, memberId: string): Promise<void> {
  // 删成员后目录候选变 → 清缓存,避免下拉仍显示已删成员。
  return httpDelete<void>(`/workspaces/${workspaceId}/members/${memberId}`).then(afterDirectoryMutation);
}

/** 待处理邀请列表。 */
export function listWorkspaceInvitations(workspaceId: string): Promise<Invitation[]> {
  return httpGet<Invitation[]>(`/workspaces/${workspaceId}/invitations`);
}

/** 撤销邀请。 */
export function revokeInvitation(workspaceId: string, invitationId: string): Promise<void> {
  return httpDelete<void>(`/workspaces/${workspaceId}/invitations/${invitationId}`);
}

