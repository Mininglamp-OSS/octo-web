// @vitest-environment jsdom
//
// ForwardService unit tests: 覆盖两阶段执行、disband 计数、注入、错误隔离、
// serial/parallel、interMessageDelayMs、onSent 副作用。
//
// 参考 mergeForwardDisbandGuard.test.ts 的 wukongimjssdk mock 手法。

import { describe, expect, it, vi, beforeEach } from "vitest"

const sdkState = vi.hoisted(() => ({
    channelInfos: new Map<string, any>(),
    send: vi.fn(),
}))

const proxyState = vi.hoisted(() => ({
    wrap: vi.fn(),
}))

const convertState = vi.hoisted(() => ({
    apply: vi.fn(),
}))

vi.mock("wukongimjssdk", () => {
    class Channel {
        channelID: string
        channelType: number
        constructor(id: string, type: number) {
            this.channelID = id
            this.channelType = type
        }
        isEqual(other: any) {
            return this.channelID === other.channelID && this.channelType === other.channelType
        }
        getChannelKey() {
            return `${this.channelID}-${this.channelType}`
        }
    }
    class Setting {
        receiptEnabled?: boolean
    }
    class MessageContent {
        mention?: { humans?: number; ais?: number }
    }
    class Message {
        content?: any
        channel?: any
        fromUID?: string
    }
    const WKSDK = {
        shared: () => ({
            channelManager: {
                getChannelInfo: (channel: any) => sdkState.channelInfos.get(channel.getChannelKey()),
                fetchChannelInfo: () => {},
            },
            chatManager: {
                send: sdkState.send,
            },
        }),
    }
    return {
        default: WKSDK,
        WKSDK,
        Channel,
        Setting,
        MessageContent,
        Message,
        ChannelTypeGroup: 2,
        ChannelTypePerson: 1,
        ChannelTypeCommunityTopic: 6,
    }
})

vi.mock("../../Utils/sendContentProxy", () => ({
    wrapSendContentForInjection: proxyState.wrap,
}))

vi.mock("../Convert", () => ({
    applyMsgLevelExternalFieldsWithFallback: convertState.apply,
}))

// disband 判断走 channelInfo.orgData.status === 2
vi.mock("../Utils/groupDisband", () => ({
    isConversationDisbanded: (channel: any) => {
        if (!channel) return false
        const info = sdkState.channelInfos.get(channel.getChannelKey())
        return info?.orgData?.status === 2
    },
}))

import { Channel } from "wukongimjssdk"
import { ForwardService } from "../ForwardService"

const CT_PERSON = 1
const CT_GROUP = 2

function makeContent(mention?: { humans?: number; ais?: number }): any {
    return { contentType: 1, mention }
}

beforeEach(() => {
    sdkState.channelInfos.clear()
    sdkState.send.mockReset()
    proxyState.wrap.mockReset()
    proxyState.wrap.mockImplementation((content: any, injection: any) => ({
        __wrapped: true,
        __injection: injection,
        __original: content,
    }))
    convertState.apply.mockReset()
})

describe("ForwardService.send — basic counting", () => {
    it("all-success: N targets → {targets:N, failedTargets:0, messageAttempts:N, failedMessages:0}", async () => {
        sdkState.send.mockResolvedValue({ messageID: "m" })
        const channels = [new Channel("g1", CT_GROUP), new Channel("u1", CT_PERSON)]
        const result = await ForwardService.send(channels, () => makeContent())
        expect(result).toEqual({
            targets: 2,
            failedTargets: 0,
            messageAttempts: 2,
            failedMessages: 0,
            disbanded: 0,
            failures: [],
        })
        expect(sdkState.send).toHaveBeenCalledTimes(2)
    })

    it("empty channels short-circuits", async () => {
        const result = await ForwardService.send([], () => makeContent())
        expect(result.targets).toBe(0)
        expect(sdkState.send).not.toHaveBeenCalled()
    })
})

