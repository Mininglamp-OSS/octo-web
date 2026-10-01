import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SummaryWorkbenchCreateEntry from "./SummaryWorkbenchCreateEntry";

const mocks = vi.hoisted(() => ({
    spaceId: "space-a",
    forceNewMount: vi.fn(),
}));

vi.mock("@douyinfe/semi-ui", () => ({
    Spin: () => <div data-testid="loading" />,
}));

vi.mock("./useCurrentSummarySpaceId", () => ({
    default: () => mocks.spaceId,
}));

vi.mock("./Entry", () => ({
    default: ({
        renderNew,
    }: {
        renderNew: (availability: unknown) => React.ReactNode;
    }) => <>{renderNew({ maxTimeRangeDays: 90, directTeamWorkflow: true })}</>,
}));

vi.mock("./SummaryWorkbenchFeature", () => ({
    default: (props: {
        maxTimeRangeDays?: number;
        directTeamWorkflow?: boolean;
        forceNewSession?: boolean;
        onForceNewSessionConsumed?: () => void;
    }) => {
        const [draft, setDraft] = React.useState("");
        React.useEffect(() => {
            if (!props.forceNewSession) return;
            mocks.forceNewMount();
            props.onForceNewSessionConsumed?.();
        }, [props.forceNewSession, props.onForceNewSessionConsumed]);
        return (
            <div>
                <span data-testid="max-time-range-days">
                    {props.maxTimeRangeDays}
                </span>
                <span data-testid="direct-team-workflow">
                    {String(props.directTeamWorkflow)}
                </span>
                <span data-testid="force-new-session">
                    {String(props.forceNewSession)}
                </span>
                <input
                    aria-label="workbench-draft"
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                />
            </div>
        );
    },
}));

vi.mock("../../pages/SummaryCreatePage", () => ({
    default: () => <div data-testid="legacy-create" />,
}));

describe("SummaryWorkbenchCreateEntry", () => {
    beforeEach(() => {
        mocks.spaceId = "space-a";
        mocks.forceNewMount.mockReset();
    });

    it("passes the server-advertised time range limit to the Workbench", () => {
        render(<SummaryWorkbenchCreateEntry source="summary_home" />, {
            legacyRoot: true,
        });

        expect(screen.getByTestId("max-time-range-days")).toHaveTextContent(
            "90"
        );
        expect(screen.getByTestId("direct-team-workflow")).toHaveTextContent(
            "true"
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

    it("consumes force-new once so a space remount cannot demote again", async () => {
        const view = render(
            <SummaryWorkbenchCreateEntry
                source="summary_home"
                forceNewSession
            />,
            { legacyRoot: true }
        );

        await waitFor(() => expect(mocks.forceNewMount).toHaveBeenCalledTimes(1));
        expect(screen.getByTestId("force-new-session")).toHaveTextContent(
            "false"
        );

        mocks.spaceId = "space-b";
        view.rerender(
            <SummaryWorkbenchCreateEntry
                source="summary_home"
                forceNewSession
            />
        );

        expect(mocks.forceNewMount).toHaveBeenCalledTimes(1);
        expect(screen.getByTestId("force-new-session")).toHaveTextContent(
            "false"
        );
    });

    it("re-arms force-new on a false to true prop transition", async () => {
        const view = render(
            <SummaryWorkbenchCreateEntry source="summary_home" />,
            { legacyRoot: true }
        );

        fireEvent.change(
            screen.getByRole("textbox", { name: "workbench-draft" }),
            { target: { value: "stale draft" } }
        );

        view.rerender(
            <SummaryWorkbenchCreateEntry
                source="summary_home"
                forceNewSession
            />
        );

        await waitFor(() => expect(mocks.forceNewMount).toHaveBeenCalledTimes(1));
        expect(
            screen.getByRole("textbox", { name: "workbench-draft" })
        ).toHaveValue("");
        expect(screen.getByTestId("force-new-session")).toHaveTextContent(
            "false"
        );
    });
});
