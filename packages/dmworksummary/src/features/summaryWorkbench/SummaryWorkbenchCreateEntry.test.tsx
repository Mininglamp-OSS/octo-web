import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SummaryWorkbenchCreateEntry from "./SummaryWorkbenchCreateEntry";

const entryMocks = vi.hoisted(() => ({ renderLegacy: false }));

vi.mock("@douyinfe/semi-ui", () => ({
    Spin: () => <div data-testid="loading" />,
}));

vi.mock("./useCurrentSummarySpaceId", () => ({
    default: () => "space-a",
}));

vi.mock("./Entry", () => ({
    default: ({
        renderNew,
        renderLegacy,
    }: {
        renderNew: (availability: unknown) => React.ReactNode;
        renderLegacy: (availability: unknown) => React.ReactNode;
    }) => <>{entryMocks.renderLegacy
        ? renderLegacy({ documentSources: true })
        : renderNew({
            maxTimeRangeDays: 90,
            directTeamWorkflow: true,
            documentSources: true,
        })}</>,
}));

vi.mock("./SummaryWorkbenchFeature", () => ({
    default: (props: {
        maxTimeRangeDays?: number;
        directTeamWorkflow?: boolean;
        documentSourcesAvailable?: boolean;
    }) => {
        const [draft, setDraft] = React.useState("");
        return (
            <div>
                <span data-testid="max-time-range-days">
                    {props.maxTimeRangeDays}
                </span>
                <span data-testid="direct-team-workflow">
                    {String(props.directTeamWorkflow)}
                </span>
                <span data-testid="document-sources">
                    {String(props.documentSourcesAvailable)}
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
    default: (props: { documentSourcesAvailable?: boolean }) => (
        <div data-testid="legacy-create">
            {String(props.documentSourcesAvailable)}
        </div>
    ),
}));

describe("SummaryWorkbenchCreateEntry", () => {
    beforeEach(() => {
        entryMocks.renderLegacy = false;
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
        expect(screen.getByTestId("document-sources")).toHaveTextContent("true");
    });

    it("passes document source availability to the Legacy fallback", () => {
        entryMocks.renderLegacy = true;
        render(<SummaryWorkbenchCreateEntry source="summary_home" />, {
            legacyRoot: true,
        });

        expect(screen.getByTestId("legacy-create")).toHaveTextContent("true");
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
});
