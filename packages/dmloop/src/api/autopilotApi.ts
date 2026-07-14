// @octo/loop — Autopilot API（自动化，对接自动化后端契约，base = /fleet/api/v1）
import type {
  Autopilot,
  AutopilotTrigger,
  CreateAutopilotRequest,
  UpdateAutopilotRequest,
  CreateAutopilotTriggerRequest,
  UpdateAutopilotTriggerRequest,
  GetAutopilotResponse,
  ListAutopilotsResponse,
  ListAutopilotRunsResponse,
  AutopilotRun,
} from "./types";
import { httpGet, httpPost, httpPatch, httpDelete } from "./http";
import { ensureDirectory, actorName, actorAvatar, projectNameOf } from "./directory";

// 后端列表不返回执行方名字/头像/项目名，用 directory 缓存回填（与 projectApi.listProjects 对称）。
async function enrich(rows: Autopilot[]): Promise<Autopilot[]> {
  const dir = await ensureDirectory();
  return rows.map((a) => ({
    ...a,
    assignee_name: actorName(dir, a.assignee_type, a.assignee_id),
    assignee_avatar: actorAvatar(dir, a.assignee_type, a.assignee_id),
    project_name: projectNameOf(dir, a.project_id),
  }));
}

export async function listAutopilots(): Promise<Autopilot[]> {
  const data = await httpGet<ListAutopilotsResponse>("/autopilots");
  return enrich(data.autopilots ?? []);
}

export async function getAutopilot(id: string): Promise<GetAutopilotResponse> {
  const [data] = await Promise.all([
    httpGet<GetAutopilotResponse>(`/autopilots/${id}`),
    ensureDirectory(),
  ]);
  const [autopilot] = await enrich([data.autopilot]);
  return { autopilot, triggers: data.triggers ?? [] };
}

export function createAutopilot(req: CreateAutopilotRequest): Promise<Autopilot> {
  return httpPost<Autopilot>("/autopilots", req);
}

export function updateAutopilot(id: string, req: UpdateAutopilotRequest): Promise<Autopilot> {
  return httpPatch<Autopilot>(`/autopilots/${id}`, req);
}

export function deleteAutopilot(id: string): Promise<void> {
  return httpDelete<void>(`/autopilots/${id}`);
}

export function triggerAutopilot(id: string): Promise<AutopilotRun> {
  return httpPost<AutopilotRun>(`/autopilots/${id}/trigger`);
}

export function createAutopilotTrigger(
  autopilotId: string,
  req: CreateAutopilotTriggerRequest,
): Promise<AutopilotTrigger> {
  return httpPost<AutopilotTrigger>(`/autopilots/${autopilotId}/triggers`, req);
}

export function updateAutopilotTrigger(
  autopilotId: string,
  triggerId: string,
  req: UpdateAutopilotTriggerRequest,
): Promise<AutopilotTrigger> {
  return httpPatch<AutopilotTrigger>(
    `/autopilots/${autopilotId}/triggers/${triggerId}`,
    req,
  );
}

export function deleteAutopilotTrigger(autopilotId: string, triggerId: string): Promise<void> {
  return httpDelete<void>(`/autopilots/${autopilotId}/triggers/${triggerId}`);
}

export async function listAutopilotRuns(
  id: string,
  params?: { limit?: number; offset?: number },
): Promise<ListAutopilotRunsResponse> {
  const data = await httpGet<ListAutopilotRunsResponse>(`/autopilots/${id}/runs`, params);
  return { runs: data.runs ?? [], total: data.total ?? 0 };
}
