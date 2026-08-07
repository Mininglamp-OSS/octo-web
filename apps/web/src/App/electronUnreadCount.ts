/**
 * getElectronUnreadMessageCount
 *
 * Aggregates the current unread-message count that should be sent to the
 * Electron main process for tray-badge rendering.  Extracted into its own
 * module so it can be unit-tested without booting the full React app tree.
 */
import { WKSDK, ChannelTypePerson } from 'wukongimjssdk'
import { WKApp, shouldSkipChannelForSpace, shouldSkipPersonConversationForSpace } from '@octo/base'

/**
 * Returns the total unread-message count across all visible conversations,
 * applying the same mute / space-filter logic as the tray listener.
 *
 * Rules:
 *  - Muted channels are excluded.
 *  - Channels / person-conversations filtered by the current Space are excluded.
 *  - Person channels use `extra.spaceUnread` when a Space is active and the
 *    field is present; otherwise fall back to `conversation.unread`.
 *  - Non-finite / negative values are clamped to 0 so a bad IPC payload cannot
 *    corrupt the tray title.
 */
export function getElectronUnreadMessageCount(): number {
  let total = 0

  for (const conversation of WKSDK.shared().conversationManager.conversations) {
    const channelInfo = WKSDK.shared().channelManager.getChannelInfo(conversation.channel)
    if (channelInfo?.mute) continue
    if (shouldSkipChannelForSpace(conversation.channel)) continue
    if (shouldSkipPersonConversationForSpace(conversation)) continue

    const currentSpaceId = WKApp.shared.currentSpaceId
    const rawUnread =
      currentSpaceId &&
      conversation.channel.channelType === ChannelTypePerson &&
      conversation.extra?.spaceUnread !== undefined
        ? conversation.extra.spaceUnread
        : conversation.unread

    const n = Number(rawUnread)
    if (Number.isFinite(n)) {
      total += Math.max(0, n)
    }
  }

  return Math.floor(total)
}
