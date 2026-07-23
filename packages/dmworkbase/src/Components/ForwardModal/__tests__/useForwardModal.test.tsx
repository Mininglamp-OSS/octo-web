import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

/**
 * 转发目标排除归档子区（issue #346 需求 2）。
 *
 * useForwardModal.rebuildConvItems 在构建子区来源时复用侧栏的 fail-open
 * helper filterArchivedThreads：
 *   - 明确 status=Archived(2) 的子区 → 不出现在转发目标
 *   - 活跃(1) / status 未知（channelInfo 未加载）的子区 → 保留（fail-open）
 *   - 群聊/私聊不受影响
 *
 * 这里 mock 掉 WKSDK / WKApp 的数据源，但使用真实的 archivedThreads.ts，
 * 守护「归档子区冒出来当转发目标」的回归。
 *
 * 渲染采用与 useFollowSidebar.test.tsx 一致的 React 17 legacy
 * ReactDOM.render + Probe 模式，避免依赖 @testing-library/react。
 */

import React from "react"
import ReactDOM from "react-dom"
import { act } from "react-dom/test-utils"

import { ChannelTypeCommunityTopic } from "../../../Service/Const"
import { ThreadStatus } from "../../../Service/Thread"

const CT_GROUP = 2

const hoisted = vi.hoisted(() => {
    return {
        conversations: [] as any[],
        getChannelInfo: vi.fn(() => undefined),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        fetchChannelInfo: vi.fn(),
        groupSaveList: vi.fn(async () => []),
        searchFriends: vi.fn(async () => []),
        mittOn: vi.fn((event: string, handler: () => void) => {
            if (event === "conversation-list-refreshed") hoisted.refreshHandlers.push(handler)
        }),
        mittOff: vi.fn(),
        currentSpaceId: "" as string,
        channelSpaceMap: new Map<string, string>(),
        channelListeners: [] as Array<(info: any) => void>,
        refreshHandlers: [] as Array<() => void>,
        // 可配置的 Space 裁决桩：默认全保留(false)。需要模拟「外部成员豁免保留」
        // 与「跨 Space 非外部成员剔除」时，用例按 channel 覆写 mockImplementation。
        shouldSkip: vi.fn((_channel: any) => false),
        // WKApp.searchChatCandidates 桩：默认 undefined（复刻 #420 修复前侧边面板
        // 未注册回调的状态）。GH #420 用例按需赋一个返回群/子区/联系人候选的 fn。
        searchChatCandidates: undefined as undefined | ((params: any) => Promise<any[]>),
        // 设备 UUID：空串时四 Tab 关注/最近同步被跳过（validateSidebarRequest 必拒）。
        // 关注/最近 Tab 用例按需赋非空值 + 配 sidebarSync 桩。
        deviceId: "" as string,
        // SidebarService.sync 桩：默认返回空集合。关注/最近 Tab 用例按需覆写。
        sidebarSync: vi.fn(async (_req: any) => ({ items: [], version: 0, follow_version: 0 })),
    }
})

// 真实 ConversationWrap 依赖完整 SDK；这里用最小透传桩，只暴露
// channel / channelInfo / timestamp，足够 rebuildConvItems 与 filterArchivedThreads 使用。
vi.mock("../../../Service/Model", () => ({
    ConversationWrap: class {
        conversation: any
        constructor(conversation: any) {
            this.conversation = conversation
        }
        get channel() {
            return this.conversation.channel
        }
        get channelInfo() {
            return this.conversation.channelInfo
        }
        get timestamp() {
            return this.conversation.timestamp ?? 0
        }
    },
}))

vi.mock("wukongimjssdk", () => {
    class Channel {
        channelID: string
        channelType: number
        constructor(channelID: string, channelType: number) {
            this.channelID = channelID
            this.channelType = channelType
        }
    }
    const sdk = {
        conversationManager: {
            get conversations() {
                return hoisted.conversations
            },
        },
        channelManager: {
            getChannelInfo: hoisted.getChannelInfo,
            addListener: (fn: any) => {
                hoisted.addListener(fn)
                hoisted.channelListeners.push(fn)
            },
            removeListener: hoisted.removeListener,
            fetchChannelInfo: hoisted.fetchChannelInfo,
        },
    }
    return {
        __esModule: true,
        default: {
            shared: () => sdk,
        },
        WKSDK: {
            shared: () => sdk,
        },
        Channel,
        ChannelInfo: class {},
        ChannelTypeGroup: 2,
        ChannelTypePerson: 1,
    }
})

vi.mock("../../../Service/SpaceService", () => ({
    shouldSkipChannelForSpace: (channel: any) => hoisted.shouldSkip(channel),
    shouldSkipPersonConversationForSpace: () => false,
}))

vi.mock("../../../Utils/rateLimit", () => ({
    debounce: (fn: any) => {
        const wrapped = (...args: any[]) => fn(...args)
        wrapped.cancel = () => {}
        return wrapped
    },
}))

vi.mock("../../../App", () => ({
    default: {
        get shared() {
            return {
                get currentSpaceId() {
                    return hoisted.currentSpaceId
                },
                get deviceId() {
                    return hoisted.deviceId
                },
                channelSpaceMap: hoisted.channelSpaceMap,
            }
        },
        dataSource: {
            channelDataSource: { groupSaveList: hoisted.groupSaveList },
            commonDataSource: { searchFriends: hoisted.searchFriends },
        },
        mittBus: { on: hoisted.mittOn, off: hoisted.mittOff },
        get searchChatCandidates() {
            return hoisted.searchChatCandidates
        },
    },
}))

