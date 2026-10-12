import React from "react";
import type { SummaryWorkbenchSessionScope } from "./sessionStorage";
import * as BaseApp from "@octo/base/src/App";

export interface UseSummaryWorkbenchSessionScopeInput {
    spaceId?: string | number | null;
    channelId?: string | null;
    channelType?: string | number | null;
    referencedTaskId?: number | null;
    messaging?: {
        getCurrentUser: () => { uid: string };
    } | null;
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
    messaging,
}: UseSummaryWorkbenchSessionScopeInput): SummaryWorkbenchSessionScope {
    // BaseApp may be fully mocked in some test environments (no default
    // export; property access on the mock throws), so resolve the login uid
    // defensively instead of assuming the module shape.
    const readUid = (host: unknown): string | undefined => {
        try {
            return (
                (host as { loginInfo?: { uid?: string } })?.loginInfo?.uid
            );
        } catch {
            return undefined;
        }
    };
    // Resolve the login uid defensively: some test environments mock
    // "@octo/base" with only a named WKApp export, others only a default
    // export, and accessing an unmocked property on a vi.mock namespace
    // throws.
    let loginUid: string | undefined;
    try {
        loginUid = readUid((BaseApp as { WKApp?: unknown }).WKApp);
    } catch {
        loginUid = undefined;
    }
    if (loginUid === undefined) {
        try {
            loginUid = readUid((BaseApp as { default?: unknown }).default);
        } catch {
            loginUid = undefined;
        }
    }
    const currentUserId = messaging?.getCurrentUser().uid ?? loginUid ?? "";
    return {
        userId: currentUserId,
        spaceId,
        channelId,
        channelType,
        referencedTaskId,
    };
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
    return React.useMemo(
        () =>
            summaryWorkbenchSessionScopeValue({
                spaceId,
                channelId,
                channelType,
                referencedTaskId,
                messaging,
            }),
        [spaceId, channelId, channelType, referencedTaskId, messaging]
    );
}
