// @octo/loop — Skill API (Mock)
import type { Skill, UpsertSkillReq, ListParams } from "./types";
import { resolveWorkspaceId } from "./types";
import { store, nextId, sleep, clone } from "./mockStore";

export async function listSkills(params?: ListParams): Promise<Skill[]> {
  await sleep();
  const ws = resolveWorkspaceId(params?.workspace_id);
  let rows = store.skills.filter((s) => s.workspace_id === ws);
  const kw = params?.keyword?.trim().toLowerCase();
  if (kw) rows = rows.filter((s) => s.name.toLowerCase().includes(kw));
  return clone(rows);
}

export async function getSkill(id: string): Promise<Skill | null> {
  await sleep(120);
  const row = store.skills.find((s) => s.id === id);
  return row ? clone(row) : null;
}

export async function createSkill(req: UpsertSkillReq): Promise<Skill> {
  await sleep();
  const nowIso = new Date().toISOString();
  const skill: Skill = {
    id: nextId("sk"),
    workspace_id: resolveWorkspaceId(),
    name: req.name,
    description: req.description ?? "",
    source: req.source ?? "workspace",
    content: req.content ?? "",
    used_by: 0,
    creator_name: "lvsijia",
    created_at: nowIso,
    updated_at: nowIso,
  };
  store.skills.push(skill);
  return clone(skill);
}

export async function updateSkill(
  id: string,
  req: UpsertSkillReq,
): Promise<Skill> {
  await sleep(120);
  const row = store.skills.find((s) => s.id === id);
  if (!row) throw new Error("skill not found");
  row.name = req.name;
  if (req.description !== undefined) row.description = req.description;
  if (req.source !== undefined) row.source = req.source;
  if (req.content !== undefined) row.content = req.content;
  row.updated_at = new Date().toISOString();
  return clone(row);
}

export async function deleteSkill(id: string): Promise<void> {
  await sleep(100);
  store.skills = store.skills.filter((s) => s.id !== id);
}
