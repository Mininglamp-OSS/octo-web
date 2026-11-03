import { useEffect, useRef, useState } from "react";
import { batchStatus, getSummaryDetail, regenerateSummary } from "../../api/summaryApi";
import { TaskStatus, type TaskStatusType } from "../../types/summary";

export interface WorkflowStatus {
  taskId: number;
  status: TaskStatusType;
  reason?: string;
  failureCode?: string;
  canRetry?: boolean;
}

export function useWorkflowTaskStatus(taskId: number | undefined, userId: string) {
  const [snapshot, setSnapshot] = useState<WorkflowStatus>();
  const [refresh, setRefresh] = useState(0);
  const retrying = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!taskId) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll(id: number) {
      try {
        const items = await batchStatus([id]);
        const task = items.find(item => item.id === id);
        if (!task || !active) return;
        const result: WorkflowStatus = { taskId: id, status: task.status };
        if (task.status === TaskStatus.FAILED) {
          const detail = await getSummaryDetail(id);
          result.status = detail.status;
          result.reason = detail.error_message ?? undefined;
          result.failureCode = detail.failure_code;
          result.canRetry = detail.creator_id === userId && result.failureCode !== "gateway_quota";
        }
        if (!active) return;
        setSnapshot(result);
        if ([TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.CANCELLED].some(status => status === result.status)) return;
      } catch {
        // Reading progress can fail temporarily; the task itself may still finish.
      }
      if (active) timer = setTimeout(() => void poll(id), 3000);
    }
    void poll(taskId);
    return () => { active = false; clearTimeout(timer); };
  }, [taskId, userId, refresh]);

  const current = snapshot?.taskId === taskId ? snapshot : undefined;
  async function retry() {
    if (!taskId || retrying.current === taskId || current?.status !== TaskStatus.FAILED || !current.canRetry) return;
    retrying.current = taskId;
    try {
      await regenerateSummary(taskId, undefined, TaskStatus.FAILED);
      setSnapshot({ taskId, status: TaskStatus.PENDING });
    } finally {
      retrying.current = undefined;
      setRefresh(value => value + 1);
    }
  }
  return { current, retry };
}
