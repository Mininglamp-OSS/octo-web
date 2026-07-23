import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WKApp } from "@octo/base";
import SummaryShareDetailPage from "../SummaryShareDetailPage";
import { getSummaryShare } from "../../api/summaryApi";

vi.mock("../../api/summaryApi", () => ({ getSummaryShare: vi.fn() }));
vi.mock("@douyinfe/semi-icons", () => ({ IconArrowLeft: () => null }));
vi.mock("@douyinfe/semi-ui", () => ({
    Button: ({ children, onClick }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
        <button type="button" onClick={onClick}>{children}</button>
    ),
    Spin: () => <span>loading</span>,
}));
vi.mock("wukongimjssdk", () => ({
    Channel: class Channel {
        constructor(public channelID: string, public channelType: number) {}
    },
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

describe("SummaryShareDetailPage return to chat", () => {
    const showConversation = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(getSummaryShare).mockResolvedValue(response);
        WKApp.endpoints.showConversation = showConversation;
    });

    it("opens the source conversation when entered from a summary card", async () => {
        render(<SummaryShareDetailPage
            shareId="share-1"
            originChannel={{ channelId: "group-1", channelType: 2 }}
        />);

        fireEvent.click(await screen.findByRole("button", { name: "返回群聊" }));

        expect(showConversation).toHaveBeenCalledOnce();
        expect(showConversation.mock.calls[0][0]).toMatchObject({
            channelID: "group-1",
            channelType: 2,
        });
    });

    it("hides the action on a direct share link", async () => {
        render(<SummaryShareDetailPage shareId="share-1" />);

        await screen.findByRole("heading", { name: "Shared summary" });
        expect(screen.queryByRole("button", { name: "返回群聊" })).toBeNull();
    });

    it("shows the source saved in the snapshot in the bottom source panel", async () => {
        render(<SummaryShareDetailPage shareId="share-1" />);

        expect(await screen.findByText("Project group")).toBeInTheDocument();
        expect(screen.getByText("已选择的信息来源")).toBeInTheDocument();
        expect(screen.queryByText("来自「Project group」")).toBeNull();
    });

    it("shows the empty source state when the snapshot has no source name", async () => {
        vi.mocked(getSummaryShare).mockResolvedValue({
            ...response,
            snapshot: { ...response.snapshot, source_name: "" },
        });

        render(<SummaryShareDetailPage shareId="share-1" />);

        expect(await screen.findByText("暂无来源")).toBeInTheDocument();
    });
});
