/**
 * @vitest-environment jsdom
 */

import React from "react"
import ReactDOM from "react-dom"
import { act } from "react-dom/test-utils"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

let ChatConversationList: typeof import("../index").default
let isMutedForRecentConversation: typeof import("../index").isMutedForRecentConversation
let container: HTMLDivElement
let mockCategories: Array<any> = []
let latestExtraContextMenus: ((conversation: any) => Array<any>) | undefined
const listFolded = vi.fn(async () => [])
const saveFolded = vi.fn(async () => {})
let listProps: any
let groupedProps: any

beforeAll(async () => {
    vi.doMock("@douyinfe/semi-ui", () => ({ Toast: { error: vi.fn() } }))
    vi.doMock("../../../Service/FoldChatService", () => ({ default: { list: listFolded, set: saveFolded }, foldKey: (c: any) => `${c.channel_type}::${c.channel_id}` }))
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
                    addListener: vi.fn(),
                    removeListener: vi.fn(),
                },
            }),
        },
    }))

    vi.doMock("../../../App", () => ({
        default: {
            endpoints: {}, shared: { currentSpaceId: "s" }, loginInfo: { uid: "u" },
        },
    }))

    vi.doMock("../../../Hooks/useCategoryList", () => ({
        useCategoryList: () => ({
            categories: mockCategories,
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
        default: (props: any) => { groupedProps = props; return null },
        isValidCategoryItem: () => true,
    }))

    vi.doMock("../../CreateCategoryModal", () => ({
        default: () => null,
    }))

    vi.doMock("../../ConversationList", () => ({
        default: (props: any) => { listProps = props; latestExtraContextMenus = props.extraContextMenus; return <div data-testid="conversation-list">{props.conversations.map((conv: any) => <span key={conv.channel.channelID}>{conv.channel.channelID}</span>)}{props.recentEntry?.node}</div> },
    }))

    const module = await import("../index")
    ChatConversationList = module.default
    isMutedForRecentConversation = module.isMutedForRecentConversation
})

beforeEach(() => {
    vi.clearAllMocks()
    mockCategories = []
    latestExtraContextMenus = undefined
    listFolded.mockResolvedValue([])
    saveFolded.mockResolvedValue(undefined)
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

    it("does not add an orphan separator when no custom category exists", () => {
        mockCategories = [{ category_id: "default", name: "默认分组", is_default: true }]
        const conversation = makeGroupConversation("unfollowed-group", 1)

        act(() => {
            ReactDOM.render(
                <ChatConversationList
                    conversations={[conversation] as any}
                    filter="all"
                    onConversationClick={() => {}}
                    onClearMessages={() => {}}
                    onThreadOverflowClick={() => {}}
                />,
                container
            )
        })

        const children = latestExtraContextMenus?.(conversation)?.[0]?.children
        expect(children).toHaveLength(1)
        expect(children?.[0]?.separator).not.toBe(true)
        expect(children?.[0]?.title).toBe("base.chatSidebar.context.createCategory")
    })

    it("keeps one separator when at least one custom category exists", () => {
        mockCategories = [
            { category_id: "default", name: "默认分组", is_default: true },
            { category_id: "engineering", name: "研发", is_default: false },
        ]
        const conversation = makeGroupConversation("unfollowed-group", 1)

        act(() => {
            ReactDOM.render(
                <ChatConversationList
                    conversations={[conversation] as any}
                    filter="all"
                    onConversationClick={() => {}}
                    onClearMessages={() => {}}
                    onThreadOverflowClick={() => {}}
                />,
                container
            )
        })

        const children = latestExtraContextMenus?.(conversation)?.[0]?.children
        expect(children?.map((item: any) => item.separator ? "separator" : item.title)).toEqual([
            "研发",
            "separator",
            "base.chatSidebar.context.createCategory",
        ])
    })

    it("applies the zero-category rule to a thread whose parent is not followed", () => {
        const conversation = {
            channel: { channelID: "thread-1", channelType: 5 },
            channelInfo: { orgData: { parentGroupNo: "parent-group" } },
            timestamp: 1,
            unread: 0,
        }

        act(() => {
            ReactDOM.render(
                <ChatConversationList
                    conversations={[conversation] as any}
                    filter="all"
                    onConversationClick={() => {}}
                    onClearMessages={() => {}}
                    onThreadOverflowClick={() => {}}
                />,
                container
            )
        })

        const children = latestExtraContextMenus?.(conversation)?.[0]?.children
        expect(children).toHaveLength(1)
        expect(children?.[0]?.separator).not.toBe(true)
        expect(children?.[0]?.title).toBe("base.chatSidebar.context.createCategory")
    })

    it("covers grouped rendering, modal ref wiring, and mute classification", () => {
        mockCategories = [{ category_id: "cat", name: "Cat", is_default: false }]
        const ref = { current: null as (() => void) | null }
        act(() => {
            ReactDOM.render(
                <ChatConversationList
                    conversations={[makeGroupConversation("grouped", 2)] as any}
                    filter="group"
                    onOpenCreateCategoryRef={ref as any}
                    onConversationClick={() => {}}
                    onClearMessages={() => {}}
                    onThreadOverflowClick={() => {}}
                />,
                container,
            )
        })
        expect(container).toBeTruthy()
        ref.current?.()
        expect(isMutedForRecentConversation({ channel: { channelID: "dm", channelType: 1 }, channelInfo: {} } as any)).toBe(false)
        expect(isMutedForRecentConversation({ channel: { channelID: "thread", channelType: 5 }, channelInfo: { orgData: {} } } as any)).toBe(false)
    })
})

