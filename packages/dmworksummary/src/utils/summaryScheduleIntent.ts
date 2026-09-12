let pending: { taskId: number; spaceId: string; expiresAt: number } | null = null;

// Record before navigation. The detail consumes after mounting/updating and
// loading; do not synchronously open the outgoing page before a remount.
export function requestSummaryScheduleOpen(taskId: number, spaceId: string) {
    pending = { taskId, spaceId, expiresAt: Date.now() + 120_000 };
}

export function consumeSummaryScheduleOpen(taskId: number, spaceId: string): boolean {
    if (pending && pending.expiresAt <= Date.now()) pending = null;
    if (pending?.taskId !== taskId || pending.spaceId !== spaceId) return false;
    pending = null;
    return true;
}
