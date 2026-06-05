/**
 * ChatConversationList
 * Chat 页面会话列表的统一出口。
 * - 统一持有 useCategoryList，所有 filter 下只调用一次
 * - filter === 'group'：渲染 ConversationListGrouped（ViewToggle + 分组视图）
 * - 其他 filter：渲染 ConversationList，右键群聊有「移到分组」子菜单
 * - CreateCategoryModal 在此层管理，不依赖子组件挂载
 */
import React, { useState, useMemo } from "react"
import { Channel, ChannelTypeGroup, ChannelTypePerson, WKSDK } from "wukongimjssdk"
import { ChannelTypeCommunityTopic } from "../../Service/Const"
import WKApp from "../../App"
import { useCategoryList } from "../../Hooks/useCategoryList"
import { useFollowSidebarContext } from "../../Hooks/useFollowSidebar"
import FollowService from "../../Service/FollowService"
import { isEffectivelyMuted, parseThreadChannelId } from "../../Service/Thread"
import { ConversationWrap } from "../../Service/Model"
import { ConvFilter } from "../ConversationList"
import ConversationList from "../ConversationList"
import ConversationListGrouped, { ValidCategoryItem, isValidCategoryItem } from "../ConversationListGrouped"
import CreateCategoryModal from "../CreateCategoryModal"
import { ContextMenusData } from "../ContextMenus"
import { useI18n } from "../../i18n"

/** 最近 Tab 3 天不活跃过滤阈值。tab 角标和列表必须共用同一阈值。 */
export const RECENT_INACTIVE_THRESHOLD_MS = 3 * 24 * 60 * 60 * 1000

/**
 * 最近 Tab 是否可见：群聊超过 3 天无消息隐藏；私聊 / 子区 不过滤。
 * tab 角标计算和列表渲染必须用同一函数，否则角标 N 但列表看不到的情况就会出现。
 */
export function isVisibleInRecentTab(conv: ConversationWrap, now: number = Date.now()): boolean {
    if (conv.channel.channelType !== ChannelTypeGroup) return true
    return (now - conv.timestamp * 1000) < RECENT_INACTIVE_THRESHOLD_MS
}

export function isMutedForRecentConversation(conv: ConversationWrap): boolean {
    const isThread = conv.channel.channelType === ChannelTypeCommunityTopic
    let parentChannelInfo: any | undefined
    if (isThread) {
        const parentGroupNo =
            (conv.channelInfo?.orgData?.parentGroupNo as string | undefined) ||
            parseThreadChannelId(conv.channel.channelID)?.groupNo
        if (parentGroupNo) {
            parentChannelInfo = WKSDK.shared().channelManager.getChannelInfo(
                new Channel(parentGroupNo, ChannelTypeGroup)
            )
        }
    }
    return isEffectivelyMuted({
        isThread,
        channelInfo: conv.channelInfo,
        parentChannelInfo,
    })
}

export interface ChatConversationListProps {
    conversations: ConversationWrap[]
    filter: ConvFilter
    /** 是否隐藏 3 天不活跃的群聊（最近 Tab 使用） */
    hideInactiveGroups?: boolean
    select?: Channel
    onConversationClick: (conv: ConversationWrap) => void
    onClearMessages: (channel: Channel) => void
    onThreadOverflowClick: (groupNo: string) => void
    /** 外部触发「新建分组」Modal（如顶部 + 按钮），调用后 Modal 显示 */
    onOpenCreateCategoryRef?: React.MutableRefObject<(() => void) | null>
    /** 群聊创建成功后回调，用于刷新会话列表 */
    onGroupCreated?: () => void
    /** 递增 token：变化时最近列表滚到第一条可导航未读 */
    scrollToUnreadToken?: number
}

// 「+ 新建分组」入口在三个右键场景共用同一个 modal。建分类成功后,要把当时
// 右键的会话(添加到关注)或群(移到分组)一并归入新分类,否则就是 bug:用户
// 以为操作连贯,实际只建了空分类。modal 是无 conv 上下文的全局组件,通过这
// 个 state 把上下文从右键现场带到 onConfirm。
//
// NewCategoryTarget = 非 null 的 PendingAction;子组件(如 ConversationListGrouped)
// 通过 onOpenCreateCategory(target?) 把右键现场带过来,顶部 + 入口 target=undefined
// 即可走"建空分类"的路径。
export type NewCategoryTarget =
    | { kind: 'followToNewCategory'; conv: ConversationWrap }
    | { kind: 'moveGroupToNewCategory'; groupNo: string }
