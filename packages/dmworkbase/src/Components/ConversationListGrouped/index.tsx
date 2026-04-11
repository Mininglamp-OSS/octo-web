import React, { useState, useRef, useEffect } from "react"
import { flushSync } from "react-dom"
import { ChannelTypeGroup, Channel } from "wukongimjssdk"
import { CategoryItem } from "../../Service/CategoryService"
import { ConversationWrap } from "../../Service/Model"
import ConversationList from "../ConversationList"
import ConversationListWithCategory from "../ConversationListWithCategory"
import CategoryManagePanel from "../CategoryManagePanel"
import ContextMenus, { ContextMenusContext, ContextMenusData } from "../ContextMenus"

// category_id 收窄为非 null（useCategoryList 已 filter 掉 null 项）
export type ValidCategoryItem = CategoryItem & { category_id: string }

export interface ConversationListGroupedProps {
    conversations: ConversationWrap[]
    select?: Channel
    onConversationClick: (conv: ConversationWrap) => void
    onClearMessages: (channel: Channel) => void
    onThreadOverflowClick: (groupNo: string) => void

    // 分组数据（由 ChatConversationList 提供，不自己 fetch）
    categories: ValidCategoryItem[]
    isLoading: boolean
    error: string | null
    onRetry: () => void
    onRenameCategory: (id: string, name: string) => Promise<void>
    onDeleteCategory: (id: string) => Promise<void> | void
    onSortCategories: (ids: string[]) => Promise<void>
    onMoveGroupToCategory: (groupNo: string, categoryId: string) => Promise<void>
    onOpenCreateCategory: () => void
}

type ViewMode = "all" | "grouped"

const VIEW_MODE_KEY = "wk_category_view_mode"

function getStoredViewMode(): ViewMode {
    try {
        const v = localStorage.getItem(VIEW_MODE_KEY)
        if (v === "all" || v === "grouped") return v
    } catch {}
    return "all"
}

