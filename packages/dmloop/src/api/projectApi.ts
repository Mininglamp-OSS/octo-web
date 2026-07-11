// @octo/loop — Project API（后端契约联调）
import type { Project, UpsertProjectReq, ListParams } from "./types";
import { httpGet, httpPost, httpPut, httpDelete } from "./http";
import { ensureDirectory, actorName, afterDirectoryMutation } from "./directory";

export async function listProjects(params?: ListParams): Promise<Project[]> {
  const [data, dir] = await Promise.all([
    httpGet<{ projects: Project[]; total?: number }>("/projects"),
    ensureDirectory(),
  ]);
  let rows = (data.projects ?? []).map((p) => ({
    ...p,
    lead_name: actorName(dir, p.lead_type, p.lead_id),
  }));
  const kw = params?.keyword?.trim().toLowerCase();
  if (kw) rows = rows.filter((p) => p.title.toLowerCase().includes(kw));
  return rows;
}

export async function getProject(id: string): Promise<Project> {
  const [p, dir] = await Promise.all([
    httpGet<Project>(`/projects/${id}`),
    ensureDirectory(),
  ]);
  return { ...p, lead_name: actorName(dir, p.lead_type, p.lead_id) };
}

export function createProject(req: UpsertProjectReq): Promise<Project> {
  return httpPost<Project>("/projects", req).then(afterDirectoryMutation);
}

export function updateProject(id: string, req: UpsertProjectReq): Promise<Project> {
  return httpPut<Project>(`/projects/${id}`, req).then(afterDirectoryMutation);
}

export function deleteProject(id: string): Promise<void> {
  return httpDelete<void>(`/projects/${id}`).then(afterDirectoryMutation);
}
