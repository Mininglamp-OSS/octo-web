// @octo/loop — 执行记录 API（真实 fleet 联调）
import type { TaskRun, RunMessage } from "./types";
import { httpGet } from "./http";
import { ensureDirectory } from "./directory";

/** 某 issue 的执行记录列表（runs）。 */
export async function listRuns(issueId: string): Promise<TaskRun[]> {
  const [rows, dir] = await Promise.all([
    httpGet<TaskRun[]>(`/issues/${issueId}/task-runs`).catch(() => [] as TaskRun[]),
    ensureDirectory(),
  ]);
  return (rows ?? [])
    .map((r) => ({ ...r, agent_name: r.agent_id ? dir.agentName.get(r.agent_id) ?? null : null }))
    .sort((a, b) => (b.created_at ?? b.dispatched_at ?? "").localeCompare(a.created_at ?? a.dispatched_at ?? ""));
}

/** 某次执行的消息流（run-messages）。 */
export function listRunMessages(taskId: string): Promise<RunMessage[]> {
  return httpGet<RunMessage[]>(`/tasks/${taskId}/messages`);
}
