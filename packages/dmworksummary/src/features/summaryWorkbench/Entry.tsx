import React, { useRef, type ReactNode } from "react";
import {
    normalizeSummaryWorkbenchSpaceId,
    summaryWorkbenchAvailability,
    useSummaryWorkbenchAvailability,
    type SummaryWorkbenchAvailability,
    type SummaryWorkbenchDisabledAvailability,
    type SummaryWorkbenchEnabledAvailability,
    type SummaryWorkbenchLoadingAvailability,
} from "./availability";

export interface SummaryWorkbenchEntryProps {
    spaceId: string | null | undefined;
    renderNew: (availability: SummaryWorkbenchEnabledAvailability) => ReactNode;
    renderLegacy: (
        availability: SummaryWorkbenchDisabledAvailability
    ) => ReactNode;
    renderPending?: (
        availability: SummaryWorkbenchLoadingAvailability
    ) => ReactNode;
    availability?: SummaryWorkbenchAvailability;
}

interface StickyDecision {
    availability: SummaryWorkbenchAvailability;
    spaceId: string;
    decision?:
        | SummaryWorkbenchEnabledAvailability
        | SummaryWorkbenchDisabledAvailability;
}

/**
 * Fail-closed entry gate for the production summary surface.
 *
 * A resolved decision is sticky for this mounted entry and Space. Invalidating
 * the shared cache only affects newly mounted entries; it cannot replace an
 * active workbench with Legacy (or vice versa) halfway through a user flow.
 */
export function SummaryWorkbenchEntry({
    spaceId,
    renderNew,
    renderLegacy,
    renderPending,
    availability = summaryWorkbenchAvailability,
}: SummaryWorkbenchEntryProps): React.ReactElement | null {
    const normalizedSpaceId = normalizeSummaryWorkbenchSpaceId(spaceId);
    const state = useSummaryWorkbenchAvailability(
        normalizedSpaceId,
        availability
    );
    const stickyRef = useRef<StickyDecision>({
        availability,
        spaceId: normalizedSpaceId,
    });

    if (
        stickyRef.current.availability !== availability ||
        stickyRef.current.spaceId !== normalizedSpaceId
    ) {
        stickyRef.current = { availability, spaceId: normalizedSpaceId };
    }
    if (!stickyRef.current.decision && state.status !== "loading") {
        stickyRef.current.decision = state;
    }

    const decision = stickyRef.current.decision;
    if (decision?.status === "enabled") {
        return <>{renderNew(decision)}</>;
    }
    if (decision?.status === "disabled") {
        return <>{renderLegacy(decision)}</>;
    }
    if (state.status !== "loading") return null;
    return renderPending ? <>{renderPending(state)}</> : null;
}

export default SummaryWorkbenchEntry;