vi.mock("../../../Service/SidebarService", () => ({
    default: { sync: (...args: any[]) => hoisted.sidebarSync(...args) },
    SidebarTargetType: { DM: 1, CHANNEL: 2, THREAD: 5 },
}))

import { useForwardModal } from "../useForwardModal"

function makeConv(channelID: string, channelType: number, displayName: string, opts: {
    parentGroupNo?: string
    threadStatus?: number
    noChannelInfo?: boolean
    timestamp?: number
    top?: boolean
} = {}) {
    if (opts.noChannelInfo) {
        return { channel: { channelID, channelType }, channelInfo: undefined, timestamp: opts.timestamp ?? 0 }
    }
    const orgData: any = { displayName }
    if (opts.parentGroupNo) orgData.parentGroupNo = opts.parentGroupNo
    if (opts.threadStatus !== undefined) orgData.thread = { status: opts.threadStatus }
    return {
        channel: { channelID, channelType },
        channelInfo: { orgData, top: opts.top === true },
        timestamp: opts.timestamp ?? 0,
    }
}

function makeGroupInfo(channelID: string, displayName: string, opts: { space_id?: string | null } = {}) {
    const orgData: any = { displayName }
    // 字段缺省(undefined) → 不写 space_id；显式 null → 写 null（验证 typeof 非 string 的 fail-open）。
    if (opts.space_id !== undefined) orgData.space_id = opts.space_id
    return {
        channel: { channelID, channelType: CT_GROUP },
        orgData,
    }
}

function Probe({ onValue }: { onValue: (value: ReturnType<typeof useForwardModal>) => void }) {
    const value = useForwardModal()
    onValue(value)
    return null
}

async function flushMicrotasks() {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
}

// 用例隔离：重置所有 hoisted 共享状态（mock 返回值 + Space/缓存/监听器集合），
// 保证两个 describe 的每个用例都从干净 hoisted 状态起步，避免跨用例串扰。
function resetHoisted() {
    vi.clearAllMocks()
    hoisted.getChannelInfo.mockReturnValue(undefined)
    hoisted.groupSaveList.mockResolvedValue([])
    hoisted.searchFriends.mockResolvedValue([])
    hoisted.shouldSkip.mockImplementation(() => false)
    hoisted.currentSpaceId = ""
    hoisted.channelSpaceMap = new Map()
    hoisted.channelListeners = []
    hoisted.refreshHandlers = []
    hoisted.conversations = []
    hoisted.searchChatCandidates = undefined
    hoisted.deviceId = ""
    hoisted.sidebarSync.mockResolvedValue({ items: [], version: 0, follow_version: 0 })
}

async function renderForward() {
    const container = document.createElement("div")
    document.body.appendChild(container)
    let latest: ReturnType<typeof useForwardModal> | undefined
    await act(async () => {
        ReactDOM.render(<Probe onValue={(value) => { latest = value }} />, container)
        await flushMicrotasks()
    })
    return {
        get current() {
            return latest!
        },
        unmount() {
            act(() => {
                ReactDOM.unmountComponentAtNode(container)
            })
            container.remove()
        },
    }
}

// 变体渲染：透传 onFinished + grantOptions，供授权区默认值/确认路径用例使用。
async function renderForwardWithGrant(
    onFinished?: Parameters<typeof useForwardModal>[0],
    grantOptions?: Parameters<typeof useForwardModal>[1],
) {
    const container = document.createElement("div")
    document.body.appendChild(container)
    let latest: ReturnType<typeof useForwardModal> | undefined
    function GrantProbe() {
        latest = useForwardModal(onFinished, grantOptions)
        return null
    }
    await act(async () => {
        ReactDOM.render(<GrantProbe />, container)
        await flushMicrotasks()
    })
    return {
        get current() {
            return latest!
        },
        unmount() {
            act(() => {
                ReactDOM.unmountComponentAtNode(container)
            })
            container.remove()
        },
    }
}

