import { beforeEach, describe, expect, it, vi } from "vitest"

const hoisted = vi.hoisted(() => {
    const apiGet = vi.fn()
    const apiPost = vi.fn()
    const apiPut = vi.fn()
    const apiDelete = vi.fn()
    const mittEmit = vi.fn()
    const deleteChannelInfo = vi.fn()
    const removeConversation = vi.fn()
    return {
        apiGet,
        apiPost,
        apiPut,
        apiDelete,
        mittEmit,
        deleteChannelInfo,
        removeConversation,
        mockWKApp: {
            apiClient: {
                get: apiGet,
                post: apiPost,
                put: apiPut,
                delete: apiDelete,
            },
            mittBus: {
                emit: mittEmit,
            },
            shared: {
                currentSpaceId: "",
                avatarUser: vi.fn(),
                avatarChannel: vi.fn(),
            },
        },
    }
})

vi.mock("@octo/base", () => ({
    ChannelQrcodeResp: class {},
    ChannelTypeCommunityTopic: 5,
    Contacts: class {},
    GroupRole: {},
    RequestConfig: class {},
    WKApp: hoisted.mockWKApp,
    buildThreadChannelId: (groupNo: string, shortId: string) => `${groupNo}____${shortId}`,
    hasSpacePrefix: vi.fn(() => false),
    parseThreadChannelId: vi.fn(() => null),
}))

vi.mock("wukongimjssdk", () => ({
    Channel: class {
        channelID: string
        channelType: number

        constructor(channelID: string, channelType: number) {
            this.channelID = channelID
            this.channelType = channelType
        }
    },
    ChannelInfo: class {},
    ChannelTypeGroup: 2,
    ChannelTypePerson: 1,
    ConversationExtra: class {},
    Message: class {},
    MessageContentType: {},
    Subscriber: class {},
    WKSDK: {
        shared: () => ({
            channelManager: {
                deleteChannelInfo: hoisted.deleteChannelInfo,
            },
            conversationManager: {
                removeConversation: hoisted.removeConversation,
            },
        }),
    },
}))

import { ChannelDataSource } from "./datasource"
import { Channel } from "wukongimjssdk"

describe("ChannelDataSource.threadDelete", () => {
    beforeEach(() => {
        vi.clearAllMocks()
        hoisted.apiDelete.mockResolvedValue(undefined)
    })

    it("removes the deleted thread conversation from local realtime state", async () => {
        await new ChannelDataSource().threadDelete("group-a", "thread-1")

        expect(hoisted.apiDelete).toHaveBeenCalledWith("groups/group-a/threads/thread-1")
        const deletedChannel = expect.objectContaining({
            channelID: "group-a____thread-1",
            channelType: 5,
        })
        expect(hoisted.deleteChannelInfo).toHaveBeenCalledWith(deletedChannel)
        expect(hoisted.removeConversation).toHaveBeenCalledWith(deletedChannel)
        expect(hoisted.mittEmit).toHaveBeenCalledWith("wk:thread-deleted", {
            groupNo: "group-a",
            shortId: "thread-1",
            threadChannelId: "group-a____thread-1",
        })
    })
})

// 子区入站 Webhook（#451 / octo-server #454）：传 threadShortId 即把 6 个方法打到
// groups/{group}/threads/{short}/incoming-webhooks；不传则保持群面 URL（回归守卫）。
// channel 始终为父群（channelID=group_no）。
describe("ChannelDataSource incoming webhooks — thread scope (#451)", () => {
    const GROUP = new Channel("g1", 2)

    beforeEach(() => {
        vi.clearAllMocks()
        hoisted.apiGet.mockResolvedValue({ list: [] })
        hoisted.apiPost.mockResolvedValue(undefined)
        hoisted.apiPut.mockResolvedValue(undefined)
        hoisted.apiDelete.mockResolvedValue(undefined)
    })

    it("list targets the thread-scoped URL when threadShortId is given", async () => {
        await new ChannelDataSource().incomingWebhooks(GROUP, "t9")
        expect(hoisted.apiGet).toHaveBeenCalledWith("groups/g1/threads/t9/incoming-webhooks")
    })

    it("list stays group-scoped when threadShortId is omitted (regression guard)", async () => {
        await new ChannelDataSource().incomingWebhooks(GROUP)
        expect(hoisted.apiGet).toHaveBeenCalledWith("groups/g1/incoming-webhooks")
    })

    it("create posts to the thread-scoped collection URL", async () => {
        const req = { name: "ci" }
        await new ChannelDataSource().createIncomingWebhook(GROUP, req, "t9")
        expect(hoisted.apiPost).toHaveBeenCalledWith("groups/g1/threads/t9/incoming-webhooks", req)
    })

    it("create stays group-scoped when threadShortId is omitted", async () => {
        const req = { name: "ci" }
        await new ChannelDataSource().createIncomingWebhook(GROUP, req)
        expect(hoisted.apiPost).toHaveBeenCalledWith("groups/g1/incoming-webhooks", req)
    })

    it("update puts to the thread-scoped item URL", async () => {
        const req = { status: 1 }
        await new ChannelDataSource().updateIncomingWebhook(GROUP, "wh1", req, "t9")
        expect(hoisted.apiPut).toHaveBeenCalledWith("groups/g1/threads/t9/incoming-webhooks/wh1", req)
    })

    it("delete deletes the thread-scoped item URL", async () => {
        await new ChannelDataSource().deleteIncomingWebhook(GROUP, "wh1", "t9")
        expect(hoisted.apiDelete).toHaveBeenCalledWith("groups/g1/threads/t9/incoming-webhooks/wh1")
    })

    it("regenerate posts to the thread-scoped regenerate URL", async () => {
        await new ChannelDataSource().regenerateIncomingWebhook(GROUP, "wh1", "t9")
        expect(hoisted.apiPost).toHaveBeenCalledWith("groups/g1/threads/t9/incoming-webhooks/wh1/regenerate")
    })

    it("test posts to the thread-scoped test URL", async () => {
        await new ChannelDataSource().testIncomingWebhook(GROUP, "wh1", "t9")
        expect(hoisted.apiPost).toHaveBeenCalledWith("groups/g1/threads/t9/incoming-webhooks/wh1/test")
    })

    it("update/delete/regenerate/test stay group-scoped when threadShortId is omitted", async () => {
        const ds = new ChannelDataSource()
        await ds.updateIncomingWebhook(GROUP, "wh1", { status: 0 })
        await ds.deleteIncomingWebhook(GROUP, "wh1")
        await ds.regenerateIncomingWebhook(GROUP, "wh1")
        await ds.testIncomingWebhook(GROUP, "wh1")
        expect(hoisted.apiPut).toHaveBeenCalledWith("groups/g1/incoming-webhooks/wh1", { status: 0 })
        expect(hoisted.apiDelete).toHaveBeenCalledWith("groups/g1/incoming-webhooks/wh1")
        expect(hoisted.apiPost).toHaveBeenCalledWith("groups/g1/incoming-webhooks/wh1/regenerate")
        expect(hoisted.apiPost).toHaveBeenCalledWith("groups/g1/incoming-webhooks/wh1/test")
    })
})
