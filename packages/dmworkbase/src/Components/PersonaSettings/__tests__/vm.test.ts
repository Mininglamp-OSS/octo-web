/**
 * PersonaSettings VM 行为单测。
 *
 * 覆盖任务（YUJ-1168 / GH octo-web#46 §3 验收）：
 *   1. loadGrants 成功 → grants 填充, loading 复位
 *   2. loadGrants 网络/服务端 500 → loadError=true, **不 Toast**
 *   3. loadGrants 404（PR-A 未 merge 兼容态）→ isBackendMissing=true,
 *      loadError 保持 false（用户文案不同）
 *   4. createGrant 成功 → 自动重拉 grants, 返回创建的 grant
 *   5. createGrant 失败 → Toast.error 提示, 返回 undefined
 *   6. deleteGrant 成功 → 自动重拉 grants
 *   7. updateGrant 走 PUT, 成功后重拉
 *   8. PersonaEditVM:
 *      - loadScopes 成功 → scopes 填充
 *      - toggleGlobal 成功 → grant.global_enabled 立即更新（乐观）
 *      - addScope / removeScope 走对应 endpoint
 *   9. hasAnyActiveGrant / refreshActiveGrantCache 缓存合流:
 *      并发调用只触发一次 GET。
 *
 * 实现注意（与 MeInfo/vm.test.tsx 同款）：
 *   - 用 vi.hoisted 提升 apiClient mock 到 import 前, 避免 TDZ
 *   - mock 整个 wukongimjssdk / @douyinfe/semi-ui, 防 jsdom 误启 SDK
 *   - mock WKApp 顶层模块, 避免连带 App.tsx 一长串副作用
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const hoisted = vi.hoisted(() => {
    const get = vi.fn()
    const post = vi.fn()
    const del = vi.fn()
    const put = vi.fn()
    const toastError = vi.fn()
    const toastWarning = vi.fn()
    return { get, post, del, put, toastError, toastWarning }
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
            currentSpaceId: "",
        },
    },
    __esModule: true,
}))

vi.mock("@douyinfe/semi-ui", () => ({
    Toast: {
        error: hoisted.toastError,
        warning: hoisted.toastWarning,
    },
}))

import {
    PersonaSettingsVM,
    PersonaEditVM,
    refreshActiveGrantCache,
    hasAnyActiveGrant,
    clearPersonaActiveCache,
    __testing,
} from "../vm"

beforeEach(() => {
    hoisted.get.mockReset()
    hoisted.post.mockReset()
    hoisted.del.mockReset()
    hoisted.put.mockReset()
    hoisted.toastError.mockReset()
    hoisted.toastWarning.mockReset()
    clearPersonaActiveCache()
    __testing.setCache(undefined)
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe("PersonaSettingsVM.loadGrants", () => {
    it("populates grants on success and resets loading", async () => {
        const grants = [
            { id: 1, grantor_uid: "u1", grantee_bot_uid: "b1", mode: "auto", global_enabled: true, active: true },
        ]
        hoisted.get.mockResolvedValueOnce(grants)
        const vm = new PersonaSettingsVM()
        await vm.loadGrants()
        expect(vm.grants).toEqual(grants)
        expect(vm.loading).toBe(false)
        expect(vm.loadError).toBe(false)
        expect(vm.isBackendMissing).toBe(false)
        expect(hoisted.get).toHaveBeenCalledWith("/v1/obo/grants")
    })

    it("marks isBackendMissing on 404 without toasting", async () => {
        // APIClient interceptor rejects with { error, msg, status }
        hoisted.get.mockRejectedValueOnce({ status: 404, msg: "not found" })
        const vm = new PersonaSettingsVM()
        await vm.loadGrants()
        expect(vm.isBackendMissing).toBe(true)
        expect(vm.loadError).toBe(false)
        expect(vm.grants).toEqual([])
        expect(hoisted.toastError).not.toHaveBeenCalled()
    })

    it("marks loadError on non-404 errors without toasting", async () => {
        hoisted.get.mockRejectedValueOnce({ status: 500, msg: "boom" })
        const vm = new PersonaSettingsVM()
        await vm.loadGrants()
        expect(vm.loadError).toBe(true)
        expect(vm.isBackendMissing).toBe(false)
        expect(vm.grants).toEqual([])
        expect(hoisted.toastError).not.toHaveBeenCalled()
    })

    it("treats non-array response as empty grants list (defensive)", async () => {
        hoisted.get.mockResolvedValueOnce(null as any)
        const vm = new PersonaSettingsVM()
        await vm.loadGrants()
        expect(vm.grants).toEqual([])
        expect(vm.loadError).toBe(false)
    })
})

describe("PersonaSettingsVM.createGrant", () => {
    it("posts with mode=auto + global_enabled=false defaults, then reloads list", async () => {
        const created = { id: 7, grantor_uid: "u1", grantee_bot_uid: "b1", mode: "auto", global_enabled: false, active: true }
        hoisted.post.mockResolvedValueOnce(created)
        hoisted.get.mockResolvedValueOnce([created])
        const vm = new PersonaSettingsVM()
        const out = await vm.createGrant("b1")
        expect(out).toEqual(created)
        expect(hoisted.post).toHaveBeenCalledWith("/v1/obo/grants", {
            grantee_bot_uid: "b1",
            mode: "auto",
            global_enabled: false,
        })
        expect(hoisted.get).toHaveBeenCalledWith("/v1/obo/grants")
        expect(vm.grants).toEqual([created])
    })

    it("toasts and returns undefined on failure", async () => {
        hoisted.post.mockRejectedValueOnce({ status: 400, msg: "bad" })
        const vm = new PersonaSettingsVM()
        const out = await vm.createGrant("b1")
        expect(out).toBeUndefined()
        expect(hoisted.toastError).toHaveBeenCalledWith("bad")
    })

    // Round-2 nit (yujiawei R2 / YUJ-1193): createGrant 成功后必须清掉 myBots，
    // 否则用户「+ 新建分身 → 选 bot → 创建 → pop → 再 + 新建分身」时 PersonaCreate
    // 的 useEffect `length===0` 守卫不再触发 loadMyBots，picker 里还能看到刚绑过
    // 的 bot → duplicate POST。
    it("clears myBots after successful create so the bot picker re-fetches next time", async () => {
        const created = { id: 7, grantor_uid: "u1", grantee_bot_uid: "b1", mode: "auto", global_enabled: false, active: true }
        hoisted.post.mockResolvedValueOnce(created)
        hoisted.get.mockResolvedValueOnce([created])
        const vm = new PersonaSettingsVM()
        // 模拟用户已经浏览过 PersonaCreate，myBots 被填充
        vm.myBots = [{ uid: "b1", name: "Bot 1" }, { uid: "b2", name: "Bot 2" }]
        await vm.createGrant("b1")
        expect(vm.myBots).toEqual([])
    })
})

describe("PersonaSettingsVM.deleteGrant / updateGrant", () => {
    it("delete calls DELETE /v1/obo/grants/:id and reloads", async () => {
        hoisted.del.mockResolvedValueOnce({})
        hoisted.get.mockResolvedValueOnce([])
        const vm = new PersonaSettingsVM()
        const ok = await vm.deleteGrant(42)
        expect(ok).toBe(true)
        expect(hoisted.del).toHaveBeenCalledWith("/v1/obo/grants/42")
        expect(hoisted.get).toHaveBeenCalledWith("/v1/obo/grants")
    })

    it("update calls PUT with patch object", async () => {
        hoisted.put.mockResolvedValueOnce({})
        hoisted.get.mockResolvedValueOnce([])
        const vm = new PersonaSettingsVM()
        const ok = await vm.updateGrant(42, { global_enabled: true })
        expect(ok).toBe(true)
        expect(hoisted.put).toHaveBeenCalledWith("/v1/obo/grants/42", { global_enabled: true })
    })

    it("delete returns false and toasts on error", async () => {
        hoisted.del.mockRejectedValueOnce({ status: 500, msg: "oops" })
        const vm = new PersonaSettingsVM()
        const ok = await vm.deleteGrant(42)
        expect(ok).toBe(false)
        expect(hoisted.toastError).toHaveBeenCalledWith("oops")
    })
})

describe("PersonaEditVM", () => {
    const grant = { id: 99, grantor_uid: "u1", grantee_bot_uid: "b1", mode: "auto" as const, global_enabled: false, active: true }

    it("loadScopes populates scopes and clears flags", async () => {
        const scopes = [{ id: 11, grant_id: 99, channel_id: "c1", channel_type: 2, enabled: true }]
        hoisted.get.mockResolvedValueOnce(scopes)
        const vm = new PersonaEditVM(grant)
        await vm.loadScopes()
        expect(vm.scopes).toEqual(scopes)
        expect(hoisted.get).toHaveBeenCalledWith("/v1/obo/grants/99/scopes")
    })

    it("loadScopes 404 → isBackendMissing", async () => {
        hoisted.get.mockRejectedValueOnce({ status: 404 })
        const vm = new PersonaEditVM(grant)
        await vm.loadScopes()
        expect(vm.isBackendMissing).toBe(true)
        expect(vm.loadError).toBe(false)
    })

    it("toggleGlobal posts PUT and updates local grant optimistically", async () => {
        hoisted.put.mockResolvedValueOnce({})
        const vm = new PersonaEditVM(grant)
        const ok = await vm.toggleGlobal(true)
        expect(ok).toBe(true)
        expect(vm.grant.global_enabled).toBe(true)
        expect(hoisted.put).toHaveBeenCalledWith("/v1/obo/grants/99", { global_enabled: true })
    })

    it("addScope POST then reloads", async () => {
        hoisted.post.mockResolvedValueOnce({})
        hoisted.get.mockResolvedValueOnce([])
        const vm = new PersonaEditVM(grant)
        const ok = await vm.addScope("c1", 2)
        expect(ok).toBe(true)
        expect(hoisted.post).toHaveBeenCalledWith("/v1/obo/scopes", {
            grant_id: 99,
            channel_id: "c1",
            channel_type: 2,
            enabled: true,
        })
    })

    it("removeScope DELETE then reloads", async () => {
        hoisted.del.mockResolvedValueOnce({})
        hoisted.get.mockResolvedValueOnce([])
        const vm = new PersonaEditVM(grant)
        const ok = await vm.removeScope(11)
        expect(ok).toBe(true)
        expect(hoisted.del).toHaveBeenCalledWith("/v1/obo/scopes/11")
    })

    it("deleteGrant DELETE /v1/obo/grants/:id", async () => {
        hoisted.del.mockResolvedValueOnce({})
        const vm = new PersonaEditVM(grant)
        const ok = await vm.deleteGrant()
        expect(ok).toBe(true)
        expect(hoisted.del).toHaveBeenCalledWith("/v1/obo/grants/99")
    })
})

describe("refreshActiveGrantCache (module-level)", () => {
    it("returns true when at least one grant is active + global_enabled", async () => {
        hoisted.get.mockResolvedValueOnce([
            { id: 1, grantor_uid: "u1", grantee_bot_uid: "b1", mode: "auto", global_enabled: true, active: true },
        ])
        const v = await refreshActiveGrantCache()
        expect(v).toBe(true)
        expect(hasAnyActiveGrant()).toBe(true)
    })

    // P1-2 (YUJ-1178): cache predicate is now "any active grant" — global_enabled
    // is intentionally decoupled. A user who created a grant with global off and
    // is only using per-channel scopes still has an active grant, so ChannelSetting
    // toggle MUST be visible. This is the regression that the original
    // `g.active && g.global_enabled` predicate caused.
    it("returns true when a grant is active even if global_enabled=false (P1-2 regression guard)", async () => {
        hoisted.get.mockResolvedValueOnce([
            { id: 1, grantor_uid: "u1", grantee_bot_uid: "b1", mode: "auto", global_enabled: false, active: true },
        ])
        const v = await refreshActiveGrantCache()
        expect(v).toBe(true)
        expect(hasAnyActiveGrant()).toBe(true)
    })

    it("returns false when no grants are active", async () => {
        hoisted.get.mockResolvedValueOnce([
            { id: 1, grantor_uid: "u1", grantee_bot_uid: "b1", mode: "auto", global_enabled: true, active: false },
        ])
        const v = await refreshActiveGrantCache()
        expect(v).toBe(false)
        expect(hasAnyActiveGrant()).toBe(false)
    })

    it("returns false when grants list is empty", async () => {
        hoisted.get.mockResolvedValueOnce([])
        const v = await refreshActiveGrantCache()
        expect(v).toBe(false)
        expect(hasAnyActiveGrant()).toBe(false)
    })

    it("returns false on 404 without crashing (PR-A not yet merged)", async () => {
        hoisted.get.mockRejectedValueOnce({ status: 404 })
        const v = await refreshActiveGrantCache()
        expect(v).toBe(false)
        expect(hasAnyActiveGrant()).toBe(false)
    })

    it("collapses concurrent calls to a single HTTP request (in-flight dedup)", async () => {
        let resolve: (v: any) => void = () => {}
        hoisted.get.mockImplementationOnce(() => new Promise((r) => { resolve = r }))
        const p1 = refreshActiveGrantCache()
        const p2 = refreshActiveGrantCache()
        expect(hoisted.get).toHaveBeenCalledTimes(1)
        resolve([])
        await Promise.all([p1, p2])
        expect(hoisted.get).toHaveBeenCalledTimes(1)
    })

    // YUJ-1178 nit: in-flight slot must be cleared on the error path too,
    // otherwise the next call would observe a stale (but settled) promise.
    it("clears in-flight slot on error so the next call can re-fetch", async () => {
        hoisted.get.mockRejectedValueOnce({ status: 500, msg: "boom" })
        await refreshActiveGrantCache()
        expect(__testing.inFlightCount()).toBe(0)
        // Next call must trigger a fresh GET, not return the previous (settled) promise.
        hoisted.get.mockResolvedValueOnce([
            { id: 1, grantor_uid: "u1", grantee_bot_uid: "b1", mode: "auto", global_enabled: false, active: true },
        ])
        const v2 = await refreshActiveGrantCache()
        expect(v2).toBe(true)
        expect(hoisted.get).toHaveBeenCalledTimes(2)
    })

    // YUJ-1178 nit: cache is bucketed by current grantor uid so that an SPA-internal
    // account switch (if/when it lands) can't leak the previous user's answer.
    it("buckets cache by grantor uid (multi-account safety)", () => {
        __testing.setCacheForUid("alice", true)
        __testing.setCacheForUid("bob", false)
        expect(__testing.getCacheForUid("alice")).toBe(true)
        expect(__testing.getCacheForUid("bob")).toBe(false)
        clearPersonaActiveCache()
        expect(__testing.getCacheForUid("alice")).toBeUndefined()
        expect(__testing.getCacheForUid("bob")).toBeUndefined()
    })
})
