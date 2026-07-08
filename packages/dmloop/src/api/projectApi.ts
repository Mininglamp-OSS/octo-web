// @octo/loop — Project API（真实 HTTP，对齐 multica REST 契约）
import type { Project, UpsertProjectReq, ListParams } from "./types";
import { httpGet, httpPost, httpPut, httpDelete, currentWorkspaceId } from "./http";

export async function listProjects(params?: ListParams): Promise<Project[]> {
  const data = await httpGet<{ projects: Project[]; total: number }>("/projects", {
    workspace_id: params?.workspace_id ?? currentWorkspaceId(),
    keyword: params?.keyword,
  });
  return data.projects;
}

export function getProject(id: string): Promise<Project> {
  return httpGet<Project>(`/projects/${id}`);
}

export function createProject(req: UpsertProjectReq): Promise<Project> {
  return httpPost<Project>("/projects", req);
}

export function updateProject(id: string, req: UpsertProjectReq): Promise<Project> {
  return httpPut<Project>(`/projects/${id}`, req);
}

export function deleteProject(id: string): Promise<void> {
  return httpDelete<void>(`/projects/${id}`);
}
