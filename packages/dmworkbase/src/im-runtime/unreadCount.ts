/**
 * getCurrentImUnreadCount
 *
 * Aggregates the current unread-message count that should be sent to the
 * desktop or browser host. Reading this value never starts a connection or
 * mounts a page.
 */
import { WKSDK, ChannelTypePerson, ChannelTypeGroup } from 'wukongimjssdk'
import { Channel } from 'wukongimjssdk'
import { ConversationWrap } from '../Service/Model'
import { ChannelTypeCommunityTopic } from '../Service/Const'
import { isEffectivelyMuted, ThreadStatus, parseThreadChannelId } from '../Service/Thread'
import { shouldSkipChannelForSpace, shouldSkipPersonConversationForSpace } from '../Service/SpaceService'

/**
 * Returns the effective unread-message total used by the desktop tray.
 *
 * Rules:
 *  - Muted channels are excluded.
 *  - Channels / person-conversations filtered by the current Space are excluded.
 *  - Uses the same effective unread value as the conversation list, including
 *    mute, Space, system-message and system-bot handling.
 */
export function getCurrentImUnreadCount(): number {
  const sdk = WKSDK.shared()
  let total = 0
  for (const conversation of sdk.conversationManager.conversations) {
    const channel = conversation.channel
    const channelInfo = WKSDK.shared().channelManager.getChannelInfo(conversation.channel)
    const isThread = channel.channelType === ChannelTypeCommunityTopic
    const parentGroupNo = isThread
      ? (channelInfo?.orgData?.parentGroupNo as string | undefined) ||
        parseThreadChannelId(channel.channelID)?.groupNo
      : undefined
    const parentChannelInfo = parentGroupNo
      ? sdk.channelManager.getChannelInfo(new Channel(parentGroupNo, ChannelTypeGroup))
      : undefined
    const threadStatus = channelInfo?.orgData?.thread?.status as number | undefined

    if (
      shouldSkipChannelForSpace(channel) ||
      (channel.channelType === ChannelTypePerson &&
        shouldSkipPersonConversationForSpace(conversation)) ||
      isEffectivelyMuted({
        isThread,
        channelInfo,
        parentChannelInfo,
      }) ||
      (isThread &&
        threadStatus !== undefined &&
        threadStatus !== ThreadStatus.Active)
    ) {
      continue
    }

    const unread = Number(new ConversationWrap(conversation).unread)
    if (Number.isFinite(unread)) {
      total += Math.max(0, unread)
    }
  }

  return Math.floor(total)
}