describe("useForwardModal — archived threads excluded from forward targets", () => {
    beforeEach(() => {
        resetHoisted()
    })

    afterEach(() => {
        hoisted.conversations = []
    })

    it("excludes archived(status=2) threads, keeps active(1), unknown-status, and groups (fail-open)", async () => {
        hoisted.conversations = [
            makeConv("g1", CT_GROUP, "Group 1", { timestamp: 100 }),
            makeConv("t-active", ChannelTypeCommunityTopic, "Active Thread", {
                parentGroupNo: "g1", threadStatus: ThreadStatus.Active, timestamp: 90,
            }),
            makeConv("t-archived", ChannelTypeCommunityTopic, "Archived Thread", {
                parentGroupNo: "g1", threadStatus: ThreadStatus.Archived, timestamp: 80,
            }),
            makeConv("t-unknown", ChannelTypeCommunityTopic, "Unknown Thread", {
                parentGroupNo: "g1", timestamp: 70, // no thread.status → fail-open keep
            }),
        ]

        const view = await renderForward()
        const ids = view.current.allItems.map((i) => i.channelID)

        expect(ids).toContain("g1")
        expect(ids).toContain("t-active")
        expect(ids).toContain("t-unknown")
        expect(ids).not.toContain("t-archived")

        view.unmount()
    })

    it("keeps a thread whose channelInfo has not loaded yet (status unknown → fail-open)", async () => {
        hoisted.conversations = [
            makeConv("g1", CT_GROUP, "Group 1", { timestamp: 100 }),
            makeConv("t-noinfo", ChannelTypeCommunityTopic, "", { noChannelInfo: true, timestamp: 60 }),
        ]

        const view = await renderForward()
        const ids = view.current.allItems.map((i) => i.channelID)

        expect(ids).toContain("t-noinfo")

        view.unmount()
    })

    it("does not filter groups or direct conversations", async () => {
        hoisted.conversations = [
            makeConv("g1", CT_GROUP, "Group 1", { timestamp: 100 }),
            makeConv("g2", CT_GROUP, "Group 2", { timestamp: 95 }),
        ]

        const view = await renderForward()
        const ids = view.current.allItems.map((i) => i.channelID)

        expect(ids).toContain("g1")
        expect(ids).toContain("g2")

        view.unmount()
    })
})