async function renderChats(conversations: any[], filter = "all") {
 await act(async () => { ReactDOM.render(<ChatConversationList conversations={conversations as any} filter={filter as any} onConversationClick={() => {}} onClearMessages={() => {}} onThreadOverflowClick={() => {}} />, container) })
}
it("folds only the chosen group, opens nested list, restores its pin and returns after last unfold", async () => {
 const group = { ...makeGroupConversation("parent", 20), channelInfo: { top: true }, unread: 3, isMentionMe: true }
 const thread = { ...makeGroupConversation("child", 10), channel: { channelID: "child", channelType: 5 } }
 await renderChats([group, thread])
 await act(async () => { await listProps.extraContextMenus(group).find((m: any) => m.title === "base.foldChats.fold").onClick() })
 expect(saveFolded).toHaveBeenCalledWith("s", { channel_id: "parent", channel_type: 2 }, true)
 expect(listProps.conversations).toEqual([thread])
 expect(listProps.recentEntry.timestamp).toBe(20)
 expect(container.textContent).toContain("base.conversationList.mentionMarker")
 await act(async () => { (container.querySelector(".wk-folded-entry") as HTMLButtonElement).click() })
 expect(listProps.conversations).toEqual([group])
 expect(listProps.conversations[0].channelInfo.top).toBe(true)
 expect(saveFolded).toHaveBeenCalledTimes(1)
 await act(async () => { await listProps.extraContextMenus(group).find((m: any) => m.title === "base.foldChats.unfold").onClick() })
 expect(listProps.conversations).toEqual([group, thread])
 expect(listProps.recentEntry).toBeUndefined()
 expect(container.textContent).not.toContain("base.foldChats.back")
})
it("offers the same fold action in Follow without hiding its rows", async () => {
 const group = makeGroupConversation("g", 1)
 await renderChats([group], "group")
 await act(async () => { await groupedProps.foldMenus(group)[0].onClick() })
 expect(groupedProps.conversations).toEqual([group])
 expect(groupedProps.foldMenus(group)[0].title).toBe("base.foldChats.unfold")
})
it("keeps rows on failed save and supports undo", async () => {
 const group = makeGroupConversation("g", 1)
 await renderChats([group])
 saveFolded.mockRejectedValueOnce(new Error("network"))
 await act(async () => { await listProps.extraContextMenus(group)[0].onClick() })
 expect(listProps.conversations).toEqual([group])
 await act(async () => { await listProps.extraContextMenus(group)[0].onClick() })
 const undo = Array.from(container.querySelectorAll("button")).find(b => b.textContent === "base.foldChats.undo")!
 await act(async () => { undo.click() })
 expect(listProps.conversations).toEqual([group])
})

it("keeps search temporary conversations within their folded destination", async () => {
 const group = makeGroupConversation("search-group", 100)
 listFolded.mockResolvedValue([{channel_id:"search-group",channel_type:2}] as any)
 await act(async () => { ReactDOM.render(<ChatConversationList conversations={[] as any} filter="all" temporaryConversationPresentation={{ conversations: [group as any], virtualChannelKeys: new Set<string>() }} onConversationClick={() => {}} onClearMessages={() => {}} onThreadOverflowClick={() => {}} />,container) })
 expect(listProps.temporarilyPinnedConversations).toEqual([])
 expect(listProps.recentEntry.timestamp).toBe(100)
 await act(async () => { (container.querySelector(".wk-folded-entry") as HTMLButtonElement).click() })
 expect(listProps.conversations).toEqual([group])
})

it("continues unread navigation in either direction and stops switching when the other list is read", async () => {
 const recent = {...makeGroupConversation("recent", 20), unread: 1}
 const folded = {...makeGroupConversation("folded", 10), unread: 2}
 listFolded.mockResolvedValue([{channel_id:"folded",channel_type:2}] as any)
 await renderChats([recent, folded])
 expect(listProps.unreadNavigationScope).toBe("recent")
 act(() => { expect(listProps.onUnreadNavigationWrap()).toBe(true) })
 expect(listProps.unreadNavigationScope).toBe("folded")
 expect(listProps.conversations).toEqual([folded])
 folded.unread = 0
 await renderChats([recent, folded])
 act(() => { expect(listProps.onUnreadNavigationWrap()).toBe(true) })
 expect(listProps.unreadNavigationScope).toBe("recent")
 expect(listProps.conversations).toEqual([recent])
 act(() => { expect(listProps.onUnreadNavigationWrap()).toBe(false) })
 expect(listProps.unreadNavigationScope).toBe("recent")
})
