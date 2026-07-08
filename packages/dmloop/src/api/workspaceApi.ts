// @octo/loop — Workspace API（真实 fleet 联调）
import type { Workspace, WorkspaceMember } from "./types";
import { httpGet, httpPost } from "./http";

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
