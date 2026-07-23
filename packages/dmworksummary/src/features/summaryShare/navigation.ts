import type { GetSummaryShareResponse } from "../../types/summary";

export function shouldOpenOriginalSummary(share: GetSummaryShareResponse): boolean {
    return share.source_accessible;
}

export function getOriginalSummaryTaskId(share: GetSummaryShareResponse): number {
    return share.snapshot.task_id;
}
