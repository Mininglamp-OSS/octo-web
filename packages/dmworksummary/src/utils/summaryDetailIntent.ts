export type SummaryDetailAction = "schedule" | "regenerate" | "retry" | "edit";
let pending: { taskId: number; spaceId: string; action: SummaryDetailAction; expiresAt: number } | null = null;

// One shared action slot, recorded before navigation. The detail consumes after mounting/updating and
// loading; do not synchronously open the outgoing page before a remount.
export function requestSummaryScheduleOpen(taskId: number, spaceId: string) {
    requestSummaryDetailAction(taskId, spaceId, "schedule");
}

export function consumeSummaryScheduleOpen(taskId: number, spaceId: string): boolean {
    return consumeSummaryDetailAction(taskId, spaceId, action => action === "schedule") === "schedule";
}

export function requestSummaryDetailAction(taskId: number, spaceId: string, action: SummaryDetailAction) {
    pending = { taskId, spaceId, action, expiresAt: Date.now() + 120_000 };
}

export function consumeSummaryDetailAction(
    taskId: number, spaceId: string, ready: (action: SummaryDetailAction) => boolean = () => true,
): SummaryDetailAction | null {
    if (pending && pending.expiresAt <= Date.now()) pending = null;
    if (pending?.taskId !== taskId || pending.spaceId !== spaceId || !ready(pending.action)) return null;
    const action = pending.action;
    pending = null;
    return action;
}
