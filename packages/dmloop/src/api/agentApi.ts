// @octo/loop — Agent API（真实 HTTP，对齐 multica REST 契约）
import type { Agent, UpsertAgentReq, ListParams } from "./types";
import { httpGet, httpPost, httpPut, httpDelete, currentWorkspaceId } from "./http";

export function listAgents(params?: ListParams): Promise<Agent[]> {
  return httpGet<Agent[]>("/agents", {
    workspace_id: params?.workspace_id ?? currentWorkspaceId(),
    keyword: params?.keyword,
  });
}

export function getAgent(id: string): Promise<Agent> {
  return httpGet<Agent>(`/agents/${id}`);
}

export function createAgent(req: UpsertAgentReq): Promise<Agent> {
  return httpPost<Agent>("/agents", req);
}

export function updateAgent(id: string, req: UpsertAgentReq): Promise<Agent> {
  return httpPut<Agent>(`/agents/${id}`, req);
}

export function deleteAgent(id: string): Promise<void> {
  return httpDelete<void>(`/agents/${id}`);
}

/* ---------- 环境变量（密钥） ---------- */
export async function getAgentEnv(id: string): Promise<Record<string, string>> {
  const data = await httpGet<{ custom_env: Record<string, string> }>(`/agents/${id}/env`);
  return data.custom_env;
}

export async function updateAgentEnv(
  id: string,
  customEnv: Record<string, string>,
): Promise<Record<string, string>> {
  const data = await httpPut<{ custom_env: Record<string, string> }>(
    `/agents/${id}/env`,
    { custom_env: customEnv },
  );
  return data.custom_env;
}

/* ---------- 技能 ---------- */
export function getAgentSkills(id: string): Promise<string[]> {
  return httpGet<string[]>(`/agents/${id}/skills`);
}

export function setAgentSkills(id: string, skills: string[]): Promise<string[]> {
  return httpPut<string[]>(`/agents/${id}/skills`, { skills });
}
