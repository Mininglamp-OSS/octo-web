// reactionMerge —— syncMessageReaction CMD 不带 message_id，所以 refreshReactions
// 重拉本频道最近一页消息后，按 messageID 把远端 reactions 合并进已渲染的本地消息。
// 这段「按 id 匹配 + 覆盖 reactions + 是否有变更」的逻辑抽成纯函数，便于单测：
// resolveLocal 注入本地查找（生产里是 ConversationVM.findMessageWithMessageID），
// 不在当前页的远端消息找不到本地对应项 → 跳过，不误建。

interface ReactionTarget {
    message: { reactions: unknown[] }
}

interface RemoteReactionSource {
    messageID: string
    reactions?: unknown[]
}

/**
 * 把 remoteMessages 的 reactions 合并进本地消息。
 * @returns 是否有任一本地消息被更新（决定要不要 notifyListener 重渲染）。
 */
export function applyRemoteReactions(
    remoteMessages: RemoteReactionSource[],
    resolveLocal: (messageID: string) => ReactionTarget | undefined,
): boolean {
    let changed = false
    for (const remote of remoteMessages) {
        const existing = resolveLocal(remote.messageID)
        if (existing) {
            // 覆盖式写入：远端是该消息 reactions 的权威全量（Convert.toReactions 已聚合）。
            existing.message.reactions = remote.reactions || []
            changed = true
        }
    }
    return changed
}

/**
 * 取数 + 合并 + 错误处理的纯 core，供 ConversationVM.refreshReactions 委托。
 * syncMessages / resolveLocal 由调用方注入（生产里是 WKApp 同步 + VM 查找），
 * 失败路径在此收口：reaction 刷新是被动的非关键更新，一次同步失败**不得**冒泡
 * 打断 CMD handler，也不该弹用户可见错误——故 catch 后经 onError 记录并返回
 * false（无变更），而非抛出。
 * @returns 是否有本地消息被更新（调用方据此决定 notifyListener）。
 */
export async function refreshReactionsCore(
    syncMessages: () => Promise<RemoteReactionSource[] | undefined>,
    resolveLocal: (messageID: string) => ReactionTarget | undefined,
    onError: (err: unknown) => void,
): Promise<boolean> {
    try {
        const remote = await syncMessages()
        if (!remote || remote.length === 0) {
            return false
        }
        return applyRemoteReactions(remote, resolveLocal)
    } catch (err) {
        onError(err)
        return false
    }
}
