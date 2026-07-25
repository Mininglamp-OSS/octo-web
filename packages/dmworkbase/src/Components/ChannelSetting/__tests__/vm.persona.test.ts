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

vi.mock("../../../Service/APIClient", () => ({
    default: {
        shared: {
            get: hoisted.get,
            post: hoisted.post,
            delete: hoisted.del,
            put: hoisted.put,
        },
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

/**
 * Round-2 P1 (YUJ-1193 / PR #47): toggle `checked` 与 `toggleOboScope` 的完整状态机。
 *
 * 4 个矩阵组合 (global × scope) — 全部锁住：
 *   1. global=true,  scope=null         → checked=true,  click off  → POST {enabled:false}
 *   2. global=true,  scope={enabled:F}  → checked=false, click on   → DELETE 旧 scope，无 POST（回退到 global=true 生效）
 *   3. global=false, scope=null         → checked=false, click on   → POST {enabled:true}
 *   4. global=false, scope={enabled:T}  → checked=true,  click off  → DELETE 旧 scope，无 POST（global=false 即 OFF）
 *
 * 旧实现 bug：
 *   - checked = !!(scope && scope.enabled) → case 1 渲染成 OFF，与 effective ON 矛盾。
 *   - toggleOboScope(false, no scope) → 直接 no-op，case 1 用户根本无法表达「排除此 channel」。
 *
 * 共同 mock 约定（task §1 spec #5）：toggleOboScope 成功后会再调 refreshOboScope 一次，
 * 因此每个测试需 mock toggle 期间的 DELETE/POST + 之后的 refresh（grants + scopes）。
 */
describe("ChannelSettingVM.toggleOboScope — Round-2 P1 state machine", () => {
    // 直接 stub vm 内部状态，跳过初始 refreshOboScope，让测试聚焦在 toggle 行为上。
    function primeVM(opts: {
        globalEnabled: boolean
        scope: { id: number; enabled: boolean } | null
    }) {
        const vm: any = makeVM()
        vm._activeGrantId = 7
        vm._activeGrantGlobalEnabled = opts.globalEnabled
        vm._oboScopeLoaded = true
        vm._oboScope = opts.scope
            ? { id: opts.scope.id, grant_id: 7, channel_id: "ch-1", channel_type: 1, enabled: opts.scope.enabled }
            : null
        return vm
    }

    // refreshOboScope 在每次 toggle 末尾被 await，这里给一个能让它走 happy-path 的回应。
    function mockTrailingRefresh(grant: { active: boolean; global_enabled: boolean }, scopes: any[] = []) {
        hoisted.get.mockResolvedValueOnce([
            { id: 7, grantor_uid: "alice", grantee_bot_uid: "b1", mode: "auto", ...grant },
        ])
        hoisted.get.mockResolvedValueOnce(scopes)
    }

    it("Case 1: global=true, no scope → checked=true; click off POSTs enabled=false", async () => {
        setHasGrant(true)
        const vm = primeVM({ globalEnabled: true, scope: null })
        // checked 渲染断言
        const section = vm.buildPersonaSection()
        expect(section).toBeDefined()
        expect(section.rows[0].properties.checked).toBe(true)

        // click off → POST exclusion
        const created = { id: 99, grant_id: 7, channel_id: "ch-1", channel_type: 1, enabled: false }
        hoisted.post.mockResolvedValueOnce(created)
        // trailing refresh after toggle: server reflects exclusion
        mockTrailingRefresh({ active: true, global_enabled: true }, [created])

        await vm.toggleOboScope(false)

        // 唯一一次 POST，且 body 是 enabled=false 的排除记录
        expect(hoisted.post).toHaveBeenCalledTimes(1)
        const [url, body] = hoisted.post.mock.calls[0]
        expect(url).toBe("obo/scopes")
        expect(body).toMatchObject({
            grant_id: 7,
            channel_id: "ch-1",
            channel_type: 1,
            enabled: false,
        })
        expect(hoisted.del).not.toHaveBeenCalled()
        // 末态：scope 是 enabled=false 的排除记录
        expect(vm._oboScope).toMatchObject({ enabled: false })
    })

    it("Case 2: global=true, scope={enabled:false} → checked=false; click on DELETEs scope (global takes over)", async () => {
        setHasGrant(true)
        const vm = primeVM({ globalEnabled: true, scope: { id: 50, enabled: false } })
        const section = vm.buildPersonaSection()
        expect(section.rows[0].properties.checked).toBe(false)

        hoisted.del.mockResolvedValueOnce(undefined)
        // trailing refresh: server now has no scope, global=true → effective ON
        mockTrailingRefresh({ active: true, global_enabled: true }, [])

        await vm.toggleOboScope(true)

        expect(hoisted.del).toHaveBeenCalledTimes(1)
        expect(hoisted.del.mock.calls[0][0]).toBe("obo/scopes/50")
        // 删除后，因为 enable(true) === global(true)，不再 POST 新 scope
        expect(hoisted.post).not.toHaveBeenCalled()
        expect(vm._oboScope).toBeNull()
        // 末态 checked 也应回到 true
        const after = vm.buildPersonaSection()
        expect(after.rows[0].properties.checked).toBe(true)
    })

    it("Case 3: global=false, no scope → checked=false; click on POSTs enabled=true", async () => {
        setHasGrant(true)
        const vm = primeVM({ globalEnabled: false, scope: null })
        const section = vm.buildPersonaSection()
        expect(section.rows[0].properties.checked).toBe(false)

        const created = { id: 77, grant_id: 7, channel_id: "ch-1", channel_type: 1, enabled: true }
        hoisted.post.mockResolvedValueOnce(created)
        mockTrailingRefresh({ active: true, global_enabled: false }, [created])

        await vm.toggleOboScope(true)

        expect(hoisted.post).toHaveBeenCalledTimes(1)
        const [url, body] = hoisted.post.mock.calls[0]
        expect(url).toBe("obo/scopes")
        expect(body).toMatchObject({
            grant_id: 7,
            channel_id: "ch-1",
            channel_type: 1,
            enabled: true,
        })
        expect(hoisted.del).not.toHaveBeenCalled()
        expect(vm._oboScope).toMatchObject({ enabled: true })
    })

    it("Case 4: global=false, scope={enabled:true} → checked=true; click off DELETEs scope (global already off)", async () => {
        setHasGrant(true)
        const vm = primeVM({ globalEnabled: false, scope: { id: 60, enabled: true } })
        const section = vm.buildPersonaSection()
        expect(section.rows[0].properties.checked).toBe(true)

        hoisted.del.mockResolvedValueOnce(undefined)
        // trailing refresh: scope deleted, global still off → effective OFF
        mockTrailingRefresh({ active: true, global_enabled: false }, [])

        await vm.toggleOboScope(false)

        expect(hoisted.del).toHaveBeenCalledTimes(1)
        expect(hoisted.del.mock.calls[0][0]).toBe("obo/scopes/60")
        // enable(false) === global(false) → 删除后无需 POST
        expect(hoisted.post).not.toHaveBeenCalled()
        expect(vm._oboScope).toBeNull()
        const after = vm.buildPersonaSection()
        expect(after.rows[0].properties.checked).toBe(false)
    })

    it("refreshOboScope persists global_enabled into _activeGrantGlobalEnabled", async () => {
        // 端到端验证 P1：refreshOboScope 必须把 global_enabled 保存到 _activeGrantGlobalEnabled。
        hoisted.get.mockResolvedValueOnce([
            { id: 7, grantor_uid: "alice", grantee_bot_uid: "b1", mode: "auto", global_enabled: true, active: true },
        ])
        hoisted.get.mockResolvedValueOnce([])
        const vm: any = makeVM()
        await vm.refreshOboScope()
        expect(vm._activeGrantId).toBe(7)
        expect(vm._activeGrantGlobalEnabled).toBe(true)
        expect(vm._oboScope).toBeNull()
        expect(vm._oboScopeLoaded).toBe(true)

        // 此时 buildPersonaSection 的 checked 必须是 true（不能因 scope=null 就误判 OFF）
        setHasGrant(true)
        const section = vm.buildPersonaSection()
        expect(section).toBeDefined()
        expect(section.rows[0].properties.checked).toBe(true)
    })

    it("refreshOboScope resets _activeGrantGlobalEnabled to false when no active grant exists", async () => {
        hoisted.get.mockResolvedValueOnce([])
        const vm: any = makeVM()
        // 先污染状态：模拟之前曾经有 global=true 的 grant
        vm._activeGrantGlobalEnabled = true
        await vm.refreshOboScope()
        expect(vm._activeGrantId).toBeUndefined()
        expect(vm._activeGrantGlobalEnabled).toBe(false)
    })
})
