// @octo/loop — Agent API（后端契约联调）
import type { Agent, CreateAgentReq, UpdateAgentReq, ListParams, RuntimeDevice, AgentTask, AgentContribution } from "./types";
import { httpGet, httpPost, httpPut, httpDelete } from "./http";
import { ensureDirectory, actorName, actorAvatar, afterDirectoryMutation } from "./directory";

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

export async function listAgents(params?: ListParams & { includeArchived?: boolean }): Promise<Agent[]> {
  const rows = await httpGet<Agent[]>("/agents", { include_archived: params?.includeArchived ? true : undefined });
  let out = await enrich(rows ?? []);
  const kw = params?.keyword?.trim().toLowerCase();
  if (kw) out = out.filter((a) => a.name.toLowerCase().includes(kw) || (a.description ?? "").toLowerCase().includes(kw));
  return out;
}

export async function getAgent(id: string): Promise<Agent> {
  const a = await httpGet<Agent>(`/agents/${id}`);
  return (await enrich([a]))[0];
}

// 共享的 agent 在线状态缓存（id → status）：供 @提及菜单画在线点,避免每个评论/回复编辑器
// 各自拉一次 /agents（一个 issue 有 N 条评论就 N 次）。仿 runtimeMap。
let _agentStatus: Map<string, string> | null = null;
let _agentStatusPromise: Promise<Map<string, string>> | null = null;
export function agentStatusMap(): Promise<Map<string, string>> {
  if (_agentStatus) return Promise.resolve(_agentStatus);
  if (!_agentStatusPromise) {
    _agentStatusPromise = listAgents()
      .then((agents) => {
        _agentStatus = new Map(agents.map((a) => [a.id, a.status]));
        return _agentStatus;
      })
      .catch(() => {
        _agentStatusPromise = null; // allow retry after a transient failure
        return new Map<string, string>();
      });
  }
  return _agentStatusPromise;
}
export function invalidateAgentStatus(): void {
  _agentStatus = null;
  _agentStatusPromise = null;
}

// agent 增改会改变工作区的 agent 集合,除清目录缓存外一并清 agent 状态缓存,
// 否则新建/恢复的 agent 在 @ 菜单里读到陈旧的在线状态。
function afterAgentMutation<T>(r: T): T {
  invalidateAgentStatus();
  return afterDirectoryMutation(r);
}

export function createAgent(req: CreateAgentReq): Promise<Agent> {
  return httpPost<Agent>("/agents", req).then(afterAgentMutation);
}

export function updateAgent(id: string, req: UpdateAgentReq): Promise<Agent> {
  return httpPut<Agent>(`/agents/${id}`, req).then(afterAgentMutation);
}

// 后端不支持 DELETE /agents/:id（405）；改用归档。
export function archiveAgent(id: string): Promise<void> {
  return httpPost<void>(`/agents/${id}/archive`, {}).then(afterAgentMutation);
}

// 恢复已归档 agent（软删除的逆操作）。
export function restoreAgent(id: string): Promise<void> {
  return httpPost<void>(`/agents/${id}/restore`, {}).then(afterAgentMutation);
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

// 整体替换 Agent 的技能集合（PUT = 覆盖）。
export async function setAgentSkills(id: string, skillIds: string[]): Promise<void> {
  await httpPut<void>(`/agents/${id}/skills`, { skill_ids: skillIds });
}

/* ---------- 运行履历（档案页活动面板，读自既有端点） ---------- */
export async function listAgentTasks(id: string): Promise<AgentTask[]> {
  return (await httpGet<AgentTask[]>(`/agents/${id}/tasks`)) ?? [];
}

/* ---------- 贡献图（档案页 GitHub 风格日历） ---------- */
export async function getAgentContributions(
  id: string,
  params?: { from?: string; to?: string; metric?: string },
): Promise<AgentContribution[]> {
  const data = await httpGet<{ data: AgentContribution[] }>(`/agents/${id}/contributions`, params);
  return data?.data ?? [];
}

/* ---------- runtimes（供新建 Agent 选择运行环境） ---------- */
export function listRuntimesForAgent(): Promise<RuntimeDevice[]> {
  return httpGet<RuntimeDevice[]>("/runtimes");
}
