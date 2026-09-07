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
