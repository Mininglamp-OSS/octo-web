/**
 * MentionFreeVM 行为单测（octo-web#235 / YUJ-2838）。
 *
 * 覆盖验收（issue「L3 交互」+「注意」）：
 *   1. loadGroups 成功 → groups/nextCursor/hasMore 填充，loading 复位
 *   2. loadGroups 404（后端 #237 未 merge）→ isBackendMissing=true，不 Toast
 *   3. loadGroups 非 404 → loadError=true，不 Toast
 *   4. loadMore cursor 分页 → append + 去重，更新 cursor/hasMore
 *   5. loadMore 无 cursor / hasMore=false → 不发请求
 *   6. toggleMentionFree 开 → PUT mention_pref{no_mention:1}；关 → DELETE
 *   7. toggle 成功 → 局部更新 no_mention；失败 → 记录错误 + 本地不变（开关回弹）
 *   8. visibleGroups → 客户端按群名过滤 + 已开启置顶分区
 *   9. 防串台：setRobotId 后旧请求 isStale 丢弃，不污染新 bot 列表
 *
 * 与 PersonaSettings/vm.test.ts 同款 mock 策略（vi.hoisted Service）。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const hoisted = vi.hoisted(() => {
    const get = vi.fn()
    const post = vi.fn()
    const del = vi.fn()
    const put = vi.fn()
    return { get, post, del, put }
})

vi.mock("../../../Service/BotManageService", () => ({
    default: {
        listGroups: hoisted.get,
        enableMentionFree: hoisted.put,
        disableMentionFree: hoisted.del,
    },
}))

import { MentionFreeVM, BotGroupItem } from "../BotManageVM"

beforeEach(() => {
    hoisted.get.mockReset()
    hoisted.post.mockReset()
    hoisted.del.mockReset()
    hoisted.put.mockReset()
})

afterEach(() => {
    vi.restoreAllMocks()
})

const grp = (overrides: Partial<BotGroupItem> = {}): BotGroupItem => ({
    group_no: "g1",
    name: "Group 1",
    no_mention: false,
    ...overrides,
})

describe("MentionFreeVM.loadGroups", () => {
    it("populates groups + cursor on success", async () => {
        hoisted.get.mockResolvedValueOnce({
            list: [grp({ group_no: "g1" }), grp({ group_no: "g2", no_mention: true })],
            next_cursor: "CURSOR2",
            has_more: true,
        })
        const vm = new MentionFreeVM("bot1")
        await vm.loadGroups()
        expect(vm.groups).toHaveLength(2)
        expect(vm.nextCursor).toBe("CURSOR2")
        expect(vm.hasMore).toBe(true)
        expect(vm.loading).toBe(false)
        expect(hoisted.get).toHaveBeenCalledWith({
            robotId: "bot1",
            limit: 30,
        })
    })

    it("marks isBackendMissing on 404 without toasting", async () => {
        hoisted.get.mockRejectedValueOnce({ status: 404, msg: "not found" })
        const vm = new MentionFreeVM("bot1")
        await vm.loadGroups()
        expect(vm.isBackendMissing).toBe(true)
        expect(vm.loadError).toBe(false)
        expect(vm.groups).toEqual([])
        expect(vm.toggleErrorMessage).toBe("")
    })

    it("marks loadError on non-404 without toasting", async () => {
        hoisted.get.mockRejectedValueOnce({ status: 500, msg: "boom" })
        const vm = new MentionFreeVM("bot1")
        await vm.loadGroups()
        expect(vm.loadError).toBe(true)
        expect(vm.isBackendMissing).toBe(false)
        expect(vm.toggleErrorMessage).toBe("")
    })

    it("treats has_more=true but null cursor as no more (defensive)", async () => {
        hoisted.get.mockResolvedValueOnce({
            list: [grp()],
            next_cursor: null,
            has_more: true,
        })
        const vm = new MentionFreeVM("bot1")
        await vm.loadGroups()
        expect(vm.hasMore).toBe(false)
        expect(vm.nextCursor).toBeNull()
    })

    it("treats non-list response as empty (defensive)", async () => {
        hoisted.get.mockResolvedValueOnce(null as any)
        const vm = new MentionFreeVM("bot1")
        await vm.loadGroups()
        expect(vm.groups).toEqual([])
        expect(vm.loadError).toBe(false)
    })
})

describe("MentionFreeVM.loadMore (cursor pagination)", () => {
    it("appends next page and updates cursor", async () => {
        hoisted.get.mockResolvedValueOnce({
            list: [grp({ group_no: "g1" })],
            next_cursor: "C2",
            has_more: true,
        })
        const vm = new MentionFreeVM("bot1")
        await vm.loadGroups()

        hoisted.get.mockResolvedValueOnce({
            list: [grp({ group_no: "g2" })],
            next_cursor: null,
            has_more: false,
        })
        await vm.loadMore()
        expect(vm.groups.map((g) => g.group_no)).toEqual(["g1", "g2"])
        expect(vm.hasMore).toBe(false)
        expect(hoisted.get).toHaveBeenLastCalledWith({
            robotId: "bot1",
            limit: 30,
            cursor: "C2",
        })
    })

    it("dedupes overlapping boundary items on append", async () => {
        hoisted.get.mockResolvedValueOnce({
            list: [grp({ group_no: "g1" }), grp({ group_no: "g2" })],
            next_cursor: "C2",
            has_more: true,
        })
        const vm = new MentionFreeVM("bot1")
        await vm.loadGroups()
        hoisted.get.mockResolvedValueOnce({
            list: [grp({ group_no: "g2" }), grp({ group_no: "g3" })],
            next_cursor: null,
            has_more: false,
        })
        await vm.loadMore()
        expect(vm.groups.map((g) => g.group_no)).toEqual(["g1", "g2", "g3"])
    })

    it("no-ops when hasMore=false", async () => {
        hoisted.get.mockResolvedValueOnce({ list: [grp()], next_cursor: null, has_more: false })
        const vm = new MentionFreeVM("bot1")
        await vm.loadGroups()
        hoisted.get.mockClear()
        await vm.loadMore()
        expect(hoisted.get).not.toHaveBeenCalled()
    })
})

describe("MentionFreeVM.toggleMentionFree", () => {
    it("ON → PUT mention_pref {no_mention:1} then local update", async () => {
        hoisted.get.mockResolvedValueOnce({
            list: [grp({ group_no: "g1", no_mention: false })],
            next_cursor: null,
            has_more: false,
        })
        const vm = new MentionFreeVM("bot1")
        await vm.loadGroups()
        hoisted.put.mockResolvedValueOnce({})
        const ok = await vm.toggleMentionFree("g1", true)
        expect(ok).toBe(true)
        expect(hoisted.put).toHaveBeenCalledWith("bot1", "g1")
        expect(vm.groups.find((g) => g.group_no === "g1")?.no_mention).toBe(true)
    })

    it("OFF → DELETE mention_pref then local update", async () => {
        hoisted.get.mockResolvedValueOnce({
            list: [grp({ group_no: "g1", no_mention: true })],
            next_cursor: null,
            has_more: false,
        })
        const vm = new MentionFreeVM("bot1")
        await vm.loadGroups()
        hoisted.del.mockResolvedValueOnce({})
        const ok = await vm.toggleMentionFree("g1", false)
        expect(ok).toBe(true)
        expect(hoisted.del).toHaveBeenCalledWith("bot1", "g1")
        expect(vm.groups.find((g) => g.group_no === "g1")?.no_mention).toBe(false)
    })

    it("failure → captures error message + local state unchanged (switch bounces back)", async () => {
        hoisted.get.mockResolvedValueOnce({
            list: [grp({ group_no: "g1", no_mention: false })],
            next_cursor: null,
            has_more: false,
        })
        const vm = new MentionFreeVM("bot1")
        await vm.loadGroups()
        hoisted.put.mockRejectedValueOnce({ status: 500, msg: "save boom" })
        const ok = await vm.toggleMentionFree("g1", true)
        expect(ok).toBe(false)
        expect(vm.toggleFailed).toBe(true)
        expect(vm.toggleErrorMessage).toBe("save boom")
        // 本地 no_mention 未变 → 视图层 checked 回弹到 false
        expect(vm.groups.find((g) => g.group_no === "g1")?.no_mention).toBe(false)
    })
})

describe("MentionFreeVM.visibleGroups (client filter + partition)", () => {
    it("partitions enabled (no_mention) on top, others after", async () => {
        hoisted.get.mockResolvedValueOnce({
            list: [
                grp({ group_no: "g1", name: "Alpha", no_mention: false }),
                grp({ group_no: "g2", name: "Beta", no_mention: true }),
                grp({ group_no: "g3", name: "Gamma", no_mention: false }),
            ],
            next_cursor: null,
            has_more: false,
        })
        const vm = new MentionFreeVM("bot1")
        await vm.loadGroups()
        const { enabled, others } = vm.visibleGroups()
        expect(enabled.map((g) => g.group_no)).toEqual(["g2"])
        expect(others.map((g) => g.group_no)).toEqual(["g1", "g3"])
    })

    it("filters by group name (case-insensitive substring)", async () => {
        hoisted.get.mockResolvedValueOnce({
            list: [
                grp({ group_no: "g1", name: "Engineering" }),
                grp({ group_no: "g2", name: "Marketing" }),
            ],
            next_cursor: null,
            has_more: false,
        })
        const vm = new MentionFreeVM("bot1")
        await vm.loadGroups()
        vm.setSearchKeyword("market")
        const { enabled, others } = vm.visibleGroups()
        expect([...enabled, ...others].map((g) => g.group_no)).toEqual(["g2"])
    })
})

describe("MentionFreeVM 防串台 (requestedUid / isStale)", () => {
    it("setRobotId discards an in-flight loadGroups from the old bot", async () => {
        // 旧 bot 的 loadGroups 还在飞时切到新 bot：旧结果回来必须被丢弃。
        let resolveOld: (v: any) => void = () => {}
        hoisted.get.mockImplementationOnce(
            () => new Promise((r) => { resolveOld = r }),
        )
        const vm = new MentionFreeVM("botOld")
        const p = vm.loadGroups()
        // 切到新 bot（setRobotId 会触发对 botNew 的新 loadGroups）
        hoisted.get.mockResolvedValueOnce({
            list: [grp({ group_no: "new1", name: "NewBotGroup" })],
            next_cursor: null,
            has_more: false,
        })
        vm.setRobotId("botNew")
        // 让旧请求迟到返回旧 bot 的群
        resolveOld({
            list: [grp({ group_no: "old1", name: "OldBotGroup" })],
            next_cursor: null,
            has_more: false,
        })
        await p
        // 列表必须是新 bot 的群，绝不能被旧 bot 结果污染
        expect(vm.robotId).toBe("botNew")
        expect(vm.groups.map((g) => g.group_no)).toEqual(["new1"])
    })

    it("toggle result from a stale bot is discarded", async () => {
        hoisted.get.mockResolvedValueOnce({
            list: [grp({ group_no: "g1", no_mention: false })],
            next_cursor: null,
            has_more: false,
        })
        const vm = new MentionFreeVM("botOld")
        await vm.loadGroups()

        let resolvePut: (v: any) => void = () => {}
        hoisted.put.mockImplementationOnce(
            () => new Promise((r) => { resolvePut = r }),
        )
        const togglePromise = vm.toggleMentionFree("g1", true)
        // 切 bot 前提交了 toggle；切走后 put 才成功
        hoisted.get.mockResolvedValueOnce({ list: [], next_cursor: null, has_more: false })
        vm.setRobotId("botNew")
        resolvePut({})
        const ok = await togglePromise
        // 过期 → 返回 false 且不把旧 bot 的群写进新 bot 列表
        expect(ok).toBe(false)
        expect(vm.toggleFailed).toBe(false)
        expect(vm.toggleErrorMessage).toBe("")
        expect(vm.groups).toEqual([])
    })

    it("ABA: a stale loadGroups for bot A (A→B→A) does not overwrite the newer A reload", async () => {
        // codex review P1：只比 robotId 会在 A→B→A 时误判旧 A 请求未过期。
        // generation 世代号保证旧 A 的迟到响应被丢弃。
        let resolveA1: (v: any) => void = () => {}
        hoisted.get.mockImplementationOnce(() => new Promise((r) => { resolveA1 = r }))
        const vm = new MentionFreeVM("botA")
        const pA1 = vm.loadGroups() // 第一帧 A，挂起

        // A→B（setRobotId 触发 B 的 loadGroups，立即 resolve）
        hoisted.get.mockResolvedValueOnce({ list: [], next_cursor: null, has_more: false })
        vm.setRobotId("botB")

        // B→A（再切回 A，触发新一帧 A 的 loadGroups）
        hoisted.get.mockResolvedValueOnce({
            list: [grp({ group_no: "A_fresh", name: "Fresh A" })],
            next_cursor: null,
            has_more: false,
        })
        vm.setRobotId("botA")
        await Promise.resolve()

        // 第一帧 A 的请求现在才迟到返回陈旧数据 —— 必须被丢弃
        resolveA1({
            list: [grp({ group_no: "A_stale", name: "Stale A" })],
            next_cursor: null,
            has_more: false,
        })
        await pA1

        expect(vm.robotId).toBe("botA")
        expect(vm.groups.map((g) => g.group_no)).toEqual(["A_fresh"])
    })

    it("setRobotId resets loadingMore so the new bot's pagination is not permanently blocked", async () => {
        // codex review P1：旧 bot 的 loadMore 在飞时切 bot，loadingMore 若不复位会
        // 永久卡住，新 bot 触底 loadMore 被头部 `if (loadingMore) return` 挡死。
        hoisted.get.mockResolvedValueOnce({
            list: [grp({ group_no: "a1" })],
            next_cursor: "CURSOR",
            has_more: true,
        })
        const vm = new MentionFreeVM("botA")
        await vm.loadGroups()

        // 旧 bot 的 loadMore 挂起
        let resolveMore: (v: any) => void = () => {}
        hoisted.get.mockImplementationOnce(() => new Promise((r) => { resolveMore = r }))
        const morePromise = vm.loadMore()
        expect(vm.loadingMore).toBe(true)

        // 切 bot：必须复位 loadingMore
        hoisted.get.mockResolvedValueOnce({
            list: [grp({ group_no: "b1" })],
            next_cursor: "BCURSOR",
            has_more: true,
        })
        vm.setRobotId("botB")
        await Promise.resolve()
        expect(vm.loadingMore).toBe(false)

        // 旧 loadMore 迟到返回 —— 过期丢弃，不污染 B，也不卡 loadingMore
        resolveMore({ list: [grp({ group_no: "a2" })], next_cursor: null, has_more: false })
        await morePromise
        expect(vm.loadingMore).toBe(false)
        expect(vm.groups.map((g) => g.group_no)).toEqual(["b1"])

        // 新 bot 的分页现在可正常工作
        hoisted.get.mockResolvedValueOnce({
            list: [grp({ group_no: "b2" })],
            next_cursor: null,
            has_more: false,
        })
        await vm.loadMore()
        expect(vm.groups.map((g) => g.group_no)).toEqual(["b1", "b2"])
    })
})
