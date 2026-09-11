import { describe, expect, it } from "vitest";
import { savedGenerationRequirement, hasGenerationTimeRange } from "./generationConfig";
import { getSummaryTypeKind } from "./summaryHelpers";
import { SummaryMode, TaskStatus, TriggerType, type SummaryDetail } from "../types/summary";

const detail: SummaryDetail = {
    task_id: 1, task_no: "test", title: "Display title", topic: "Workflow requirement",
    summary_mode: SummaryMode.BY_PERSON, status: TaskStatus.COMPLETED, trigger_type: TriggerType.AGENT,
    time_range_start: "2026-09-01T00:00:00Z", time_range_end: "2026-09-01T00:00:00Z",
    sources: [], participants: [], result: null, error_message: null,
    origin_channel_id: "", origin_channel_type: 0, created_at: "", updated_at: "",
};

describe("saved generation configuration", () => {
    it("does not mistake a legacy Agent title/topic for its original instruction", () => {
        expect(savedGenerationRequirement(detail)).toBe("");
        expect(savedGenerationRequirement({ ...detail, generation_requirement: "Original user request" })).toBe("Original user request");
    });
    it("preserves the existing Workflow prompt", () => {
        expect(savedGenerationRequirement({ ...detail, trigger_type: TriggerType.MANUAL })).toBe("Workflow requirement");
    });
    it("recognizes the legacy now/now placeholder as missing, not a selected range", () => {
        expect(hasGenerationTimeRange(detail)).toBe(false);
        expect(hasGenerationTimeRange({ ...detail, time_range_end: "2026-09-07T00:00:00Z" })).toBe(true);
    });
    it.each([TriggerType.AGENT, TriggerType.MANUAL, TriggerType.SCHEDULED])("classifies engine %s only by personal/team ownership", (trigger_type) => {
        expect(getSummaryTypeKind({ ...detail, trigger_type, schedule_id: 1 })).toBe("quick");
        expect(getSummaryTypeKind({ ...detail, trigger_type, participants: [{ user_id: "a" }, { user_id: "b" }] })).toBe("multi");
    });
});
