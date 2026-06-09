import { ChannelTypeCommunityTopic } from "../../Service/Const"
import { ThreadStatus } from "../../Service/Thread"

/**
 * 关注 Tab 展开父群子区时，默认隐藏「已归档(archived)」子区。
 *
 * 归档信号有两路来源，但二者并非对等取「或」，而是分主次：
 *   1. live channelInfo：conv.channelInfo?.orgData?.thread?.status，IM 实时补齐。
 *      它反映子区当前最新状态（归档/取消归档都会即时刷新 channelInfo），
 *      因此一旦加载（status 已知）即为权威信号。
 *   2. sidebar status：/sidebar/sync 在子区项(target_type=5)上直接带 status
 *      (1=active, 2=archived)。冷启动刷新后第一帧即可拿到，无需等 channelInfo，
 *      用作 channelInfo 尚未补齐时的「冷启动快路径」，从源头消除
 *      「归档子区先闪一下再消失」的抖动。但它仅在 /sidebar/sync 时整体刷新，
 *      取消归档等操作只刷新 channelInfo 而不发 sidebar-reload，故可能短暂过期。
 *
 * 精确取舍：
 *   - channelInfo status 已知（已加载）：以它为准——
 *     channelInfo=Active 覆盖过期的 sidebar=Archived（刚取消归档立即重现）；
 *     channelInfo=Archived 即使 sidebar=Active 也隐藏。
 *   - channelInfo status 未知（未加载）：回退看 sidebar status，
 *     sidebar=Archived 在首帧即隐藏（消除冷启动抖动）。
 *   - 两路都未知：fail-open，视为可见，避免误隐藏活跃子区。
 */

/** conv 上读取归档状态所需的最小结构（便于单测构造，避免依赖完整 ConversationWrap）。 */
export interface ArchivableConversation {
    channel: { channelType: number; channelID: string }
    channelInfo?: {
        orgData?: {
            thread?: {
                status?: number
            }
        }
    }
}

/**
 * 子区 channelID → sidebar status 映射（来自 /sidebar/sync）。
 * 值语义同 ThreadStatus：1=active, 2=archived；缺失=未知（回退 channelInfo）。
 */
export type ThreadSidebarStatusMap = Map<string, number | undefined>

/**
 * 仅当 conv 是子区类型且判定为「已归档」时返回 true。
 *
 * 优先级：live channelInfo 已知则以它为准（权威）；未知时回退 sidebar status
 * （冷启动快路径）；两路都未知则 fail-open（可见）。
 *
 * @param statusMap 可选；channelID → sidebar status。仅在 channelInfo 尚未加载时
 *                  作为回退使用；不传 / 命中不到时退化为仅看 channelInfo（旧行为）。
 */
export function isArchivedThreadConversation(
    conv: ArchivableConversation,
    statusMap?: ThreadSidebarStatusMap,
): boolean {
    if (conv.channel.channelType !== ChannelTypeCommunityTopic) return false

    // 1) live channelInfo 已知 → 权威信号
    const channelInfoStatus = conv.channelInfo?.orgData?.thread?.status
    if (channelInfoStatus !== undefined) {
        return channelInfoStatus === ThreadStatus.Archived
    }

    // 2) channelInfo 未知 → 回退 sidebar status（冷启动快路径）
    const sidebarStatus = statusMap?.get(conv.channel.channelID)
    if (sidebarStatus !== undefined) {
        return sidebarStatus === ThreadStatus.Archived
    }

    // 3) 两路都未知 → fail-open（可见）
    return false
}

/**
 * 角标(follow badge)专用：按 sidebar item + 可选 liveConv 判定子区是否「已归档」。
 *
 * 与列表展示层保持一致：
 *   - liveConv 存在 → 走 isArchivedThreadConversation（channelInfo 优先，回退 statusMap）。
 *   - liveConv 缺失（sidebar-only 关注，从未聊过、IM 缓存无 conv）→ 回退查
 *     sidebar statusMap，sidebar=Archived 即判定归档。
 * 这样 sidebar-only 的已归档关注子区不会把 it.unread 误计入角标，
 * 避免「红点 N 但列表里看不到对应未读」的角标/列表 desync。
 */
export function isThreadArchivedForBadge(
    liveConv: ArchivableConversation | undefined,
    targetId: string,
    statusMap: ThreadSidebarStatusMap,
): boolean {
    if (liveConv) {
        return isArchivedThreadConversation(liveConv, statusMap)
    }
    return statusMap.get(targetId) === ThreadStatus.Archived
}

/**
 * 过滤掉「明确已归档」的子区，返回 UI 可见的会话数组。
 * 非子区、两路状态都未知的子区都会保留（fail-open）。
 *
 * @param statusMap 可选 sidebar status 映射；不传时行为与旧版完全一致。
 */
export function filterArchivedThreads<T extends ArchivableConversation>(
    convs: T[],
    statusMap?: ThreadSidebarStatusMap,
): T[] {
    return convs.filter(conv => !isArchivedThreadConversation(conv, statusMap))
}