describe("ForwardService.send — disband handling", () => {
    it("all-disband: buildContent called (needed for count), sender never called, all counted as failed", async () => {
        const g1 = new Channel("g1", CT_GROUP)
        const g2 = new Channel("g2", CT_GROUP)
        sdkState.channelInfos.set(g1.getChannelKey(), { orgData: { status: 2 } })
        sdkState.channelInfos.set(g2.getChannelKey(), { orgData: { status: 2 } })
        const buildContent = vi.fn(() => makeContent())
        const result = await ForwardService.send([g1, g2], buildContent)
        expect(result).toMatchObject({
            targets: 2,
            failedTargets: 2,
            messageAttempts: 2,
            failedMessages: 2,
            disbanded: 2,
        })
        expect(result.failures.every((f) => f.reason === "disbanded")).toBe(true)
        // disbanded channel 也需要 build 以取 contents.length（否则多选转发含 disband
        // 目标时 Toast 分母会缩水，见 H1 修复）。
        expect(buildContent).toHaveBeenCalledTimes(2)
        expect(sdkState.send).not.toHaveBeenCalled()
    })

    it("partial disband: disbanded channels skipped in send, sendable channels sent", async () => {
        const g1 = new Channel("g1", CT_GROUP)
        const g2 = new Channel("g2", CT_GROUP)
        sdkState.channelInfos.set(g1.getChannelKey(), { orgData: { status: 2 } })
        sdkState.send.mockResolvedValue({ messageID: "m" })
        const result = await ForwardService.send([g1, g2], () => makeContent())
        expect(result).toMatchObject({
            targets: 2,
            failedTargets: 1,
            messageAttempts: 2,
            failedMessages: 1,
            disbanded: 1,
        })
        expect(sdkState.send).toHaveBeenCalledTimes(1)
    })

    it("disband + multi-content: failedMessages counts each content (H1 regression fix)", async () => {
        // 场景对齐 Conversation onForward 多选转发：3 条消息 × [1 disband + 1 normal]
        // 老代码分母 = messages × channels = 6，其中 disband 目标计 3 条失败。
        // 修复前 ForwardService 把 disband 计 1 条 → 分母 4，用户看到 "1/4 failed"。
        // 修复后 disband 按 contents.length 计 → 分母 6，用户看到 "3/6 failed"。
        const g1 = new Channel("g1", CT_GROUP)
        const g2 = new Channel("g2", CT_GROUP)
        sdkState.channelInfos.set(g1.getChannelKey(), { orgData: { status: 2 } })
        sdkState.send.mockResolvedValue({ messageID: "m" })
        const contents = [makeContent(), makeContent(), makeContent()]
        const result = await ForwardService.send([g1, g2], () => contents)
        expect(result).toMatchObject({
            targets: 2,
            failedTargets: 1,
            messageAttempts: 6,
            failedMessages: 3,
            disbanded: 1,
        })
        // g1 的 3 条都在 failures 里，且带 messageIndex 0/1/2
        const g1Failures = result.failures.filter((f) => f.channelID === "g1")
        expect(g1Failures).toHaveLength(3)
        expect(g1Failures.map((f) => f.messageIndex).sort()).toEqual([0, 1, 2])
        expect(g1Failures.every((f) => f.reason === "disbanded")).toBe(true)
    })
})

describe("ForwardService.send — send error isolation", () => {
    it("single target reject isolates: other targets unaffected", async () => {
        const g1 = new Channel("g1", CT_GROUP)
        const g2 = new Channel("g2", CT_GROUP)
        sdkState.send
            .mockRejectedValueOnce(new Error("boom"))
            .mockResolvedValueOnce({ messageID: "m2" })
        const result = await ForwardService.send([g1, g2], () => makeContent())
        expect(result.failedTargets).toBe(1)
        expect(result.failedMessages).toBe(1)
        expect(result.failures[0]).toMatchObject({ channelID: "g1", reason: "send-error" })
    })
})

