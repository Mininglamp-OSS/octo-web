import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import SummaryWorkbenchCreateEntry from "./SummaryWorkbenchCreateEntry";

vi.mock("@douyinfe/semi-ui", () => ({
    Spin: () => <div data-testid="loading" />,
}));

vi.mock("./useCurrentSummarySpaceId", () => ({
    default: () => "space-a",
}));

vi.mock("./Entry", () => ({
    default: ({
        renderNew,
    }: {
        renderNew: (availability: unknown) => React.ReactNode;
    }) => <>{renderNew({ maxTimeRangeDays: 90 })}</>,
}));

vi.mock("./SummaryWorkbenchFeature", () => ({
    default: (props: {
        onOpenScheduledSummary?: () => void;
        maxTimeRangeDays?: number;
    }) => {
        const [draft, setDraft] = React.useState("");
        return (
            <div>
                <span data-testid="max-time-range-days">
                    {props.maxTimeRangeDays}
                </span>
                <input
                    aria-label="workbench-draft"
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                />
                <button type="button" onClick={props.onOpenScheduledSummary}>
                    open-schedule
                </button>
            </div>
        );
    },
}));

vi.mock("../../pages/SummaryCreatePage", () => ({
    default: (props: {
        initialMode?: string;
        initialScheduleOpen?: boolean;
        onBackToWorkbench?: () => void;
    }) => (
        <div
            data-testid="legacy-schedule"
            data-initial-mode={props.initialMode}
            data-schedule-open={String(props.initialScheduleOpen)}
        >
            <button type="button" onClick={props.onBackToWorkbench}>
                back-to-workbench
            </button>
        </div>
    ),
}));

describe("SummaryWorkbenchCreateEntry scheduled summary bridge", () => {
    it("passes the server-advertised time range limit to the Workbench", () => {
        render(<SummaryWorkbenchCreateEntry source="summary_home" />, {
            legacyRoot: true,
        });

        expect(screen.getByTestId("max-time-range-days")).toHaveTextContent(
            "90"
        );
    });

    it("remounts the workbench when the channel type changes for the same id", () => {
        const view = render(
            <SummaryWorkbenchCreateEntry
                source="chat_aside"
                channel={{ channelID: "shared-id", channelType: 1 }}
            />,
            { legacyRoot: true }
        );

        fireEvent.change(
            screen.getByRole("textbox", { name: "workbench-draft" }),
            {
                target: { value: "direct-chat draft" },
            }
        );
        expect(
            screen.getByRole("textbox", { name: "workbench-draft" })
        ).toHaveValue("direct-chat draft");

        view.rerender(
            <SummaryWorkbenchCreateEntry
                source="chat_aside"
                channel={{ channelID: "shared-id", channelType: 2 }}
            />
        );

        expect(
            screen.getByRole("textbox", { name: "workbench-draft" })
        ).toHaveValue("");
    });

    it("opens scheduled summaries in Legacy and can return to the Workbench", () => {
        render(<SummaryWorkbenchCreateEntry source="summary_home" />, {
            legacyRoot: true,
        });

        fireEvent.change(
            screen.getByRole("textbox", { name: "workbench-draft" }),
            {
                target: { value: "unsent requirement" },
            }
        );
        fireEvent.click(screen.getByRole("button", { name: "open-schedule" }));
        const legacy = screen.getByTestId("legacy-schedule");
        expect(legacy.dataset.initialMode).toBe("normal");
        expect(legacy.dataset.scheduleOpen).toBe("true");

        fireEvent.click(
            screen.getByRole("button", { name: "back-to-workbench" })
        );
        expect(
            screen.getByRole("button", { name: "open-schedule" })
        ).toBeInTheDocument();
        expect(
            screen.getByRole("textbox", { name: "workbench-draft" })
        ).toHaveValue("unsent requirement");
    });
});
