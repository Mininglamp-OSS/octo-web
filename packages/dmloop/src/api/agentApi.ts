// @octo/loop — Agent API (Mock)
import type { Agent, UpsertAgentReq, ListParams } from "./types";
import { resolveWorkspaceId } from "./types";
import { store, nextId, sleep, clone } from "./mockStore";

export async function listAgents(params?: ListParams): Promise<Agent[]> {
  await sleep();
  const ws = resolveWorkspaceId(params?.workspace_id);
  let rows = store.agents.filter((a) => a.workspace_id === ws);
  const kw = params?.keyword?.trim().toLowerCase();
  if (kw) rows = rows.filter((a) => a.name.toLowerCase().includes(kw));
  return clone(rows);
}

export async function getAgent(id: string): Promise<Agent | null> {
  await sleep(120);
  const row = store.agents.find((a) => a.id === id);
  return row ? clone(row) : null;
}

export async function createAgent(req: UpsertAgentReq): Promise<Agent> {
  await sleep();
  const nowIso = new Date().toISOString();
  const agent: Agent = {
    id: nextId("a"),
    workspace_id: resolveWorkspaceId(),
    name: req.name,
    description: req.description ?? "",
    instructions: req.instructions ?? "",
    status: req.status ?? "idle",
    runtime_id: req.runtime_id ?? "rt-001",
    runtime_name: "kaka-mbp",
    model: req.model ?? "claude-opus-4",
    visibility: req.visibility ?? "workspace",
    max_concurrent_tasks: req.max_concurrent_tasks ?? 1,
    owner_name: "lvsijia",
    skills: [],
    runs_30d: 0,
    created_at: nowIso,
    updated_at: nowIso,
  };
  store.agents.push(agent);
  return clone(agent);
}

export async function updateAgent(
  id: string,
  req: UpsertAgentReq,
): Promise<Agent> {
  await sleep(120);
  const row = store.agents.find((a) => a.id === id);
  if (!row) throw new Error("agent not found");
  row.name = req.name;
  if (req.description !== undefined) row.description = req.description;
  if (req.instructions !== undefined) row.instructions = req.instructions;
  if (req.status !== undefined) row.status = req.status;
  if (req.model !== undefined) row.model = req.model;
  if (req.visibility !== undefined) row.visibility = req.visibility;
  if (req.max_concurrent_tasks !== undefined)
    row.max_concurrent_tasks = req.max_concurrent_tasks;
  row.updated_at = new Date().toISOString();
  return clone(row);
}

export async function deleteAgent(id: string): Promise<void> {
  await sleep(100);
  store.agents = store.agents.filter((a) => a.id !== id);
}
