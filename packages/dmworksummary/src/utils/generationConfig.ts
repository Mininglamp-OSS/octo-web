import { SummaryMode, TriggerType, type SummaryDetail } from "../types/summary";

export function savedGenerationRequirement(detail: SummaryDetail | null): string {
    if (!detail) return "";
    if (detail.generation_requirement?.trim()) return detail.generation_requirement;
    // Compatibility with an older backend: never present the Agent title as
    // the previous prompt. Workflow topic already is the execution instruction.
    return detail.trigger_type === TriggerType.AGENT ? "" : detail.topic || detail.title || "";
}

export function hasGenerationTimeRange(detail: SummaryDetail | null): boolean {
    return !!detail && Date.parse(detail.time_range_end) > Date.parse(detail.time_range_start);
}

// The paired backend always emits this field, including "" for an Agent save
// with missing configuration. Older servers omit it and lack the config API.
export function supportsGenerationConfig(detail: SummaryDetail | null): boolean {
    return typeof detail?.generation_requirement === "string";
}

export function canCompleteGenerationConfig(detail: SummaryDetail | null, forSchedule = false): boolean {
    return !!detail && detail.trigger_type === TriggerType.AGENT && supportsGenerationConfig(detail) &&
        (forSchedule || (detail.summary_mode === SummaryMode.BY_PERSON && (detail.participants?.length ?? 0) <= 1));
}
