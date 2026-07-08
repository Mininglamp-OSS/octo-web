// @octo/loop — Skill API（真实 HTTP，对齐 multica REST 契约）
import type { Skill, UpsertSkillReq, ListParams } from "./types";
import { httpGet, httpPost, httpPut, httpDelete, currentWorkspaceId } from "./http";

export function listSkills(params?: ListParams): Promise<Skill[]> {
  return httpGet<Skill[]>("/skills", {
    workspace_id: params?.workspace_id ?? currentWorkspaceId(),
    keyword: params?.keyword,
  });
}

export function getSkill(id: string): Promise<Skill> {
  return httpGet<Skill>(`/skills/${id}`);
}

export function createSkill(req: UpsertSkillReq): Promise<Skill> {
  return httpPost<Skill>("/skills", req);
}

export function importSkill(url: string): Promise<Skill> {
  return httpPost<Skill>("/skills/import", { url });
}

export function updateSkill(id: string, req: UpsertSkillReq): Promise<Skill> {
  return httpPut<Skill>(`/skills/${id}`, req);
}

export function deleteSkill(id: string): Promise<void> {
  return httpDelete<void>(`/skills/${id}`);
}
