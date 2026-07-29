export interface SortableConversation {
    channel: {
        channelType: number
        channelID: string
    }
}

export interface FollowSortItem {
    target_type: number
    target_id: string
}

export interface FollowDragSortContext<T extends SortableConversation> {
    activeId: string
    overId: string
    overType: unknown
    itemToCategory: Map<string, string>
    categoryItems: Map<string, T[]>
    childItemsByParent: Map<string, T[]>
    groupChannelType: number
    childChannelType: number
}

export function getSortableItemId(item: SortableConversation): string {
    return `item::${item.channel.channelType}::${item.channel.channelID}`
}

function arrayMoveItem<T>(items: T[], fromIndex: number, toIndex: number): T[] {
    const next = items.slice()
    const [item] = next.splice(fromIndex, 1)
    next.splice(toIndex, 0, item)
    return next
}

export function computeFollowDragSortItems<T extends SortableConversation>({
    activeId,
    overId,
    overType,
    itemToCategory,
    categoryItems,
    childItemsByParent,
    groupChannelType,
    childChannelType,
}: FollowDragSortContext<T>): FollowSortItem[] | null {
    if (overType !== "item") return null

    const sourceCatId = itemToCategory.get(activeId)
    const targetCatId = itemToCategory.get(overId)
    if (!sourceCatId || !targetCatId || sourceCatId !== targetCatId) return null

    const items = categoryItems.get(sourceCatId) || []
    const oldIndex = items.findIndex(item => getSortableItemId(item) === activeId)
    const newIndex = items.findIndex(item => getSortableItemId(item) === overId)
    if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return null

    const sortItems: FollowSortItem[] = []
    const newOrder = arrayMoveItem(items, oldIndex, newIndex)
    for (const item of newOrder) {
        sortItems.push({
            target_type: item.channel.channelType,
            target_id: item.channel.channelID,
        })

        if (item.channel.channelType === groupChannelType) {
            const childItems = childItemsByParent.get(item.channel.channelID) || []
            for (const child of childItems) {
                sortItems.push({
                    target_type: childChannelType,
                    target_id: child.channel.channelID,
                })
            }
        }
    }

    return sortItems
}
