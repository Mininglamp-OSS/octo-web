export type SummaryDetailAction = "schedule" | "regenerate" | "retry" | "edit";
const pendingByTask = new Map<string, { action: SummaryDetailAction; expiresAt: number }>();

function pendingKey(taskId: number, spaceId: string): string {
    return `${spaceId}:${taskId}`;
}

// Record one pending action per task before navigation. The detail consumes it
// after mounting/updating and loading; do not open the outgoing page synchronously.
export function requestSummaryScheduleOpen(taskId: number, spaceId: string) {
    requestSummaryDetailAction(taskId, spaceId, "schedule");
}

export function consumeSummaryScheduleOpen(taskId: number, spaceId: string): boolean {
    return consumeSummaryDetailAction(taskId, spaceId, action => action === "schedule") === "schedule";
}

export function requestSummaryDetailAction(taskId: number, spaceId: string, action: SummaryDetailAction) {
    pendingByTask.set(pendingKey(taskId, spaceId), { action, expiresAt: Date.now() + 120_000 });
}

export function consumeSummaryDetailAction(
    taskId: number, spaceId: string, ready: (action: SummaryDetailAction) => boolean = () => true,
): SummaryDetailAction | null {
    const key = pendingKey(taskId, spaceId);
    const pending = pendingByTask.get(key);
    if (!pending) return null;
    if (pending.expiresAt <= Date.now()) {
        pendingByTask.delete(key);
        return null;
    }
    if (!ready(pending.action)) return null;
    const action = pending.action;
    pendingByTask.delete(key);
    return action;
}