describe("useForwardModal — group/my fallback groups + thread re-homing", () => {
    beforeEach(() => {
        resetHoisted()
    })

    afterEach(() => {
        hoisted.conversations = []
    })

    it("recents has no group + group/my returns groups → final allItems contains the group", async () => {
        hoisted.conversations = []
        hoisted.groupSaveList.mockResolvedValue([makeGroupInfo("g-only", "Group Only")] as any)

        const view = await renderForward()
        const ids = view.current.allItems.map((i) => i.channelID)

        expect(ids).toContain("g-only")

        view.unmount()
    })

    it("survives a lazy-load channelListener rebuild without dropping the fallback group (double-write race guard)", async () => {
        hoisted.conversations = []
        hoisted.groupSaveList.mockResolvedValue([makeGroupInfo("g-lazy", "Group Lazy")] as any)

        const view = await renderForward()
        expect(view.current.allItems.map((i) => i.channelID)).toContain("g-lazy")

        // 模拟懒加载 channelInfo 到达 → channelListener → rebuildDebounced → rebuild
        await act(async () => {
            for (const fn of hoisted.channelListeners) fn({})
            await flushMicrotasks()
        })

        expect(view.current.allItems.map((i) => i.channelID)).toContain("g-lazy")

        view.unmount()
    })

    it("keeps a group whose authoritative space_id matches and re-seeds channelSpaceMap", async () => {
        hoisted.currentSpaceId = "space-1"
        hoisted.conversations = []
        hoisted.groupSaveList.mockResolvedValue([
            makeGroupInfo("g-match", "Group Match", { space_id: "space-1" }),
        ] as any)

        const view = await renderForward()
        const ids = view.current.allItems.map((i) => i.channelID)

        expect(ids).toContain("g-match")
        expect(hoisted.channelSpaceMap.get(`g-match_${CT_GROUP}`)).toBe("space-1")

        view.unmount()
    })

    it("drops a cross-space group when shouldSkipChannelForSpace rejects it (non-external member), but still re-seeds its real space_id", async () => {
        hoisted.currentSpaceId = "space-1"
        hoisted.conversations = []
        // 非外部成员：权威裁决剔除（source_space_id 不匹配 → shouldSkip 返回 true）。
        hoisted.shouldSkip.mockImplementation((ch: any) => ch?.channelID === "g-other")
        hoisted.groupSaveList.mockResolvedValue([
            makeGroupInfo("g-other", "Group Other", { space_id: "space-2" }),
        ] as any)

        const view = await renderForward()
        const ids = view.current.allItems.map((i) => i.channelID)

        expect(ids).not.toContain("g-other")
        // Plan A：跨 Space 分支无条件回种群真实归属（与权威 channelInfo 命中时一致），
        // 即便最终被剔除，缓存里存的也是该群真实 space_id（非污染）。
        expect(hoisted.channelSpaceMap.get(`g-other_${CT_GROUP}`)).toBe("space-2")

        view.unmount()
    })

    it("keeps a cross-space external group exempted by source_space_id and re-seeds its real space_id", async () => {
        // currentSpaceId=space-1，群 orgData.space_id=space-2，但我以 space-1 身份外部加入
        // （source_space_id=space-1）→ 权威 shouldSkipChannelForSpace 豁免保留（返回 false）。
        hoisted.currentSpaceId = "space-1"
        hoisted.conversations = []
        hoisted.shouldSkip.mockImplementation(() => false)
        hoisted.groupSaveList.mockResolvedValue([
            makeGroupInfo("g-external", "External Group", { space_id: "space-2" }),
        ] as any)

        const view = await renderForward()
        const ids = view.current.allItems.map((i) => i.channelID)

        // 回归 #366 Blocker：外部群必须出现在转发框（兜底路径不得错误剔除）。
        expect(ids).toContain("g-external")
        // 回种群真实归属 space-2。
        expect(hoisted.channelSpaceMap.get(`g-external_${CT_GROUP}`)).toBe("space-2")

        view.unmount()
    })

    it("keeps a group with empty-string space_id but does NOT re-seed channelSpaceMap", async () => {
        hoisted.currentSpaceId = "space-1"
        hoisted.conversations = []
        hoisted.groupSaveList.mockResolvedValue([
            makeGroupInfo("g-empty", "Group Empty", { space_id: "" }),
        ] as any)

        const view = await renderForward()
        const ids = view.current.allItems.map((i) => i.channelID)

        expect(ids).toContain("g-empty")
        expect(hoisted.channelSpaceMap.has(`g-empty_${CT_GROUP}`)).toBe(false)

        view.unmount()
    })

    it("keeps a group missing the space_id field (fail-open)", async () => {
        hoisted.currentSpaceId = "space-1"
        hoisted.conversations = []
        // 无 space_id 字段
        hoisted.groupSaveList.mockResolvedValue([makeGroupInfo("g-nofield", "Group NoField")] as any)

        const view = await renderForward()
        const ids = view.current.allItems.map((i) => i.channelID)

        expect(ids).toContain("g-nofield")
        expect(hoisted.channelSpaceMap.has(`g-nofield_${CT_GROUP}`)).toBe(false)

        view.unmount()
    })

    it("deduplicates a group present in both recents and group/my, keeping the recents version", async () => {
        // 给两份设可区分 displayName：recents 版 vs group/my 版。
        // 去重逻辑：recents 群先入 seenGroupIDs，兜底群 continue 跳过 → 应保留 recents 版。
        hoisted.conversations = [makeConv("g-dup", CT_GROUP, "Group Dup Recents", { timestamp: 100 })]
        hoisted.groupSaveList.mockResolvedValue([makeGroupInfo("g-dup", "Group Dup Fallback")] as any)

        const view = await renderForward()
        const occurrences = view.current.allItems.filter((i) => i.channelID === "g-dup")

        expect(occurrences).toHaveLength(1)
        // 锁定「recents 优先」语义：保留的必须是 recents 版本，而非兜底版本。
        expect(occurrences[0].displayName).toBe("Group Dup Recents")

        view.unmount()
    })

    it("re-homes a recents thread within its group/my parent's segment while an orphan thread stays in the tail", async () => {
        // 区分两条路径：
        //  - t-child 的父群 g-parent 仅在 group/my（兜底群），子区在 recents → 走挂回循环，
        //    应紧跟父群、落在父群与下一个兜底群 g-second 之间。
        //  - t-orphan 的父群 g-missing 既不在 recents 也不在 group/my → 真孤儿，落在末尾段。
        // 第二个兜底群 g-second 作为分界：若删掉挂回循环，t-child 会落到末尾的
        // threadsByParent 兜底段，排到 g-second 之后，下面的 childIdx < secondIdx 断言即失败。
        hoisted.conversations = [
            makeConv("t-child", ChannelTypeCommunityTopic, "Child Thread", {
                parentGroupNo: "g-parent", timestamp: 90,
            }),
            makeConv("t-orphan", ChannelTypeCommunityTopic, "Orphan Thread", {
                parentGroupNo: "g-missing", timestamp: 80,
            }),
        ]
        hoisted.groupSaveList.mockResolvedValue([
            makeGroupInfo("g-parent", "Parent Group"),
            makeGroupInfo("g-second", "Second Group"),
        ] as any)

        const view = await renderForward()
        const items = view.current.allItems

        const parentIdx = items.findIndex((i) => i.channelID === "g-parent")
        const childIdx = items.findIndex((i) => i.channelID === "t-child")
        const secondIdx = items.findIndex((i) => i.channelID === "g-second")
        const orphanIdx = items.findIndex((i) => i.channelID === "t-orphan")

        expect(parentIdx).toBeGreaterThanOrEqual(0)
        expect(secondIdx).toBeGreaterThanOrEqual(0)
        // 真子区紧跟父群、归在父群段内（在下一个兜底群之前）——删除挂回循环则此断言失败。
        expect(childIdx).toBeGreaterThan(parentIdx)
        expect(childIdx).toBeLessThan(secondIdx)
        expect(items[childIdx].parentChannelID).toBe("g-parent")
        // 孤儿子区在末尾段：排在所有兜底群之后，且 parentChannelID 仍正确。
        expect(orphanIdx).toBeGreaterThan(secondIdx)
        expect(items[orphanIdx].parentChannelID).toBe("g-missing")

        view.unmount()
    })

    it("falls back to keeping an orphan thread whose parent is in neither recents nor group/my", async () => {
        hoisted.conversations = [
            makeConv("t-orphan", ChannelTypeCommunityTopic, "Orphan Thread", {
                parentGroupNo: "g-missing", timestamp: 90,
            }),
        ]
        hoisted.groupSaveList.mockResolvedValue([])

        const view = await renderForward()
        const item = view.current.allItems.find((i) => i.channelID === "t-orphan")

        expect(item).toBeTruthy()
        expect(item!.parentChannelID).toBe("g-missing")

        view.unmount()
    })

    it("keeps a group with null space_id (fail-open) and does NOT re-seed channelSpaceMap", async () => {
        hoisted.currentSpaceId = "space-1"
        hoisted.conversations = []
        // 显式 null：typeof 非 "string"，落入末位 fail-open，且不回种缓存。
        hoisted.groupSaveList.mockResolvedValue([
            makeGroupInfo("g-null", "Group Null", { space_id: null }),
        ] as any)

        const view = await renderForward()
        const ids = view.current.allItems.map((i) => i.channelID)

        expect(ids).toContain("g-null")
        expect(hoisted.channelSpaceMap.has(`g-null_${CT_GROUP}`)).toBe(false)

        view.unmount()
    })

    it("filters an archived child re-homed under a group/my fallback parent (#346 still applies on the new path)", async () => {
        // 父群仅在 group/my（兜底群），子区在 recents：一个活跃、一个归档。
        // 组合 extra-group 父群 + archived child，验证归档过滤在兜底路径下仍生效。
        hoisted.conversations = [
            makeConv("t-active", ChannelTypeCommunityTopic, "Active Child", {
                parentGroupNo: "g-fallback", threadStatus: ThreadStatus.Active, timestamp: 90,
            }),
            makeConv("t-archived", ChannelTypeCommunityTopic, "Archived Child", {
                parentGroupNo: "g-fallback", threadStatus: ThreadStatus.Archived, timestamp: 80,
            }),
        ]
        hoisted.groupSaveList.mockResolvedValue([makeGroupInfo("g-fallback", "Fallback Parent")] as any)

        const view = await renderForward()
        const ids = view.current.allItems.map((i) => i.channelID)

        expect(ids).toContain("g-fallback")
        expect(ids).toContain("t-active")
        expect(ids).not.toContain("t-archived")

        view.unmount()
    })

    it("on Space switch re-entry, the previous Space's fallback group must not flash in the first frame (M1)", async () => {
        // Space A：兜底群带空串 space_id（fail-open 保留），渲染后进入 extraGroupsRef。
        hoisted.currentSpaceId = "space-A"
        hoisted.conversations = []
        hoisted.groupSaveList.mockResolvedValueOnce([
            makeGroupInfo("g-A", "Group A", { space_id: "" }),
        ] as any)

        const view = await renderForward()
        expect(view.current.allItems.map((i) => i.channelID)).toContain("g-A")

        // 切到 Space B：第二次 groupSaveList 挂起，模拟「B 的结果 resolve 前」的第一帧。
        let resolveB: (v: any) => void = () => {}
        hoisted.groupSaveList.mockReturnValueOnce(
            new Promise((res) => { resolveB = res }) as any
        )
        hoisted.currentSpaceId = "space-B"

        // conversation-list-refreshed → load() 重入。
        await act(async () => {
            for (const fn of hoisted.refreshHandlers) fn()
            await flushMicrotasks()
        })

        // 关键回归断言：B 的 groupSaveList 尚未 resolve，第一帧不得出现 A 的兜底群。
        // g-A 是空串 space_id，旧逻辑（extraGroupsRef 残留）会在 Space B 下 fail-open 闪现。
        expect(view.current.allItems.map((i) => i.channelID)).not.toContain("g-A")

        // 收尾：让挂起的 B 完成，避免悬挂 promise。
        await act(async () => {
            resolveB([])
            await flushMicrotasks()
        })

        view.unmount()
    })
})

