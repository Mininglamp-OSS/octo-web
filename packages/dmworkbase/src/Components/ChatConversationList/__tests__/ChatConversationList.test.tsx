import React from "react"
import ReactDOM from "react-dom"
import { act } from "react-dom/test-utils"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

let ChatConversationList: typeof import("../index").default
let container: HTMLDivElement

beforeAll(async () => {
    vi.doMock("wukongimjssdk", () => ({
        Channel: class {
            channelID: string
            channelType: number

            constructor(channelID: string, channelType: number) {
                this.channelID = channelID
                this.channelType = channelType
            }
        },
        ChannelTypeGroup: 2,
        ChannelTypePerson: 1,
        WKSDK: {
            shared: () => ({
                channelManager: {
                    getChannelInfo: () => undefined,
                },
            }),
        },
    }))

    vi.doMock("../../../App", () => ({
        default: {
            endpoints: {},
        },
    }))

    vi.doMock("../../../Hooks/useCategoryList", () => ({
        useCategoryList: () => ({
            categories: [],
            isLoading: false,
            error: null,
            reload: vi.fn(),
            createCategory: vi.fn(),
            renameCategory: vi.fn(),
            deleteCategory: vi.fn(),
            sortCategories: vi.fn(),
            moveGroupToCategory: vi.fn(),
        }),
    }))

    vi.doMock("../../../Hooks/useFollowSidebar", () => ({
        useFollowSidebarContext: () => ({
            dmsByCategory: new Map(),
            threadsByCategory: new Map(),
            itemsByCategory: new Map(),
            followedGroupNos: new Set(),
            followedKeys: new Set(),
            versionRef: { current: 0 },
            bumpVersion: vi.fn(),
            applyOptimisticSort: vi.fn(),
            isLoading: false,
            error: null,
            reload: vi.fn(),
        }),
    }))

    vi.doMock("../../../Service/FollowService", () => ({
        default: {},
    }))

    vi.doMock("../../../Service/Thread", () => ({
        isEffectivelyMuted: () => false,
        parseThreadChannelId: () => undefined,
    }))

    vi.doMock("../../../i18n", () => ({
        useI18n: () => ({ t: (key: string) => key }),
    }))

    vi.doMock("../../ConversationListGrouped", () => ({
        default: () => null,
        isValidCategoryItem: () => true,
    }))

    vi.doMock("../../CreateCategoryModal", () => ({
        default: () => null,
    }))

    vi.doMock("../../ConversationList", () => ({
        default: ({ conversations }: { conversations: Array<any> }) => (
            <div data-testid="conversation-list">
                {conversations.map((conv) => (
                    <span key={conv.channel.channelID}>{conv.channel.channelID}</span>
                ))}
            </div>
        ),
    }))

    ChatConversationList = (await import("../index")).default
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

function makeGroupConversation(id: string, timestamp: number) {
    return {
        channel: {
            channelID: id,
            channelType: 2,
        },
        timestamp,
        unread: 0,
    }
}

describe("ChatConversationList", () => {
    it("passes stale group conversations through to the recent list", () => {
        const staleGroup = makeGroupConversation("stale-group", 1)
        const recentGroup = makeGroupConversation("recent-group", Math.floor(Date.now() / 1000))

        act(() => {
            ReactDOM.render(
                <ChatConversationList
                    conversations={[staleGroup, recentGroup] as any}
                    filter="all"
                    onConversationClick={() => {}}
                    onClearMessages={() => {}}
                    onThreadOverflowClick={() => {}}
                />,
                container
            )
        })

        expect(container.textContent).toContain("stale-group")
        expect(container.textContent).toContain("recent-group")
    })
})
