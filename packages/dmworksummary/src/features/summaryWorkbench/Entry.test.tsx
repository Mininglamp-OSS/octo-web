import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
    SummaryWorkbenchAvailability,
    type SummaryWorkbenchCapabilitySource,
} from "./availability";
import SummaryWorkbenchEntry from "./Entry";

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((resolvePromise) => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
}

function entry(
    availability: SummaryWorkbenchAvailability,
    spaceId: string,
    suffix = ""
) {
    return (
        <SummaryWorkbenchEntry
            availability={availability}
            spaceId={spaceId}
            renderPending={() => <div data-testid={`pending${suffix}`} />}
            renderNew={() => <div data-testid={`new${suffix}`} />}
            renderLegacy={(decision) => (
                <div data-testid={`legacy${suffix}`}>{decision.reason}</div>
            )}
        />
    );
}

describe("SummaryWorkbenchEntry", () => {
    it("renders pending without flashing Legacy, then selects the new entry", async () => {
        const response = deferred<unknown>();
        const availability = new SummaryWorkbenchAvailability({
            getCapabilities: vi.fn(() => response.promise),
        });

        render(entry(availability, "space-a"));
        expect(screen.getByTestId("pending")).toBeInTheDocument();
        expect(screen.queryByTestId("legacy")).not.toBeInTheDocument();

        response.resolve({
            enabled: true,
            contract_version: "1",
            max_time_range_days: 90,
            direct_team_workflow: true,
        });
        expect(await screen.findByTestId("new")).toBeInTheDocument();
    });

    it("uses Legacy when capability loading fails closed", async () => {
        const availability = new SummaryWorkbenchAvailability({
            getCapabilities: vi.fn().mockResolvedValue({
                enabled: true,
                contract_version: "2",
                max_time_range_days: 90,
                direct_team_workflow: false,
            }),
        });

        render(entry(availability, "space-a"));
        expect(await screen.findByTestId("legacy")).toHaveTextContent(
            "unsupported_contract"
        );
    });

    it("keeps an already mounted entry sticky while a new entry observes invalidation", async () => {
        const source: SummaryWorkbenchCapabilitySource = {
            getCapabilities: vi
                .fn()
                .mockResolvedValueOnce({
                    enabled: true,
                    contract_version: "1",
                    max_time_range_days: 90,
                    direct_team_workflow: true,
                })
                .mockResolvedValueOnce({
                    enabled: false,
                    contract_version: "1",
                    max_time_range_days: 90,
                    direct_team_workflow: false,
                }),
        };
        const availability = new SummaryWorkbenchAvailability(source);
        const { rerender } = render(entry(availability, "space-a", "-first"));
        expect(await screen.findByTestId("new-first")).toBeInTheDocument();

        availability.invalidate("space-a");
        rerender(
            <>
                {entry(availability, "space-a", "-first")}
                {entry(availability, "space-a", "-second")}
            </>
        );

        expect(screen.getByTestId("new-first")).toBeInTheDocument();
        expect(await screen.findByTestId("legacy-second")).toHaveTextContent(
            "server_disabled"
        );
        expect(source.getCapabilities).toHaveBeenCalledTimes(2);
    });

    it("resets the sticky decision when the current Space changes", async () => {
        const source: SummaryWorkbenchCapabilitySource = {
            getCapabilities: vi
                .fn()
                .mockResolvedValueOnce({
                    enabled: true,
                    contract_version: "1",
                    max_time_range_days: 90,
                    direct_team_workflow: true,
                })
                .mockResolvedValueOnce({
                    enabled: false,
                    contract_version: "1",
                    max_time_range_days: 90,
                    direct_team_workflow: false,
                }),
        };
        const availability = new SummaryWorkbenchAvailability(source);
        const { rerender } = render(entry(availability, "space-a"));
        expect(await screen.findByTestId("new")).toBeInTheDocument();

        rerender(entry(availability, "space-b"));
        await waitFor(() => {
            expect(screen.getByTestId("legacy")).toHaveTextContent(
                "server_disabled"
            );
        });
    });

    it("uses Legacy immediately when there is no current Space", () => {
        const source: SummaryWorkbenchCapabilitySource = {
            getCapabilities: vi.fn(),
        };
        const availability = new SummaryWorkbenchAvailability(source);

        render(entry(availability, "  "));
        expect(screen.getByTestId("legacy")).toHaveTextContent("missing_space");
        expect(source.getCapabilities).not.toHaveBeenCalled();
    });
});
