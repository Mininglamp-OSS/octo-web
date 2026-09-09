import { Dap } from "@octo/base";
import type { CreateAgentSummaryResult } from "../types/summary";

const QUALITY_GAP_KINDS = new Set([
  "channel",
  "coverage",
  "truncation",
  "output_truncation",
  "dropped",
  "citation",
  "tool_error",
  "evidence",
]);

function boundedGapKind(kind: string): string {
  return QUALITY_GAP_KINDS.has(kind) ? kind : "other";
}

export function trackAgentSummaryQuality(
  result: CreateAgentSummaryResult,
  context: Record<string, unknown> = {}
): void {
  Dap.shared.track("smart_summary_quality_gate", {
    ...context,
    task_id: result.task_id,
    finish_status: result.finish_status ?? "unreported",
    gap_count: result.gaps?.length ?? 0,
    ...(result.gaps?.[0]?.kind
      ? { first_gap_kind: boundedGapKind(result.gaps[0].kind) }
      : {}),
  });
}
