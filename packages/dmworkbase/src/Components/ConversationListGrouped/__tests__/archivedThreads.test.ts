import { describe, expect, it } from "vitest"
import {
    isArchivedThreadConversation,
    filterArchivedThreads,
    type ArchivableConversation,
} from "../archivedThreads"
import { ThreadStatus } from "../../../Service/Thread"
import { ChannelTypeCommunityTopic } from "../../../Service/Const"

const CT_GROUP = 2

// 构造一个子区会话存根：channelType=子区，thread.status 可选（undefined 表示未知/未加载）
function makeThreadConv(channelID: string, status?: number): ArchivableConversation {
    return {
        channel: { channelType: ChannelTypeCommunityTopic },
        channelInfo:
            status === undefined
                ? undefined
                : { orgData: { thread: { status } } },
    }
}

function makeGroupConv(): ArchivableConversation {
    return { channel: { channelType: CT_GROUP } }
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

    it("status 从 Active 改为 Archived 后，filterArchivedThreads 结果随之变化（issue #345 判定路径回归）", () => {
        // 模拟归档前：同父群下两个活跃子区都可见
        const stable = makeThreadConv("stable", ThreadStatus.Active)
        const toggling = makeThreadConv("toggling", ThreadStatus.Active)
        const before = filterArchivedThreads([stable, toggling])
        expect(before).toEqual([stable, toggling])

        // channelInfo 刷新后拿到权威 status=Archived（live 引用被原地改写）
        toggling.channelInfo!.orgData!.thread!.status = ThreadStatus.Archived
        const after = filterArchivedThreads([stable, toggling])

        expect(after).toEqual([stable])
        expect(after).not.toContain(toggling)
    })
})