const ConversationListGrouped: React.FC<ConversationListGroupedProps> = ({
    conversations,
    select,
    onConversationClick,
    onClearMessages,
    onThreadOverflowClick,
    categories,
    isLoading,
    error,
    onRetry,
    onRenameCategory,
    onDeleteCategory,
    onSortCategories,
    onMoveGroupToCategory,
    onOpenCreateCategory,
}) => {
    const [viewMode, setViewMode] = useState<ViewMode>(getStoredViewMode)
    const [managePanelVisible, setManagePanelVisible] = useState(false)
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

    const handleViewModeChange = (mode: ViewMode) => {
        setViewMode(mode)
        try { localStorage.setItem(VIEW_MODE_KEY, mode) } catch {}
    }

    const groupConversations = conversations.filter(
        c => c.channel.channelType === ChannelTypeGroup
    )
    const groupConvMap = new Map(groupConversations.map(c => [c.channel.channelID, c]))

    // Thread conv: parentGroupNo → list
    const threadConvsByParent = new Map<string, ConversationWrap[]>()
    for (const conv of conversations) {
        if (conv.channel.channelType !== ChannelTypeGroup) continue
        // skip groups, only threads below
    }
    for (const conv of conversations) {
        const parentGroupNo = conv.channelInfo?.orgData?.parentGroupNo
        if (parentGroupNo) {
            const list = threadConvsByParent.get(parentGroupNo) || []
            list.push(conv)
            threadConvsByParent.set(parentGroupNo, list)
        }
    }

    const categorizedGroupNos = new Set(
        categories.flatMap(cat => (cat.groups || []).map(g => g.group_no))
    )
    const ungroupedGroupNos = groupConversations
        .filter(c => !categorizedGroupNos.has(c.channel.channelID))
        .map(c => c.channel.channelID)
    const ungroupedConvs: ConversationWrap[] = []
    for (const groupNo of ungroupedGroupNos) {
        const groupConv = groupConvMap.get(groupNo)
        if (groupConv) {
            ungroupedConvs.push(groupConv)
            const threads = threadConvsByParent.get(groupNo) || []
            ungroupedConvs.push(...threads)
        }
    }

    // 构建「移到分组」子菜单（含 ✓ 标识 + 新建分组入口）
    const buildExtraContextMenus = (conv: ConversationWrap | undefined): ContextMenusData[] => {
        if (!conv || conv.channel.channelType !== ChannelTypeGroup) return []
        if (categories.length === 0) return []

        const groupNo = conv.channel.channelID
        const currentCategoryId = categories.find(
            cat => (cat.groups || []).some(g => g.group_no === groupNo)
        )?.category_id

        const items: ContextMenusData[] = categories.map(cat => ({
            title: cat.name,
            checked: currentCategoryId === cat.category_id,
            onClick: () => onMoveGroupToCategory(groupNo, cat.category_id),
        }))
        items.push({ separator: true } as ContextMenusData)
        items.push({ title: "+ 新建分组", onClick: onOpenCreateCategory })

        return items
    }

    const ConvListWithMenu = (convs: ConversationWrap[]) => (
        <ConversationList
            conversations={convs}
            select={select}
            filter="group"
            onClick={onConversationClick}
            onClearMessages={onClearMessages}
            onThreadOverflowClick={onThreadOverflowClick}
            extraContextMenus={buildExtraContextMenus}
        />
    )

    const categoriesForView = categories.map(cat => {
        const catConvs: ConversationWrap[] = []
        for (const g of (cat.groups || [])) {
            const groupConv = groupConvMap.get(g.group_no)
            if (groupConv) {
                catConvs.push(groupConv)
                // 해당 그룹의 thread conv도 포함
                const threads = threadConvsByParent.get(g.group_no) || []
                catConvs.push(...threads)
            }
        }
        const groupCount = (cat.groups || []).length
        const unreadCount = catConvs.reduce((sum, c) => sum + (c.unread || 0), 0)
        return {
            id: cat.category_id,
            name: cat.name,
            groupCount,
            isEmpty: groupCount === 0,
            unreadCount,
            conversations: ConvListWithMenu(catConvs),
        }
    })

    const buildCategoryContextMenus = (categoryId: string): ContextMenusData[] => {
        const idx = categories.findIndex(c => c.category_id === categoryId)
        const cat = categories[idx]
        if (!cat) return []
        return [
            {
                title: "重命名",
                icon: "M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z m-2-2 4 4",
                onClick: () => {
                    setRenamingCategoryId(categoryId)
                    setActiveCategoryId(null)
                },
            },
            {
                title: "上移",
                icon: "M18 15 12 9 6 15",
                onClick: () => {
                    if (idx <= 0) return
                    const newIds = categories.map(c => c.category_id)
                    ;[newIds[idx - 1], newIds[idx]] = [newIds[idx], newIds[idx - 1]]
                    onSortCategories(newIds)
                },
            },
            {
                title: "下移",
                icon: "M6 9l6 6 6-6",
                onClick: () => {
                    if (idx >= categories.length - 1) return
                    const newIds = categories.map(c => c.category_id)
                    ;[newIds[idx], newIds[idx + 1]] = [newIds[idx + 1], newIds[idx]]
                    onSortCategories(newIds)
                },
            },
            { separator: true } as ContextMenusData,
            {
                title: "删除分组",
                icon: "M3 6h18 M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6 M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2",
                danger: true,
                onClick: () => onDeleteCategory(categoryId),
            },
        ]
    }

    return (
        <>
            <ConversationListWithCategory
                viewMode={viewMode}
                onViewModeChange={handleViewModeChange}
                categories={categoriesForView}
                isLoading={isLoading}
                error={error}
                onRetry={onRetry}
                allConversations={ConvListWithMenu(conversations)}
                ungroupedConversations={ungroupedConvs.length > 0 ? ConvListWithMenu(ungroupedConvs) : undefined}
                onCreateCategory={onOpenCreateCategory}
                onManageCategories={() => setManagePanelVisible(true)}
                activeCategoryId={activeCategoryId}
                renamingCategoryId={renamingCategoryId}
                onRenameConfirm={async (id, newName) => {
                    await onRenameCategory(id, newName)
                    setRenamingCategoryId(null)
                }}
                onRenameCancel={() => setRenamingCategoryId(null)}
                onCategoryContextMenu={(categoryId, e) => {
                    e.preventDefault()
                    const menus = buildCategoryContextMenus(categoryId)
                    // flushSync 保证 state 同步更新，ContextMenus re-render 后再 show()
                    flushSync(() => {
                        setActiveCategoryId(categoryId)
                        setCategoryMenus(menus)
                    })
                    categoryCtxMenuRef.current?.show(e)
                    // 先移除旧监听器，再注册新的，避免累积
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

            <ContextMenus
                onContext={(ctx) => { categoryCtxMenuRef.current = ctx }}
                menus={categoryMenus}
            />

            <CategoryManagePanel
                key={managePanelVisible ? 'panel-open' : 'panel-closed'}
                visible={managePanelVisible}
                categories={categories
                    .filter(c => c.category_id !== null)
                    .map(c => ({
                        id: c.category_id,
                        name: c.name,
                        groupCount: (c.groups || []).length,
                    }))
                }
                onClose={() => setManagePanelVisible(false)}
                onRename={onRenameCategory}
                onDelete={onDeleteCategory}
                onReorder={onSortCategories}
                onCreateCategory={() => { setManagePanelVisible(false); onOpenCreateCategory() }}
            />
        </>
    )
}

export default ConversationListGrouped
