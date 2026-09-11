import { TriggerType, type SummaryDetail } from "../types/summary";

export function savedGenerationRequirement(detail: SummaryDetail | null): string {
    if (!detail) return "";
    if (detail.generation_requirement !== undefined) return detail.generation_requirement;
    // Compatibility with an older backend: never present the Agent title as
    // the previous prompt. Workflow topic already is the execution instruction.
    return detail.trigger_type === TriggerType.AGENT ? "" : detail.topic || detail.title || "";
}

export function hasGenerationTimeRange(detail: SummaryDetail | null): boolean {
    return !!detail && Date.parse(detail.time_range_end) > Date.parse(detail.time_range_start);
}