describe("ForwardService.send — injection", () => {
    it("wrapSendContentForInjection called; spaceId injected only for person channel", async () => {
        const p1 = new Channel("u1", CT_PERSON)
        const g1 = new Channel("g1", CT_GROUP)
        sdkState.send.mockResolvedValue({ messageID: "m" })
        await ForwardService.send([p1, g1], () => makeContent(), { spaceId: "space-A" })
        const calls = proxyState.wrap.mock.calls
        expect(calls).toHaveLength(2)
        const personCall = calls.find((c: any[]) => c[0].mention === undefined && c[1].spaceId === "space-A")
        expect(personCall).toBeDefined()
        const groupCall = calls.find((c: any[]) => c[1].spaceId === null)
        expect(groupCall).toBeDefined()
    })

    it("no spaceId opt → never injected", async () => {
        const p1 = new Channel("u1", CT_PERSON)
        sdkState.send.mockResolvedValue({ messageID: "m" })
        await ForwardService.send([p1], () => makeContent())
        const inj = proxyState.wrap.mock.calls[0][1]
        expect(inj.spaceId).toBeNull()
    })

    it("mention.humans/ais forwarded from content to injection", async () => {
        const g1 = new Channel("g1", CT_GROUP)
        sdkState.send.mockResolvedValue({ messageID: "m" })
        await ForwardService.send([g1], () => makeContent({ humans: 1, ais: 1 }))
        const inj = proxyState.wrap.mock.calls[0][1]
        expect(inj.mentionHumans).toBe(true)
        expect(inj.mentionAis).toBe(true)
    })
})

describe("ForwardService.send — Setting.receiptEnabled", () => {
    it("receipt=1 in channelInfo → setting.receiptEnabled=true", async () => {
        const g1 = new Channel("g1", CT_GROUP)
        sdkState.channelInfos.set(g1.getChannelKey(), { orgData: { receipt: 1 } })
        sdkState.send.mockResolvedValue({ messageID: "m" })
        await ForwardService.send([g1], () => makeContent())
        const setting = sdkState.send.mock.calls[0][2]
        expect(setting.receiptEnabled).toBe(true)
    })

    it("receipt≠1 → setting.receiptEnabled falsy", async () => {
        const g1 = new Channel("g1", CT_GROUP)
        sdkState.send.mockResolvedValue({ messageID: "m" })
        await ForwardService.send([g1], () => makeContent())
        const setting = sdkState.send.mock.calls[0][2]
        expect(setting.receiptEnabled).toBeFalsy()
    })
})

describe("ForwardService.send — serial + multi-chunk failure propagation", () => {
    it("chunk 2/3 fails → chunk 3 skipped for A, B continues fully", async () => {
        const chA = new Channel("A", CT_GROUP)
        const chB = new Channel("B", CT_GROUP)
        // 6 calls expected if all sent: A1, A2, A3, B1, B2, B3
        // A2 fails → A3 not called; B1..B3 all called
        // channelMode serial → A finishes first, then B
        sdkState.send
            .mockResolvedValueOnce({ messageID: "A1" }) // A[0]
            .mockRejectedValueOnce(new Error("A2 fail")) // A[1]
            // A[2] not called
            .mockResolvedValueOnce({ messageID: "B1" }) // B[0]
            .mockResolvedValueOnce({ messageID: "B2" }) // B[1]
            .mockResolvedValueOnce({ messageID: "B3" }) // B[2]

        const contents = [makeContent(), makeContent(), makeContent()]
        const result = await ForwardService.send(
            [chA, chB],
            () => contents,
            { channelMode: "serial", messageMode: "serial" },
        )
        expect(sdkState.send).toHaveBeenCalledTimes(5)
        expect(result.failedTargets).toBe(1)
        // A2 (send-error) + A3 (skipped, counted) = 2 failures on A
        expect(result.failedMessages).toBe(2)
        const aFailures = result.failures.filter((f) => f.channelID === "A")
        expect(aFailures).toHaveLength(2)
        expect(aFailures.map((f) => f.messageIndex).sort()).toEqual([1, 2])
        expect(result.messageAttempts).toBe(6)
    })
})

