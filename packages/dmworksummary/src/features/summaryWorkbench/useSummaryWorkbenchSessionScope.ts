import React from "react";
import type { SummaryWorkbenchSessionScope } from "./sessionStorage";
import WKApp from "@octo/base/src/App";

export interface UseSummaryWorkbenchSessionScopeInput {
    spaceId?: string | number | null;
    channelId?: string | null;
    channelType?: string | number | null;
    referencedTaskId?: number | null;
    messaging?: {
        getCurrentUser: () => { uid: string };
    } | null;
}

function currentSummaryWorkbenchUserId(
    messaging: UseSummaryWorkbenchSessionScopeInput["messaging"]
): string {
    try {
        return messaging?.getCurrentUser()?.uid || WKApp.loginInfo.uid || "";
    } catch {
        return WKApp.loginInfo.uid || "";
    }
}

/**
 * Single derivation of the persisted-session storage scope. Both
 * SummaryWorkbenchFeature and SummaryWorkbenchCreateEntry must agree on this
 * five-field key byte-for-byte: a drift would write `:previous` under one key
 * while the feature reads another, silently orphaning the prior session.
 */
export function summaryWorkbenchSessionScopeValue({
    spaceId,
    channelId,
    channelType,
    referencedTaskId,
    userId,
}: Omit<UseSummaryWorkbenchSessionScopeInput, "messaging"> & {
    userId: string;
}): SummaryWorkbenchSessionScope {
    return {
        userId,
        spaceId,
        channelId,
        channelType,
        referencedTaskId,
    };
}

export function summaryWorkbenchSessionScopeIdentity(
    scope: SummaryWorkbenchSessionScope
): string {
    const channelId = scope.channelId || "global";
    return JSON.stringify([
        scope.userId || "anonymous",
        String(scope.spaceId ?? "global"),
        channelId,
        channelId === "global" ? "" : String(scope.channelType ?? "unknown"),
        scope.referencedTaskId === undefined || scope.referencedTaskId === null
            ? ""
            : String(scope.referencedTaskId),
    ]);
}

export function useSummaryWorkbenchSessionScope(
    input: UseSummaryWorkbenchSessionScopeInput
): SummaryWorkbenchSessionScope {
    const {
        spaceId,
        channelId,
        channelType,
        referencedTaskId,
        messaging,
    } = input;
    // Resolve on every render before memoization. Messaging objects are stable
    // across login refreshes, but their current user is intentionally live.
    const userId = currentSummaryWorkbenchUserId(messaging);
    return React.useMemo(
        () =>
            summaryWorkbenchSessionScopeValue({
                spaceId,
                channelId,
                channelType,
                referencedTaskId,
                userId,
            }),
        [spaceId, channelId, channelType, referencedTaskId, userId]
    );
}
