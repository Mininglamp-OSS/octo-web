/**
 * buildAllowNoMentionRow — 群级「允许群内 Bot 免@回答」总开关行单测（YUJ-3088）。
 *
 * 覆盖：
 *   1. 默认态：allow_no_mention 缺省 → checked=true（开）。
 *   2. allow_no_mention=0 → checked=false（关）。
 *   3. onCheck：loading 流转（true→false）+ 调 setAllowNoMention(v) + 成功后 refresh()。
 *   4. onCheck 失败：loading 回 false，不 refresh。
 *   5. 非管理员（isManagerOrCreator=false）→ 返回 undefined（不渲染）。
 *   6. 非 group channelType → 返回 undefined（不渲染）。
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { Channel, ChannelTypeGroup, ChannelTypePerson } from "wukongimjssdk"

const hoisted = vi.hoisted(() => {
    const setAllowNoMention = vi.fn(() => Promise.resolve())
    return { setAllowNoMention }
})

vi.mock("../ChannelSetting", () => ({
    ChannelSettingManager: {
        shared: { setAllowNoMention: hoisted.setAllowNoMention },
    },
}))

// ListItemSwitch 引入了 semi-ui / css，单测里 stub 成占位即可。
vi.mock("../../Components/ListItem", () => ({
    ListItemSwitch: function ListItemSwitch() { return null },
}))

import { buildAllowNoMentionRow } from "../channelSettingRows"

const groupChannel = new Channel("g1", ChannelTypeGroup)
const personChannel = new Channel("u1", ChannelTypePerson)

const make = (over: any = {}) =>
    buildAllowNoMentionRow({
        channel: groupChannel,
        channelInfo: { orgData: {} } as any,
        isManagerOrCreator: true,
        title: "allow",
        refresh: vi.fn(),
        ...over,
    })

describe("buildAllowNoMentionRow", () => {
    beforeEach(() => {
        hoisted.setAllowNoMention.mockReset()
        hoisted.setAllowNoMention.mockResolvedValue(undefined)
    })

    it("defaults checked=true when allow_no_mention is absent", () => {
        const row = make({ channelInfo: { orgData: {} } as any })
        expect(row).toBeDefined()
        expect(row!.properties.checked).toBe(true)
    })

    it("checked=true when allow_no_mention=1", () => {
        const row = make({ channelInfo: { orgData: { allow_no_mention: 1 } } as any })
        expect(row!.properties.checked).toBe(true)
    })

    it("checked=false when allow_no_mention=0", () => {
        const row = make({ channelInfo: { orgData: { allow_no_mention: 0 } } as any })
        expect(row!.properties.checked).toBe(false)
    })

    it("onCheck calls setAllowNoMention, toggles loading, and refreshes on success", async () => {
        const refresh = vi.fn()
        const row = make({ refresh })
        const ctx: any = { loading: false }
        row!.properties.onCheck(false, ctx)
        // 立即进入 loading
        expect(ctx.loading).toBe(true)
        expect(hoisted.setAllowNoMention).toHaveBeenCalledWith(false, groupChannel)
        await Promise.resolve()
        await Promise.resolve()
        expect(ctx.loading).toBe(false)
        expect(refresh).toHaveBeenCalledTimes(1)
    })

    it("onCheck resets loading and skips refresh on failure", async () => {
        hoisted.setAllowNoMention.mockRejectedValueOnce(new Error("boom"))
        const refresh = vi.fn()
        const row = make({ refresh })
        const ctx: any = { loading: false }
        row!.properties.onCheck(true, ctx)
        expect(ctx.loading).toBe(true)
        await Promise.resolve()
        await Promise.resolve()
        expect(ctx.loading).toBe(false)
        expect(refresh).not.toHaveBeenCalled()
    })

    it("returns undefined for non-manager members", () => {
        expect(make({ isManagerOrCreator: false })).toBeUndefined()
    })

    it("returns undefined for non-group channel types", () => {
        expect(make({ channel: personChannel })).toBeUndefined()
    })
})
