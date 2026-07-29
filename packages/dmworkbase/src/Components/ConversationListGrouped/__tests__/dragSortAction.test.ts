import { describe, expect, it, vi } from "vitest"
import {
    computeFollowDragSortItems,
    getSortableItemId,
    type FollowDragSortContext,
    type SortableConversation,
} from "../dragSortAction"

const ChannelTypePerson = 1
const ChannelTypeGroup = 2
const ChannelTypeCommunityTopic = 5

function conversation(channelType: number, channelID: string): SortableConversation {
    return {
        channel: { channelType, channelID },
    }
}

function baseContext(
    overrides: Partial<FollowDragSortContext<SortableConversation>> = {},
): FollowDragSortContext<SortableConversation> {
    const dmA = conversation(ChannelTypePerson, "dm-a")
    const groupB = conversation(ChannelTypeGroup, "group-b")
    const dmC = conversation(ChannelTypePerson, "dm-c")
    const groupD = conversation(ChannelTypeGroup, "group-d")

    return {
        activeId: getSortableItemId(dmA),
        overId: getSortableItemId(groupB),
        overType: "item",
        itemToCategory: new Map([
            [getSortableItemId(dmA), "cat-a"],
            [getSortableItemId(groupB), "cat-a"],
            [getSortableItemId(dmC), "cat-a"],
            [getSortableItemId(groupD), "cat-b"],
        ]),
        categoryItems: new Map([
            ["cat-a", [dmA, groupB, dmC]],
            ["cat-b", [groupD]],
        ]),
        childItemsByParent: new Map([
            [
                "group-b",
                [
                    conversation(ChannelTypeCommunityTopic, "group-b____t1"),
                    conversation(ChannelTypeCommunityTopic, "group-b____t2"),
                ],
            ],
        ]),
        groupChannelType: ChannelTypeGroup,
        childChannelType: ChannelTypeCommunityTopic,
        ...overrides,
    }
}

describe("computeFollowDragSortItems", () => {
    it("item drop 到同 category 的另一 item 时返回排序 payload", () => {
        const result = computeFollowDragSortItems(baseContext())

        expect(result).toEqual([
            { target_type: ChannelTypeGroup, target_id: "group-b" },
            { target_type: ChannelTypeCommunityTopic, target_id: "group-b____t1" },
            { target_type: ChannelTypeCommunityTopic, target_id: "group-b____t2" },
            { target_type: ChannelTypePerson, target_id: "dm-a" },
            { target_type: ChannelTypePerson, target_id: "dm-c" },
        ])
    })

    it("item drop 到别 category 的 item 时保持 no-op", () => {
        const onSortFollowItems = vi.fn()
        const onMoveGroupToCategory = vi.fn()
        const followDM = vi.fn()
        const groupD = conversation(ChannelTypeGroup, "group-d")

        const result = computeFollowDragSortItems(baseContext({
            overId: getSortableItemId(groupD),
        }))
        if (result) onSortFollowItems(result)

        expect(result).toBeNull()
        expect(onSortFollowItems).not.toHaveBeenCalled()
        expect(onMoveGroupToCategory).not.toHaveBeenCalled()
        expect(followDM).not.toHaveBeenCalled()
    })

    it("item drop 到 category header / drop area 时保持 no-op", () => {
        const onSortFollowItems = vi.fn()
        const onMoveGroupToCategory = vi.fn()
        const followDM = vi.fn()

        const result = computeFollowDragSortItems(baseContext({
            overId: "cat::cat-b",
            overType: "category",
        }))
        if (result) onSortFollowItems(result)

        expect(result).toBeNull()
        expect(onSortFollowItems).not.toHaveBeenCalled()
        expect(onMoveGroupToCategory).not.toHaveBeenCalled()
        expect(followDM).not.toHaveBeenCalled()
    })
})
