import { Channel, ConversationExtra } from "wukongimjssdk"

export interface SyncConversationExtrasCallbackDeps {
    postConversationExtrasSync: (path: string, body: Record<string, any>) => Promise<any>
    toConversationExtra: (channel: Channel, conversationExtraMap: any) => ConversationExtra
}

export function createSyncConversationExtrasCallback(
    deps: SyncConversationExtrasCallbackDeps,
) {
    return async function syncConversationExtrasCallback(
        version: number,
    ): Promise<Array<ConversationExtra>> {
        const conversationExtras = new Array<ConversationExtra>()
        const results = await deps.postConversationExtrasSync("conversation/extra/sync", {
            "version": version,
        })
        if (results) {
            for (const result of results) {
                const channel = new Channel(result["channel_id"], result["channel_type"])
                conversationExtras.push(deps.toConversationExtra(channel, result))
            }
        }
        return conversationExtras
    }
}
