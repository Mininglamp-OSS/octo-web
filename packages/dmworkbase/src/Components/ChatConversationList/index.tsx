/**
 * ChatConversationList
 * Chat 页面会话列表的统一出口。
 * - 统一持有 useCategoryList，所有 filter 下只调用一次
 * - filter === 'group'：渲染 ConversationListGrouped（ViewToggle + 分组视图）
 * - 其他 filter：渲染 ConversationList，右键群聊有「移到分组」子菜单
 * - CreateCategoryModal 在此层管理，不依赖子组件挂载
 */
import React, { useState } from "react"
import { Channel, ChannelTypeGroup } from "wukongimjssdk"
import WKApp from "../../App"
import { useCategoryList } from "../../Hooks/useCategoryList"
import { ConversationWrap } from "../../Service/Model"
import { ConvFilter } from "../ConversationList"
import ConversationList from "../ConversationList"
import ConversationListGrouped, { ValidCategoryItem } from "../ConversationListGrouped"
import CreateCategoryModal from "../CreateCategoryModal"
import { ContextMenusData } from "../ContextMenus"

export interface ChatConversationListProps {
    conversations: ConversationWrap[]
    filter: ConvFilter
    select?: Channel
    onConversationClick: (conv: ConversationWrap) => void
    onClearMessages: (channel: Channel) => void
    onThreadOverflowClick: (groupNo: string) => void
    /** 外部触发「新建分组」Modal（如顶部 + 按钮），调用后 Modal 显示 */
    onOpenCreateCategoryRef?: React.MutableRefObject<(() => void) | null>
}

const ChatConversationList: React.FC<ChatConversationListProps> = ({
    conversations,
    filter,
    select,
    onConversationClick,
    onClearMessages,
    onThreadOverflowClick,
    onOpenCreateCategoryRef,
}) => {
    const {
        categories,
        isLoading,
        error,
        reload,
        createCategory,
        renameCategory,
        deleteCategory,
        sortCategories,
        moveGroupToCategory,
    } = useCategoryList()

    const [createModalVisible, setCreateModalVisible] = useState(false)

    // 暴露「打开新建分组 Modal」给外层（如顶部 + 按钮）
    React.useEffect(() => {
        if (onOpenCreateCategoryRef) {
            onOpenCreateCategoryRef.current = () => setCreateModalVisible(true)
        }
        return () => {
            if (onOpenCreateCategoryRef) {
                onOpenCreateCategoryRef.current = null
            }
        }
    }, [onOpenCreateCategoryRef])

    const existingCategoryNames = categories.map(c => c.name)

    // 构建「移到分组」子菜单（含 ✓ 标识 + 新建分组入口）
    // 用于非 group filter 下的 ConversationList
    const buildMoveToGroupMenus = (conv: ConversationWrap | undefined): ContextMenusData[] => {
        if (!conv || conv.channel.channelType !== ChannelTypeGroup) return []
        if (categories.length === 0) return []

        const groupNo = conv.channel.channelID
        const currentCategoryId = categories.find(
            cat => (cat.groups || []).some(g => g.group_no === groupNo)
        )?.category_id

        const items: ContextMenusData[] = categories.map(cat => ({
            title: cat.name,
            checked: currentCategoryId === cat.category_id,
            onClick: () => moveGroupToCategory(groupNo, cat.category_id),
        }))
        items.push({ separator: true } as ContextMenusData)
        items.push({ title: "+ 新建分组", onClick: () => setCreateModalVisible(true) })

        return items
    }

    return (
        <>
            {filter === 'group' ? (
                <ConversationListGrouped
                    conversations={conversations}
                    select={select}
                    onConversationClick={onConversationClick}
                    onClearMessages={onClearMessages}
                    onThreadOverflowClick={onThreadOverflowClick}
                    categories={categories as ValidCategoryItem[]}
                    isLoading={isLoading}
                    error={error}
                    onRetry={reload}
                    onRenameCategory={renameCategory}
                    onDeleteCategory={deleteCategory}
                    onSortCategories={sortCategories}
                    onMoveGroupToCategory={moveGroupToCategory}
                    onOpenCreateCategory={() => setCreateModalVisible(true)}
                    onStartGroup={() => {
                        const menus = WKApp.shared.chatMenus()
                        const groupMenu = menus.find((m: any) => m.key === 'start-group')
                        if (groupMenu?.onClick) groupMenu.onClick()
                    }}
                    onCreateGroupInCategory={(categoryId: string) => {
                        WKApp.endpoints.organizationalLayer(
                            { channelID: "", channelType: 0 } as any,
                            { defaultCategoryId: categoryId, onSuccess: reload }
                        )
                    }}
                />
            ) : (
                <ConversationList
                    conversations={conversations}
                    select={select}
                    filter={filter}
                    onClick={onConversationClick}
                    onClearMessages={onClearMessages}
                    onThreadOverflowClick={onThreadOverflowClick}
                    extraContextMenus={buildMoveToGroupMenus}
                />
            )}

            {/* CreateCategoryModal 在此层统一管理，不依赖 ConversationListGrouped 挂载 */}
            <CreateCategoryModal
                visible={createModalVisible}
                existingNames={existingCategoryNames}
                onConfirm={async (name) => {
                    await createCategory(name)
                    setCreateModalVisible(false)
                }}
                onCancel={() => setCreateModalVisible(false)}
            />
        </>
    )
}

export default ChatConversationList
