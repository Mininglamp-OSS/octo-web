export interface ReminderDoneCallbackDeps {
    postReminderDone: (path: string, ids: number[]) => Promise<any>
}

export function createReminderDoneCallback(deps: ReminderDoneCallbackDeps) {
    return async function reminderDoneCallback(ids: number[]) {
        return deps.postReminderDone("message/reminder/done", ids)
    }
}
