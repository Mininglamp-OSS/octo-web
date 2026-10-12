import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SummaryWorkbenchCreateEntry from "./SummaryWorkbenchCreateEntry";

const mocks = vi.hoisted(() => ({
    spaceId: "space-a",
    forceNewMount: vi.fn(),
    toastWarning: vi.fn(),
    capabilityReady: true,
}));

vi.mock("@douyinfe/semi-ui", () => ({
    Spin: () => <div data-testid="loading" />,
    Toast: { warning: (...args: unknown[]) => mocks.toastWarning(...args) },
}));

vi.mock("@octo/base", () => ({
    default: { loginInfo: { uid: "test-uid" } },
    WKApp: { loginInfo: { uid: "test-uid" } },
    useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock("@octo/base/src/App", () => ({
    default: { loginInfo: { uid: "test-uid" } },
    useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock("./useCurrentSummarySpaceId", () => ({
    default: () => mocks.spaceId,
}));

vi.mock("./Entry", () => ({
    default: ({
        renderNew,
        renderPending,
    }: {
        renderNew: (availability: unknown) => React.ReactNode;
        renderPending: () => React.ReactNode;
    }) => (
        <>
            {mocks.capabilityReady
                ? renderNew({ maxTimeRangeDays: 90, directTeamWorkflow: true })
                : renderPending()}
        </>
    ),
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
        localStorage.clear();
        mocks.spaceId = "space-a";
        mocks.forceNewMount.mockReset();
        mocks.toastWarning.mockReset();
        mocks.capabilityReady = true;
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
        const onForceNewSessionConsumed = vi.fn();
        const view = render(
            <SummaryWorkbenchCreateEntry
                source="summary_home"
                forceNewSession
                onForceNewSessionConsumed={onForceNewSessionConsumed}
            />,
            { legacyRoot: true }
        );

        await waitFor(() =>
            expect(mocks.forceNewMount).toHaveBeenCalledTimes(1)
        );
        expect(onForceNewSessionConsumed).toHaveBeenCalledTimes(1);
        expect(screen.getByTestId("force-new-session")).toHaveTextContent(
            "false"
        );

        mocks.spaceId = "space-b";
        view.rerender(
            <SummaryWorkbenchCreateEntry
                source="summary_home"
                forceNewSession
                onForceNewSessionConsumed={onForceNewSessionConsumed}
            />
        );

        expect(mocks.forceNewMount).toHaveBeenCalledTimes(1);
        expect(onForceNewSessionConsumed).toHaveBeenCalledTimes(1);
        expect(screen.getByTestId("force-new-session")).toHaveTextContent(
            "false"
        );
    });

    it("moves the persisted session before mounting a fresh workbench", async () => {
        const key = "summary-workbench-session:v2:test-uid:space-a:global";
        localStorage.setItem(key, "old-session");

        render(
            <SummaryWorkbenchCreateEntry
                source="summary_home"
                forceNewSession
            />,
            { legacyRoot: true }
        );

        await waitFor(() => expect(mocks.forceNewMount).toHaveBeenCalled());
        expect(localStorage.getItem(key)).toBeNull();
        expect(localStorage.getItem(`${key}:previous`)).toBe("old-session");
    });

    it("starts fresh in memory when the previous slot cannot be written", async () => {
        const key = "summary-workbench-session:v2:test-uid:space-a:global";
        const previousKey = `${key}:previous`;
        localStorage.setItem(key, "old-session");
        const originalSetItem = Storage.prototype.setItem;
        const setSpy = vi
            .spyOn(Storage.prototype, "setItem")
            .mockImplementation(function (storageKey, value) {
                if (storageKey === previousKey) {
                    throw new DOMException("full", "QuotaExceededError");
                }
                return originalSetItem.call(this, storageKey, value);
            });

        render(
            <SummaryWorkbenchCreateEntry
                source="summary_home"
                forceNewSession
            />,
            { legacyRoot: true }
        );

        await waitFor(() => expect(mocks.forceNewMount).toHaveBeenCalledTimes(1));
        expect(localStorage.getItem(key)).toBeNull();
        expect(localStorage.getItem(previousKey)).toBeNull();
        expect(mocks.toastWarning).toHaveBeenCalledWith(
            "summary.workbench.errors.previousSessionSaveFailed"
        );
        setSpy.mockRestore();
    });

    it("withdraws fresh intent while capability availability is pending", async () => {
        const key = "summary-workbench-session:v2:test-uid:space-a:global";
        localStorage.setItem(key, "current-session");
        mocks.capabilityReady = false;
        const view = render(
            <SummaryWorkbenchCreateEntry
                source="summary_home"
                forceNewSession
            />,
            { legacyRoot: true }
        );

        view.rerender(<SummaryWorkbenchCreateEntry source="summary_home" />);
        mocks.capabilityReady = true;
        view.rerender(<SummaryWorkbenchCreateEntry source="summary_home" />);

        await waitFor(() =>
            expect(screen.getByTestId("force-new-session")).toHaveTextContent(
                "false"
            )
        );
        expect(mocks.forceNewMount).not.toHaveBeenCalled();
        expect(localStorage.getItem(key)).toBe("current-session");
        expect(localStorage.getItem(`${key}:previous`)).toBeNull();
    });

    it.each(["space", "channel", "user"] as const)(
        "does not carry pending fresh intent into a different %s scope",
        async (scopeField) => {
            let uid = "user-a";
            let channel = { channelID: "channel-a", channelType: 1 };
            const messaging = {
                getCurrentUser: () => ({ uid }),
            } as NonNullable<
                React.ComponentProps<
                    typeof SummaryWorkbenchCreateEntry
                >["messaging"]
            >;
            const onForceNewSessionConsumed = vi.fn();
            const storageKey = () =>
                [
                    "summary-workbench-session:v2",
                    uid,
                    mocks.spaceId,
                    channel.channelID,
                    `type:${channel.channelType}`,
                ].join(":");

            localStorage.setItem(storageKey(), "origin-session");
            mocks.capabilityReady = false;
            const view = render(
                <SummaryWorkbenchCreateEntry
                    source="chat_aside"
                    forceNewSession
                    channel={channel}
                    messaging={messaging}
                    onForceNewSessionConsumed={onForceNewSessionConsumed}
                />,
                { legacyRoot: true }
            );
            const originKey = storageKey();

            if (scopeField === "space") mocks.spaceId = "space-b";
            if (scopeField === "channel") {
                channel = { channelID: "channel-b", channelType: 2 };
            }
            if (scopeField === "user") uid = "user-b";
            const destinationKey = storageKey();
            localStorage.setItem(destinationKey, "destination-session");
            mocks.capabilityReady = true;
            view.rerender(
                <SummaryWorkbenchCreateEntry
                    source="chat_aside"
                    forceNewSession
                    channel={channel}
                    messaging={messaging}
                    onForceNewSessionConsumed={onForceNewSessionConsumed}
                />
            );

            await waitFor(() =>
                expect(
                    screen.getByTestId("force-new-session")
                ).toHaveTextContent("false")
            );
            expect(mocks.forceNewMount).not.toHaveBeenCalled();
            expect(localStorage.getItem(originKey)).toBe("origin-session");
            expect(localStorage.getItem(destinationKey)).toBe(
                "destination-session"
            );
            expect(
                localStorage.getItem(`${destinationKey}:previous`)
            ).toBeNull();
            expect(onForceNewSessionConsumed).toHaveBeenCalledTimes(1);
        }
    );

    it("re-arms force-new on a false to true prop transition", async () => {
        const view = render(
            <SummaryWorkbenchCreateEntry source="summary_home" />,
            {
                legacyRoot: true,
            }
        );

        fireEvent.change(
            screen.getByRole("textbox", { name: "workbench-draft" }),
            {
                target: { value: "stale draft" },
            }
        );

        view.rerender(
            <SummaryWorkbenchCreateEntry
                source="summary_home"
                forceNewSession
            />
        );

        await waitFor(() =>
            expect(mocks.forceNewMount).toHaveBeenCalledTimes(1)
        );
        expect(
            screen.getByRole("textbox", { name: "workbench-draft" })
        ).toHaveValue("");
        expect(screen.getByTestId("force-new-session")).toHaveTextContent(
            "false"
        );
    });
});
