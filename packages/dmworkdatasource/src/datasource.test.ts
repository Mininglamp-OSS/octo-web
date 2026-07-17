import { beforeEach, describe, expect, it, vi } from "vitest"

const hoisted = vi.hoisted(() => {
    const apiGet = vi.fn()
    const apiPost = vi.fn()
    const apiPut = vi.fn()
    const apiDelete = vi.fn()
    const mittEmit = vi.fn()
    const deleteChannelInfo = vi.fn()
    const removeConversation = vi.fn()
    // axios doubles: `sharedPost` is the global (interceptor-bearing) axios.post;
    // `isolatedPost` is the post() of the axios.create() instance datasource.ts
    // builds for foreign uploads. Routing is what the upload-bypass test asserts.
    const sharedPost = vi.fn()
    const isolatedPost = vi.fn()
    const axiosCreate = vi.fn(() => ({ post: isolatedPost }))
    return {
        apiGet,
        apiPost,
        apiPut,
        apiDelete,
        mittEmit,
        deleteChannelInfo,
        removeConversation,
        sharedPost,
        isolatedPost,
        axiosCreate,
        mockWKApp: {
            apiClient: {
                get: apiGet,
                post: apiPost,
                put: apiPut,
                delete: apiDelete,
                config: { apiURL: "http://localhost:3000/api/v1/" },
            },
            loginInfo: { token: "session-token" },
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

vi.mock("axios", () => ({
    default: {
        post: hoisted.sharedPost,
        create: hoisted.axiosCreate,
    },
}))

vi.mock("@octo/base", () => ({
    ChannelQrcodeResp: class {},
    ChannelTypeCommunityTopic: 5,
    Contacts: class {},
    GroupRole: {},
    RequestConfig: class {},
    WKApp: hoisted.mockWKApp,
    IncomingWebhookService: {
        list: (groupNo: string, threadShortId?: string) =>
            hoisted.apiGet(threadShortId
                ? `groups/${groupNo}/threads/${threadShortId}/incoming-webhooks`
                : `groups/${groupNo}/incoming-webhooks`).then((resp: { list?: unknown[] }) => resp?.list || []),
        create: (groupNo: string, req: unknown, threadShortId?: string) =>
            hoisted.apiPost(threadShortId
                ? `groups/${groupNo}/threads/${threadShortId}/incoming-webhooks`
                : `groups/${groupNo}/incoming-webhooks`, req),
        update: (groupNo: string, webhookId: string, req: unknown, threadShortId?: string) =>
            hoisted.apiPut(`${threadShortId
                ? `groups/${groupNo}/threads/${threadShortId}/incoming-webhooks`
                : `groups/${groupNo}/incoming-webhooks`}/${webhookId}`, req),
        delete: (groupNo: string, webhookId: string, threadShortId?: string) =>
            hoisted.apiDelete(`${threadShortId
                ? `groups/${groupNo}/threads/${threadShortId}/incoming-webhooks`
                : `groups/${groupNo}/incoming-webhooks`}/${webhookId}`),
        regenerate: (groupNo: string, webhookId: string, threadShortId?: string) =>
            hoisted.apiPost(`${threadShortId
                ? `groups/${groupNo}/threads/${threadShortId}/incoming-webhooks`
                : `groups/${groupNo}/incoming-webhooks`}/${webhookId}/regenerate`),
        test: (groupNo: string, webhookId: string, threadShortId?: string) =>
            hoisted.apiPost(`${threadShortId
                ? `groups/${groupNo}/threads/${threadShortId}/incoming-webhooks`
                : `groups/${groupNo}/incoming-webhooks`}/${webhookId}/test`),
    },
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

import { ChannelDataSource, CommonDataSource, shouldAttachUploadToken } from "./datasource"
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

// Guard for uploadSticker: the session token rides along on the upload POST only
// when the server-returned upload URL is same-origin with a trusted origin —
// either the API the apiClient authenticates against OR the app (document)
// origin. A genuinely foreign host (matching neither) never receives the
// credential (PR#496 review: Jerry-Xin / OctoBoooot).
describe("shouldAttachUploadToken (sticker upload same-origin guard)", () => {
    const loc = "https://app.example.com/chat"

    it("attaches when the upload URL is same-origin as an absolute (CORS) apiURL", () => {
        expect(shouldAttachUploadToken("https://api.example.com/file/upload?type=sticker", "https://api.example.com/v1/", loc)).toBe(true)
    })

    it("attaches when apiURL is relative and the upload URL is same-origin as the app", () => {
        expect(shouldAttachUploadToken("https://app.example.com/file/upload?type=sticker", "/api/v1/", loc)).toBe(true)
    })

    it("attaches when apiURL is empty (falls back to the document origin)", () => {
        expect(shouldAttachUploadToken("https://app.example.com/file/upload", "", loc)).toBe(true)
    })

    // Regression guard: with a cross-origin (CORS) apiURL, an upload URL on the
    // app's own origin must still attach the token — pinning to apiURL alone
    // would strip the required credential here and 401 a working upload.
    it("attaches when the upload URL is same-origin as the app even if apiURL is a different absolute origin", () => {
        expect(shouldAttachUploadToken("https://app.example.com/file/upload", "https://api.example.com/v1/", loc)).toBe(true)
    })

    it("withholds when the upload host matches neither the apiURL nor the app origin", () => {
        expect(shouldAttachUploadToken("https://evil.example.com/file/upload", "/api/v1/", loc)).toBe(false)
        expect(shouldAttachUploadToken("https://evil.example.com/file/upload", "https://api.example.com/v1/", loc)).toBe(false)
    })

    it("withholds on a malformed upload URL", () => {
        expect(shouldAttachUploadToken("http://[::::", "/api/v1/", loc)).toBe(false)
    })
})

// Exercises the REAL uploadSticker() request path (not just the helper): a
// foreign upload URL must go through the isolated, interceptor-free axios
// instance, NOT the shared global axios — because the shared axios carries the
// APIClient request interceptor that injects the session token unconditionally,
// which would re-add the credential to a foreign host even though the call-site
// withholds it (PR#496 review: Jerry-Xin / OctoBoooot). apiURL is
// http://localhost:3000/api/v1/ and jsdom's document origin is
// http://localhost:3000, so same-origin == localhost:3000.
describe("uploadSticker request routing (interceptor-bypass guard)", () => {
    const stickerResp = { data: { path: "file/preview/sticker/u/x.png", ext: "png" } }
    let cds: CommonDataSource

    beforeEach(() => {
        vi.clearAllMocks()
        cds = new CommonDataSource()
    })

    const file = () => new File([new Uint8Array([1, 2, 3])], "x.png", { type: "image/png" })

    it("routes a same-origin upload through the shared (interceptor-bearing) axios", async () => {
        hoisted.apiGet.mockResolvedValue({ url: "http://localhost:3000/file/upload?type=sticker" })
        hoisted.sharedPost.mockResolvedValue(stickerResp)

        await cds.uploadSticker(file())

        expect(hoisted.sharedPost).toHaveBeenCalledTimes(1)
        expect(hoisted.isolatedPost).not.toHaveBeenCalled()
    })

    it("routes a foreign-origin upload through the isolated axios so the interceptor can't re-add the token", async () => {
        hoisted.apiGet.mockResolvedValue({ url: "https://evil.example.com/file/upload" })
        hoisted.isolatedPost.mockResolvedValue(stickerResp)

        await cds.uploadSticker(file())

        expect(hoisted.isolatedPost).toHaveBeenCalledTimes(1)
        expect(hoisted.sharedPost).not.toHaveBeenCalled()
        // and the isolated client is given no token header at the call site
        const [, , cfg] = hoisted.isolatedPost.mock.calls[0]
        expect(cfg?.headers?.token).toBeUndefined()
    })
})
