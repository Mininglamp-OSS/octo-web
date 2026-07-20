/**
 * ChannelSettingVM — subscriberOfMe HTTP 兜底回归门（GH octo-web#244）
 *
 * 弱网下群创建「半成功」(群记录已入库但 IM 频道未创建/未同步，详见 octo-server#247)：
 * 本地 SDK 没有 subscriber 缓存 → reloadSubscribers 读到空 → subscriberOfMe 为
 * undefined → ChannelSettingRouteData.isManagerOrCreatorOfMe 返回 false →
 * 群「创建者」被当成非管理员，改名 / 改头像 / 公告全部被拒且无任何提示。
 *
 * 修复：当本地缓存拿不到 subscriberOfMe 时，直接走 HTTP
 * (GET groups/:id/members/:uid，读 DB 而非依赖 IM 频道) 兜底拉取「我」的成员记录，
 * 用服务端权威 role 回填 subscriberOfMe，恢复创建者的管理权限。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const hoisted = vi.hoisted(() => {
    const subscriber = vi.fn()
    const channelManager = {
        fetchChannelInfo: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addSubscriberChangeListener: vi.fn(),
        removeSubscriberChangeListener: vi.fn(),
        getChannelInfo: vi.fn(() => undefined),
        getSubscribes: vi.fn(() => []), // 本地缓存为空：模拟半成功 / 未同步
        syncSubscribes: vi.fn(() => Promise.resolve()),
    }
    return { subscriber, channelManager }
})

vi.mock("../../../App", () => ({
    default: {
        apiClient: { get: vi.fn(), post: vi.fn(), delete: vi.fn(), put: vi.fn() },
        shared: { channelSettings: () => [] },
        loginInfo: { uid: "alice" },
        dataSource: { channelDataSource: { subscriber: hoisted.subscriber } },
    },
    __esModule: true,
}))

vi.mock("@douyinfe/semi-ui", () => ({
    Toast: { error: vi.fn(), warning: vi.fn() },
}))

vi.mock("wukongimjssdk", () => ({
    default: { shared: () => ({ channelManager: hoisted.channelManager }) },
    WKSDK: { shared: () => ({ channelManager: hoisted.channelManager }) },
    Channel: class {
        constructor(public channelID: string, public channelType: number) {}
        isEqual(): boolean {
            return false
        }
    },
    ChannelInfo: class {},
    ChannelTypePerson: 1,
    __esModule: true,
}))

vi.mock("../../ListItem", () => ({
    ListItem: () => null,
    ListItemSwitch: () => null,
    ListItemIcon: () => null,
}))

import { ChannelSettingVM } from "../vm"
import { GroupRole } from "../../../Service/Const"

const ChannelTypeGroup = 2

function makeGroupVM() {
    const channel: any = { channelID: "grp-halfsuccess", channelType: ChannelTypeGroup, isEqual: () => false }
    return new ChannelSettingVM(channel)
}

beforeEach(() => {
    hoisted.subscriber.mockReset()
    hoisted.channelManager.getSubscribes.mockReturnValue([])
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe("ChannelSettingVM.ensureSubscriberOfMeFallback — issue 244", () => {
    it("issue 244: recovers creator permission when local subscriber cache is empty", async () => {
        // 服务端 DB 里群主记录存在（半成功：群记录已入库），HTTP 兜底能拿到 owner role。
        hoisted.subscriber.mockResolvedValueOnce({ uid: "alice", role: GroupRole.owner })
        const vm: any = makeGroupVM()

        // 前置：本地缓存空 → subscriberOfMe 尚未就绪 → 权限判定为 false（bug 现场）。
        expect(vm.subscriberOfMe).toBeUndefined()
        expect(vm.routeData.isManagerOrCreatorOfMe).toBe(false)

        await vm.ensureSubscriberOfMeFallback()

        // HTTP 兜底命中，用 uid + channel 精确查询「我」。
        expect(hoisted.subscriber).toHaveBeenCalledTimes(1)
        expect(hoisted.subscriber.mock.calls[0][1]).toBe("alice")
        // 回填后创建者恢复管理权限。
        expect(vm.subscriberOfMe).toMatchObject({ uid: "alice", role: GroupRole.owner })
        expect(vm.routeData.subscriberOfMe).toMatchObject({ uid: "alice" })
        expect(vm.routeData.isManagerOrCreatorOfMe).toBe(true)
    })

    it("issue 244: no-op when subscriberOfMe already resolved from cache", async () => {
        const vm: any = makeGroupVM()
        vm.subscriberOfMe = { uid: "alice", role: GroupRole.owner }

        await vm.ensureSubscriberOfMeFallback()

        // 缓存已就绪 → 不重复打服务端。
        expect(hoisted.subscriber).not.toHaveBeenCalled()
    })

    it("issue 244: stays silent (no crash) when server has no membership row", async () => {
        // 更坏的半成功：连成员记录都没入库 → subscriber() 返回 undefined。
        hoisted.subscriber.mockResolvedValueOnce(undefined)
        const vm: any = makeGroupVM()

        await expect(vm.ensureSubscriberOfMeFallback()).resolves.toBeUndefined()
        expect(vm.subscriberOfMe).toBeUndefined()
        expect(vm.routeData.isManagerOrCreatorOfMe).toBe(false)
    })

    it("issue 244: swallows HTTP errors without throwing", async () => {
        hoisted.subscriber.mockRejectedValueOnce({ status: 500, msg: "boom" })
        const vm: any = makeGroupVM()

        await expect(vm.ensureSubscriberOfMeFallback()).resolves.toBeUndefined()
        expect(vm.subscriberOfMe).toBeUndefined()
    })

    it("issue 244: skips fallback for 1-1 (person) channels", async () => {
        const channel: any = { channelID: "peer", channelType: 1, isEqual: () => false }
        const vm: any = new ChannelSettingVM(channel)

        await vm.ensureSubscriberOfMeFallback()

        expect(hoisted.subscriber).not.toHaveBeenCalled()
    })
})
