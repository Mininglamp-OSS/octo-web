import { describe, expect, it, vi } from "vitest";
import { consumeSummaryScheduleOpen, requestSummaryScheduleOpen, consumeSummaryDetailAction, requestSummaryDetailAction } from "./summaryDetailIntent";

describe("summary detail navigation intent", () => {
    it("survives navigation before mounting, and is consumed only once", () => {
        requestSummaryScheduleOpen(1, "space");
        expect(consumeSummaryScheduleOpen(1, "space")).toBe(true);
        expect(consumeSummaryScheduleOpen(1, "space")).toBe(false);
    });
    it("never transfers intent to a different task or space", () => {
        requestSummaryScheduleOpen(1, "space");
        expect(consumeSummaryScheduleOpen(2, "space")).toBe(false);
        expect(consumeSummaryScheduleOpen(1, "other-space")).toBe(false);
        expect(consumeSummaryScheduleOpen(1, "space")).toBe(true);
    });
    it("a newer click supersedes the previous request", () => {
        requestSummaryScheduleOpen(1, "space");
        requestSummaryScheduleOpen(2, "space");
        expect(consumeSummaryScheduleOpen(2, "space")).toBe(true);
    });
    it.each(["regenerate", "retry", "edit"] as const)("waits for readiness before consuming %s", (action) => {
        requestSummaryDetailAction(1, "space", action);
        expect(consumeSummaryScheduleOpen(1, "space")).toBe(false);
        expect(consumeSummaryDetailAction(1, "space", () => false)).toBeNull();
        expect(consumeSummaryDetailAction(1, "space")).toBe(action);
        expect(consumeSummaryDetailAction(1, "space")).toBeNull();
    });
    it("expires abandoned actions", () => {
        const now = vi.spyOn(Date, "now").mockReturnValue(0);
        try {
            requestSummaryDetailAction(1, "space", "edit");
            now.mockReturnValue(120_001);
            expect(consumeSummaryDetailAction(1, "space")).toBeNull();
        } finally { now.mockRestore(); }
    });
});
