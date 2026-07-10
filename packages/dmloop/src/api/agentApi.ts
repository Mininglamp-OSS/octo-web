// @octo/loop — Agent API（后端契约联调）
import type { Agent, CreateAgentReq, UpdateAgentReq, ListParams, RuntimeDevice } from "./types";
import { httpGet, httpPost, httpPut, httpDelete } from "./http";
import { ensureDirectory, actorName, actorAvatar } from "./directory";

// runtime 名字缓存（用于 agent.runtime_name 回填）
let _runtimeMap: Map<string, string> | null = null;
async function runtimeMap(): Promise<Map<string, string>> {
  if (_runtimeMap) return _runtimeMap;
  const rows = await httpGet<RuntimeDevice[]>("/runtimes").catch(() => [] as RuntimeDevice[]);
  _runtimeMap = new Map(rows.map((r) => [r.id, r.name]));
  return _runtimeMap;
}
export function invalidateRuntimeMap(): void {
  _runtimeMap = null;
}

async function enrich(agents: Agent[]): Promise<Agent[]> {
  const [dir, rmap] = await Promise.all([ensureDirectory(), runtimeMap()]);
  return agents.map((a) => ({
    ...a,
    runtime_name: rmap.get(a.runtime_id) ?? null,
    owner_name: actorName(dir, "member", a.owner_id),
    owner_avatar: actorAvatar(dir, "member", a.owner_id),
  }));
}

export async function listAgents(params?: ListParams): Promise<Agent[]> {
  const rows = await httpGet<Agent[]>("/agents");
  let out = await enrich(rows ?? []);
  const kw = params?.keyword?.trim().toLowerCase();
  if (kw) out = out.filter((a) => a.name.toLowerCase().includes(kw) || (a.description ?? "").toLowerCase().includes(kw));
  return out;
}

export async function getAgent(id: string): Promise<Agent> {
  const a = await httpGet<Agent>(`/agents/${id}`);
  return (await enrich([a]))[0];
}

export function createAgent(req: CreateAgentReq): Promise<Agent> {
  return httpPost<Agent>("/agents", req);
}

export function updateAgent(id: string, req: UpdateAgentReq): Promise<Agent> {
  return httpPut<Agent>(`/agents/${id}`, req);
}

// 后端不支持 DELETE /agents/:id（405）；改用归档。
export function archiveAgent(id: string): Promise<void> {
  return httpPost<void>(`/agents/${id}/archive`, {});
}

/* ---------- 环境变量（密钥） ---------- */
export async function getAgentEnv(id: string): Promise<Record<string, string>> {
  const data = await httpGet<{ custom_env: Record<string, string> }>(`/agents/${id}/env`);
  return data.custom_env ?? {};
}
export async function updateAgentEnv(id: string, customEnv: Record<string, string>): Promise<Record<string, string>> {
  const data = await httpPut<{ custom_env: Record<string, string> }>(`/agents/${id}/env`, { custom_env: customEnv });
  return data.custom_env ?? {};
}

/* ---------- 技能 ---------- */
export function getAgentSkills(id: string): Promise<Array<{ id: string; name: string }>> {
  return httpGet<Array<{ id: string; name: string }>>(`/agents/${id}/skills`);
}

/* ---------- runtimes（供新建 Agent 选择运行环境） ---------- */
export function listRuntimesForAgent(): Promise<RuntimeDevice[]> {
  return httpGet<RuntimeDevice[]>("/runtimes");
}
