import React from "react"
import ReactDOM from "react-dom"
import { act } from "react-dom/test-utils"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { ThreadStatus } from "../../../Service/Thread"

let ConversationListGrouped: typeof import("../index").default
let container: HTMLDivElement

const ChannelTypeGroup = 2
const ChannelTypePerson = 1
const ChannelTypeCommunityTopic = 5

beforeAll(async () => {
    vi.doMock("wukongimjssdk", () => ({
        default: {
            shared: () => ({
                channelManager: {
                    getChannelInfo: () => undefined,
                },
            }),
        },
        Channel: class {
            channelID: string
            channelType: number
            constructor(channelID: string, channelType: number) {
                this.channelID = channelID
                this.channelType = channelType
            }
        },
        ChannelTypeGroup,
        ChannelTypePerson,
        Conversation: class {},
        WKSDK: {
            shared: () => ({
                channelManager: {
                    getChannelInfo: () => undefined,
                },
            }),
        },
    }))

    vi.doMock("../../../Service/Const", () => ({
        ChannelTypeCommunityTopic,
    }))

    vi.doMock("../../../Service/Thread", () => ({
        parseThreadChannelId: (channelId: string) => {
            const parts = channelId.split("____")
            return parts.length === 2 ? { groupNo: parts[0], shortId: parts[1] } : null
        },
        isEffectivelyMuted: () => false,
        ThreadStatus: { Active: 1, Archived: 2, Deleted: 3 },
    }))

    vi.doMock("../../../Service/FollowService", () => ({ default: {} }))

    vi.doMock("../../../Service/SidebarService", () => ({ default: {} }))

    vi.doMock("../../../Service/Model", () => ({
        ConversationWrap: class {
            conversation: any
            constructor(conversation: any) {
                this.conversation = conversation
            }
            get channel() {
                return this.conversation.channel
            }
            get channelInfo() {
                return this.conversation.channelInfo
            }
            get timestamp() {
                return this.conversation.timestamp
            }
            get unread() {
                return this.conversation.unread
            }
            get isMentionMe() {
                return this.conversation.isMentionMe
            }
        },
    }))

    vi.doMock("../../../i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }))

    vi.doMock("../../WKModal", () => ({ wkConfirm: vi.fn() }))

    vi.doMock("../../ContextMenus", () => ({
        __esModule: true,
        default: () => null,
    }))

    // DnD 包：直接 passthrough children，避免引入真实拖拽上下文
    vi.doMock("@dnd-kit/core", () => ({
        DndContext: ({ children }: any) => <div>{children}</div>,
        DragOverlay: ({ children }: any) => <div>{children}</div>,
        PointerSensor: class {},
        useSensor: () => ({}),
        useSensors: () => [],
    }))
    vi.doMock("@dnd-kit/sortable", () => ({
        SortableContext: ({ children }: any) => <div>{children}</div>,
        verticalListSortingStrategy: {},
        arrayMove: (arr: any[]) => arr,
    }))

    // ConversationListWithCategory：渲染每个分组的 conversations 节点即可
    vi.doMock("../../ConversationListWithCategory", () => ({
        __esModule: true,
        default: ({ categories = [] }: { categories?: Array<any> }) => (
            <div data-testid="cat-list">
                {categories.map((cat) => (
                    <div key={cat.id} data-testid={`cat-${cat.id}`}>
                        {cat.conversations}
                    </div>
                ))}
            </div>
        ),
    }))

    // ConversationList：把传入的 conversations 的 channelID 平铺渲染，便于断言成员
    vi.doMock("../../ConversationList", () => ({
        __esModule: true,
        default: ({ conversations }: { conversations: Array<any> }) => (
            <div data-testid="conversation-list">
                {conversations.map((conv) => (
                    <span key={conv.channel.channelID} data-cid={conv.channel.channelID}>
                        {conv.channel.channelID}
                    </span>
                ))}
            </div>
        ),
    }))

    ConversationListGrouped = (await import("../index")).default
})

beforeEach(() => {
    vi.clearAllMocks()
    container = document.createElement("div")
    document.body.appendChild(container)
})

afterEach(() => {
    act(() => {
        ReactDOM.unmountComponentAtNode(container)
    })
    container.remove()
})

function groupConv(groupNo: string) {
    return {
        channel: { channelID: groupNo, channelType: ChannelTypeGroup },
        channelInfo: { orgData: {} },
        timestamp: 100,
        unread: 0,
        isMentionMe: false,
    }
}

function threadConv(channelID: string, parentGroupNo: string, status?: number) {
    return {
        channel: { channelID, channelType: ChannelTypeCommunityTopic },
        channelInfo: {
            orgData: {
                parentGroupNo,
                ...(status === undefined ? {} : { thread: { status } }),
            },
        },
        timestamp: 90,
        unread: 0,
        isMentionMe: false,
    }
}

function renderGrouped(props: Partial<React.ComponentProps<typeof ConversationListGrouped>>) {
    const baseProps: any = {
        conversations: [],
        onConversationClick: () => {},
        onClearMessages: () => {},
        onThreadOverflowClick: () => {},
        categories: [],
        isLoading: false,
        error: null,
        onRetry: () => {},
        onRenameCategory: async () => {},
        onDeleteCategory: () => {},
        onSortCategories: async () => {},
        onMoveGroupToCategory: async () => {},
        onOpenCreateCategory: () => {},
        ...props,
    }
    act(() => {
        ReactDOM.render(<ConversationListGrouped {...baseProps} />, container)
    })
}

describe("ConversationListGrouped — 归档子区过滤 (issue #345)", () => {
    const categories = [
        {
            category_id: "cat-a",
            name: "Cat A",
            sort: 0,
            groups: [{ group_no: "grpA" }],
            is_default: false,
        },
    ]

    it("已归档子区不出现在分组子项，活跃子区与父群仍展示", () => {
        const conversations = [
            groupConv("grpA"),
            threadConv("grpA____tActive", "grpA", ThreadStatus.Active),
            threadConv("grpA____tArchived", "grpA", ThreadStatus.Archived),
        ]
        const itemsByCategory = new Map<string, any[]>([
            ["cat-a", [{ target_type: 2, target_id: "grpA", category_id: "cat-a", follow_sort: 1 }]],
        ])
        const followedKeys = new Set<string>([
            "5::grpA____tActive",
            "5::grpA____tArchived",
        ])
        const followedGroupNos = new Set<string>(["grpA"])

        renderGrouped({
            conversations: conversations as any,
            categories: categories as any,
            itemsByCategory,
            followedKeys,
            followedGroupNos,
        })

        const text = container.textContent || ""
        expect(text).toContain("grpA____tActive")
        expect(text).not.toContain("grpA____tArchived")
        // 父群本身仍在
        expect(container.querySelector('[data-cid="grpA"]')).toBeTruthy()
    })

    it("status 未知(channelInfo 未加载)的子区 fail-open 仍展示", () => {
        const conversations = [
            groupConv("grpA"),
            threadConv("grpA____tUnknown", "grpA", undefined),
        ]
        const itemsByCategory = new Map<string, any[]>([
            ["cat-a", [{ target_type: 2, target_id: "grpA", category_id: "cat-a", follow_sort: 1 }]],
        ])
        const followedKeys = new Set<string>(["5::grpA____tUnknown"])
        const followedGroupNos = new Set<string>(["grpA"])

        renderGrouped({
            conversations: conversations as any,
            categories: categories as any,
            itemsByCategory,
            followedKeys,
            followedGroupNos,
        })

        expect(container.textContent || "").toContain("grpA____tUnknown")
    })
})
