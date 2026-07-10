// @octo/loop — 执行记录 API（后端契约联调）
import type { TaskRun, RunMessage } from "./types";
import { httpGet, httpPost } from "./http";
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

/** 某次执行的消息流（run-messages）。since 给出后只取 seq 更大的增量（clean 会剔除 undefined）。 */
export function listRunMessages(taskId: string, since?: number): Promise<RunMessage[]> {
  return httpGet<RunMessage[]>(`/tasks/${taskId}/messages`, { since });
}

/** 重跑 issue：不带 task_id 按当前 assignee 重跑，带则重跑该 task 的 agent。后端返回新建 task。 */
export function rerunIssue(issueId: string, taskId?: string): Promise<TaskRun> {
  return httpPost<TaskRun>(`/issues/${issueId}/rerun`, taskId ? { task_id: taskId } : {});
}

/** 取消某次执行（只能取消属于该 issue 的 task）。 */
export function cancelTask(issueId: string, taskId: string): Promise<TaskRun> {
  return httpPost<TaskRun>(`/issues/${issueId}/tasks/${taskId}/cancel`, {});
}
