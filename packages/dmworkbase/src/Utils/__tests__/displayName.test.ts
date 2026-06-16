import { describe, it, expect } from "vitest"
import {
    displayName,
    isRealnameVerified,
    personalRemarkDisplayName,
    subscriberDisplayName,
} from "../displayName"

/**
 * `realname_verified` 字符串归一化测试。
 *
 * 背景：
 *   后端不同节点 / 老接口把 `tinyint(1)` 投射成字符串 `"1"` 或 `"true"`，
 *   原实现只比较 `=== true` / `=== 1`，这些载荷会被误判为「未实名」，
 *   导致 real_name 不生效、徽章不渲染。修复后 isRealnameVerified /
 *   displayName 都能识别 boolean / number / string 三种来源。
 */

describe("isRealnameVerified — 字符串归一化 (E1)", () => {
    it("识别 boolean true", () => {
        expect(isRealnameVerified({ realname_verified: true })).toBe(true)
    })

    it("识别 number 1", () => {
        expect(isRealnameVerified({ realname_verified: 1 })).toBe(true)
    })

    it("识别 string \"1\"（后端序列化偏差）", () => {
        expect(isRealnameVerified({ realname_verified: "1" as any })).toBe(true)
    })

    it("识别 string \"true\"（后端序列化偏差）", () => {
        expect(isRealnameVerified({ realname_verified: "true" as any })).toBe(true)
    })

    it("false / 0 / 字段缺失 / null user 都返回 false", () => {
        expect(isRealnameVerified({ realname_verified: false })).toBe(false)
        expect(isRealnameVerified({ realname_verified: 0 })).toBe(false)
        expect(isRealnameVerified({ realname_verified: null })).toBe(false)
        expect(isRealnameVerified({})).toBe(false)
        expect(isRealnameVerified(null)).toBe(false)
        expect(isRealnameVerified(undefined)).toBe(false)
    })

    it("不把任意非空字符串当真（避免 \"0\" / \"false\" / \"yes\" 误判）", () => {
        expect(isRealnameVerified({ realname_verified: "0" as any })).toBe(false)
        expect(isRealnameVerified({ realname_verified: "false" as any })).toBe(false)
        expect(isRealnameVerified({ realname_verified: "yes" as any })).toBe(false)
        expect(isRealnameVerified({ realname_verified: "" as any })).toBe(false)
    })
})

describe("displayName — 字符串归一化后的 real_name 生效 (E1)", () => {
    it("realname_verified=\"1\" + real_name → 返回 real_name", () => {
        const name = displayName({
            name: "nickname",
            real_name: "Real Name",
            realname_verified: "1" as any,
        })
        expect(name).toBe("Real Name")
    })

    it("realname_verified=\"true\" + real_name → 返回 real_name", () => {
        const name = displayName({
            name: "nickname",
            real_name: "Real Name",
            realname_verified: "true" as any,
        })
        expect(name).toBe("Real Name")
    })

    it("realname_verified=\"0\" → 不用 real_name，走 nickname", () => {
        const name = displayName({
            name: "nickname",
            real_name: "Real Name",
            realname_verified: "0" as any,
        })
        expect(name).toBe("nickname")
    })

    it("remark 优先于 nickname（未实名时）", () => {
        const name = displayName({
            remark: "Buddy",
            name: "nickname",
            real_name: "Real Name",
            realname_verified: "0" as any,
        })
        expect(name).toBe("Buddy")
    })

    it("已实名的 real_name 优先于 remark / nickname", () => {
        const name = displayName({
            remark: "Buddy",
            name: "nickname",
            real_name: "Real Name",
            realname_verified: "1" as any,
        })
        expect(name).toBe("Real Name")
    })
})

describe("subscriberDisplayName — 字符串归一化透传 (E1)", () => {
    it("subscriber.orgData.realname_verified=\"1\" → 使用 real_name", () => {
        const sub = {
            name: "alice_nick",
            remark: "",
            orgData: {
                real_name: "Alice Wang",
                realname_verified: "1" as any,
            },
        }
        expect(subscriberDisplayName(sub)).toBe("Alice Wang")
    })

    it("subscriber.orgData.realname_verified=\"true\" → 使用 real_name", () => {
        const sub = {
            name: "alice_nick",
            orgData: {
                real_name: "Alice Wang",
                realname_verified: "true" as any,
            },
        }
        expect(subscriberDisplayName(sub)).toBe("Alice Wang")
    })

    it("subscriber.orgData.realname_verified=\"0\" → 回落 name（不当实名）", () => {
        const sub = {
            name: "alice_nick",
            orgData: {
                real_name: "Alice Wang",
                realname_verified: "0" as any,
            },
        }
        expect(subscriberDisplayName(sub)).toBe("alice_nick")
    })
})

describe("personalRemarkDisplayName — Person channelInfo 个人备注", () => {
    it("存在个人备注时返回 orgData.displayName", () => {
        expect(
            personalRemarkDisplayName({
                title: "bot_name",
                orgData: {
                    remark: "Bot Alias",
                    displayName: "Bot Alias",
                },
            })
        ).toBe("Bot Alias")
    })

    it("displayName 缺失时回退到 remark", () => {
        expect(
            personalRemarkDisplayName({
                title: "bot_name",
                orgData: {
                    remark: "Bot Alias",
                },
            })
        ).toBe("Bot Alias")
    })

    it("个人备注为空时返回空串，不用 displayName/title 抢占群成员名", () => {
        expect(
            personalRemarkDisplayName({
                title: "bot_name",
                orgData: {
                    remark: "",
                    displayName: "Real Bot Name",
                },
            })
        ).toBe("")
    })
})
