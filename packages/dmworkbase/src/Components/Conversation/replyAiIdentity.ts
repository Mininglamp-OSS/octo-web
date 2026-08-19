import { Channel, ChannelTypePerson, WKSDK } from "wukongimjssdk"

import WKApp from "../../App"
import { getImChannelInfo } from "../../im-runtime/channelRuntime"
import { SYSTEM_BOTS } from "../../Service/SpaceService"

/**
 * 消息作者(by uid)是否 AI/bot。供带 is_ai_msg 属性的消息事件统一取值 ——
 * message_replied(被回复作者)、message_copied / message_forwarded(被复制/转发消息作者)。
 *
 * 判据走「按 uid 查其 person channelInfo 的 robot 标记」(与 vm 的 isAiMessage 同源),
 * **不查会话 subscribers** —— 后者仅群/子区会话填充,1:1(ChannelTypePerson)会话恒为空,
 * 若用它判 bot 会把 human↔AI DM 的消息误判为 false,而这正是本属性要测的主力人群
 * (见 #1452 review P1:助手/自定义 bot 的 DM 回复全部漏计,只有 botfather 命中)。
 * 再叠加 octoAssistantUids(助手 uid,可能未在 orgData 打 robot 标记)与 SYSTEM_BOTS
 * (botfather 等无 orgData 的系统 bot)兜底。取不到作者或非 bot → false。
 */
export function isMessageAuthorAi(authorUid: string | undefined | null): boolean {
    if (!authorUid) return false
    const ci = getImChannelInfo(WKSDK.shared(), new Channel(authorUid, ChannelTypePerson))
    if (ci?.orgData?.robot === 1) return true
    if (WKApp.remoteConfig?.octoAssistantUids?.includes(authorUid)) return true
    return SYSTEM_BOTS.has(authorUid)
}

/** @deprecated 用 isMessageAuthorAi;保留别名不动 message_replied 既有引用/回归测试。 */
export const isReplyAuthorAi = isMessageAuthorAi
