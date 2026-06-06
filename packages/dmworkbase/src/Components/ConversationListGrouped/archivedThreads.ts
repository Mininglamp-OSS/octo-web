import { ChannelTypeCommunityTopic } from "../../Service/Const"
import { ThreadStatus } from "../../Service/Thread"

/**
 * 关注 Tab 展开父群子区时，默认隐藏「已归档(archived)」子区。
 *
 * 设计原则 fail-open：只有当 conv 是子区且其 thread.status 明确等于
 * ThreadStatus.Archived 时才算「已归档」。status 未知 / channelInfo 未加载
 * （如 sidebar-only 子区还没补齐 channelInfo）一律视为可见，避免误隐藏活跃子区。
 *
 * 这里读取的归档状态路径与项目内其它处一致：
 *   conv.channelInfo?.orgData?.thread?.status
 */

/** conv 上读取归档状态所需的最小结构（便于单测构造，避免依赖完整 ConversationWrap）。 */
export interface ArchivableConversation {
    channel: { channelType: number }
    channelInfo?: {
        orgData?: {
            thread?: {
                status?: number
            }
        }
    }
}

/** 仅当 conv 是子区类型且其 thread.status 明确为 Archived 时返回 true。 */
export function isArchivedThreadConversation(conv: ArchivableConversation): boolean {
    if (conv.channel.channelType !== ChannelTypeCommunityTopic) return false
    return conv.channelInfo?.orgData?.thread?.status === ThreadStatus.Archived
}

/**
 * 过滤掉「明确已归档」的子区，返回 UI 可见的会话数组。
 * 非子区、status 未知的子区都会保留（fail-open）。
 */
export function filterArchivedThreads<T extends ArchivableConversation>(convs: T[]): T[] {
    return convs.filter(conv => !isArchivedThreadConversation(conv))
}
