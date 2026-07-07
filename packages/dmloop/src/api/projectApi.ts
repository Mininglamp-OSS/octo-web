// @octo/loop — Project API (Mock)
import type { Project, UpsertProjectReq, ListParams, AssigneeType } from "./types";
import { resolveWorkspaceId } from "./types";
import { store, nextId, sleep, clone } from "./mockStore";
import { CANDIDATES } from "./mock/seed";

function leadName(type?: AssigneeType | null, id?: string | null): string | null {
  if (!type || !id) return null;
  return CANDIDATES.find((c) => c.id === id)?.name ?? null;
}

export async function listProjects(params?: ListParams): Promise<Project[]> {
  await sleep();
  const ws = resolveWorkspaceId(params?.workspace_id);
  let rows = store.projects.filter((p) => p.workspace_id === ws);
  const kw = params?.keyword?.trim().toLowerCase();
  if (kw) rows = rows.filter((p) => p.title.toLowerCase().includes(kw));
  return clone(rows);
}

export async function getProject(id: string): Promise<Project | null> {
  await sleep(120);
  const row = store.projects.find((p) => p.id === id);
  return row ? clone(row) : null;
}

export async function createProject(req: UpsertProjectReq): Promise<Project> {
  await sleep();
  const nowIso = new Date().toISOString();
  const project: Project = {
    id: nextId("p"),
    workspace_id: resolveWorkspaceId(),
    title: req.title,
    description: req.description ?? null,
    icon: req.icon ?? "📁",
    status: req.status ?? "planned",
    priority: req.priority ?? "none",
    lead_type: req.lead_type ?? null,
    lead_id: req.lead_id ?? null,
    lead_name: leadName(req.lead_type, req.lead_id),
    issue_count: 0,
    done_count: 0,
    created_at: nowIso,
    updated_at: nowIso,
  };
  store.projects.push(project);
  return clone(project);
}

export async function updateProject(
  id: string,
  req: UpsertProjectReq,
): Promise<Project> {
  await sleep(120);
  const row = store.projects.find((p) => p.id === id);
  if (!row) throw new Error("project not found");
  row.title = req.title;
  if (req.description !== undefined) row.description = req.description;
  if (req.icon !== undefined) row.icon = req.icon;
  if (req.status !== undefined) row.status = req.status;
  if (req.priority !== undefined) row.priority = req.priority;
  if (req.lead_type !== undefined) row.lead_type = req.lead_type;
  if (req.lead_id !== undefined) {
    row.lead_id = req.lead_id;
    row.lead_name = leadName(req.lead_type ?? row.lead_type, req.lead_id);
  }
  row.updated_at = new Date().toISOString();
  return clone(row);
}

export async function deleteProject(id: string): Promise<void> {
  await sleep(100);
  store.projects = store.projects.filter((p) => p.id !== id);
}
