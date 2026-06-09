import { describe, expect, it } from "vitest"
import {
    isArchivedThreadConversation,
    isThreadArchivedForBadge,
    filterArchivedThreads,
    type ArchivableConversation,
    type ThreadSidebarStatusMap,
} from "../archivedThreads"
import { ThreadStatus } from "../../../Service/Thread"
import { ChannelTypeCommunityTopic } from "../../../Service/Const"

const CT_GROUP = 2

// 构造一个子区会话存根：channelType=子区，thread.status 可选（undefined 表示未知/未加载）
function makeThreadConv(channelID: string, status?: number): ArchivableConversation {
    return {
        channel: { channelType: ChannelTypeCommunityTopic, channelID },
        channelInfo:
            status === undefined
                ? undefined
                : { orgData: { thread: { status } } },
    }
}

function makeGroupConv(): ArchivableConversation {
    return { channel: { channelType: CT_GROUP, channelID: "g1" } }
}

describe("isArchivedThreadConversation", () => {
    it("active 子区(status=1) 不算归档", () => {
        expect(isArchivedThreadConversation(makeThreadConv("t1", ThreadStatus.Active))).toBe(false)
    })

    it("archived 子区(status=2) 算归档", () => {
        expect(isArchivedThreadConversation(makeThreadConv("t2", ThreadStatus.Archived))).toBe(true)
    })

    it("status 未知/channelInfo 未加载的子区不算归档（fail-open）", () => {
        expect(isArchivedThreadConversation(makeThreadConv("t3", undefined))).toBe(false)
    })

    it("非子区类型（群聊）永远不算归档", () => {
        expect(isArchivedThreadConversation(makeGroupConv())).toBe(false)
    })
})

describe("filterArchivedThreads", () => {
    it("同一父群下 active + archived + unknown：只滤掉归档，保留 active 与 unknown", () => {
        const active = makeThreadConv("active", ThreadStatus.Active)
        const archived = makeThreadConv("archived", ThreadStatus.Archived)
        const unknown = makeThreadConv("unknown", undefined)

        const result = filterArchivedThreads([active, archived, unknown])

        expect(result).toEqual([active, unknown])
        expect(result).not.toContain(archived)
    })

    it("不影响非子区会话", () => {
        const group = makeGroupConv()
        const archived = makeThreadConv("archived", ThreadStatus.Archived)
        expect(filterArchivedThreads([group, archived])).toEqual([group])
    })

    it("空数组返回空数组", () => {
        expect(filterArchivedThreads([])).toEqual([])
    })
})

