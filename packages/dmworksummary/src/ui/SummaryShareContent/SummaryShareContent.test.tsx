import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import SummaryShareContent from ".";
import type { SummaryShareSnapshot } from "../../types/summary";

function snapshot(content: string): SummaryShareSnapshot {
    return {
        id: 1,
        task_id: 2,
        task_no: "ST2",
        space_id: "space-1",
        title: "Shared summary",
        source_name: "Project group",
        source_count: 1,
        participant_count: 3,
        message_count: 12,
        time_range_start: "2026-07-15T00:00:00Z",
        time_range_end: "2026-07-16T00:00:00Z",
        summary_mode: 1,
        result_version: 1,
        preview: "Preview",
        content,
        created_at: "2026-07-16T01:00:00Z",
    };
}

describe("SummaryShareContent", () => {
    it("renders summary metadata and safe markdown", () => {
        render(<SummaryShareContent
            snapshot={snapshot("## Result\n\n[Safe](https://example.com) and [Unsafe](javascript:alert(1))")}
            locale="en-US"
            metaLabel="Summary range"
            participantText="3 participants"
            messageText="12 messages"
        />);

        expect(screen.getByRole("heading", { name: "Result" })).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Safe" })).toHaveAttribute("href", "https://example.com");
        expect(screen.getByText("Unsafe").closest("a")).toBeNull();
        expect(screen.getByText("3 participants")).toBeInTheDocument();
    });

    it("does not render raw html or external images", () => {
        const { container } = render(<SummaryShareContent
            snapshot={snapshot('<script>alert(1)</script>\n\n![tracker](https://example.com/tracker.png)')}
            locale="en-US"
            metaLabel="Summary range"
            participantText="3 participants"
            messageText="12 messages"
        />);

        expect(container.querySelector("script")).toBeNull();
        expect(container.querySelector("img")).toBeNull();
        expect(screen.getByText("tracker")).toBeInTheDocument();
    });

    it("hides unavailable metadata without leaving empty separators", () => {
        const missingMeta = {
            ...snapshot("Result"),
            time_range_start: "",
            time_range_end: "",
        };
        const { container } = render(<SummaryShareContent
            snapshot={missingMeta}
            locale="en-US"
            metaLabel="Summary range"
            participantText=""
            messageText="12 messages"
        />);

        expect(screen.getByText("12 messages")).toBeInTheDocument();
        expect(container.querySelectorAll(".summary-share-content__meta span")).toHaveLength(1);
    });
});
