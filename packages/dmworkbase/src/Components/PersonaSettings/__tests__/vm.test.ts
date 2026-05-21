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
        // YUJ-1444: loadMyBots needs loginInfo.uid to filter `space_bots` by creator.
        // Tests mutate this property directly to flip "logged in as alice" etc.
        loginInfo: {
            uid: "",
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
        expect(hoisted.get).toHaveBeenCalledWith("obo/grants")
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
        expect(hoisted.post).toHaveBeenCalledWith("obo/grants", {
            grantee_bot_uid: "b1",
            mode: "auto",
            global_enabled: false,
        })
        expect(hoisted.get).toHaveBeenCalledWith("obo/grants")
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

    // v2 (octo-web#73): personaPrompt argument hits POST body when non-empty;
    // empty / whitespace input is filtered so it doesn't overwrite the server's
    // NULL default (fan-out logic distinguishes "" from NULL when assembling
    // the system prompt).
    it("sends persona_prompt in POST body when provided (v2 octo-web#73)", async () => {
        const created = { id: 8, grantor_uid: "u1", grantee_bot_uid: "b1", mode: "auto", global_enabled: false, active: false }
        hoisted.post.mockResolvedValueOnce(created)
        hoisted.get.mockResolvedValueOnce([created])
        const vm = new PersonaSettingsVM()
        await vm.createGrant("b1", "用简洁专业的语气回复")
        expect(hoisted.post).toHaveBeenCalledWith("obo/grants", {
            grantee_bot_uid: "b1",
            mode: "auto",
            global_enabled: false,
            persona_prompt: "用简洁专业的语气回复",
        })
    })

    it("trims persona_prompt and omits when blank (v2 octo-web#73)", async () => {
        // 用户没填 prompt → 不要把 "" 提交进 body 把后端 NULL 覆盖成 ''。
        hoisted.post.mockResolvedValueOnce({})
        hoisted.get.mockResolvedValueOnce([])
        const vm = new PersonaSettingsVM()
        await vm.createGrant("b1", "   ")
        expect(hoisted.post).toHaveBeenCalledWith("obo/grants", {
            grantee_bot_uid: "b1",
            mode: "auto",
            global_enabled: false,
        })
    })
})

