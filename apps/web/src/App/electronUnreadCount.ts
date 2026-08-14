/**
 * getElectronUnreadMessageCount
 *
 * Aggregates the current unread-message count that should be sent to the
 * Electron main process for tray-badge rendering.  Extracted into its own
 * module so it can be unit-tested without booting the full React app tree.
 */
import { WKSDK, ChannelTypePerson, ChannelTypeGroup } from 'wukongimjssdk'
import {
  ConversationWrap,
  isEffectivelyMuted,
  ChannelTypeCommunityTopic,
  ThreadStatus,
  parseThreadChannelId,
  Channel,
  shouldSkipChannelForSpace,
  shouldSkipPersonConversationForSpace,
} from '@octo/base'

/**
 * Returns the effective unread-message total used by the desktop tray.
 *
 * Rules:
 *  - Muted channels are excluded.
 *  - Channels / person-conversations filtered by the current Space are excluded.
 *  - Uses the same effective unread value as the conversation list, including
 *    mute, Space, system-message and system-bot handling.
 */
export function getElectronUnreadMessageCount(): number {
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
