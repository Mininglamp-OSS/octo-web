/**
 * ChannelSettingVM — Persona / OBO section 行为单测（PR-C / GH octo-web#47 / YUJ-1178）
 *
 * 覆盖三个 P1 修复 + 一个 P2 非阻塞修复的回归门：
 *   P1-2: refreshOboScope 找 active grant 只看 `g.active`，不再 && global_enabled；
 *         配套 PersonaSettings/vm.ts 的 hasAnyActiveGrant 缓存语义改动，保证「用户
 *         有任意 active grant」就让 toggle 渲染（per-channel scope 模式的核心）。
 *   P1-3: refreshOboScope 非 404 错误时，_oboScope 保持 undefined（不再降级到 null
 *         触发「scope 加载成功但点不动」假象），_oboScopeLoaded 保持 false →
 *         buildPersonaSection 返回 undefined，toggle 整体隐藏。
 *   非阻塞：didUnMount 后异步 refresh* resolve 不再 notifyListener / 不再写状态。
 *
 * 实现注意：ChannelSettingVM 真正依赖 wukongimjssdk 的 channelManager；这里把
 * channelManager 替换成 mock listener。Channel 用最小 stub，只保留 channelID /
 * channelType / isEqual。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const hoisted = vi.hoisted(() => {
    const get = vi.fn()
    const post = vi.fn()
    const del = vi.fn()
    const put = vi.fn()
    const toastError = vi.fn()
    const channelManager = {
        fetchChannelInfo: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addSubscriberChangeListener: vi.fn(),
        removeSubscriberChangeListener: vi.fn(),
        getChannelInfo: vi.fn(() => undefined),
        getSubscribes: vi.fn(() => []),
    }
    return { get, post, del, put, toastError, channelManager }
})

vi.mock("../../../App", () => ({
    default: {
        apiClient: {
            get: hoisted.get,
            post: hoisted.post,
            delete: hoisted.del,
            put: hoisted.put,
        },
        shared: {
            // ChannelSettingVM.sections() 会走到 WKApp.shared.channelSettings(context)，
            // 我们 stub 成返回空 base sections。
            channelSettings: () => [],
        },
        loginInfo: { uid: "alice" },
    },
    __esModule: true,
}))

vi.mock("@douyinfe/semi-ui", () => ({
    Toast: {
        error: hoisted.toastError,
        warning: vi.fn(),
    },
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

// 简化 ListItem / SectionManager 等下游 import（按需 stub，避免 jsdom 加载重组件）。
vi.mock("../../ListItem", () => ({
    ListItem: () => null,
    ListItemSwitch: () => null,
    ListItemIcon: () => null,
}))

import { ChannelSettingVM } from "../vm"
import {
    clearPersonaActiveCache,
    __testing,
} from "../../PersonaSettings/vm"

function makeVM() {
    // Channel mock: 最小满足 channelID + channelType + isEqual。
    const channel: any = { channelID: "ch-1", channelType: 1, isEqual: () => false }
    return new ChannelSettingVM(channel)
}

function setHasGrant(v: boolean | undefined) {
    __testing.setCache(v)
}

beforeEach(() => {
    hoisted.get.mockReset()
    hoisted.post.mockReset()
    hoisted.del.mockReset()
    hoisted.put.mockReset()
    hoisted.toastError.mockReset()
    clearPersonaActiveCache()
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe("ChannelSettingVM.buildPersonaSection — P1-3 gating", () => {
    it("returns undefined when hasAnyActiveGrant() is false", () => {
        setHasGrant(false)
        const vm = makeVM()
        const out = (vm as any).buildPersonaSection()
        expect(out).toBeUndefined()
    })

    it("returns undefined when hasAnyActiveGrant() is undefined (cache not warm)", () => {
        setHasGrant(undefined)
        const vm = makeVM()
        const out = (vm as any).buildPersonaSection()
        expect(out).toBeUndefined()
    })

    it("returns undefined when _oboScopeLoaded is false (toggle hidden until load completes)", () => {
        setHasGrant(true)
        const vm: any = makeVM()
        vm._oboScopeLoaded = false
        vm._activeGrantId = 99
        expect(vm.buildPersonaSection()).toBeUndefined()
    })

    it("returns undefined when _activeGrantId is undefined even if _oboScopeLoaded=true", () => {
        setHasGrant(true)
        const vm: any = makeVM()
        vm._oboScopeLoaded = true
        vm._activeGrantId = undefined
        // P1-3 防呆：即便 _oboScopeLoaded 误置 true，没 grant id 也不能渲染点不动的 toggle。
        expect(vm.buildPersonaSection()).toBeUndefined()
    })

    it("returns undefined when _oboBackendMissing is true (404 graceful)", () => {
        setHasGrant(true)
        const vm: any = makeVM()
        vm._oboBackendMissing = true
        vm._oboScopeLoaded = true
        vm._activeGrantId = 99
        expect(vm.buildPersonaSection()).toBeUndefined()
    })

    it("returns a Section when all gates pass", () => {
        setHasGrant(true)
        const vm: any = makeVM()
        vm._oboScopeLoaded = true
        vm._activeGrantId = 99
        vm._oboScope = null // 不在 scope，但 toggle 仍渲染（unchecked）
        const out = vm.buildPersonaSection()
        expect(out).toBeDefined()
    })
})

describe("ChannelSettingVM.refreshOboScope — P1-2 + P1-3", () => {
    it("P1-2: finds active grant even when global_enabled=false (per-channel scope mode)", async () => {
        // 单一 grant：active=true / global_enabled=false。原实现 find(active && global_enabled)
        // 拿不到 grant，_activeGrantId 一直 undefined → toggle 永远隐藏；这就是 P1-2 的回归。
        hoisted.get.mockResolvedValueOnce([
            { id: 7, grantor_uid: "alice", grantee_bot_uid: "b1", mode: "auto", global_enabled: false, active: true },
        ])
        hoisted.get.mockResolvedValueOnce([]) // 无 scope 记录
        const vm: any = makeVM()
        await vm.refreshOboScope()
        expect(vm._activeGrantId).toBe(7)
        expect(vm._oboScopeLoaded).toBe(true)
    })

    it("P1-3: non-404 error keeps _oboScope=undefined and _oboScopeLoaded=false (toggle stays hidden)", async () => {
        hoisted.get.mockRejectedValueOnce({ status: 500, msg: "boom" })
        const vm: any = makeVM()
        await vm.refreshOboScope()
        expect(vm._oboScope).toBeUndefined()
        expect(vm._oboScopeLoaded).toBe(false)
        expect(vm._oboBackendMissing).toBe(false)
        // section 渲染门要返回 undefined，不要变成 dead toggle。
        setHasGrant(true)
        expect(vm.buildPersonaSection()).toBeUndefined()
    })

    it("404 path sets _oboBackendMissing=true (PR-A not merged yet)", async () => {
        hoisted.get.mockRejectedValueOnce({ status: 404 })
        const vm: any = makeVM()
        await vm.refreshOboScope()
        expect(vm._oboBackendMissing).toBe(true)
    })

    it("success path: matched scope is loaded into _oboScope", async () => {
        const grant = { id: 7, grantor_uid: "alice", grantee_bot_uid: "b1", mode: "auto", global_enabled: false, active: true }
        const scope = { id: 11, grant_id: 7, channel_id: "ch-1", channel_type: 1, enabled: true }
        hoisted.get.mockResolvedValueOnce([grant])
        hoisted.get.mockResolvedValueOnce([scope])
        const vm: any = makeVM()
        await vm.refreshOboScope()
        expect(vm._activeGrantId).toBe(7)
        expect(vm._oboScope).toEqual(scope)
        expect(vm._oboScopeLoaded).toBe(true)
    })

    it("success but no scope match: _oboScope=null, _oboScopeLoaded=true", async () => {
        const grant = { id: 7, grantor_uid: "alice", grantee_bot_uid: "b1", mode: "auto", global_enabled: true, active: true }
        // 返回别的 channel 的 scope，不匹配本 vm 的 ch-1。
        hoisted.get.mockResolvedValueOnce([grant])
        hoisted.get.mockResolvedValueOnce([
            { id: 11, grant_id: 7, channel_id: "ch-other", channel_type: 1, enabled: true },
        ])
        const vm: any = makeVM()
        await vm.refreshOboScope()
        expect(vm._oboScope).toBeNull()
        expect(vm._oboScopeLoaded).toBe(true)
    })
})

describe("ChannelSettingVM.didUnMount — async safety", () => {
    it("after dispose, late-resolving refreshOboScope does not notify listener", async () => {
        const vm: any = makeVM()
        const notifySpy = vi.spyOn(vm, "notifyListener")
        // 一个永不 resolve 的 promise；先调，再 dispose，再让它 resolve。
        let resolveGrants: (v: any) => void = () => {}
        hoisted.get.mockImplementationOnce(() => new Promise((r) => { resolveGrants = r }))
        const p = vm.refreshOboScope()
        vm.didUnMount()
        // dispose 之后 resolve grants — 后续不应该再 notify / 改状态。
        resolveGrants([])
        await p
        expect(notifySpy).not.toHaveBeenCalled()
        expect(vm._oboScopeLoaded).toBe(false)
    })
})