describe("PersonaSettingsVM.deleteGrant / updateGrant", () => {
    it("delete calls DELETE /v1/obo/grants/:id and reloads", async () => {
        hoisted.del.mockResolvedValueOnce({})
        hoisted.get.mockResolvedValueOnce([])
        const vm = new PersonaSettingsVM()
        const ok = await vm.deleteGrant(42)
        expect(ok).toBe(true)
        expect(hoisted.del).toHaveBeenCalledWith("obo/grants/42")
        expect(hoisted.get).toHaveBeenCalledWith("obo/grants")
    })

    it("update calls PUT with patch object", async () => {
        hoisted.put.mockResolvedValueOnce({})
        hoisted.get.mockResolvedValueOnce([])
        const vm = new PersonaSettingsVM()
        const ok = await vm.updateGrant(42, { global_enabled: true })
        expect(ok).toBe(true)
        expect(hoisted.put).toHaveBeenCalledWith("obo/grants/42", { global_enabled: true })
    })

    // v2 (octo-web#73): updateGrant now accepts `active` so PersonaCard toggle
    // can flip it; backend (octo-server#108) performs mutual exclusion across
    // the user's grants — the frontend just sends one PUT.
    it("update accepts {active:true} and reloads list (backend handles mutex)", async () => {
        hoisted.put.mockResolvedValueOnce({})
        hoisted.get.mockResolvedValueOnce([
            { id: 42, grantor_uid: "u1", grantee_bot_uid: "b1", mode: "auto", global_enabled: false, active: true },
        ])
        const vm = new PersonaSettingsVM()
        const ok = await vm.updateGrant(42, { active: true })
        expect(ok).toBe(true)
        expect(hoisted.put).toHaveBeenCalledWith("obo/grants/42", { active: true })
        // 必须 reload，因为后端 mutex 把别的 grant 改成 inactive 了，前端这里看不见。
        expect(hoisted.get).toHaveBeenCalledWith("obo/grants")
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
        expect(hoisted.get).toHaveBeenCalledWith("obo/grants/99/scopes")
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
        expect(hoisted.put).toHaveBeenCalledWith("obo/grants/99", { global_enabled: true })
    })

    it("addScope POST then reloads", async () => {
        hoisted.post.mockResolvedValueOnce({})
        hoisted.get.mockResolvedValueOnce([])
        const vm = new PersonaEditVM(grant)
        const ok = await vm.addScope("c1", 2)
        expect(ok).toBe(true)
        expect(hoisted.post).toHaveBeenCalledWith("obo/scopes", {
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
        expect(hoisted.del).toHaveBeenCalledWith("obo/scopes/11")
    })

    it("deleteGrant DELETE /v1/obo/grants/:id", async () => {
        hoisted.del.mockResolvedValueOnce({})
        const vm = new PersonaEditVM(grant)
        const ok = await vm.deleteGrant()
        expect(ok).toBe(true)
        expect(hoisted.del).toHaveBeenCalledWith("obo/grants/99")
    })

    // v2 (octo-web#73): savePersonaForm puts persona_prompt + active in one round-trip
    // and updates local grant optimistically. This is the primary write path for the
    // PersonaEdit form's "保存" button.
    describe("savePersonaForm (v2 octo-web#73)", () => {
        it("PUTs persona_prompt + active together and updates local grant", async () => {
            hoisted.put.mockResolvedValueOnce({})
            const vm = new PersonaEditVM(grant)
            const ok = await vm.savePersonaForm("用简洁专业的语气回复", true)
            expect(ok).toBe(true)
            expect(hoisted.put).toHaveBeenCalledWith("obo/grants/99", {
                persona_prompt: "用简洁专业的语气回复",
                active: true,
            })
            // 本地乐观更新：避免 UI 还显示旧值等到 reload。
            expect(vm.grant.persona_prompt).toBe("用简洁专业的语气回复")
            expect(vm.grant.active).toBe(true)
        })

        it("allows empty string prompt (user explicitly clearing previously set prompt)", async () => {
            // 边界：编辑场景下空串不应被过滤 —— 用户的真实意图就是「清掉之前写的 prompt」。
            // 这与 createGrant 的策略相反（创建时空串意味着「我还没填」→ 过滤）。
            hoisted.put.mockResolvedValueOnce({})
            const vm = new PersonaEditVM({ ...grant, persona_prompt: "old style" })
            const ok = await vm.savePersonaForm("", false)
            expect(ok).toBe(true)
            expect(hoisted.put).toHaveBeenCalledWith("obo/grants/99", {
                persona_prompt: "",
                active: false,
            })
            expect(vm.grant.persona_prompt).toBe("")
            expect(vm.grant.active).toBe(false)
        })

        it("omits active when not provided (prompt-only save)", async () => {
            hoisted.put.mockResolvedValueOnce({})
            const vm = new PersonaEditVM(grant)
            await vm.savePersonaForm("hello")
            expect(hoisted.put).toHaveBeenCalledWith("obo/grants/99", {
                persona_prompt: "hello",
            })
            expect(vm.grant.active).toBe(grant.active) // unchanged
        })

        it("returns false + toasts on failure", async () => {
            hoisted.put.mockRejectedValueOnce({ status: 500, msg: "save boom" })
            const vm = new PersonaEditVM(grant)
            const ok = await vm.savePersonaForm("x", true)
            expect(ok).toBe(false)
            expect(hoisted.toastError).toHaveBeenCalledWith("save boom")
        })
    })
})

describe("PersonaSettingsVM.loadMyBots — Bug 3 (YUJ-1444): merges my_bots + owned space_bots", () => {
    // 拿到模块默认导出的 mock，方便测试动态改 currentSpaceId / loginInfo.uid。
    // 在所有 mock 注册之后再 import，保证拿到 vi.mock 注入的对象（不是真实 App）。
    const getApp = async () => (await import("../../../App")).default as any

    beforeEach(async () => {
        const App = await getApp()
        App.shared.currentSpaceId = ""
        App.loginInfo.uid = ""
    })

    it("space_id absent: only calls /robot/my_bots, no /robot/space_bots", async () => {
        // 模拟用户未进入任何 space —— 老路径：只问 my_bots。
        hoisted.get.mockResolvedValueOnce([
            { uid: "b1", name: "Bot 1" },
        ])
        const vm = new PersonaSettingsVM()
        await vm.loadMyBots()
        expect(hoisted.get).toHaveBeenCalledTimes(1)
        expect(hoisted.get).toHaveBeenCalledWith("/robot/my_bots", undefined)
        expect(vm.myBots.map((b) => b.uid)).toEqual(["b1"])
    })

    it("space_id present: queries BOTH /robot/my_bots AND /robot/space_bots", async () => {
        const App = await getApp()
        App.shared.currentSpaceId = "spaceA"
        App.loginInfo.uid = "alice"

        // my_bots 命中：用户已加好友的 bot
        hoisted.get.mockResolvedValueOnce([
            { uid: "friend_bot", name: "FriendBot" },
        ])
        // space_bots 命中：包含 alice 创建的 + 别人创建的；只有 alice 创建的应进入 picker
        hoisted.get.mockResolvedValueOnce([
            { uid: "owned_bot", name: "OwnedBot", creator_uid: "alice" },
            { uid: "other_bot", name: "OtherBot", creator_uid: "bob" },
        ])

        const vm = new PersonaSettingsVM()
        await vm.loadMyBots()

        expect(hoisted.get).toHaveBeenCalledWith("/robot/my_bots", { param: { space_id: "spaceA" } })
        expect(hoisted.get).toHaveBeenCalledWith("/robot/space_bots", { param: { space_id: "spaceA" } })

        const uids = vm.myBots.map((b) => b.uid).sort()
        // friend_bot 来自 my_bots; owned_bot 来自 space_bots(creator=alice); other_bot 被过滤掉
        expect(uids).toEqual(["friend_bot", "owned_bot"])
    })

    it("filters out bots already granted to a persona", async () => {
        const App = await getApp()
        App.shared.currentSpaceId = "spaceA"
        App.loginInfo.uid = "alice"

        hoisted.get.mockResolvedValueOnce([
            { uid: "b1", name: "Bot 1" },
            { uid: "b2", name: "Bot 2" },
        ])
        hoisted.get.mockResolvedValueOnce([
            { uid: "b3", name: "Bot 3", creator_uid: "alice" },
        ])

        const vm = new PersonaSettingsVM()
        // 用户已经把 b1 绑给某个 persona —— picker 不应再列出 b1。
        vm.grants = [
            { id: 1, grantor_uid: "alice", grantee_bot_uid: "b1", mode: "auto", global_enabled: false, active: true },
        ]
        await vm.loadMyBots()
        expect(vm.myBots.map((b) => b.uid).sort()).toEqual(["b2", "b3"])
    })

    it("dedupes bots that appear in BOTH my_bots and space_bots (intersection case)", async () => {
        const App = await getApp()
        App.shared.currentSpaceId = "spaceA"
        App.loginInfo.uid = "alice"

        // 同一个 bot 同时在 my_bots（已加好友）和 space_bots（alice 创建）出现 —— 必须去重。
        hoisted.get.mockResolvedValueOnce([
            { uid: "shared_bot", name: "Shared (from my_bots)" },
        ])
        hoisted.get.mockResolvedValueOnce([
            { uid: "shared_bot", name: "Shared (from space_bots)", creator_uid: "alice" },
        ])

        const vm = new PersonaSettingsVM()
        await vm.loadMyBots()
        expect(vm.myBots).toHaveLength(1)
        // 先到先得 → my_bots 的元数据胜出
        expect(vm.myBots[0]).toMatchObject({ uid: "shared_bot", name: "Shared (from my_bots)" })
    })

    it("my_bots fails: still returns owned bots from space_bots (graceful degrade)", async () => {
        const App = await getApp()
        App.shared.currentSpaceId = "spaceA"
        App.loginInfo.uid = "alice"

        hoisted.get.mockRejectedValueOnce({ status: 500, msg: "my_bots boom" })
        hoisted.get.mockResolvedValueOnce([
            { uid: "owned_only", name: "OwnedOnly", creator_uid: "alice" },
        ])

        const vm = new PersonaSettingsVM()
        await vm.loadMyBots()
        // 单端失败不弹 Toast — 这是 picker 子页，文案已能告知用户。
        expect(hoisted.toastError).not.toHaveBeenCalled()
        expect(vm.myBots.map((b) => b.uid)).toEqual(["owned_only"])
    })

    it("space_bots fails: still returns my_bots", async () => {
        const App = await getApp()
        App.shared.currentSpaceId = "spaceA"
        App.loginInfo.uid = "alice"

        hoisted.get.mockResolvedValueOnce([
            { uid: "friend_only", name: "FriendOnly" },
        ])
        hoisted.get.mockRejectedValueOnce({ status: 500, msg: "space_bots boom" })

        const vm = new PersonaSettingsVM()
        await vm.loadMyBots()
        expect(hoisted.toastError).not.toHaveBeenCalled()
        expect(vm.myBots.map((b) => b.uid)).toEqual(["friend_only"])
    })

    it("both endpoints fail: myBots=[] without throwing or toasting", async () => {
        const App = await getApp()
        App.shared.currentSpaceId = "spaceA"
        App.loginInfo.uid = "alice"

        hoisted.get.mockRejectedValueOnce({ status: 500 })
        hoisted.get.mockRejectedValueOnce({ status: 500 })

        const vm = new PersonaSettingsVM()
        await vm.loadMyBots()
        expect(vm.myBots).toEqual([])
        expect(hoisted.toastError).not.toHaveBeenCalled()
        expect(vm.myBotsLoading).toBe(false)
    })

    it("loginInfo.uid empty: skips creator_uid filter (no owned bots claimed)", async () => {
        // 边界：loginInfo 还没 ready 时，宁可空 picker 也不要把别人的 bot 列出来。
        const App = await getApp()
        App.shared.currentSpaceId = "spaceA"
        App.loginInfo.uid = ""

        hoisted.get.mockResolvedValueOnce([])
        hoisted.get.mockResolvedValueOnce([
            { uid: "owned_bot", name: "OwnedBot", creator_uid: "alice" },
        ])

        const vm = new PersonaSettingsVM()
        await vm.loadMyBots()
        // creator_uid 过滤无法判断「是不是我」→ 整段 ownedSpaceBots 留空，picker 空态。
        expect(vm.myBots).toEqual([])
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
