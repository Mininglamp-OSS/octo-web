import { t } from "../../i18n"
import { isRealnameVerified } from "../../Utils/displayName"

const ChannelTypeGroup = 2
const ChannelTypePerson = 1
const ChannelTypeCommunityTopic = 5

export interface ChatContextMember {
    uid: string
    name?: string
    remark?: string
    isDeleted?: number
    orgData?: {
        real_name?: string | null
        realname_verified?: boolean | number | string | null
        robot?: number
    } | null
}

export interface ChatContextMessage {
    fromUID: string
    from?: { title?: string }
    content?: { text?: string }
}

export interface ChatContextChannelInfo {
    title?: string
    orgData?: { remark?: string }
}

export interface ChatContextResult {
    memberContext?: string   // "聊天成员（同一人的多个名字用/连接）：张三/小张,..." — undefined for DM
    chatContext?: string     // "[channel label]\n[Alice]: hi\n[Bob]: hello"
    channelType?: number     // pass-through for VoiceService to send as channel_type
    selfName?: string        // 当前说话人三层名字串（去重 + "/" 连接），供 FormData self_name 使用
}

// 把三层名字按「收集 → 去重保序 → / 连接」拼成单个成员 token（无标签）
function formatNameToken(
    name?: string | null,
    remark?: string | null,
    realName?: string | null,
    verified?: boolean,
): string {
    const nm = (name ?? "").trim()
    const rm = (remark ?? "").trim()
    const rn = verified ? (realName ?? "").trim() : ""

    // 收集顺序：实名 > 群昵称 > 昵称；只收非空层
    const parts = [rn, rm, nm].filter((v) => v.length > 0)
    // 按值去重保序：相同的名字只保留一个（单名字成员即裸名）
    const distinct = [...new Set(parts)]
    return distinct.join("/")
}

// 成员 token：bot 不补实名；verified 用 isRealnameVerified 归一（兼容 "1"/"true"）
function buildMemberNameToken(sub: ChatContextMember): string {
    const isBot = sub.orgData?.robot === 1
    const verified = !isBot && isRealnameVerified({
        realname_verified: sub.orgData?.realname_verified,
    })
    return formatNameToken(sub.name, sub.remark, sub.orgData?.real_name, verified)
}

export function buildChatContext(params: {
    messages: ChatContextMessage[]
    subscribers: ChatContextMember[]
    channelType: number
    loginUID: string
    channelInfo?: ChatContextChannelInfo | null
    groupName?: string
    threadName?: string
    self?: {
        name?: string | null
        remark?: string | null
        realName?: string | null
        realnameVerified?: boolean
    }
}): ChatContextResult {
    const { messages, subscribers, channelType, loginUID, channelInfo, groupName, threadName } = params
    const names: string[] = []

    const result: ChatContextResult = {
        channelType: channelType,
    }

    let channelLabel = ''
    if (channelType === ChannelTypePerson) {
        const peerName = channelInfo?.title?.trim() || channelInfo?.orgData?.remark?.trim() || ''
        if (peerName) {
            channelLabel = t("base.chatContext.direct", { values: { name: peerName } })
        }
    } else if (channelType === ChannelTypeCommunityTopic) {
        const parts: string[] = []
        if (groupName) parts.push(t("base.chatContext.group", { values: { name: groupName } }))
        if (threadName) parts.push(t("base.chatContext.thread", { values: { name: threadName } }))
        channelLabel = parts.join('- ') || ''

        if (subscribers.length <= 100) {
            for (const sub of subscribers) {
                if (sub.uid === loginUID) continue
                if (sub.isDeleted) continue
                const token = buildMemberNameToken(sub)
                if (token) names.push(token)
            }
        } else {
            const activeUIDs = new Set<string>()
            for (let i = messages.length - 1; i >= 0 && activeUIDs.size < 100; i--) {
                const uid = messages[i].fromUID
                if (uid && uid !== loginUID) {
                    activeUIDs.add(uid)
                }
            }
            for (const sub of subscribers) {
                if (activeUIDs.has(sub.uid) && !sub.isDeleted) {
                    const token = buildMemberNameToken(sub)
                    if (token) names.push(token)
                }
            }
        }
    } else {
        if (groupName) {
            channelLabel = t("base.chatContext.group", { values: { name: groupName } })
        }

        if (channelType === ChannelTypeGroup) {
            if (subscribers.length <= 100) {
                for (const sub of subscribers) {
                    if (sub.uid === loginUID) continue
                    if (sub.isDeleted) continue
                    const token = buildMemberNameToken(sub)
                    if (token) names.push(token)
                }
            } else {
                const activeUIDs = new Set<string>()
                for (let i = messages.length - 1; i >= 0 && activeUIDs.size < 100; i--) {
                    const uid = messages[i].fromUID
                    if (uid && uid !== loginUID) {
                        activeUIDs.add(uid)
                    }
                }
                for (const sub of subscribers) {
                    if (activeUIDs.has(sub.uid) && !sub.isDeleted) {
                        const token = buildMemberNameToken(sub)
                        if (token) names.push(token)
                    }
                }
            }
        }
    }

    if (channelType !== ChannelTypePerson) {
        const uniqueNames = [...new Set(names)]
        if (uniqueNames.length > 0) {
            result.memberContext = t("base.chatContext.members", {
                values: { names: uniqueNames.join("，") },
            })
        }
    }

    const chatLines: string[] = []

    if (channelLabel) {
        chatLines.push(channelLabel)
    }

    if (messages && messages.length > 0) {
        const last10 = messages.slice(-10)
        for (const m of last10) {
            const senderName = m.from?.title || m.fromUID
            const text = m.content?.text || ''
            chatLines.push(`[${senderName}]: ${text}`)
        }
    }

    if (chatLines.length > 0) {
        result.chatContext = chatLines.join('\n')
    }

    if (params.self) {
        const selfToken = formatNameToken(
            params.self.name,
            params.self.remark,
            params.self.realName,
            params.self.realnameVerified === true,   // 自己侧 loginInfo 已归一，严格 ===true
        )
        if (selfToken) result.selfName = selfToken
    }

    return result
}
