// @octo/loop — Skill API（真实 fleet 联调）
import type { Skill, UpsertSkillReq, ListParams } from "./types";
import { httpGet, httpPost, httpPut, httpDelete } from "./http";

function matchKeyword(rows: Skill[], keyword?: string): Skill[] {
  const kw = keyword?.trim().toLowerCase();
  if (!kw) return rows;
  return rows.filter(
    (s) => s.name.toLowerCase().includes(kw) || (s.description ?? "").toLowerCase().includes(kw),
  );
}

export async function listSkills(params?: ListParams): Promise<Skill[]> {
  const rows = await httpGet<Skill[]>("/skills");
  return matchKeyword(rows ?? [], params?.keyword);
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

/** 展示用：技能来源类型（取自 config.origin）。 */
export function skillSource(s: Skill): string {
  const o = s.config?.origin;
  if (!o) return "workspace";
  if (o.type === "skills_sh" || o.source_url) return "github";
  return "workspace";
}
