import { describe, expect, it } from "vitest";
import { consumeSummaryScheduleOpen, requestSummaryScheduleOpen } from "./summaryScheduleIntent";

describe("schedule navigation intent", () => {
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
});
