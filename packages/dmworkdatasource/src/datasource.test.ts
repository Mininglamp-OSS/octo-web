import { beforeEach, describe, expect, it, vi } from "vitest"

const hoisted = vi.hoisted(() => {
    const apiDelete = vi.fn()
    const mittEmit = vi.fn()
    const deleteChannelInfo = vi.fn()
    const removeConversation = vi.fn()
    return {
        apiDelete,
        mittEmit,
        deleteChannelInfo,
        removeConversation,
        mockWKApp: {
            apiClient: {
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
