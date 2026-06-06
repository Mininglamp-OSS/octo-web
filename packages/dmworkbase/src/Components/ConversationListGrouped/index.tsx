import React, { useState, useRef, useEffect } from "react"
import { flushSync } from "react-dom"
import WKSDK, { ChannelTypeGroup, ChannelTypePerson, Channel, Conversation } from "wukongimjssdk"
import { ChannelTypeCommunityTopic } from "../../Service/Const"
import { parseThreadChannelId, isEffectivelyMuted } from "../../Service/Thread"
import FollowService from "../../Service/FollowService"
import { SidebarItem } from "../../Service/SidebarService"
import { ConversationWrap } from "../../Service/Model"
import ConversationList from "../ConversationList"
import ConversationListWithCategory from "../ConversationListWithCategory"
import ContextMenus, { ContextMenusContext, ContextMenusData } from "../ContextMenus"
import type { NewCategoryTarget } from "../ChatConversationList"
import {
    DndContext,
    DragOverlay,
    PointerSensor,
    useSensor,
    useSensors,
    type DragEndEvent,
    type DragStartEvent,
} from "@dnd-kit/core"
import {
    SortableContext,
    verticalListSortingStrategy,
    arrayMove,
} from "@dnd-kit/sortable"
import {
    VIRTUAL_DEFAULT_CATEGORY_ID,
    computeEffectiveCategories,
    isValidCategoryItem,
    isVirtualCategory,
    type ValidCategoryItem,
} from "./categoriesFallback"
import { filterArchivedThreads, isArchivedThreadConversation } from "./archivedThreads"
import { useI18n } from "../../i18n"
import { wkConfirm } from "../WKModal"

// 兜底相关 helper 迁移至 ./categoriesFallback 独立模块，便于无依赖地单元测试。
// 这里保留 re-export 以保持对外 API 不变（ConversationList.tsx / storybook 可直接从本模块引用）。
export {
    VIRTUAL_DEFAULT_CATEGORY_ID,
    computeEffectiveCategories,
    isValidCategoryItem,
    isVirtualCategory,
    type ValidCategoryItem,
}

export interface ConversationListGroupedProps {
    conversations: ConversationWrap[]
    select?: Channel
    onConversationClick: (conv: ConversationWrap) => void
    onClearMessages: (channel: Channel) => void
    onThreadOverflowClick: (groupNo: string) => void

    // 分组数据（由 ChatConversationList 提供，不自己 fetch）
    categories: ValidCategoryItem[]
    /** 已关注 DM 按 category_id 聚合（来自 /sidebar/sync）。key 为 category_id，"" 表示未分类 */
    dmsByCategory?: Map<string, SidebarItem[]>
    /** 已关注子区按 category_id 聚合（来自 /sidebar/sync） */
    threadsByCategory?: Map<string, SidebarItem[]>
    /** 全类型按 category_id 聚合，每桶按 follow_sort ASC（手动排序的源信息）。
     *  非空时取代旧的「按 timestamp 排」分支，让用户的拖拽顺序可见。 */
    itemsByCategory?: Map<string, SidebarItem[]>
    /** 当前已关注的群 group_no 集合。/categories 不感知 follow 状态，渲染时与此 Set 求交。
     *  传 undefined 时退化到不过滤（兼容旧调用方）。 */
    followedGroupNos?: Set<string>
    /** 全类型已关注集合（key 为 `${target_type}::${target_id}`）。
     *  渲染父群下子区时与此求交，避免 IM 仍有活跃会话但 sidebar 已 unfollow 的子区还在显示。 */
    followedKeys?: Set<string>
    /** 同分组内手动排序回调；items 顺序即新顺序，target_type 与 target_id 取自会话频道 */
    onSortFollowItems?: (items: { target_type: number; target_id: string }[]) => void | Promise<void>
    isLoading: boolean
    error: string | null
    onRetry: () => void
    onRenameCategory: (id: string, name: string) => Promise<void>
    onDeleteCategory: (id: string) => Promise<void> | void
    onSortCategories: (ids: string[]) => Promise<void>
    onMoveGroupToCategory: (groupNo: string, categoryId: string) => Promise<void>
    /**
     * 打开"新建分组" modal。target 表示当时右键的现场;父层(ChatConversationList)据此
     * 把分类建出后顺手把右键选中项归入新分类。无 target = 顶部 + 入口/纯建空分类。
     */
    onOpenCreateCategory: (target?: NewCategoryTarget) => void
    onStartGroup?: () => void
    onCreateGroupInCategory?: (categoryId: string) => void
    /** 取消关注后的回调（用于刷新列表） */
    onUnfollow?: () => void
}



