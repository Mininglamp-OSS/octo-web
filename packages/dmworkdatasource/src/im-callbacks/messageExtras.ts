import { Channel, MessageExtra } from "wukongimjssdk"

export interface SyncMessageExtraCallbackDeps {
    syncMessageExtras: (
        channel: Channel,
        extraVersion: number,
        limit: number,
    ) => Promise<MessageExtra[]>
}

export function createSyncMessageExtraCallback(deps: SyncMessageExtraCallbackDeps) {
    return async function syncMessageExtraCallback(
        channel: Channel,
        extraVersion: number,
        limit: number,
    ): Promise<MessageExtra[]> {
        return deps.syncMessageExtras(channel, extraVersion, limit)
    }
}