/**
 * GH #420 / OCT-34 回归守护：转发目标选择器搜索群聊/子区。
 *
 * 根因：群/子区结果来自 WKApp.searchChatCandidates。Web 端由 SummaryModule
 * 注册该回调，但扩展侧边面板从未挂载它 → 回调为 undefined → useForwardModal
 * 的搜索 effect 清空群/子区结果，搜索只剩联系人。修复在侧边面板入口注册了一个
 * 等价回调。这里直接驱动 useForwardModal 的「已注册 searchChatCandidates」路径
 * （此前 App mock 恒为 undefined，从未覆盖），守护：
 *   - 搜到频道(group) / 子区(thread)，命中子区时父群被带出；
 *   - 联系人(direct)候选不被丢失（无回归）；
 *   - 非默认 Space 下，currentSpaceId 作为 space_id 透传给回调（Space 作用域）。
 *
 * keyword 经 setInputValue 的 300ms debounce 才生效，故用 fake timers 推进。
 */
describe("useForwardModal — registered searchChatCandidates surfaces channels & subzones (GH #420)", () => {
    beforeEach(() => {
        resetHoisted()
        vi.useFakeTimers()
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    // 群「Engineering」、子区「Daily Standup」(父群=g-eng)、联系人「Alice」。
    const candidates = [
        { chat_id: "g-eng", chat_type: "group", name: "Engineering", member_count: 12 },
        { chat_id: "t-standup", chat_type: "thread", name: "Daily Standup", parent_group_no: "g-eng" },
        { chat_id: "d-alice", chat_type: "direct", name: "Alice", member_count: null },
    ]

    // 搜索前先切到目标 Tab：四 Tab 化后搜索按当前 Tab 作用域过滤（对齐纪要选择器），
    // 后端候选（群/子区/私聊）分别落在「全部群聊」/「全部私聊」Tab 下，而非默认「最近」。
    async function search(
        view: Awaited<ReturnType<typeof renderForward>>,
        kw: string,
        tab: "followed" | "recent" | "group" | "direct" = "group",
    ) {
        await act(async () => {
            view.current.setActiveTab(tab)
            view.current.setInputValue(kw)
            await vi.advanceTimersByTimeAsync(350) // 越过 300ms debounce → setKeyword
            await flushMicrotasks() // searchChatCandidates(...).then(setSearchGroupItems)
            await flushMicrotasks()
        })
    }

    it("surfaces a channel(group) result when searching its name", async () => {
        hoisted.searchChatCandidates = vi.fn(async () => candidates)
        const view = await renderForward()

        await search(view, "engineering")
        const found = view.current.items.find((i) => i.channelID === "g-eng")

        expect(found).toBeTruthy()
        expect(found!.isThread).toBe(false)
        expect(found!.displayName).toBe("Engineering")

        view.unmount()
    })

    it("surfaces a subzone(thread) result AND brings out its parent group (方案 A)", async () => {
        hoisted.searchChatCandidates = vi.fn(async () => candidates)
        const view = await renderForward()

        await search(view, "standup")
        const ids = view.current.items.map((i) => i.channelID)
        const thread = view.current.items.find((i) => i.channelID === "t-standup")

        // 命中子区本身
        expect(ids).toContain("t-standup")
        expect(thread!.isThread).toBe(true)
        expect(thread!.parentChannelID).toBe("g-eng")
        // 父群被带出（即使父群名未命中关键字）
        expect(ids).toContain("g-eng")

        view.unmount()
    })

    it("still surfaces a contact(direct) result (no regression)", async () => {
        hoisted.searchChatCandidates = vi.fn(async () => candidates)
        const view = await renderForward()

        await search(view, "alice", "direct")
        const found = view.current.items.find((i) => i.channelID === "d-alice")

        expect(found).toBeTruthy()
        expect(found!.isThread).toBe(false)
        expect(found!.displayName).toBe("Alice")

        view.unmount()
    })

    it("forwards currentSpaceId as space_id to searchChatCandidates under a non-default Space", async () => {
        hoisted.currentSpaceId = "space-非默认"
        const spy = vi.fn(async () => candidates)
        hoisted.searchChatCandidates = spy
        const view = await renderForward()

        await search(view, "engineering")

        expect(spy).toHaveBeenCalled()
        const arg = spy.mock.calls[spy.mock.calls.length - 1][0]
        expect(arg.keyword).toBe("engineering")
        expect(arg.space_id).toBe("space-非默认")

        view.unmount()
    })

    it("clears group/thread results when searchChatCandidates is unregistered (pre-fix sidepanel state)", async () => {
        // 复刻修复前：回调未注册 → 群/子区结果应为空（只可能剩本地会话/联系人，
        // 本用例无本地数据 → items 不含群/子区候选）。
        hoisted.searchChatCandidates = undefined
        const view = await renderForward()

        await search(view, "engineering")
        const ids = view.current.items.map((i) => i.channelID)

        expect(ids).not.toContain("g-eng")
        expect(ids).not.toContain("t-standup")

        view.unmount()
    })
})

/**
 * 转发到聊天弹窗「转发时授权」复选框默认值（老板令 XIN-496）。
 *
 * 需求：授权开关默认从「选中」改为「不选中」。默认不勾时确认走「不授权」路径
 * （onFinished 第二参 undefined）；用户主动勾选后仍能正常授权（onFinished 第二参
 * 带 { role }）。仅改默认初值，不动授权逻辑本身，也不动权限级别下拉默认值。
 */
describe("useForwardModal — grant switch defaults OFF (转发时授权 默认不选中)", () => {
    beforeEach(() => {
        resetHoisted()
    })

    afterEach(() => {
        hoisted.conversations = []
    })

    it("defaults grantEnabled to false even when canGrant is true", async () => {
        const view = await renderForwardWithGrant(vi.fn(), { canGrant: true })

        expect(view.current.grantEnabled).toBe(false)
        // 权限级别下拉默认值不变：仍为 reader。
        expect(view.current.grantRole).toBe("reader")

        view.unmount()
    })

    it("forwards WITHOUT a grant when the switch is left at its default (unchecked → 不授权路径)", async () => {
        const finished = vi.fn()
        hoisted.conversations = [makeConv("g1", CT_GROUP, "Group 1", { timestamp: 100 })]
        const view = await renderForwardWithGrant(finished, { canGrant: true })

        const target = view.current.allItems.find((i) => i.channelID === "g1")!
        act(() => view.current.toggleSelect(target))
        act(() => view.current.confirm())

        expect(finished).toHaveBeenCalledTimes(1)
        const [channels, grant] = finished.mock.calls[0]
        expect(channels).toHaveLength(1)
        expect(grant).toBeUndefined()

        view.unmount()
    })

    it("still forwards WITH a grant once the user opts in (checked → 授权路径, role preserved)", async () => {
        const finished = vi.fn()
        hoisted.conversations = [makeConv("g1", CT_GROUP, "Group 1", { timestamp: 100 })]
        const view = await renderForwardWithGrant(finished, { canGrant: true })

        const target = view.current.allItems.find((i) => i.channelID === "g1")!
        act(() => view.current.toggleSelect(target))
        act(() => view.current.setGrantEnabled(true))
        expect(view.current.grantEnabled).toBe(true)
        act(() => view.current.confirm())

        expect(finished).toHaveBeenCalledTimes(1)
        const [channels, grant] = finished.mock.calls[0]
        expect(channels).toHaveLength(1)
        expect(grant).toEqual({ role: "reader" })

        view.unmount()
    })

    it("honours the caller's defaultRole when the switch is turned on", async () => {
        const finished = vi.fn()
        hoisted.conversations = [makeConv("g1", CT_GROUP, "Group 1", { timestamp: 100 })]
        const view = await renderForwardWithGrant(finished, { canGrant: true, defaultRole: "writer" })

        const target = view.current.allItems.find((i) => i.channelID === "g1")!
        act(() => view.current.toggleSelect(target))
        act(() => view.current.setGrantEnabled(true))
        act(() => view.current.confirm())

        const [, grant] = finished.mock.calls[0]
        expect(grant).toEqual({ role: "writer" })

        view.unmount()
    })
})

/**
 * 四 Tab 转发选择器（issue #661）：对齐智能纪要选择器的关注/最近/全部群聊/全部私聊。
 *
 * 数据源方案 (b)：主体仍复用本地会话 + group/my + 好友装配（零权限回归）；
 * 「关注」Tab 走 SidebarService follow 同步，「最近」Tab 走 SidebarService recent
 * 同步并按置顶优先、timestamp 倒序排序。这里守护：Tab 作用域过滤、群→子区嵌套、
 * 关注/最近集合过滤、以及授权在任意 Tab 下确认仍生效。
 */
describe("useForwardModal — four-Tab selector (issue #661)", () => {
    beforeEach(() => {
        resetHoisted()
    })

    afterEach(() => {
        hoisted.conversations = []
    })

    // 好友（私聊）来自 searchFriends：channelType=1(个人)。
    function makeFriend(channelID: string, displayName: string) {
        return { channel: { channelID, channelType: 1 }, orgData: { displayName } }
    }

    it("default tab is 'recent' and scopes to SidebarService recent set (directs from friends excluded)", async () => {
        hoisted.deviceId = "dev-uuid"
        hoisted.conversations = [
            makeConv("g1", CT_GROUP, "Group 1", { timestamp: 100 }),
            makeConv("g2", CT_GROUP, "Group 2", { timestamp: 90 }),
        ]
        hoisted.searchFriends.mockResolvedValue([makeFriend("d1", "Alice")] as any)
        hoisted.sidebarSync.mockImplementation(async (req: any) => ({
            items: req.tab === "recent"
                ? [{ target_type: 2, target_id: "g2", timestamp: 2000 }]
                : [],
            version: 0,
            follow_version: 0,
        }))

        const view = await renderForward()

        expect(view.current.activeTab).toBe("recent")
        const ids = view.current.items.map((i) => i.channelID)
        // 最近 = 后端 recent 集合 → 仅含 g2；本地会话 g1 不在集合内，好友 d1 也不在集合内。
        expect(ids).toEqual(["g2"])
        expect(ids).not.toContain("g1")
        expect(ids).not.toContain("d1")
        // 但 allItems（已选头像区）仍是全量，含本地会话与好友。
        expect(view.current.allItems.map((i) => i.channelID)).toContain("g1")
        expect(view.current.allItems.map((i) => i.channelID)).toContain("d1")

        view.unmount()
    })

    it("recent tab puts SidebarService pinned items before newer unpinned items", async () => {
        hoisted.deviceId = "dev-uuid"
        hoisted.conversations = [
            makeConv("g1", CT_GROUP, "Group 1", { timestamp: 1000 }),
            makeConv("g2", CT_GROUP, "Group 2", { timestamp: 10 }),
        ]
        hoisted.sidebarSync.mockImplementation(async (req: any) => ({
            items: req.tab === "recent"
                ? [
                    { target_type: 2, target_id: "g1", timestamp: 2_000_000_000_000, is_pinned: false },
                    { target_type: 2, target_id: "g2", timestamp: 0, is_pinned: true },
                ]
                : [],
            version: 0,
            follow_version: 0,
        }))

        const view = await renderForward()

        // g2 虽然 timestamp 更旧，但 sidebar recent 标记为置顶，必须排在普通项前面。
        expect(view.current.items.map((i) => i.channelID)).toEqual(["g2", "g1"])

        view.unmount()
    })

    it("recent tab also treats local channelInfo.top as pinned when SidebarService does not mark it", async () => {
        hoisted.deviceId = "dev-uuid"
        hoisted.conversations = [
            makeConv("g1", CT_GROUP, "Group 1", { timestamp: 1000 }),
            makeConv("g2", CT_GROUP, "Group 2", { timestamp: 10, top: true }),
        ]
        hoisted.sidebarSync.mockImplementation(async (req: any) => ({
            items: req.tab === "recent"
                ? [
                    { target_type: 2, target_id: "g1", timestamp: 2_000_000_000_000, is_pinned: false },
                    { target_type: 2, target_id: "g2", timestamp: 0, is_pinned: false },
                ]
                : [],
            version: 0,
            follow_version: 0,
        }))

        const view = await renderForward()

        expect(view.current.items.map((i) => i.channelID)).toEqual(["g2", "g1"])

        view.unmount()
    })

    it("group tab shows groups + nested threads (tree order) and hides directs", async () => {
        hoisted.conversations = [
            makeConv("g1", CT_GROUP, "Group 1", { timestamp: 100 }),
            makeConv("t1", ChannelTypeCommunityTopic, "Thread 1", { parentGroupNo: "g1", timestamp: 90 }),
        ]
        hoisted.searchFriends.mockResolvedValue([makeFriend("d1", "Alice")] as any)

        const view = await renderForward()
        act(() => view.current.setActiveTab("group"))

        const ids = view.current.items.map((i) => i.channelID)
        // 群 + 子区，子区紧跟父群（树序）。
        expect(ids).toEqual(["g1", "t1"])
        // 私聊被排除。
        expect(ids).not.toContain("d1")

        view.unmount()
    })

    it("direct tab shows only directs (friends), hides groups/threads", async () => {
        hoisted.conversations = [
            makeConv("g1", CT_GROUP, "Group 1", { timestamp: 100 }),
            makeConv("t1", ChannelTypeCommunityTopic, "Thread 1", { parentGroupNo: "g1", timestamp: 90 }),
        ]
        hoisted.searchFriends.mockResolvedValue([makeFriend("d1", "Alice")] as any)

        const view = await renderForward()
        act(() => view.current.setActiveTab("direct"))

        const ids = view.current.items.map((i) => i.channelID)
        expect(ids).toEqual(["d1"])

        view.unmount()
    })

    it("search on group tab brings out a matched thread's parent group (方案 A)", async () => {
        vi.useFakeTimers()
        try {
            hoisted.conversations = [
                makeConv("g1", CT_GROUP, "Engineering", { timestamp: 100 }),
                makeConv("t1", ChannelTypeCommunityTopic, "Daily Standup", { parentGroupNo: "g1", timestamp: 90 }),
                makeConv("g2", CT_GROUP, "Product", { timestamp: 80 }),
            ]

            const view = await renderForward()
            act(() => view.current.setActiveTab("group"))
            await act(async () => {
                view.current.setInputValue("standup")
                await vi.advanceTimersByTimeAsync(350) // 越过 300ms debounce → setKeyword
                await flushMicrotasks()
            })

            const ids = view.current.items.map((i) => i.channelID)
            // 命中子区 t1 → 带出父群 g1；无关的 g2 不出现。
            expect(ids).toContain("t1")
            expect(ids).toContain("g1")
            expect(ids).not.toContain("g2")

            view.unmount()
        } finally {
            vi.useRealTimers()
        }
    })

    it("followed tab filters by the SidebarService follow set (composite key)", async () => {
        hoisted.deviceId = "dev-uuid"
        hoisted.conversations = [
            makeConv("g1", CT_GROUP, "Group 1", { timestamp: 100 }),
            makeConv("g2", CT_GROUP, "Group 2", { timestamp: 90 }),
        ]
        // 仅关注 g1（复合 key = 群类型 2 :: g1）。
        hoisted.sidebarSync.mockResolvedValue({
            items: [
                { target_type: 2, target_id: "g1", is_followed: true },
                { target_type: 2, target_id: "g2", is_followed: false },
            ],
            version: 0,
            follow_version: 0,
        })

        const view = await renderForward()
        act(() => view.current.setActiveTab("followed"))

        const ids = view.current.items.map((i) => i.channelID)
        expect(ids).toContain("g1")
        expect(ids).not.toContain("g2")
        // 关注/最近同步分别以 follow/recent tab + 设备 UUID 发起。
        expect(hoisted.sidebarSync).toHaveBeenCalledWith(
            expect.objectContaining({ tab: "follow", device_uuid: "dev-uuid" }),
        )
        expect(hoisted.sidebarSync).toHaveBeenCalledWith(
            expect.objectContaining({ tab: "recent", device_uuid: "dev-uuid" }),
        )

        view.unmount()
    })

    it("skips sidebar sync when deviceId is empty (doomed request guard) → followed/recent tabs empty", async () => {
        hoisted.deviceId = ""
        hoisted.conversations = [makeConv("g1", CT_GROUP, "Group 1", { timestamp: 100 })]

        const view = await renderForward()

        expect(hoisted.sidebarSync).not.toHaveBeenCalled()
        expect(view.current.activeTab).toBe("recent")
        // 最近集合为空 → 默认最近 Tab 无内容。
        expect(view.current.items.map((i) => i.channelID)).not.toContain("g1")

        act(() => view.current.setActiveTab("followed"))

        expect(hoisted.sidebarSync).not.toHaveBeenCalled()
        // 关注集合为空 → 关注 Tab 无内容。
        expect(view.current.items.map((i) => i.channelID)).not.toContain("g1")

        view.unmount()
    })

    it("grant still fires on confirm regardless of the active tab", async () => {
        const finished = vi.fn()
        hoisted.conversations = [makeConv("g1", CT_GROUP, "Group 1", { timestamp: 100 })]
        const view = await renderForwardWithGrant(finished, { canGrant: true })

        // 切到「全部群聊」再选中 + 开授权 + 确认。
        act(() => view.current.setActiveTab("group"))
        const target = view.current.allItems.find((i) => i.channelID === "g1")!
        act(() => view.current.toggleSelect(target))
        act(() => view.current.setGrantEnabled(true))
        act(() => view.current.confirm())

        expect(finished).toHaveBeenCalledTimes(1)
        const [channels, grant] = finished.mock.calls[0]
        expect(channels).toHaveLength(1)
        expect(grant).toEqual({ role: "reader" })

        view.unmount()
    })
})
