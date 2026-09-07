import { Dap } from "@octo/base";
import type { CreateAgentSummaryResult } from "../types/summary";

export function trackAgentSummaryQuality(
  result: CreateAgentSummaryResult,
  context: Record<string, unknown> = {}
): void {
  if (!result.finish_status) return;

  Dap.shared.track("smart_summary_quality_gate", {
    ...context,
    task_id: result.task_id,
    finish_status: result.finish_status,
    gap_count: result.gaps?.length ?? 0,
    ...(result.gaps?.[0]?.kind
      ? { first_gap_kind: result.gaps[0].kind }
      : {}),
  });
}
