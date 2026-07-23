import { describe, expect, it } from "vitest";
import type { GetSummaryShareResponse } from "../../types/summary";
import { getOriginalSummaryTaskId, shouldOpenOriginalSummary } from "./navigation";

function share(participantCount: number, sourceAccessible: boolean): GetSummaryShareResponse {
    return {
        share_id: "share-1",
        source_accessible: sourceAccessible,
        snapshot: {
            id: 1, task_id: 2, task_no: "ST2", space_id: "space-1",
            title: "Summary", source_name: "Project group", source_count: 1,
            participant_count: participantCount, message_count: 12,
            time_range_start: "2026-07-15T00:00:00Z", time_range_end: "2026-07-16T00:00:00Z",
            summary_mode: 2, result_version: 1, preview: "Preview", content: "Result",
            created_at: "2026-07-16T01:00:00Z",
        },
    };
}

describe("shouldOpenOriginalSummary", () => {
    it("opens the original summary for an authorized multi-person participant", () => {
        expect(shouldOpenOriginalSummary(share(2, true))).toBe(true);
    });

    it("keeps unauthorized multi-person recipients on the shared snapshot", () => {
        expect(shouldOpenOriginalSummary(share(2, false))).toBe(false);
    });

    it("opens the original personal summary for its authorized owner", () => {
        expect(shouldOpenOriginalSummary(share(1, true))).toBe(true);
    });

    it("keeps other recipients of a personal summary on the shared snapshot", () => {
        expect(shouldOpenOriginalSummary(share(1, false))).toBe(false);
    });

    it("uses the numeric snapshot task id to locate the exact original summary", () => {
        const accessibleShare = share(1, true);
        accessibleShare.snapshot.task_no = "ST2";

        expect(getOriginalSummaryTaskId(accessibleShare)).toBe(2);
    });
});
