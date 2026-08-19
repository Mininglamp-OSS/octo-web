import { Channel, ChannelTypePerson, WKSDK } from "wukongimjssdk"

import WKApp from "../../App"
import { getImChannelInfo } from "../../im-runtime/channelRuntime"
import { SYSTEM_BOTS } from "../../Service/SpaceService"

/**
 * message_replied 的 is_ai_msg:被回复消息作者(reply.fromUID)是否 AI/bot。
 *
 * 判据走「按 uid 查其 person channelInfo 的 robot 标记」(与 vm 的 isAiMessage 同源),
 * **不查会话 subscribers** —— 后者仅群/子区会话填充,1:1(ChannelTypePerson)会话恒为空,
 * 若用它判 bot 会把 human↔AI DM 的每次回复误判为 false,而这正是本属性要测的主力人群
 * (见 #1452 review P1:助手/自定义 bot 的 DM 回复全部漏计,只有 botfather 命中)。
 * 再叠加 octoAssistantUids(助手 uid,可能未在 orgData 打 robot 标记)与 SYSTEM_BOTS
 * (botfather 等无 orgData 的系统 bot)兜底。取不到作者或非 bot → false。
 */
export function isReplyAuthorAi(replyFromUid: string | undefined | null): boolean {
    if (!replyFromUid) return false
    const ci = getImChannelInfo(WKSDK.shared(), new Channel(replyFromUid, ChannelTypePerson))
    if (ci?.orgData?.robot === 1) return true
    if (WKApp.remoteConfig?.octoAssistantUids?.includes(replyFromUid)) return true
    return SYSTEM_BOTS.has(replyFromUid)
}
