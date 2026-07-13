import { ChannelTypeCommunityTopic } from "@octo/base"
import { ChannelTypeGroup, Conversation, Reminder } from "wukongimjssdk"

export interface SyncRemindersCallbackDeps {
    getConversations: () => Conversation[] | undefined
    postReminderSync: (path: string, body: Record<string, any>) => Promise<any>
    toReminder: (reminderMap: any) => Reminder
}

export function createSyncRemindersCallback(deps: SyncRemindersCallbackDeps) {
    return async function syncRemindersCallback(version: number): Promise<Array<Reminder>> {
        const reminders = new Array<Reminder>()
        const channelIDs = new Array<string>()
        const conversations = deps.getConversations()
        if (conversations && conversations.length > 0) {
            for (const conversation of conversations) {
                if (
                    conversation.channel.channelType === ChannelTypeGroup ||
                    conversation.channel.channelType === ChannelTypeCommunityTopic
                ) {
                    channelIDs.push(conversation.channel.channelID)
                }
            }
        }
        const results = await deps.postReminderSync("message/reminder/sync", {
            "version": version,
            "limit": 100,
            "channel_ids": channelIDs,
        })
        if (results) {
            for (const result of results) {
                reminders.push(deps.toReminder(result))
            }
        }
        return reminders
    }
}
