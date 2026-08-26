import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * isReplyAuthorAi —— message_replied.is_ai_msg 的身份派生(#1452 review P1 回归守卫)。
 *
 * 原实现查会话 subscribers 判 bot;subscribers 仅群/子区填充,1:1(ChannelTypePerson)会话恒空,
 * 于是 human↔AI DM 的每次回复都被误判 is_ai_msg=false(只有 botfather 经 SYSTEM_BOTS 兜底命中)。
 * 本用例钉死:DM 里回复一个 robot 作者必须判 true —— 这正是 P1 的失败场景。改回查 subscribers 即红。
 */

const hoisted = vi.hoisted(() => ({
    robotByUid: new Map<string, number>(), // uid -> orgData.robot
    octoAssistantUids: [] as string[],
}))

vi.mock("wukongimjssdk", () => ({
    ChannelTypePerson: 1,
    WKSDK: { shared: () => ({}) },
    Channel: class {
        channelID: string
        channelType: number
        constructor(channelID: string, channelType: number) {
            this.channelID = channelID
            this.channelType = channelType
        }
    },
}))

vi.mock("../../../App", () => ({
    default: { remoteConfig: { octoAssistantUids: hoisted.octoAssistantUids } },
}))

vi.mock("../../../im-runtime/channelRuntime", () => ({
    // 按 uid(= Channel.channelID)查 person channelInfo 的 robot 标记,不依赖任何 subscribers。
    getImChannelInfo: (_sdk: unknown, channel: { channelID: string }) => {
        const robot = hoisted.robotByUid.get(channel.channelID)
        return robot === undefined ? undefined : { orgData: { robot } }
    },
}))

vi.mock("../../../Service/SpaceService", () => ({
    SYSTEM_BOTS: new Set(["botfather"]),
}))

import { isReplyAuthorAi } from "../replyAiIdentity"

describe("isReplyAuthorAi — 被回复作者是否 AI/bot", () => {
    beforeEach(() => {
        hoisted.robotByUid.clear()
        hoisted.octoAssistantUids.length = 0
    })

    it("DM 里回复一个 robot 作者 → true(P1:此前查 subscribers 恒 false)", () => {
        // 1:1 会话 subscribers 为空,但对方(助手/自定义 bot)的 person channelInfo 带 robot=1
        hoisted.robotByUid.set("assistant-uid", 1)
        expect(isReplyAuthorAi("assistant-uid")).toBe(true)
    })

    it("回复人类作者 → false", () => {
        hoisted.robotByUid.set("human-uid", 0)
        expect(isReplyAuthorAi("human-uid")).toBe(false)
    })

    it("群里回复 bot 作者(channelInfo robot=1)→ true", () => {
        hoisted.robotByUid.set("group-bot", 1)
        expect(isReplyAuthorAi("group-bot")).toBe(true)
    })

    it("octoAssistantUids 里的助手即使 orgData 未打 robot 标记也 → true", () => {
        hoisted.octoAssistantUids.push("octo-assistant")
        // 没有 channelInfo(getImChannelInfo 返回 undefined),仅靠 octoAssistantUids 命中
        expect(isReplyAuthorAi("octo-assistant")).toBe(true)
    })

    it("SYSTEM_BOTS(botfather)兜底 → true", () => {
        expect(isReplyAuthorAi("botfather")).toBe(true)
    })

    it("无作者(undefined/null/空)→ false", () => {
        expect(isReplyAuthorAi(undefined)).toBe(false)
        expect(isReplyAuthorAi(null)).toBe(false)
        expect(isReplyAuthorAi("")).toBe(false)
    })

    it("channelInfo 缺失且不在任何名单 → false", () => {
        expect(isReplyAuthorAi("unknown-uid")).toBe(false)
    })
})
