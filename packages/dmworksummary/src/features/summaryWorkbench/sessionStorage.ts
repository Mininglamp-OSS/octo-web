const SESSION_KEY_PREFIX = "summary-workbench-session:v2";

export interface SummaryWorkbenchSessionScope {
    userId?: string | null;
    spaceId?: string | number | null;
    channelId?: string | null;
    channelType?: string | number | null;
    referencedTaskId?: number | null;
}

function storageKey(scope: SummaryWorkbenchSessionScope): string {
    const user = encodeURIComponent(scope.userId || "anonymous");
    const space = encodeURIComponent(String(scope.spaceId ?? "global"));
    const channel = encodeURIComponent(scope.channelId || "global");
    const channelType = scope.channelId
        ? encodeURIComponent(String(scope.channelType ?? "unknown"))
        : "";
    const baseKey = `${SESSION_KEY_PREFIX}:${user}:${space}:${channel}${
        channelType ? `:type:${channelType}` : ""
    }`;
    if (scope.referencedTaskId === undefined || scope.referencedTaskId === null) {
        return baseKey;
    }
    const referencedTask = encodeURIComponent(String(scope.referencedTaskId));
    return `${baseKey}:reference:${referencedTask}`;
}

export function readSummaryWorkbenchSession(
    scope: SummaryWorkbenchSessionScope
): string {
    try {
        return localStorage.getItem(storageKey(scope)) || "";
    } catch {
        return "";
    }
}

export function writeSummaryWorkbenchSession(
    scope: SummaryWorkbenchSessionScope,
    sessionId: string
): void {
    if (!sessionId) return;
    try {
        localStorage.setItem(storageKey(scope), sessionId);
    } catch {
        // Storage can be unavailable in private or restricted environments.
    }
}

export function clearSummaryWorkbenchSession(
    scope: SummaryWorkbenchSessionScope
): void {
    try {
        localStorage.removeItem(storageKey(scope));
    } catch {
        // Keep the current in-memory session usable when storage is unavailable.
    }
}

const PREVIOUS_SUFFIX = ":previous";

function previousStorageKey(scope: SummaryWorkbenchSessionScope): string {
    return `${storageKey(scope)}${PREVIOUS_SUFFIX}`;
}

/**
 * Keep the currently persisted session reachable as "last conversation"
 * before a forced-new-session mount clears the main slot.
 */
export function moveSummaryWorkbenchSessionToPrevious(
    scope: SummaryWorkbenchSessionScope
): void {
    const sessionId = readSummaryWorkbenchSession(scope);
    if (!sessionId) return;
    try {
        localStorage.setItem(previousStorageKey(scope), sessionId);
        localStorage.removeItem(storageKey(scope));
    } catch {
        // The new session still works when storage is unavailable.
    }
}

export function readSummaryWorkbenchPreviousSession(
    scope: SummaryWorkbenchSessionScope
): string {
    try {
        return localStorage.getItem(previousStorageKey(scope)) || "";
    } catch {
        return "";
    }
}

export function writeSummaryWorkbenchPreviousSession(
    scope: SummaryWorkbenchSessionScope,
    sessionId: string
): void {
    try {
        if (sessionId) {
            localStorage.setItem(previousStorageKey(scope), sessionId);
        } else {
            localStorage.removeItem(previousStorageKey(scope));
        }
    } catch {
        // Storage can be unavailable in private or restricted environments.
    }
}

export function clearSummaryWorkbenchPreviousSession(
    scope: SummaryWorkbenchSessionScope
): void {
    try {
        localStorage.removeItem(previousStorageKey(scope));
    } catch {
        // Keep the current in-memory session usable when storage is unavailable.
    }
}
