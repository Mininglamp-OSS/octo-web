import { TaskStatus, type SummaryListItem } from "../../types/summary";

export type SummaryListAction = "refine" | "edit" | "regenerate" | "configure" | "cancel" | "retry";

/** No engine or referenceability inference. A malformed projection fails closed. */
export function summaryListActions(task: SummaryListItem) {
  const projection = task.content_actions;
  const unavailable = {
    mode: "unavailable" as const, contentId: undefined as string | undefined,
    refine: false, edit: false, regenerate: false, configure: false, cancel: false, retry: false,
  };
  if (projection != null) {
    if (projection.contract_version !== 1 || !["formal", "legacy", "unavailable"].includes(projection.mode)) return unavailable;
    if (projection.mode === "unavailable") return unavailable;
    if (projection.mode === "formal") {
      if (typeof projection.content_id !== "string" || !projection.content_id || !projection.capabilities) return unavailable;
      const caps = projection.capabilities;
      return {
        mode: "formal" as const, contentId: projection.content_id,
        refine: caps.can_refine === true,
        edit: caps.can_edit === true,
        // 重新生成 opens the two-mode modal (按意见调整 + 全部重新生成). 按意见调整
        // is always available when refine is, and the modal itself greys 全部重新
        // 生成 (and points to 定时更新) when the configuration is still incomplete —
        // so the entry appears for both configured and unconfigured summaries.
        regenerate: caps.can_refine === true,
        configure: caps.can_configure_schedule === true,
        cancel: projection.active_generation?.can_cancel === true,
        retry: false,
      };
    }
  }
  if (task.content_protocol_version) return unavailable;
  return {
    mode: "legacy" as const, contentId: undefined,
    // Detail rechecks ownership, actual content and readiness.
    refine: task.status === TaskStatus.COMPLETED,
    edit: task.status === TaskStatus.COMPLETED || task.status === TaskStatus.FAILED,
    regenerate: false, configure: false,
    cancel: task.status === TaskStatus.PENDING || task.status === TaskStatus.WAITING_CONFIRM || task.status === TaskStatus.PROCESSING,
    retry: task.status === TaskStatus.FAILED,
  };
}