describe("ForwardService.send — two-phase build abort", () => {
    it("buildContent throws on 3rd channel → sender NEVER called", async () => {
        const chs = [
            new Channel("A", CT_GROUP),
            new Channel("B", CT_GROUP),
            new Channel("C", CT_GROUP),
        ]
        class InteractiveCardForwardBlockedError extends Error {}
        let count = 0
        const buildContent = () => {
            count++
            if (count === 3) throw new InteractiveCardForwardBlockedError("blocked")
            return makeContent()
        }
        await expect(ForwardService.send(chs, buildContent)).rejects.toBeInstanceOf(
            InteractiveCardForwardBlockedError,
        )
        expect(sdkState.send).not.toHaveBeenCalled()
    })
})

describe("ForwardService.send — sender override + onSent", () => {
    it("opts.sender is used; default chatManager.send is not called", async () => {
        const g1 = new Channel("g1", CT_GROUP)
        const customSender = vi.fn().mockResolvedValue({ messageID: "custom" })
        await ForwardService.send([g1], () => makeContent(), { sender: customSender })
        expect(customSender).toHaveBeenCalledTimes(1)
        expect(sdkState.send).not.toHaveBeenCalled()
    })

    it("onSent invoked per resolved message with messageIndex for multi-content", async () => {
        const g1 = new Channel("g1", CT_GROUP)
        sdkState.send
            .mockResolvedValueOnce({ messageID: "m0" })
            .mockResolvedValueOnce({ messageID: "m1" })
        const onSent = vi.fn()
        await ForwardService.send(
            [g1],
            () => [makeContent(), makeContent()],
            { messageMode: "serial", onSent },
        )
        expect(onSent).toHaveBeenCalledTimes(2)
        expect(onSent.mock.calls[0][2]).toBe(0)
        expect(onSent.mock.calls[1][2]).toBe(1)
    })

    it("onSent messageIndex is undefined for single-content", async () => {
        const g1 = new Channel("g1", CT_GROUP)
        sdkState.send.mockResolvedValue({ messageID: "m" })
        const onSent = vi.fn()
        await ForwardService.send([g1], () => makeContent(), { onSent })
        expect(onSent).toHaveBeenCalledTimes(1)
        expect(onSent.mock.calls[0][2]).toBeUndefined()
    })
})

describe("ForwardService.send — external fields fallback", () => {
    it("applyMsgLevelExternalFieldsWithFallback called once per successful message", async () => {
        const g1 = new Channel("g1", CT_GROUP)
        const g2 = new Channel("g2", CT_GROUP)
        sdkState.send.mockResolvedValue({ messageID: "m" })
        await ForwardService.send([g1, g2], () => makeContent())
        expect(convertState.apply).toHaveBeenCalledTimes(2)
    })

    it("not called on failure", async () => {
        const g1 = new Channel("g1", CT_GROUP)
        sdkState.send.mockRejectedValue(new Error("boom"))
        await ForwardService.send([g1], () => makeContent())
        expect(convertState.apply).not.toHaveBeenCalled()
    })
})

describe("ForwardService.send — interMessageDelayMs", () => {
    it("serial messageMode respects interMessageDelayMs between chunks", async () => {
        vi.useFakeTimers()
        const g1 = new Channel("g1", CT_GROUP)
        sdkState.send.mockResolvedValue({ messageID: "m" })
        const promise = ForwardService.send(
            [g1],
            () => [makeContent(), makeContent()],
            { messageMode: "serial", interMessageDelayMs: 500 },
        )
        // 让第一个 send + 后续 microtask 排空
        await vi.advanceTimersByTimeAsync(0)
        expect(sdkState.send).toHaveBeenCalledTimes(1)
        await vi.advanceTimersByTimeAsync(500)
        await promise
        expect(sdkState.send).toHaveBeenCalledTimes(2)
        vi.useRealTimers()
    })
})
