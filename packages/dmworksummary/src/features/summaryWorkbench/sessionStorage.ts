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
): boolean {
    if (!sessionId) return false;
    try {
        localStorage.setItem(storageKey(scope), sessionId);
        return true;
    } catch {
        // Storage can be unavailable in private or restricted environments.
        return false;
    }
}

export function clearSummaryWorkbenchSession(
    scope: SummaryWorkbenchSessionScope
): boolean {
    try {
        localStorage.removeItem(storageKey(scope));
        return true;
    } catch {
        // Keep the current in-memory session usable when storage is unavailable.
        return false;
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
): boolean {
    const activeKey = storageKey(scope);
    const previousKey = previousStorageKey(scope);
    let previousSessionId: string | null = null;
    try {
        const sessionId = localStorage.getItem(activeKey) || "";
        if (!sessionId) return true;
        previousSessionId = localStorage.getItem(previousKey);
        localStorage.setItem(previousKey, sessionId);
        localStorage.removeItem(activeKey);
        return true;
    } catch {
        try {
            if (previousSessionId === null) {
                localStorage.removeItem(previousKey);
            } else {
                localStorage.setItem(previousKey, previousSessionId);
            }
        } catch {
            // Storage remains unavailable; keep the in-memory session usable.
        }
        return false;
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
): boolean {
    try {
        if (sessionId) {
            localStorage.setItem(previousStorageKey(scope), sessionId);
        } else {
            localStorage.removeItem(previousStorageKey(scope));
        }
        return true;
    } catch {
        // Storage can be unavailable in private or restricted environments.
        return false;
    }
}

export function clearSummaryWorkbenchPreviousSession(
    scope: SummaryWorkbenchSessionScope
): boolean {
    try {
        localStorage.removeItem(previousStorageKey(scope));
        return true;
    } catch {
        // Keep the current in-memory session usable when storage is unavailable.
        return false;
    }
}

/** Atomically replace both session pointers, restoring both on partial failure. */
export function replaceSummaryWorkbenchSessionSlots(
    scope: SummaryWorkbenchSessionScope,
    activeSessionId: string,
    previousSessionId: string
): boolean {
    const activeKey = storageKey(scope);
    const previousKey = previousStorageKey(scope);
    try {
        const originalActive = localStorage.getItem(activeKey);
        const originalPrevious = localStorage.getItem(previousKey);
        try {
            if (activeSessionId) {
                localStorage.setItem(activeKey, activeSessionId);
            } else {
                localStorage.removeItem(activeKey);
            }
            if (previousSessionId) {
                localStorage.setItem(previousKey, previousSessionId);
            } else {
                localStorage.removeItem(previousKey);
            }
            return true;
        } catch {
            if (originalActive === null) localStorage.removeItem(activeKey);
            else localStorage.setItem(activeKey, originalActive);
            if (originalPrevious === null) localStorage.removeItem(previousKey);
            else localStorage.setItem(previousKey, originalPrevious);
            return false;
        }
    } catch {
        return false;
    }
}
