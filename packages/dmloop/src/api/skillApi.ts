// @octo/loop — Skill API（后端契约联调）
import type {
  Skill,
  UpsertSkillReq,
  ListParams,
  RuntimeLocalSkillListRequest,
  RuntimeLocalSkillImportRequest,
  RuntimeLocalSkillSummary,
} from "./types";
import { httpGet, httpPost, httpPut, httpDelete } from "./http";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

/* ---------- 从运行时拷贝技能（async 两段式） ---------- */

/** 发起 + 轮询 runtime 本地技能列表，直到终态。 */
export async function fetchRuntimeSkills(
  runtimeId: string,
): Promise<{ supported: boolean; skills: RuntimeLocalSkillSummary[]; error?: string }> {
  const init = await httpPost<RuntimeLocalSkillListRequest>(`/runtimes/${runtimeId}/local-skills`, {});
  let cur = init;
  for (let i = 0; i < 12 && cur.status !== "completed" && cur.status !== "failed"; i++) {
    await sleep(900);
    cur = await httpGet<RuntimeLocalSkillListRequest>(`/runtimes/${runtimeId}/local-skills/${init.id}`);
  }
  if (cur.status === "failed") return { supported: cur.supported, skills: [], error: cur.error || "failed" };
  return { supported: cur.supported, skills: cur.skills ?? [] };
}

/** 发起 + 轮询导入某个 runtime 技能，返回创建/更新后的 Skill。 */
export async function importRuntimeSkill(
  runtimeId: string,
  skillKey: string,
  name?: string,
): Promise<RuntimeLocalSkillImportRequest> {
  const init = await httpPost<RuntimeLocalSkillImportRequest>(`/runtimes/${runtimeId}/local-skills/import`, {
    skill_key: skillKey,
    name,
  });
  let cur = init;
  for (let i = 0; i < 12 && cur.status !== "completed" && cur.status !== "failed"; i++) {
    await sleep(900);
    cur = await httpGet<RuntimeLocalSkillImportRequest>(`/runtimes/${runtimeId}/local-skills/import/${init.id}`);
  }
  return cur;
}