describe("sidebar status map（issue #340 抗抖动）", () => {
    const ARCHIVED = ThreadStatus.Archived // 2
    const ACTIVE = ThreadStatus.Active // 1

    it("sidebar status=2 + channelInfo 缺失 => 首帧即过滤掉（核心回归：无闪烁）", () => {
        const conv = makeThreadConv("t-archived", undefined)
        const statusMap: ThreadSidebarStatusMap = new Map([["t-archived", ARCHIVED]])
        expect(isArchivedThreadConversation(conv, statusMap)).toBe(true)
        expect(filterArchivedThreads([conv], statusMap)).toEqual([])
    })

    it("sidebar status=1 + channelInfo 缺失 => 可见", () => {
        const conv = makeThreadConv("t-active", undefined)
        const statusMap: ThreadSidebarStatusMap = new Map([["t-active", ACTIVE]])
        expect(isArchivedThreadConversation(conv, statusMap)).toBe(false)
        expect(filterArchivedThreads([conv], statusMap)).toEqual([conv])
    })

    it("sidebar status 缺失 + channelInfo 缺失 => fail-open 可见（向后兼容）", () => {
        const conv = makeThreadConv("t-unknown", undefined)
        const statusMap: ThreadSidebarStatusMap = new Map() // 没有该 channelID
        expect(isArchivedThreadConversation(conv, statusMap)).toBe(false)
        expect(filterArchivedThreads([conv], statusMap)).toEqual([conv])
    })

    it("sidebar status 缺失 + channelInfo status=Archived => 过滤掉（既有行为）", () => {
        const conv = makeThreadConv("t-ci-archived", ThreadStatus.Archived)
        const statusMap: ThreadSidebarStatusMap = new Map()
        expect(isArchivedThreadConversation(conv, statusMap)).toBe(true)
        expect(filterArchivedThreads([conv], statusMap)).toEqual([])
    })

    it("sidebar status=1 但 channelInfo 后续解析为 Archived => channelInfo 权威，隐藏", () => {
        // channelInfo 已加载即为权威信号；它说归档就隐藏，盖过过期的 sidebar=Active。
        const conv = makeThreadConv("t-late-archived", ThreadStatus.Archived)
        const statusMap: ThreadSidebarStatusMap = new Map([["t-late-archived", ACTIVE]])
        expect(isArchivedThreadConversation(conv, statusMap)).toBe(true)
        expect(filterArchivedThreads([conv], statusMap)).toEqual([])
    })

    it("sidebar status=2(过期) 但 channelInfo=Active(刚取消归档) => channelInfo 权威，可见（#340 回归）", () => {
        // 取消归档只刷新 channelInfo 不发 sidebar-reload，sidebar 仍过期为 Archived；
        // channelInfo 已加载为 Active 应权威胜出，子区立即重现，不必等下次 sidebar/sync。
        const conv = makeThreadConv("t-just-unarchived", ThreadStatus.Active)
        const statusMap: ThreadSidebarStatusMap = new Map([["t-just-unarchived", ARCHIVED]])
        expect(isArchivedThreadConversation(conv, statusMap)).toBe(false)
        expect(filterArchivedThreads([conv], statusMap)).toEqual([conv])
    })

    it("sidebar status=2 + channelInfo 未知 => 隐藏（冷启动消抖动）", () => {
        const conv = makeThreadConv("t-cold", undefined)
        const statusMap: ThreadSidebarStatusMap = new Map([["t-cold", ARCHIVED]])
        expect(isArchivedThreadConversation(conv, statusMap)).toBe(true)
        expect(filterArchivedThreads([conv], statusMap)).toEqual([])
    })

    it("sidebar status=1 + channelInfo=Archived => channelInfo 权威，隐藏", () => {
        const conv = makeThreadConv("t-ci-auth", ThreadStatus.Archived)
        const statusMap: ThreadSidebarStatusMap = new Map([["t-ci-auth", ACTIVE]])
        expect(isArchivedThreadConversation(conv, statusMap)).toBe(true)
        expect(filterArchivedThreads([conv], statusMap)).toEqual([])
    })

    it("不传 statusMap（undefined）=> 行为与今天完全一致", () => {
        const archivedViaCi = makeThreadConv("a", ThreadStatus.Archived)
        const active = makeThreadConv("b", ThreadStatus.Active)
        const unknown = makeThreadConv("c", undefined)
        expect(filterArchivedThreads([archivedViaCi, active, unknown])).toEqual([active, unknown])
    })

    it("空 statusMap => 退化为仅看 channelInfo（向后兼容）", () => {
        const archivedViaCi = makeThreadConv("a", ThreadStatus.Archived)
        const active = makeThreadConv("b", ThreadStatus.Active)
        const unknown = makeThreadConv("c", undefined)
        const empty: ThreadSidebarStatusMap = new Map()
        expect(filterArchivedThreads([archivedViaCi, active, unknown], empty)).toEqual([active, unknown])
    })

    it("同父群下混合：sidebar 标归档的隐藏，sidebar active / 未知的保留", () => {
        const a = makeThreadConv("sb-archived", undefined)
        const b = makeThreadConv("sb-active", undefined)
        const c = makeThreadConv("sb-unknown", undefined)
        const statusMap: ThreadSidebarStatusMap = new Map([
            ["sb-archived", ARCHIVED],
            ["sb-active", ACTIVE],
        ])
        expect(filterArchivedThreads([a, b, c], statusMap)).toEqual([b, c])
    })
})

describe("isThreadArchivedForBadge", () => {
    const ARCHIVED = ThreadStatus.Archived // 2
    const ACTIVE = ThreadStatus.Active // 1

    it("BUG 用例：sidebar-only 已归档子区(liveConv 缺失，statusMap=Archived) => true（未读不计入角标）", () => {
        const statusMap: ThreadSidebarStatusMap = new Map<string, number | undefined>([["t1", ARCHIVED]])
        expect(isThreadArchivedForBadge(undefined, "t1", statusMap)).toBe(true)
    })

    it("对照：sidebar-only 活跃子区(liveConv 缺失，statusMap=Active) => false（未读计入角标）", () => {
        const statusMap: ThreadSidebarStatusMap = new Map<string, number | undefined>([["t2", ACTIVE]])
        expect(isThreadArchivedForBadge(undefined, "t2", statusMap)).toBe(false)
    })

    it("sidebar-only 子区且 statusMap 无该项(未知) => false（fail-open，计入角标）", () => {
        const statusMap: ThreadSidebarStatusMap = new Map<string, number | undefined>()
        expect(isThreadArchivedForBadge(undefined, "t3", statusMap)).toBe(false)
    })

    it("liveConv 存在且 channelInfo 归档(status=2) => true", () => {
        const conv = makeThreadConv("t4", ThreadStatus.Archived)
        const statusMap: ThreadSidebarStatusMap = new Map<string, number | undefined>()
        expect(isThreadArchivedForBadge(conv, "t4", statusMap)).toBe(true)
    })

    it("liveConv 存在且 channelInfo 活跃(status=1) => false", () => {
        const conv = makeThreadConv("t5", ThreadStatus.Active)
        const statusMap: ThreadSidebarStatusMap = new Map<string, number | undefined>()
        expect(isThreadArchivedForBadge(conv, "t5", statusMap)).toBe(false)
    })

    it("liveConv 存在、channelInfo 未知但 statusMap=Archived => true（委托给 isArchivedThreadConversation 回退）", () => {
        const conv = makeThreadConv("t6", undefined)
        const statusMap: ThreadSidebarStatusMap = new Map<string, number | undefined>([["t6", ARCHIVED]])
        expect(isThreadArchivedForBadge(conv, "t6", statusMap)).toBe(true)
    })
})