const ConversationListGrouped: React.FC<ConversationListGroupedProps> = ({
    conversations,
    select,
    onConversationClick,
    onClearMessages,
    onThreadOverflowClick,
    categories,
    dmsByCategory,
    threadsByCategory,
    itemsByCategory,
    followedGroupNos,
    followedKeys,
    onSortFollowItems,
    isLoading,
    error,
    onRetry,
    onRenameCategory,
    onDeleteCategory,
    onSortCategories,
    onMoveGroupToCategory,
    onOpenCreateCategory,
    onStartGroup,
    onCreateGroupInCategory,
    onUnfollow,
}) => {
    const { t } = useI18n()
    // ── DnD 状态 ──────────────────────────────────────────────────────────────
    const sensors = useSensors(useSensor(PointerSensor, {
        activationConstraint: { distance: 6 }, // 6px 才触发拖拽，避免误触点击
    }))
    const [activeDragId, setActiveDragId] = useState<string | null>(null)
    type DragData =
        | { type: 'category'; categoryId: string }
        | { type: 'item'; channelType: number; channelID: string; isThread?: boolean }

    function isDragData(d: unknown): d is DragData {
        if (!d || typeof d !== 'object') return false
        const obj = d as Record<string, unknown>
        if (obj.type === 'category') return typeof obj.categoryId === 'string'
        if (obj.type === 'item') return typeof obj.channelID === 'string' && typeof obj.channelType === 'number'
        return false
    }

    const [activeDragData, setActiveDragData] = useState<DragData | null>(null)

    // 分组内 sort：sortable id → 所属分组ID 反查；分组ID → 该分组的可排序 items（不含子区）。
    // 在下方 categoriesForView 构建时填充，handleDragEnd 通过闭包读取最新值。
    const itemToCategory = new Map<string, string>()
    const categoryItems = new Map<string, ConversationWrap[]>()

    const handleDragStart = (event: DragStartEvent) => {
        setActiveDragId(String(event.active.id))
        const d = event.active.data.current
        setActiveDragData(isDragData(d) ? d : null)
    }

    const handleDragEnd = (event: DragEndEvent) => {
        setActiveDragId(null)
        setActiveDragData(null)
        const { active, over } = event
        if (!over) return

        const activeType = active.data.current?.type
        const overId = String(over.id)
        const overType = over.data.current?.type

        if (activeType === 'category') {
            // 分组整体排序——只动可见分组（effectiveCategories）。索引基于隐藏后的
            // 列表才不会拖到不可见 slot，hidden default 通过 hiddenRealCategoryIds 追加
            // 在末尾保住后端 contract。
            const oldIndex = effectiveCategories.findIndex(c => `cat::${c.category_id}` === String(active.id))
            const newIndex = effectiveCategories.findIndex(c => `cat::${c.category_id}` === overId)
            if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
                const newOrder = arrayMove(effectiveCategories, oldIndex, newIndex)
                    .map(c => c.category_id as string)
                onSortCategories([...newOrder, ...hiddenRealCategoryIds])
            }
            return
        }

        if (activeType !== 'item') return
        const d = active.data.current
        if (!isDragData(d) || d.type !== 'item') return
        const channelID = d.channelID
        const channelType = d.channelType

        // DM 跨分组移动：复用 followDM(peer_uid, category_id) 覆盖式更新（与右键菜单同实现）。
        // 失败时让 onUnfollow reload 兜底回到原位。
        const moveDmToCategory = async (peerUid: string, targetCatId: string) => {
            try {
                await FollowService.followDM({ peer_uid: peerUid, category_id: targetCatId })
                onUnfollow?.()
            } catch (err) {
                console.error('[ConversationListGrouped] failed to move DM to category', err)
                onUnfollow?.()
            }
        }

        // 分支 1：item → item，落在另一个会话上
        if (overType === 'item') {
            const sourceCatId = itemToCategory.get(String(active.id))
            const targetCatId = itemToCategory.get(overId)
            if (!sourceCatId || !targetCatId) return

            if (sourceCatId === targetCatId) {
                // 同分组内手动排序：调 /v2/follow/sort，items 顺序由数组下标决定。
                // 子区跟随父群在视觉上一起移动 → 提交时把每个群的已关注子区紧跟其后，
                // 否则后端不更新子区的 follow_sort，旧值会让子区在 sidebar 里漂离父群。
                const items = categoryItems.get(sourceCatId) || []
                const oldIndex = items.findIndex(c => `item::${c.channel.channelType}::${c.channel.channelID}` === String(active.id))
                const newIndex = items.findIndex(c => `item::${c.channel.channelType}::${c.channel.channelID}` === overId)
                if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
                    const newOrder = arrayMove(items, oldIndex, newIndex)
                    const sortItems: { target_type: number; target_id: string }[] = []
                    for (const c of newOrder) {
                        sortItems.push({
                            target_type: c.channel.channelType,
                            target_id: c.channel.channelID,
                        })
                        // 群下面紧跟其已关注子区。followedChildThreadsByParent 已合并
                        // IM 缓存（按 followedKeys 过滤）+ sidebar 自带的 sidebar-only
                        // 关注子区（通过 parent_channel_id 反挂），保证拖父群时所有
                        // 已关注的子区都进 sort payload，不会漏掉新关注但 IM 没缓存的。
                        if (c.channel.channelType === ChannelTypeGroup) {
                            const childThreads = followedChildThreadsByParent.get(c.channel.channelID) || []
                            for (const t of childThreads) {
                                sortItems.push({
                                    target_type: ChannelTypeCommunityTopic,
                                    target_id: t.channel.channelID,
                                })
                            }
                        }
                    }
                    onSortFollowItems?.(sortItems)
                }
            } else if (!isVirtualCategory(targetCatId)) {
                // 跨分组移动
                if (channelType === ChannelTypeGroup) {
                    onMoveGroupToCategory(channelID, targetCatId)
                } else if (channelType === ChannelTypePerson) {
                    moveDmToCategory(channelID, targetCatId)
                }
            }
            return
        }

        // 分支 2：item → 分组 header / drop area（群 + DM 跨分组移动；子区不支持）
        if (channelType === ChannelTypeCommunityTopic) return
        let targetCatId: string | undefined
        if (overId.startsWith('drop::cat::')) {
            targetCatId = overId.replace('drop::cat::', '')
        } else if (overId.startsWith('cat::')) {
            targetCatId = overId.replace('cat::', '')
        }
        if (!targetCatId || isVirtualCategory(targetCatId)) return
        if (channelType === ChannelTypeGroup) {
            onMoveGroupToCategory(channelID, targetCatId)
        } else if (channelType === ChannelTypePerson) {
            moveDmToCategory(channelID, targetCatId)
        }
    }
    // ──────────────────────────────────────────────────────────────────────────

    const categoryCtxMenuRef = useRef<ContextMenusContext | null>(null)
    const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null)
    const ctxMenuClearRef = useRef<(() => void) | null>(null)

    // 组件卸载时清理 context menu 的 mousedown 监听器
    useEffect(() => {
        return () => {
            if (ctxMenuClearRef.current) {
                document.removeEventListener('mousedown', ctxMenuClearRef.current, true)
                ctxMenuClearRef.current = null
            }
        }
    }, [])
    // 菜单数据用 ref 存，避免 state 异步导致 menus 为空时就 show()
    const [categoryMenus, setCategoryMenus] = useState<ContextMenusData[]>([])
    const [renamingCategoryId, setRenamingCategoryId] = useState<string | null>(null)

    const groupConversations = conversations.filter(
        c => c.channel.channelType === ChannelTypeGroup
    )
    const groupConvMap = new Map(groupConversations.map(c => [c.channel.channelID, c]))

    // DM conversations 按 peer_uid (= channelID for ChannelTypePerson) 索引
    const dmConvMap = new Map(
        conversations
            .filter(c => c.channel.channelType === ChannelTypePerson)
            .map(c => [c.channel.channelID, c])
    )
    // 子区 conversations 按 channelID 索引（独立 follow item，不挂在父群下）
    const threadConvByChannel = new Map(
        conversations
            .filter(c => c.channel.channelType === ChannelTypeCommunityTopic)
            .map(c => [c.channel.channelID, c])
    )

    // Thread conv: parentGroupNo → 子区列表
    const threadConvsByParent = new Map<string, ConversationWrap[]>()
    for (const conv of conversations) {
        const parentGroupNo = conv.channelInfo?.orgData?.parentGroupNo
            || parseThreadChannelId(conv.channel.channelID)?.groupNo
        if (parentGroupNo) {
            const list = threadConvsByParent.get(parentGroupNo) || []
            list.push(conv)
            threadConvsByParent.set(parentGroupNo, list)
        }
    }

    // 把 sidebar item 解析成 ConversationWrap；IM SDK 缓存里没有时（新关注从未聊过）
    // 现合成一个占位 conv，channelInfo 由 ChannelManager 异步补齐。同一份逻辑被
    // categoriesForView 多个分支共用 + 下面的 followedChildThreadsByParent 也用。
    const synthesizeFromItem = (it: SidebarItem): ConversationWrap => {
        const conv = new Conversation()
        conv.channel = new Channel(it.target_id, it.channel_type)
        conv.unread = it.unread || 0
        conv.timestamp = it.timestamp || 0
        return new ConversationWrap(conv)
    }

    // 父群下「已关注子区」统一来源：合并 IM 缓存（按 followedKeys 过滤掉缓存里仍活跃
    // 但 sidebar 已 unfollow 的）+ sidebar 自己列出的 target_type=5 项（含 IM 没缓存的，
    // 通过 parent_channel_id 反挂父群）。渲染嵌套和拖父群 sort payload 共用，避免出现
    // 「sidebar-only 关注子区不嵌父群、也不进 sort」的 bug。
    const followedChildThreadsByParent = new Map<string, ConversationWrap[]>()
    for (const [parentGroupNo, threads] of threadConvsByParent) {
        const filtered = followedKeys
            ? threads.filter(t => followedKeys.has(`${ChannelTypeCommunityTopic}::${t.channel.channelID}`))
            : threads
        if (filtered.length) followedChildThreadsByParent.set(parentGroupNo, filtered.slice())
    }
    if (itemsByCategory) {
        for (const list of itemsByCategory.values()) {
            for (const it of list) {
                if (it.target_type !== 5) continue
                const parentGroupNo = it.parent_channel_id
                if (!parentGroupNo) continue
                const existing = followedChildThreadsByParent.get(parentGroupNo) || []
                if (existing.some(t => t.channel.channelID === it.target_id)) continue
                const conv = threadConvByChannel.get(it.target_id) || synthesizeFromItem(it)
                existing.push(conv)
                followedChildThreadsByParent.set(parentGroupNo, existing)
            }
        }
    }

    // 渲染用的可见子区 map：在全量 followedChildThreadsByParent 基础上过滤掉「明确已归档」
    // 的子区（fail-open：status 未知/未加载的子区仍显示）。全量 map 继续用于拖拽排序的
    // sort payload，避免隐藏归档子区导致后端 follow_sort 被意外改动。
    const visibleChildThreadsByParent = new Map<string, ConversationWrap[]>()
    for (const [parentGroupNo, threads] of followedChildThreadsByParent) {
        visibleChildThreadsByParent.set(parentGroupNo, filterArchivedThreads(threads))
    }

    // 构建右键菜单：取消关注 + 移出分组（有分组时，一级直接点击）+ 移到分组（一级，展开二级子菜单）
    const buildExtraContextMenus = (conv: ConversationWrap | undefined): ContextMenusData[] => {
        if (!conv) return []
        
        const menus: ContextMenusData[] = []
        const channel = conv.channel
        
        // 1. 取消关注（所有类型都支持）
        const unfollowItem: ContextMenusData = {
            title: t("base.chatSidebar.context.unfollow"),
            icon: "M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z M2.172 15.172a4 4 0 0 0 5.656 0L10 13l2.172 2.172a4 4 0 1 0 5.656-5.656L10 1.686 2.172 9.514a4 4 0 0 0 0 5.658Z",
            onClick: async () => {
                try {
                    if (channel.channelType === ChannelTypeGroup) {
                        await FollowService.unfollowChannel({ group_no: channel.channelID })
                    } else if (channel.channelType === ChannelTypePerson) {
                        await FollowService.unfollowDM(channel.channelID)
                    } else if (channel.channelType === ChannelTypeCommunityTopic) {
                        await FollowService.unfollowThread(channel.channelID)
                    }
                    onUnfollow?.()
                } catch (err) {
                    console.error('[ConversationListGrouped] failed to unfollow conversation', err)
                }
            }
        }
        menus.push(unfollowItem)
        
        // 2. 移到分组 / 移出分组（仅群聊）
        if (channel.channelType === ChannelTypeGroup && categories.length > 0) {
            const groupNo = channel.channelID
            const currentCategoryId = categories.find(
                cat => (cat.groups || []).some(g => g.group_no === groupNo)
            )?.category_id

            // 「移到分组」二级子菜单（排除当前分组）
            const moveToChildren: ContextMenusData[] = categories
                .filter(c => c.category_id !== currentCategoryId && !c.is_default)
                .map(cat => ({
                    title: cat.name,
                    checked: false,
                    onClick: () => onMoveGroupToCategory(groupNo, cat.category_id),
                }))
            moveToChildren.push({ separator: true } as ContextMenusData)
            moveToChildren.push({
                title: t("base.chatSidebar.context.createCategory"),
                onClick: () => onOpenCreateCategory({ kind: 'moveGroupToNewCategory', groupNo }),
            })

            const moveToItem: ContextMenusData = {
                title: t("base.chatSidebar.context.moveToCategory"),
                icon: "M2 9V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-4 M12 3v5h5 M9 15l3 3 3-3 M12 12v6",
                children: moveToChildren,
            }
            menus.push(moveToItem)
        }

        // 3. 移到分组（DM）—— 复用 followDM(peer_uid, category_id) 覆盖旧 category_id
        if (channel.channelType === ChannelTypePerson && categories.length > 0) {
            const peerUid = channel.channelID
            // 反查当前 DM 所在分组
            let currentDmCategoryId: string | undefined
            if (dmsByCategory) {
                for (const [catId, items] of dmsByCategory) {
                    if (items.some(it => it.target_id === peerUid)) {
                        currentDmCategoryId = catId || undefined
                        break
                    }
                }
            }
            const moveToChildrenDm: ContextMenusData[] = categories
                .filter(c => !c.is_default && c.category_id !== currentDmCategoryId)
                .map(cat => ({
                    title: cat.name,
                    checked: false,
                    onClick: async () => {
                        try {
                            await FollowService.followDM({ peer_uid: peerUid, category_id: cat.category_id })
                            onUnfollow?.()
                        } catch (err) {
                            console.error('[ConversationListGrouped] failed to move DM to category', err)
                        }
                    },
                }))
            moveToChildrenDm.push({ separator: true } as ContextMenusData)
            moveToChildrenDm.push({
                title: t("base.chatSidebar.context.createCategory"),
                // DM 的"新分组"语义 = 用新分类 followDM,与 followConvToCategory
                // 对 ChannelTypePerson 分支等价(都走 FollowService.followDM)。
                onClick: () => onOpenCreateCategory({ kind: 'followToNewCategory', conv }),
            })
            menus.push({
                title: t("base.chatSidebar.context.moveToCategory"),
                icon: "M2 9V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-4 M12 3v5h5 M9 15l3 3 3-3 M12 12v6",
                children: moveToChildrenDm,
            })
        }

        return menus
    }

    const ConvListWithMenu = (convs: ConversationWrap[]) => {
        // 同分组内 sort 的 sortable items：排除子区（子区跟随父频道，不独立排序）。
        // 注：DM/群的 useSortable id 与此处 items 必须一致 —— item::<channelType>::<channelID>
        const sortableIds = convs
            .filter(c => c.channel.channelType !== ChannelTypeCommunityTopic)
            .map(c => `item::${c.channel.channelType}::${c.channel.channelID}`)
        return (
            <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
                <ConversationList
                    conversations={convs}
                    select={select}
                    filter="all"
                    compact
                    onClick={onConversationClick}
                    onClearMessages={onClearMessages}
                    onThreadOverflowClick={onThreadOverflowClick}
                    extraContextMenus={buildExtraContextMenus}
                    hideCloseChat
                    disablePinSplit
                    hidePin
                />
            </SortableContext>
        )
    }

    // 所有非默认分组里已归组的群 group_no 集合（用于默认分组的兜底逻辑）
    const assignedGroupNos = new Set<string>()
    for (const cat of categories) {
        if (!cat.is_default) {
            for (const g of cat.groups || []) {
                assignedGroupNos.add(g.group_no)
            }
        }
    }

    // 兜底：后端 categories 为空（GH dmwork-org/dmwork-web#1044 旧账号场景）时，渲染一个
    // 虚拟「默认」分组，避免 groupConversations 整列消失。真实 categories 走原逻辑。
    // 关注 tab 按 PM #337 spec 不展示默认分组（含真实 is_default 与虚拟兜底分组）。
    const effectiveCategories = computeEffectiveCategories(categories)
        .filter(cat => !cat.is_default && !isVirtualCategory(cat.category_id))

    // 用户视角的可见分组排序只动 effectiveCategories；提交 /categories/sort 时仍要把
    // 真实存在但被隐藏的默认分组带上，否则后端会误删 / useCategoryList 的本地重建会
    // 因为 ID 不在新顺序里把它丢掉。虚拟分组没有真 UUID 永远不发。
    const hiddenRealCategoryIds = categories
        .filter(c => !effectiveCategories.some(v => v.category_id === c.category_id))
        .filter(c => !isVirtualCategory(c.category_id))
        .map(c => c.category_id as string)

    const categoriesForView = effectiveCategories.map(cat => {
        let catConvs: ConversationWrap[]

        const sidebarKey = cat.is_default ? "" : (cat.category_id ?? "")
        const sidebarInCat = itemsByCategory?.get(sidebarKey) || []

        if (cat.is_default) {
            // 关注 tab 不会走默认分组（上层已 filter）；保留兜底以防其它 caller 复用。
            catConvs = groupConversations.filter(c => !assignedGroupNos.has(c.channel.channelID))
            catConvs = catConvs.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))
            const withThreads: ConversationWrap[] = []
            for (const conv of catConvs) {
                withThreads.push(conv)
                const threads = filterArchivedThreads([...(threadConvsByParent.get(conv.channel.channelID) || [])])
                    .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))
                withThreads.push(...threads)
            }
            catConvs = withThreads
        } else if (itemsByCategory) {
            // 关注 tab 主路径：直接按 sidebar 给的 follow_sort 顺序铺。
            // 每个 item 解析成 ConversationWrap，群下面紧跟其已关注子区。
            // 这样手动排序结果立即可见，且 DM/群混排顺序与后端一致。
            catConvs = []
            // dedupe 用 ${target_type}::${target_id} 复合 key，避免 DM/群/子区
            // 共享同一 raw id 时互相抑制（target_id 在不同表是各自命名空间）。
            const seenIds = new Set<string>()
            const keyOf = (type: number, id: string) => `${type}::${id}`
            for (const it of sidebarInCat) {
                const itKey = keyOf(it.target_type, it.target_id)
                if (seenIds.has(itKey)) continue
                seenIds.add(itKey)

                if (it.target_type === 1) {
                    catConvs.push(dmConvMap.get(it.target_id) || synthesizeFromItem(it))
                } else if (it.target_type === 2) {
                    catConvs.push(groupConvMap.get(it.target_id) || synthesizeFromItem(it))
                    // 父群下挂已关注子区：来源已合并 IM 缓存（按 followedKeys 过滤）+ sidebar
                    // 自带的 target_type=5 with parent_channel_id（含 IM 没缓存的关注子区）。
                    // 渲染用可见 map（已过滤明确归档子区）；全量 map 仅用于拖拽 sort payload。
                    const childThreads = (visibleChildThreadsByParent.get(it.target_id) || [])
                        .slice()
                        .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))
                    for (const t of childThreads) {
                        const tKey = keyOf(ChannelTypeCommunityTopic, t.channel.channelID)
                        if (!seenIds.has(tKey)) {
                            seenIds.add(tKey)
                            catConvs.push(t)
                        }
                    }
                } else if (it.target_type === 5) {
                    const threadConv = threadConvByChannel.get(it.target_id) || synthesizeFromItem(it)
                    // standalone 子区：明确归档的不在关注列表渲染（ThreadPanel 仍可查看/重新激活）。
                    if (!isArchivedThreadConversation(threadConv)) {
                        catConvs.push(threadConv)
                    }
                }
            }
        } else {
            // 兜底：旧 caller 没传 itemsByCategory 时，按 cat.groups 顺序拼装。
            const visibleGroups = followedGroupNos
                ? (cat.groups || []).filter(g => followedGroupNos.has(g.group_no))
                : (cat.groups || [])
            catConvs = []
            for (const g of visibleGroups) {
                const groupConv = groupConvMap.get(g.group_no)
                if (groupConv) {
                    catConvs.push(groupConv)
                    const threads = filterArchivedThreads(threadConvsByParent.get(g.group_no) || [])
                    catConvs.push(...threads)
                }
            }
            const dmItems = dmsByCategory?.get(sidebarKey) || []
            const threadItems = threadsByCategory?.get(sidebarKey) || []
            const dmConvsInCat = dmItems.map(it => dmConvMap.get(it.target_id) || synthesizeFromItem(it))
            const standaloneThreadConvs = filterArchivedThreads(
                threadItems.map(it => threadConvByChannel.get(it.target_id) || synthesizeFromItem(it))
            )
            const seenChannelIds = new Set(catConvs.map(c => c.channel.channelID))
            const dedupedThreads = standaloneThreadConvs.filter(c => !seenChannelIds.has(c.channel.channelID))
            catConvs.push(...dmConvsInCat, ...dedupedThreads)
        }

        // 记录 sortable items（DM + 群，子区不参与 sort）→ handleDragEnd 用
        const sortableInCat = catConvs.filter(c => c.channel.channelType !== ChannelTypeCommunityTopic)
        categoryItems.set(cat.category_id, sortableInCat)
        for (const c of sortableInCat) {
            itemToCategory.set(`item::${c.channel.channelType}::${c.channel.channelID}`, cat.category_id)
        }

        const groupCount = catConvs.length
        const isMuted = (c: ConversationWrap): boolean => {
            const isThread = c.channel.channelType === ChannelTypeCommunityTopic
            let parentChannelInfo: any | undefined
            if (isThread) {
                const parentGroupNo = c.channelInfo?.orgData?.parentGroupNo
                    || parseThreadChannelId(c.channel.channelID)?.groupNo
                if (parentGroupNo) {
                    parentChannelInfo = WKSDK.shared().channelManager.getChannelInfo(
                        new Channel(parentGroupNo, ChannelTypeGroup)
                    )
                }
            }
            return isEffectivelyMuted({ isThread, channelInfo: c.channelInfo, parentChannelInfo })
        }
        const unreadCount = catConvs.reduce((sum, c) => sum + (isMuted(c) ? 0 : (c.unread || 0)), 0)
        const hasMention = catConvs.some(c => !isMuted(c) && c.isMentionMe)
        return {
            id: cat.category_id,
            name: cat.is_default ? t("base.chatSidebar.defaultCategory") : cat.name,
            groupCount,
            isEmpty: groupCount === 0,
            unreadCount,
            hasMention,
            conversations: ConvListWithMenu(catConvs),
        }
    })

    const buildCategoryContextMenus = (categoryId: string): ContextMenusData[] => {
        // 虚拟默认分组没有真实 UUID，无法 rename / delete / sort / create-group，直接屏蔽菜单
        if (isVirtualCategory(categoryId)) return []
        // 用 effectiveCategories（=可见分组）做 idx，否则上/下移会跳到不可见 slot
        const idx = effectiveCategories.findIndex(c => c.category_id === categoryId)
        const cat = effectiveCategories[idx]
        if (!cat) return []

        const upDownMenus: ContextMenusData[] = [
            {
                title: t("base.chatSidebar.context.moveUp"),
                icon: "M18 15 12 9 6 15",
                onClick: () => {
                    if (idx <= 0) return
                    const newIds = effectiveCategories.map(c => c.category_id as string)
                    ;[newIds[idx - 1], newIds[idx]] = [newIds[idx], newIds[idx - 1]]
                    onSortCategories([...newIds, ...hiddenRealCategoryIds])
                },
            },
            {
                title: t("base.chatSidebar.context.moveDown"),
                icon: "M6 9l6 6 6-6",
                onClick: () => {
                    if (idx >= effectiveCategories.length - 1) return
                    const newIds = effectiveCategories.map(c => c.category_id as string)
                    ;[newIds[idx], newIds[idx + 1]] = [newIds[idx + 1], newIds[idx]]
                    onSortCategories([...newIds, ...hiddenRealCategoryIds])
                },
            },
        ]

        // 默认分组：仅允许拖拽排序，屏蔽「重命名」和「删除分组」
        if (cat.is_default) {
            return upDownMenus
        }

        return [
            {
                title: t("base.chatSidebar.context.startGroup"),
                icon: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 7a4 4 0 1 0 8 0 4 4 0 0 0-8 0 M22 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75",
                onClick: () => {
                    onCreateGroupInCategory?.(categoryId)
                },
            },
            { separator: true } as ContextMenusData,
            {
                title: t("base.chatSidebar.context.rename"),
                icon: "M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z m-2-2 4 4",
                onClick: () => {
                    setRenamingCategoryId(categoryId)
                    setActiveCategoryId(null)
                },
            },
            ...upDownMenus,
            { separator: true } as ContextMenusData,
            {
                title: t("base.chatSidebar.context.deleteCategory"),
                icon: "M3 6h18 M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6 M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2",
                danger: true,
                onClick: () => {
                    wkConfirm({
                        title: t("base.chatSidebar.confirm.deleteCategoryTitle"),
                        content: t("base.chatSidebar.confirm.deleteCategoryContent", {
                            values: { name: cat.name },
                        }),
                        okType: 'danger',
                        okText: t("base.chatSidebar.action.delete"),
                        cancelText: t("base.common.cancel"),
                        onOk: () => onDeleteCategory(categoryId),
                    })
                },
            },
        ]
    }

    const categoryIds = effectiveCategories.map(c => `cat::${c.category_id}`)

    // 找到正在拖拽的 conv item（用于 DragOverlay）
    const activeDragConv = activeDragData?.type === 'item'
        ? conversations.find(c => c.channel.channelID === activeDragData.channelID)
        : null

    return (
        <DndContext
            sensors={sensors}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
        >
            <SortableContext items={categoryIds} strategy={verticalListSortingStrategy}>
                <ConversationListWithCategory
                    key={isLoading ? "loading" : categories.map(c => c.category_id).join(",")}
                    categories={categoriesForView}
                    isLoading={isLoading}
                    error={error}
                    onRetry={onRetry}
                    onCreateCategory={onOpenCreateCategory}
                    hasNoGroups={categories.length === 0 && groupConversations.length === 0}
                    onStartGroup={onStartGroup}
                    activeCategoryId={activeCategoryId}
                    renamingCategoryId={renamingCategoryId}
                    categorySectionDraggable={categories.length > 0}
                    onRenameConfirm={async (id, newName) => {
                        await onRenameCategory(id, newName)
                        setRenamingCategoryId(null)
                    }}
                    onRenameCancel={() => setRenamingCategoryId(null)}
                    onCategoryContextMenu={(categoryId, e) => {
                        e.preventDefault()
                        // 虚拟默认分组不响应右键菜单（无可执行操作）
                        if (isVirtualCategory(categoryId)) return
                        const menus = buildCategoryContextMenus(categoryId)
                        flushSync(() => {
                            setActiveCategoryId(categoryId)
                            setCategoryMenus(menus)
                        })
                        categoryCtxMenuRef.current?.show(e)
                        if (ctxMenuClearRef.current) {
                            document.removeEventListener('mousedown', ctxMenuClearRef.current, true)
                        }
                        const clear = () => {
                            setActiveCategoryId(null)
                            document.removeEventListener('mousedown', clear, true)
                            ctxMenuClearRef.current = null
                        }
                        ctxMenuClearRef.current = clear
                        document.addEventListener('mousedown', clear, true)
                    }}
                />
            </SortableContext>

            <ContextMenus
                onContext={(ctx) => { categoryCtxMenuRef.current = ctx }}
                menus={categoryMenus}
            />

            {/* DragOverlay：ghost 预览 */}
            <DragOverlay>
                {activeDragConv ? (
                    <div className="wk-conv-compact-item wk-conv-compact-item--ghost">
                        <span className="wk-conv-compact-icon">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="4" y1="6" x2="20" y2="6" />
                                <line x1="4" y1="12" x2="20" y2="12" />
                                <line x1="4" y1="18" x2="12" y2="18" />
                            </svg>
                        </span>
                        <span className="wk-conv-compact-name">
                            {activeDragConv.channelInfo?.orgData.displayName ?? activeDragConv.channel.channelID}
                        </span>
                    </div>
                ) : activeDragData?.type === 'category' ? (
                    <div className="wk-category-header wk-category-header--ghost">
                        <span className="wk-category-header__name">
                            {categories.find(c => `cat::${c.category_id}` === activeDragId)?.name ?? t("base.chatSidebar.categoryFallback")}
                        </span>
                    </div>
                ) : null}
            </DragOverlay>
        </DndContext>
    )
}

export default ConversationListGrouped
