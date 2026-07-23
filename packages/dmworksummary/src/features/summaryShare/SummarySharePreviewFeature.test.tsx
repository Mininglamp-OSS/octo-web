import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SummarySharePreviewFeature from "./SummarySharePreviewFeature";
import { getSummaryShare } from "../../api/summaryApi";

vi.mock("../../api/summaryApi", () => ({ getSummaryShare: vi.fn() }));
vi.mock("@douyinfe/semi-icons", () => ({ IconClose: () => <span aria-hidden="true" /> }));
vi.mock("@douyinfe/semi-ui", () => ({
    Button: ({ children, disabled, onClick, "aria-label": ariaLabel }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
        <button type="button" disabled={disabled} onClick={onClick} aria-label={ariaLabel}>{children}</button>
    ),
    Spin: () => <span>loading</span>,
}));

const response = {
    share_id: "share-1",
    source_accessible: false,
    snapshot: {
        id: 1, task_id: 2, task_no: "ST2", space_id: "space-1",
        title: "Shared summary", source_name: "Project group", source_count: 1,
        participant_count: 3, message_count: 12,
        time_range_start: "2026-07-15T00:00:00Z", time_range_end: "2026-07-16T00:00:00Z",
        summary_mode: 1, result_version: 1, preview: "Preview", content: "## Result",
        created_at: "2026-07-16T01:00:00Z",
    },
};

describe("SummarySharePreviewFeature", () => {
    beforeEach(() => vi.clearAllMocks());

    it("loads the snapshot and opens the read-only detail", async () => {
        vi.mocked(getSummaryShare).mockResolvedValue(response);
        const onOpenDetail = vi.fn();
        render(<SummarySharePreviewFeature shareId="share-1" onClose={vi.fn()} onOpenDetail={onOpenDetail} />);

        expect(getSummaryShare).toHaveBeenCalledWith("share-1");
        expect(await screen.findByText("Shared summary")).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "查看总结详情" }));
        expect(onOpenDetail).toHaveBeenCalledOnce();
    });

    it("shows the unavailable state when the grant cannot be read", async () => {
        vi.mocked(getSummaryShare).mockRejectedValue(new Error("not found"));
        render(<SummarySharePreviewFeature shareId="missing" onClose={vi.fn()} onOpenDetail={vi.fn()} />);

        await waitFor(() => expect(screen.getByText("该分享不存在、已失效或你无权查看")).toBeInTheDocument());
        expect(screen.getByRole("button", { name: "查看总结详情" })).toBeDisabled();
    });
});