type PendingAction = NewCategoryTarget | null

const ChatConversationList: React.FC<ChatConversationListProps> = ({
    conversations,
    filter,
    hideInactiveGroups = false,
    select,
    onConversationClick,
    onClearMessages,
    onThreadOverflowClick,
    onOpenCreateCategoryRef,
    onGroupCreated,
    scrollToUnreadToken,
}) => {
    const { t } = useI18n()
    const {
        categories,
        isLoading: catLoading,
        error: catError,
        reload,
        createCategory,
        renameCategory,
        deleteCategory,
        sortCategories,
        moveGroupToCategory,
    } = useCategoryList()

    // 关注 tab 的 DM/thread 数据来源（/sidebar/sync）。/categories 接口只返回群，
    // DM 关注关系存在 user_conversation_ext 表，由 sidebar 给出 (category_id → DMs) 映射。
    const {
        dmsByCategory,
        threadsByCategory,
        itemsByCategory,
        followedGroupNos,
        followedKeys,
        versionRef,
        bumpVersion,
        applyOptimisticSort,
        isLoading: sidebarLoading,
        error: sidebarError,
        reload: reloadSidebar,
    } = useFollowSidebarContext()

    // /categories 和 /sidebar/sync 都是 follow tab 的真实数据源——任意一个失败都需要
    // 用户感知，否则会渲染半空 tab 但没有错误/重试入口。两边的 loading 也合并，
    // 让 ConversationListGrouped 的骨架/错误态覆盖全套数据。
    const isLoading = catLoading || sidebarLoading
    const error = catError || sidebarError

    // 跨分组移群也会 bump 后端 follow_version；wrap useCategoryList 的实现，
    // 让本地 ref 同步乐观自增 + reload sidebar，避免下一次 sort CAS 冲突。
    const handleMoveGroupToCategory = React.useCallback(
        async (groupNo: string, categoryId: string) => {
            await moveGroupToCategory(groupNo, categoryId)
            bumpVersion()
            reloadSidebar()
        },
        [moveGroupToCategory, bumpVersion, reloadSidebar]
    )

    // 删除分组：后端级联取消关注分组下所有会话（spec #337），前端必须刷新 sidebar
    // 才能让 followedKeys 反映取消关注的项（否则最近 tab 右键这些会话还显示"取消关注"）。
    // useCategoryList.deleteCategory 只改本地 categories state 不动 sidebar，wrap 一下补上。
    const handleDeleteCategory = React.useCallback(
        async (categoryId: string) => {
            await deleteCategory(categoryId)
            bumpVersion()
            reloadSidebar()
        },
        [deleteCategory, bumpVersion, reloadSidebar]
    )
    // 后端每个 follow 写操作都会 bump user_follow_version，本地 ref 同步乐观自增，
    // 让随后的 sort 不必等 sidebar reload 就拿到正确版本号；若实际 bump >1（cascade）
    // 由 sort 的冲突重试兜底。
    const reloadAll = React.useCallback(() => {
        bumpVersion()
        reload()
        reloadSidebar()
    }, [bumpVersion, reload, reloadSidebar])

    // 同分组内手动排序：调 /v2/follow/sort 带 follow_version 做 CAS。
    // - 立刻乐观更新本地 items 顺序，避免 dnd-kit 把 item 放回原位 → API + reload 后再闪到新位置的视觉抖动
    // - 用 versionRef 读最新 version（避免闭包持有旧值在连续拖拽时 CAS 冲突）
    // - 成功后 bumpVersion() 乐观 +1，让下次拖拽不必等 reload
    // - 冲突时 reload 一次拿到新 version 再重试一次；失败由 reload 兜底回退本地状态
    const handleSortFollowItems = React.useCallback(
        async (items: { target_type: number; target_id: string }[]) => {
            applyOptimisticSort(items)
            const payload = {
                items: items.map((it, idx) => ({
                    target_type: it.target_type,
                    target_id: it.target_id,
                    sort: idx,
                })),
            }
            try {
                await FollowService.sort({ ...payload, version: versionRef.current })
                bumpVersion()
            } catch (err: any) {
                // APIClient response interceptor 把 400 reject 成 { error, msg, status }
                const errMsg = String(err?.msg || err?.message || err || '')
                if (errMsg.includes('version conflict')) {
                    // 拉新 version 后重试一次
                    await reloadSidebar()
                    try {
                        await FollowService.sort({ ...payload, version: versionRef.current })
                        bumpVersion()
                    } catch (retryErr) {
                        console.error('[ChatConversationList] follow sort retry failed', retryErr)
                    }
                } else {
                    console.error('[ChatConversationList] follow sort failed', err)
                }
            } finally {
                // 最终拉一次保证 UI 与服务端一致
                reloadSidebar()
            }
        },
        [applyOptimisticSort, versionRef, bumpVersion, reloadSidebar]
    )

    const [createModalVisible, setCreateModalVisible] = useState(false)

    const [pendingAction, setPendingAction] = useState<PendingAction>(null)

    // 暴露「打开新建分组 Modal」给外层（如顶部 + 按钮）。
    // 顶部入口无右键上下文,必须先清 pendingAction,避免上次右键残留被误归入新分类。
    React.useEffect(() => {
        if (onOpenCreateCategoryRef) {
            onOpenCreateCategoryRef.current = () => {
                setPendingAction(null)
                setCreateModalVisible(true)
            }
        }
        return () => {
            if (onOpenCreateCategoryRef) {
                onOpenCreateCategoryRef.current = null
            }
        }
    }, [onOpenCreateCategoryRef])

    const existingCategoryNames = categories.map(c => c.name)

    // 最近 Tab 3 天不活跃群聊隐藏逻辑：列表渲染、tab 角标、其它复用方都必须共用一套
    // 判定，否则会出现「badge 显示 N 但列表里看不到对应未读」。
    const filteredConversations = useMemo(() => {
        if (!hideInactiveGroups) return conversations
        const now = Date.now()
        return conversations.filter(conv => isVisibleInRecentTab(conv, now))
    }, [conversations, hideInactiveGroups])

    const shouldScrollToRecentUnreadTarget = React.useCallback(
        (conv: ConversationWrap) => {
            if (filter === 'group') return false
            if (conv.unread <= 0) return false
            if (hideInactiveGroups && !isVisibleInRecentTab(conv)) return false
            return !isMutedForRecentConversation(conv)
        },
        [filter, hideInactiveGroups]
    )

    // 按 conv.channelType 把会话归入指定分类。三种 channel 走三套写操作:
    // - 子区:父群先 refollow + moveCategory,再 followThread(子区不能脱离父群单独分组)
    // - 群:refollow + moveCategory
    // - DM:followDM 带 category_id 一步到位
    // "添加到关注 → 已有分组"和"添加到关注 → + 新建分组"两条路径都用这一份。
    const followConvToCategory = async (conv: ConversationWrap, categoryId: string) => {
        const channel = conv.channel
        if (channel.channelType === ChannelTypeCommunityTopic) {
            const parentGroupNo = conv.channelInfo?.orgData?.parentGroupNo
                || parseThreadChannelId(channel.channelID)?.groupNo
            if (!parentGroupNo) throw new Error('Unable to resolve parent groupNo')
            await FollowService.refollowChannel({ group_no: parentGroupNo })
            await moveGroupToCategory(parentGroupNo, categoryId)
            await FollowService.followThread({ thread_channel_id: channel.channelID })
        } else if (channel.channelType === ChannelTypeGroup) {
            await FollowService.refollowChannel({ group_no: channel.channelID })
            await moveGroupToCategory(channel.channelID, categoryId)
        } else if (channel.channelType === ChannelTypePerson) {
            await FollowService.followDM({ peer_uid: channel.channelID, category_id: categoryId })
        }
    }

    // 构建额外的右键菜单项
    // - 「移到分组」子菜单（仅关注 Tab 的群聊）
    // - 「添加到关注 / 取消关注」（最近 Tab）
    const buildExtraMenus = (conv: ConversationWrap | undefined): ContextMenusData[] => {
        if (!conv) return []

        const menus: ContextMenusData[] = []
        const channel = conv.channel
        // sidebar 是 follow 状态的唯一权威源。channelInfo.orgData.is_followed 是 IM 同步
        // 缓存，删分组级联取关 / 取消关注后不会立即清空，回退到它会让取关后的项继续显示
        // 「取消关注」（GH #337 review 指出的 bug）。sidebar reload 在所有 follow 写操作后
        // 都会触发，初始未加载时退化为「都视为未关注」即可。
        const isFollowed = followedKeys.has(`${channel.channelType}::${channel.channelID}`)

        // 最近 Tab（filter !== 'group'）显示「添加到关注 / 取消关注」
        if (filter !== 'group') {
            if (isFollowed) {
                // 已关注 → 显示「取消关注」
                menus.push({
                    title: t("base.chatSidebar.context.unfollow"),
                    onClick: async () => {
                        const channel = conv.channel
                        try {
                            if (channel.channelType === ChannelTypeGroup) {
                                await FollowService.unfollowChannel({ group_no: channel.channelID })
                            } else if (channel.channelType === ChannelTypePerson) {
                                await FollowService.unfollowDM(channel.channelID)
                            } else if (channel.channelType === ChannelTypeCommunityTopic) {
                                await FollowService.unfollowThread(channel.channelID)
                            }
                            // 刷新分组列表
                            reloadAll()
                        } catch (err) {
                            console.error('[ChatConversationList] failed to unfollow conversation', err)
                        }
                    }
                })
            } else {
                // 未关注 → 显示「添加到关注」
                const channel = conv.channel

                // 子区：父频道未关注时弹分组子菜单（含「+ 新建分组」），先把父频道
                // 关注到目标分组再 followThread；父频道已关注时直接 followThread
                // 跟随父频道分组（子区不能脱离父频道单独换分组）。
                if (channel.channelType === ChannelTypeCommunityTopic) {
                    const parentGroupNo = conv.channelInfo?.orgData?.parentGroupNo
                        || parseThreadChannelId(channel.channelID)?.groupNo
                    const parentFollowed = !!parentGroupNo && followedGroupNos.has(parentGroupNo)

                    if (parentFollowed) {
                        menus.push({
                            title: t("base.chatSidebar.context.addToFollow"),
                            onClick: async () => {
                                try {
                                    await FollowService.followThread({ thread_channel_id: channel.channelID })
                                    reloadAll()
                                } catch (err) {
                                    console.error('[ChatConversationList] failed to follow thread', err)
                                }
                            }
                        })
                    } else {
                        const categoryItems: ContextMenusData[] = categories
                            .filter(cat => !cat.is_default && isValidCategoryItem(cat))
                            .map(cat => ({
                                title: cat.name,
                                onClick: async () => {
                                    try {
                                        await followConvToCategory(conv, cat.category_id)
                                        reloadAll()
                                    } catch (err) {
                                        console.error('[ChatConversationList] failed to follow thread', err)
                                    }
                                }
                            }))
                        categoryItems.push({ separator: true } as ContextMenusData)
                        categoryItems.push({
                            title: t("base.chatSidebar.context.createCategory"),
                            onClick: () => {
                                setPendingAction({ kind: 'followToNewCategory', conv })
                                setCreateModalVisible(true)
                            }
                        })

                        menus.push({
                            title: t("base.chatSidebar.context.addToFollow"),
                            children: categoryItems
                        })
                    }
                } else {
                    // 群聊和私聊需要选分组
                    const categoryItems: ContextMenusData[] = categories
                        .filter(cat => !cat.is_default && isValidCategoryItem(cat))
                        .map(cat => ({
                            title: cat.name,
                            onClick: async () => {
                                try {
                                    await followConvToCategory(conv, cat.category_id)
                                    reloadAll()
                                } catch (err) {
                                    console.error('[ChatConversationList] failed to follow conversation', err)
                                }
                            }
                        }))
                    categoryItems.push({ separator: true } as ContextMenusData)
                    categoryItems.push({
                        title: t("base.chatSidebar.context.createCategory"),
                        onClick: () => {
                            setPendingAction({ kind: 'followToNewCategory', conv })
                            setCreateModalVisible(true)
                        }
                    })

                    menus.push({
                        title: t("base.chatSidebar.context.addToFollow"),
                        children: categoryItems
                    })
                }
            }
        }

        // filter === 'group'(关注 Tab) 走 ConversationListGrouped 自建右键菜单,
        // 通过下方 onOpenCreateCategory(target) 把现场带回这里,不在此处处理。

        return menus
    }

    return (
        <>
            {filter === 'group' ? (
                <ConversationListGrouped
                    conversations={filteredConversations}
                    select={select}
                    onConversationClick={onConversationClick}
                    onClearMessages={onClearMessages}
                    onThreadOverflowClick={onThreadOverflowClick}
                    categories={categories.filter(isValidCategoryItem)}
                    dmsByCategory={dmsByCategory}
                    threadsByCategory={threadsByCategory}
                    itemsByCategory={itemsByCategory}
                    followedGroupNos={followedGroupNos}
                    followedKeys={followedKeys}
                    onSortFollowItems={handleSortFollowItems}
                    isLoading={isLoading}
                    error={error}
                    onRetry={reloadAll}
                    onRenameCategory={renameCategory}
                    onDeleteCategory={handleDeleteCategory}
                    onSortCategories={sortCategories}
                    onMoveGroupToCategory={handleMoveGroupToCategory}
                    onOpenCreateCategory={(target?: NewCategoryTarget) => {
                        // target 由 ConversationListGrouped 右键"+ 新建分组"传入
                        // (移到分组 / 添加到关注的分支);顶部 + 按钮不带 target,清空即可。
                        setPendingAction(target ?? null)
                        setCreateModalVisible(true)
                    }}
                    onStartGroup={() => {
                        WKApp.endpoints.organizationalLayer(null, {
                            keepSidebarTab: true,
                            onSuccess: () => {
                                reloadAll()
                                onGroupCreated?.()
                            }
                        })
                    }}
                    onCreateGroupInCategory={(categoryId: string) => {
                        WKApp.endpoints.organizationalLayer(null, {
                            defaultCategoryId: categoryId,
                            keepSidebarTab: true,
                            onSuccess: () => {
                                reloadAll()
                                onGroupCreated?.()
                            }
                        })
                    }}
                    onUnfollow={reloadAll}
                />
            ) : (
                <ConversationList
                    conversations={filteredConversations}
                    select={select}
                    filter={filter}
                    onClick={onConversationClick}
                    onClearMessages={onClearMessages}
                    onThreadOverflowClick={onThreadOverflowClick}
                    extraContextMenus={buildExtraMenus}
                    scrollToUnreadToken={scrollToUnreadToken}
                    shouldScrollToUnreadTarget={shouldScrollToRecentUnreadTarget}
                />
            )}

            {/* CreateCategoryModal 在此层统一管理，不依赖 ConversationListGrouped 挂载 */}
            <CreateCategoryModal
                visible={createModalVisible}
                existingNames={existingCategoryNames}
                onConfirm={async (name) => {
                    const action = pendingAction
                    try {
                        const created = await createCategory(name)
                        const newCategoryId = created.category_id
                        // 顶部 + 按钮入口 action 为 null,只建空分类即可。
                        if (newCategoryId && action) {
                            try {
                                if (action.kind === 'followToNewCategory') {
                                    await followConvToCategory(action.conv, newCategoryId)
                                } else if (action.kind === 'moveGroupToNewCategory') {
                                    await handleMoveGroupToCategory(action.groupNo, newCategoryId)
                                }
                            } catch (err) {
                                // 分类已建出来,不阻塞 modal 关闭;打日志让用户重试关注操作
                                console.error('[ChatConversationList] failed to assign item to new category', err)
                            }
                        }
                        reloadAll()
                        // 只有 createCategory 成功才关 modal。失败时让异常继续上抛,
                        // 由 CreateCategoryModal 自身 catch 显示"创建失败,请重试"。
                        setPendingAction(null)
                        setCreateModalVisible(false)
                    } catch (err) {
                        // 失败也清理右键上下文,避免下次打开时挂着上次的 pending
                        setPendingAction(null)
                        throw err
                    }
                }}
                onCancel={() => {
                    setPendingAction(null)
                    setCreateModalVisible(false)
                }}
            />
        </>
    )
}

export default ChatConversationList
