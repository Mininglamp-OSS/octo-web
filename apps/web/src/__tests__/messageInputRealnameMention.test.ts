import { describe, it, expect } from "vitest"
import {
    buildMemberInfos,
    parseMentionMarkers,
} from "@octo/base/src/Components/MessageInput/mentionResolve"
import { subscriberDisplayName } from "@octo/base/src/Utils/displayName"

/**
 * Tests for inbound @-mention matching with real_name candidates.
 *
 * These exercise the REAL production helpers from
 * MessageInput/mentionResolve.ts (the same `buildMemberInfos` /
 * `buildMentionRegex` / `parseMentionMarkers` used by the editor), so a backend
 * that backfills `@实名` / `@群昵称` / `@昵称` all resolve to the same uid. Bots
 * are excluded from real_name augmentation; unknown names stay plain text.
 */

interface SubscriberLike {
    uid: string
    name?: string
    remark?: string
    orgData?: {
        real_name?: string | null
        realname_verified?: boolean | number | string | null
        robot?: number
    }
}

function firstMention(parsed: ReturnType<typeof parseMentionMarkers>) {
    return parsed.find((n) => n.type === "mention")
}

describe("MessageInput @-mention realname matching", () => {
    const verifiedMember: SubscriberLike = {
        uid: "u1",
        name: "zhangsan",
        remark: "小张",
        orgData: { real_name: "张三", realname_verified: 1 },
    }

    it("resolves @实名 / @群昵称 / @昵称 to the same uid", () => {
        const infos = buildMemberInfos([verifiedMember])

        for (const writing of ["@张三", "@小张", "@zhangsan"]) {
            const mention = firstMention(parseMentionMarkers(`${writing} 你好`, infos))
            expect(mention, writing).toBeDefined()
            expect(mention!.attrs!.id, writing).toBe("u1")
        }
    })

    it("chip label is the canonical display name for any matched alias", () => {
        // real_name=王大棍, remark(群昵称)=棍哥, name(昵称)=大棍子 → 已实名，规范名是 real_name 王大棍。
        const member: SubscriberLike = {
            uid: "u1",
            name: "大棍子",
            remark: "棍哥",
            orgData: { real_name: "王大棍", realname_verified: 1 },
        }
        const infos = buildMemberInfos([member])
        // 规范名 = real_name(verified) → remark → name，这里 real_name="王大棍"。
        for (const writing of ["@棍哥", "@王大棍", "@大棍子"]) {
            const mention = firstMention(parseMentionMarkers(`${writing} 在吗`, infos))
            expect(mention, writing).toBeDefined()
            expect(mention!.attrs!.id, writing).toBe("u1")
            expect(mention!.attrs!.label, writing).toBe("王大棍")
        }
    })

    it("chip label uses remark when not verified", () => {
        // 未实名：real_name 不生效，规范名退回 remark 棍哥。
        const member: SubscriberLike = {
            uid: "u1",
            name: "大棍子",
            remark: "棍哥",
            orgData: { real_name: "王大棍", realname_verified: 0 },
        }
        const infos = buildMemberInfos([member])
        for (const writing of ["@棍哥", "@大棍子"]) {
            const mention = firstMention(parseMentionMarkers(`${writing} 在吗`, infos))
            expect(mention, writing).toBeDefined()
            expect(mention!.attrs!.id, writing).toBe("u1")
            expect(mention!.attrs!.label, writing).toBe("棍哥")
        }
    })

    it("chip label uses real_name when no remark (verified)", () => {
        // 没有群昵称：规范名 = real_name(verified)=张三，匹配任意别名都渲染 张三。
        const infos = buildMemberInfos([
            {
                uid: "u1",
                name: "zhangsan",
                orgData: { real_name: "张三", realname_verified: 1 },
            },
        ])
        for (const writing of ["@张三", "@zhangsan"]) {
            const mention = firstMention(parseMentionMarkers(`${writing} 你好`, infos))
            expect(mention, writing).toBeDefined()
            expect(mention!.attrs!.id, writing).toBe("u1")
            expect(mention!.attrs!.label, writing).toBe("张三")
        }
    })

    it("matches longest name first for prefix-overlapping names", () => {
        const members: SubscriberLike[] = [
            { uid: "u1", name: "zhangsan", orgData: { real_name: "张三", realname_verified: 1 } },
            { uid: "u2", name: "zhangsanfeng", orgData: { real_name: "张三丰", realname_verified: 1 } },
        ]
        const infos = buildMemberInfos(members)
        const mention = firstMention(parseMentionMarkers("@张三丰 在吗", infos))
        expect(mention).toBeDefined()
        expect(mention!.attrs!.id).toBe("u2")
    })

    it("does not create a real_name candidate for bots", () => {
        const bot: SubscriberLike = {
            uid: "bot1",
            name: "客服助手",
            orgData: { real_name: "X", realname_verified: 1, robot: 1 },
        }
        const infos = buildMemberInfos([bot])
        // @客服助手 still binds (it is the nickname), but @X (the real_name) does not.
        const parsed = parseMentionMarkers("@X 你好", infos)
        expect(firstMention(parsed)).toBeUndefined()
        expect(parsed.map((n) => n.text).join("")).toBe("@X 你好")
    })

    it("does not augment real_name for unverified members", () => {
        const unverified: SubscriberLike = {
            uid: "u9",
            name: "wang",
            orgData: { real_name: "王某", realname_verified: 0 },
        }
        const infos = buildMemberInfos([unverified])
        const parsed = parseMentionMarkers("@王某 在吗", infos)
        expect(firstMention(parsed)).toBeUndefined()
    })

    it("keeps unknown @name as plain text", () => {
        const infos = buildMemberInfos([verifiedMember])
        const parsed = parseMentionMarkers("@路人甲 你好", infos)
        expect(firstMention(parsed)).toBeUndefined()
        expect(parsed.map((n) => n.text).join("")).toBe("@路人甲 你好")
    })

    it("input-box chip label and send-side label agree on the canonical name", () => {
        // real_name=王大棍(已实名), remark=棍哥, name=大棍子。
        // 输入框 chip 走 buildMemberInfos→subscriberDisplayName；
        // 发送侧 formatMentionTextV2 也走 subscriberDisplayName（同一解析器）。
        // 二者必须都得到 @王大棍。
        const member: SubscriberLike = {
            uid: "u1",
            name: "大棍子",
            remark: "棍哥",
            orgData: { real_name: "王大棍", realname_verified: 1 },
        }
        const infos = buildMemberInfos([member])
        const chip = firstMention(parseMentionMarkers("@棍哥 在吗", infos))
        const inputLabel = chip!.attrs!.label
        // 模拟 formatMentionTextV2 普通成员分支：`@${subscriberDisplayName(member)}`
        const sendLabel = subscriberDisplayName(member)
        expect(inputLabel).toBe("王大棍")
        expect(sendLabel).toBe("王大棍")
        expect(`@${inputLabel}`).toBe(`@${sendLabel}`)
    })
})
