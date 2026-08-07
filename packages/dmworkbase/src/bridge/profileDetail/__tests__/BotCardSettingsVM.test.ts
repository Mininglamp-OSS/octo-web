/**
 * BotCardSettingsVM + botCardSettings 行为单测。
 *
 * 覆盖服务端文档里三条最容易踩错的规则，以及围绕它们的错误分支：
 *
 *   1. `effective_value` 未被总闸支配 —— 客户端必须自己 AND `bot.card_enabled`；
 *   2. 一律按 `error.code` 分支（服务端错误的线路状态码被钉成 400，真实 500 在
 *      响应体的 `error.http_status` 里，已由 APIClient 归一化），服务端错误重试；
 *   3. 删除 = 回落上一层，不是设为 false；`value` / `effective_value` / `source`
 *      三字段不能合并，`value !== null` 是「存在覆盖」的唯一判据。
 *
 * mock 策略与 BotManageVM.test.ts 同款（vi.hoisted + mock Service 模块）。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import type { BotSettingItem } from "../../../Service/BotManageService"

const hoisted = vi.hoisted(() => ({
    listSettings: vi.fn(),
    putSettings: vi.fn(),
    deleteSetting: vi.fn(),
}))

vi.mock("../../../Service/BotManageService", () => ({
    default: {
        listSettings: hoisted.listSettings,
        putSettings: hoisted.putSettings,
        deleteSetting: hoisted.deleteSetting,
    },
}))

import { BotCardSettingsVM } from "../BotCardSettingsVM"
import {
    BOT_CARD_DISPLAY_KEY,
    BOT_CARD_INTERACTION_KEY,
    BOT_CARD_MASTER_KEY,
    BOT_CARD_REASONING_KEY,
    buildRows,
    classifyBotSettingError,
    hasUsableMasterKey,
    indexSettingItems,
    resolveMasterEnabled,
} from "../botCardSettings"

beforeEach(() => {
    hoisted.listSettings.mockReset()
    hoisted.putSettings.mockReset()
    hoisted.deleteSetting.mockReset()
    hoisted.putSettings.mockResolvedValue(undefined)
    hoisted.deleteSetting.mockResolvedValue(undefined)
})

afterEach(() => {
    vi.restoreAllMocks()
})

const tick = (): Promise<void> =>
    new Promise((resolve) => {
        setTimeout(resolve, 0)
    })

/** 构造一条目录项。 */
const item = (
    key: string,
    overrides: Partial<BotSettingItem> = {},
): BotSettingItem => ({
    key,
    type: "bool",
    value: null,
    effective_value: true,
    source: "default",
    editable: true,
    ...overrides,
})

/** 一份「总闸开 + 三项全开、全部继承默认」的目录。 */
const fullCatalog = (
    overrides: Record<string, Partial<BotSettingItem>> = {},
): { list: BotSettingItem[] } => ({
    list: [
        item(BOT_CARD_MASTER_KEY, {
            editable: false,
            source: "env",
            ...overrides[BOT_CARD_MASTER_KEY],
        }),
        item(BOT_CARD_DISPLAY_KEY, overrides[BOT_CARD_DISPLAY_KEY]),
        item(BOT_CARD_INTERACTION_KEY, overrides[BOT_CARD_INTERACTION_KEY]),
        item(BOT_CARD_REASONING_KEY, overrides[BOT_CARD_REASONING_KEY]),
    ],
})

/** APIClient 拦截器 reject 的形状。 */
const rejection = (
    fields: { code?: string; status?: number; details?: Record<string, unknown> },
): unknown => ({
    error: new Error("mock"),
    msg: "mock message",
    ...fields,
})

// ── 纯函数层 ────────────────────────────────────────────────────────────────

describe("buildRows 总闸 AND", () => {
    it("总闸关闭时子开关一律为关且禁用，即使自身 effective_value 是 true", () => {
        const items = indexSettingItems(
            fullCatalog({ [BOT_CARD_MASTER_KEY]: { effective_value: false } }).list,
        )
        const { rows, masterEnabled } = buildRows(items)
        expect(masterEnabled).toBe(false)
        const display = rows.find((row) => row.key === BOT_CARD_DISPLAY_KEY)!
        // 这正是文档警告的场景：直接渲染 effective_value 会显示「开」。
        expect(display.effectiveValue).toBe(true)
        expect(display.checked).toBe(false)
        expect(display.disabled).toBe(true)
    })

    it("总闸开启时 checked 跟随自身 effective_value", () => {
        const items = indexSettingItems(
            fullCatalog({
                [BOT_CARD_REASONING_KEY]: { effective_value: false },
            }).list,
        )
        const { rows } = buildRows(items)
        expect(rows.find((r) => r.key === BOT_CARD_DISPLAY_KEY)!.checked).toBe(true)
        expect(rows.find((r) => r.key === BOT_CARD_REASONING_KEY)!.checked).toBe(
            false,
        )
    })

    it("总闸键缺失时 fail-open（不把整页误置灰），且解析函数保持无副作用", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
        const items = indexSettingItems([item(BOT_CARD_DISPLAY_KEY)])
        expect(resolveMasterEnabled(items)).toBe(true)
        expect(hasUsableMasterKey(items)).toBe(false)
        expect(buildRows(items).rows[0].disabled).toBe(false)
        // 解析在渲染路径上被反复调用，不能在这里打日志（否则每帧刷屏）。
        expect(warn).not.toHaveBeenCalled()
    })

    it("总闸键缺失的告警由 loadSettings 每次拉取打一次", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
        hoisted.listSettings.mockResolvedValueOnce({
            list: [item(BOT_CARD_DISPLAY_KEY)],
        })
        const vm = new BotCardSettingsVM("bot1", { retryDelayMs: 0 })
        await vm.loadSettings()
        expect(warn).toHaveBeenCalledTimes(1)
        // 渲染多次不会追加日志。
        vm.snapshot()
        vm.snapshot()
        expect(warn).toHaveBeenCalledTimes(1)
    })
})

describe("buildRows 目录解析", () => {
    it("跳过未知 key，不影响已知行渲染，且顺序固定为推理→展示→交互", () => {
        const list = [
            ...fullCatalog().list,
            item("bot.some_future_key"),
            item("bot.another_future_key", { type: "int", effective_value: 3 }),
        ]
        const { rows } = buildRows(indexSettingItems(list))
        expect(rows.map((row) => row.key)).toEqual([
            BOT_CARD_REASONING_KEY,
            BOT_CARD_DISPLAY_KEY,
            BOT_CARD_INTERACTION_KEY,
        ])
        // 总闸不作为开关行渲染（不可写，由视图单独渲染成只读状态条）。
        expect(rows.some((row) => row.key === BOT_CARD_MASTER_KEY)).toBe(false)
    })

    it("跳过 type 非 bool 或 effective_value 非 bool 的行", () => {
        const list = [
            item(BOT_CARD_MASTER_KEY, { editable: false, source: "env" }),
            item(BOT_CARD_DISPLAY_KEY, { type: "int", effective_value: 1 }),
            item(BOT_CARD_INTERACTION_KEY, { effective_value: "true" }),
            item(BOT_CARD_REASONING_KEY),
        ]
        const { rows } = buildRows(indexSettingItems(list))
        expect(rows.map((row) => row.key)).toEqual([BOT_CARD_REASONING_KEY])
    })

    it("overridden 只看 value !== null，不看 source", () => {
        const items = indexSettingItems(
            fullCatalog({
                [BOT_CARD_DISPLAY_KEY]: { value: false, source: "bot" },
                // 矛盾形状：source 说是 bot 覆盖，但 value 为 null。
                [BOT_CARD_INTERACTION_KEY]: { value: null, source: "bot" },
            }).list,
        )
        const { rows } = buildRows(items)
        expect(rows.find((r) => r.key === BOT_CARD_DISPLAY_KEY)!.overridden).toBe(
            true,
        )
        expect(
            rows.find((r) => r.key === BOT_CARD_INTERACTION_KEY)!.overridden,
        ).toBe(false)
    })

    it("editable:false 的行禁用（不只对总闸生效，泛化处理）", () => {
        const items = indexSettingItems(
            fullCatalog({
                [BOT_CARD_REASONING_KEY]: { editable: false, source: "env" },
            }).list,
        )
        const { rows } = buildRows(items)
        expect(rows.find((r) => r.key === BOT_CARD_REASONING_KEY)!.disabled).toBe(
            true,
        )
        expect(rows.find((r) => r.key === BOT_CARD_DISPLAY_KEY)!.disabled).toBe(
            false,
        )
    })

    it("展示型卡片关闭时给交互型卡片挂依赖提示，但不改其开关状态", () => {
        const items = indexSettingItems(
            fullCatalog({
                [BOT_CARD_DISPLAY_KEY]: { effective_value: false },
            }).list,
        )
        const { rows } = buildRows(items)
        const interaction = rows.find(
            (row) => row.key === BOT_CARD_INTERACTION_KEY,
        )!
        expect(interaction.needsDisplay).toBe(true)
        // 不自行重组布尔：开关仍显示自身生效值，也仍可写。
        expect(interaction.checked).toBe(true)
        expect(interaction.disabled).toBe(false)
    })
})

describe("classifyBotSettingError", () => {
    it("按 error.code 归类，而不是按 HTTP 状态码", () => {
        // query_failed / store_failed 的线路状态码是 400，真实 500 在
        // error.http_status 里 —— APIClient 已归一化成 status:500，但即使
        // 只看到 400，也必须靠 code 判成「可重试」而不是「参数错了」。
        expect(
            classifyBotSettingError(
                rejection({ code: "err.server.robot.store_failed", status: 400 }),
            ).kind,
        ).toBe("retryable")
        expect(
            classifyBotSettingError(
                rejection({ code: "err.server.robot.query_failed", status: 500 }),
            ).kind,
        ).toBe("retryable")
        expect(
            classifyBotSettingError(
                rejection({ code: "err.shared.internal", status: 400 }),
            ).kind,
        ).toBe("retryable")
    })

    it("区分两种 404：带 not_found code = 不支持，无 code = 后端未部署", () => {
        expect(
            classifyBotSettingError(
                rejection({ code: "err.server.robot.not_found", status: 404 }),
            ).kind,
        ).toBe("unsupported")
        expect(classifyBotSettingError(rejection({ status: 404 })).kind).toBe(
            "backendMissing",
        )
    })

    it("归类属主 / 参数 / 限流错误并带出 details.field", () => {
        expect(
            classifyBotSettingError(
                rejection({ code: "err.server.robot.creator_only", status: 403 }),
            ).kind,
        ).toBe("forbidden")
        const invalid = classifyBotSettingError(
            rejection({
                code: "err.server.robot.request_invalid",
                status: 400,
                details: { field: "value" },
            }),
        )
        expect(invalid.kind).toBe("invalid")
        expect(invalid.field).toBe("value")
        expect(classifyBotSettingError(rejection({ status: 429 })).kind).toBe(
            "rateLimited",
        )
    })

    it("无 code 的 403 也归为 forbidden，不给重试按钮", () => {
        // 网关 / 代理 / 将来服务端换码都可能给出无 code 的 403。落到 unknown 会渲染
        // 带重试按钮的「加载失败」，等于请用户对着永久拒绝反复打限流端点。
        expect(classifyBotSettingError(rejection({ status: 403 })).kind).toBe(
            "forbidden",
        )
    })
})

// ── VM 层 ──────────────────────────────────────────────────────────────────

describe("BotCardSettingsVM.loadSettings", () => {
    it("成功后填充三行并复位 loading", async () => {
        hoisted.listSettings.mockResolvedValueOnce(fullCatalog())
        const vm = new BotCardSettingsVM("bot1", { retryDelayMs: 0 })
        await vm.loadSettings()
        expect(vm.loading).toBe(false)
        expect(vm.loadError).toBeNull()
        expect(vm.snapshot().rows).toHaveLength(3)
        expect(hoisted.listSettings).toHaveBeenCalledWith("bot1")
    })

    it("无 code 的 404 → isBackendMissing（后端未部署）", async () => {
        hoisted.listSettings.mockRejectedValueOnce(rejection({ status: 404 }))
        const vm = new BotCardSettingsVM("bot1", { retryDelayMs: 0 })
        await vm.loadSettings()
        expect(vm.isBackendMissing).toBe(true)
        expect(vm.isUnsupported).toBe(false)
    })

    it("err.server.robot.not_found → isUnsupported（含 App Bot）", async () => {
        hoisted.listSettings.mockRejectedValueOnce(
            rejection({ code: "err.server.robot.not_found", status: 404 }),
        )
        const vm = new BotCardSettingsVM("bot1", { retryDelayMs: 0 })
        await vm.loadSettings()
        expect(vm.isUnsupported).toBe(true)
        expect(vm.isBackendMissing).toBe(false)
    })

    it("服务端错误自动重试一次后成功", async () => {
        hoisted.listSettings
            .mockRejectedValueOnce(
                rejection({ code: "err.server.robot.query_failed", status: 500 }),
            )
            .mockResolvedValueOnce(fullCatalog())
        const vm = new BotCardSettingsVM("bot1", { retryDelayMs: 0 })
        await vm.loadSettings()
        expect(hoisted.listSettings).toHaveBeenCalledTimes(2)
        expect(vm.loadError).toBeNull()
        expect(vm.snapshot().rows).toHaveLength(3)
    })

    it("重试仍失败 → loadError.kind = retryable（有界，不无限重试）", async () => {
        hoisted.listSettings.mockRejectedValue(
            rejection({ code: "err.server.robot.query_failed", status: 500 }),
        )
        const vm = new BotCardSettingsVM("bot1", { retryDelayMs: 0 })
        await vm.loadSettings()
        expect(hoisted.listSettings).toHaveBeenCalledTimes(2)
        expect(vm.loadError?.kind).toBe("retryable")
    })

    it("参数非法不重试（重试必然再失败，且会撞限流）", async () => {
        hoisted.listSettings.mockRejectedValue(
            rejection({ code: "err.server.robot.request_invalid", status: 400 }),
        )
        const vm = new BotCardSettingsVM("bot1", { retryDelayMs: 0 })
        await vm.loadSettings()
        expect(hoisted.listSettings).toHaveBeenCalledTimes(1)
        expect(vm.loadError?.kind).toBe("invalid")
    })
})

describe("BotCardSettingsVM.toggle", () => {
    const loaded = async (
        overrides: Record<string, Partial<BotSettingItem>> = {},
    ): Promise<BotCardSettingsVM> => {
        hoisted.listSettings.mockResolvedValueOnce(fullCatalog(overrides))
        const vm = new BotCardSettingsVM("bot1", { retryDelayMs: 0 })
        await vm.loadSettings()
        return vm
    }

    it("乐观更新立刻生效，并 PUT 该项覆盖", async () => {
        const vm = await loaded()
        expect(vm.toggle(BOT_CARD_DISPLAY_KEY, false)).toBe(true)
        const row = vm
            .snapshot()
            .rows.find((r) => r.key === BOT_CARD_DISPLAY_KEY)!
        // 同步就能看到新状态 + pending 标记，无需等网络。
        expect(row.checked).toBe(false)
        expect(row.overridden).toBe(true)
        expect(row.source).toBe("bot")
        expect(row.pending).toBe(true)
        await tick()
        expect(hoisted.putSettings).toHaveBeenCalledWith("bot1", [
            { key: BOT_CARD_DISPLAY_KEY, value: false },
        ])
    })

    it("在飞期间的后续点击合并成一次批量 PUT", async () => {
        const vm = await loaded()
        let releaseFirst: () => void = () => undefined
        hoisted.putSettings.mockImplementationOnce(
            () =>
                new Promise<void>((resolve) => {
                    releaseFirst = resolve
                }),
        )
        vm.toggle(BOT_CARD_DISPLAY_KEY, false)
        await tick()
        expect(hoisted.putSettings).toHaveBeenCalledTimes(1)

        // 第一个 PUT 还没回来，此时再点两个开关。
        vm.toggle(BOT_CARD_INTERACTION_KEY, false)
        vm.toggle(BOT_CARD_REASONING_KEY, true)
        await tick()
        expect(hoisted.putSettings).toHaveBeenCalledTimes(1)

        releaseFirst()
        await tick()
        expect(hoisted.putSettings).toHaveBeenCalledTimes(2)
        expect(hoisted.putSettings.mock.calls[1][1]).toEqual([
            { key: BOT_CARD_INTERACTION_KEY, value: false },
            { key: BOT_CARD_REASONING_KEY, value: true },
        ])
    })

    it("单发写入失败 → 回滚该行并记下可重试的写错误", async () => {
        const vm = await loaded()
        hoisted.putSettings.mockRejectedValue(
            rejection({ code: "err.server.robot.store_failed", status: 500 }),
        )
        vm.toggle(BOT_CARD_DISPLAY_KEY, false)
        await tick()
        const row = vm
            .snapshot()
            .rows.find((r) => r.key === BOT_CARD_DISPLAY_KEY)!
        expect(row.checked).toBe(true) // 弹回服务端真实状态
        expect(row.overridden).toBe(false)
        expect(row.pending).toBe(false)
        expect(vm.writeError?.kind).toBe("retryable")
    })

    it("多 key 批次失败 → 整批一起回滚（全批原子）", async () => {
        const vm = await loaded()
        let releaseFirst: () => void = () => undefined
        hoisted.putSettings.mockImplementationOnce(
            () =>
                new Promise<void>((resolve) => {
                    releaseFirst = resolve
                }),
        )
        // 先让一个写入占住在飞位，把后面两个 key 挤进同一批。
        vm.toggle(BOT_CARD_DISPLAY_KEY, false)
        await tick()
        vm.toggle(BOT_CARD_INTERACTION_KEY, false)
        vm.toggle(BOT_CARD_REASONING_KEY, false)
        hoisted.putSettings.mockRejectedValue(
            rejection({ code: "err.server.robot.store_failed", status: 500 }),
        )
        releaseFirst()
        await tick()
        await tick()

        const rows = vm.snapshot().rows
        for (const key of [BOT_CARD_INTERACTION_KEY, BOT_CARD_REASONING_KEY]) {
            const row = rows.find((r) => r.key === key)!
            expect(row.checked).toBe(true)
            expect(row.overridden).toBe(false)
            expect(row.pending).toBe(false)
        }
        expect(vm.writeError?.kind).toBe("retryable")
    })

    /**
     * 回归：同一行在飞期间被再次点击，第一批成功、第二批失败时，**不能**回滚到
     * 「第一次写入之前」—— 服务端此刻已经有了第一批写进去的显式覆盖。
     *
     * 旧实现留着最初的快照，于是回滚后 UI 显示「未自定义 + 开」，而服务端是显式
     * 关；更糟的是 overridden 变回 false 让「取消自定义」消失，用户再没有任何途径
     * 清掉那个覆盖（PR #1282 review P1）。
     */
    it("同 key 连点：先成功后失败只回滚到已确认值，不越过已提交的写入", async () => {
        const vm = await loaded()
        let releaseFirst: () => void = () => undefined
        hoisted.putSettings.mockImplementationOnce(
            () =>
                new Promise<void>((resolve) => {
                    releaseFirst = resolve
                }),
        )

        vm.toggle(BOT_CARD_DISPLAY_KEY, false) // PUT#1 起飞
        await tick()
        vm.toggle(BOT_CARD_DISPLAY_KEY, true) // 在飞期间再点，合入下一批

        hoisted.putSettings.mockRejectedValue(
            rejection({ code: "err.server.robot.store_failed", status: 500 }),
        )
        releaseFirst() // PUT#1 成功 → PUT#2(true) 发出并失败
        await tick()
        await tick()

        // 3 次：PUT#1(false) + PUT#2(true) 的首发与那一次有界重试。
        expect(hoisted.putSettings).toHaveBeenCalledTimes(3)
        expect(hoisted.putSettings.mock.calls[0][1]).toEqual([
            { key: BOT_CARD_DISPLAY_KEY, value: false },
        ])
        expect(hoisted.putSettings.mock.calls[1][1]).toEqual([
            { key: BOT_CARD_DISPLAY_KEY, value: true },
        ])
        expect(hoisted.putSettings.mock.calls[2][1]).toEqual(
            hoisted.putSettings.mock.calls[1][1],
        )

        const row = vm
            .snapshot()
            .rows.find((r) => r.key === BOT_CARD_DISPLAY_KEY)!
        // 服务端真实状态 = PUT#1 写入的显式覆盖 false。UI 必须与之一致。
        expect(row.checked).toBe(false)
        expect(row.overridden).toBe(true)
        expect(row.source).toBe("bot")
        // 覆盖存在 → 用户仍有「取消自定义」这条出路。
        expect(row.editable).toBe(true)
        expect(vm.writeError?.kind).toBe("retryable")
    })

    it("总闸关闭 / 只读行不受理点击，也不发请求", async () => {
        const off = await loaded({
            [BOT_CARD_MASTER_KEY]: { effective_value: false },
        })
        expect(off.toggle(BOT_CARD_DISPLAY_KEY, false)).toBe(false)

        const readonly = await loaded({
            [BOT_CARD_REASONING_KEY]: { editable: false, source: "env" },
        })
        expect(readonly.toggle(BOT_CARD_REASONING_KEY, false)).toBe(false)

        await tick()
        expect(hoisted.putSettings).not.toHaveBeenCalled()
    })
})

describe("BotCardSettingsVM.resetToDefault", () => {
    it("DELETE 后重拉（回落值不可本地推导），并解除该行禁用", async () => {
        hoisted.listSettings
            .mockResolvedValueOnce(
                fullCatalog({
                    [BOT_CARD_DISPLAY_KEY]: { value: false, effective_value: false, source: "bot" },
                }),
            )
            // 删掉覆盖后回落到全局默认 true —— 只有服务端知道这个值。
            .mockResolvedValueOnce(
                fullCatalog({
                    [BOT_CARD_DISPLAY_KEY]: { value: null, effective_value: true, source: "global" },
                }),
            )
        const vm = new BotCardSettingsVM("bot1", { retryDelayMs: 0 })
        await vm.loadSettings()

        const ok = await vm.resetToDefault(BOT_CARD_DISPLAY_KEY)
        expect(ok).toBe(true)
        expect(hoisted.deleteSetting).toHaveBeenCalledWith(
            "bot1",
            BOT_CARD_DISPLAY_KEY,
        )
        expect(hoisted.listSettings).toHaveBeenCalledTimes(2)

        const row = vm
            .snapshot()
            .rows.find((r) => r.key === BOT_CARD_DISPLAY_KEY)!
        expect(row.checked).toBe(true)
        expect(row.overridden).toBe(false)
        expect(row.source).toBe("global")
        // 回归守卫：重拉会自增 generation，busy 的清理绝不能被 isStale 挡掉，
        // 否则这一行会永久禁用。
        expect(row.disabled).toBe(false)
        expect(row.pending).toBe(false)
    })

    it("没有显式覆盖的行不发 DELETE（没有可删的覆盖）", async () => {
        hoisted.listSettings.mockResolvedValueOnce(fullCatalog())
        const vm = new BotCardSettingsVM("bot1", { retryDelayMs: 0 })
        await vm.loadSettings()
        expect(await vm.resetToDefault(BOT_CARD_DISPLAY_KEY)).toBe(false)
        expect(hoisted.deleteSetting).not.toHaveBeenCalled()
    })

    it("DELETE 失败不重拉，记下写错误并解除禁用", async () => {
        hoisted.listSettings.mockResolvedValueOnce(
            fullCatalog({
                [BOT_CARD_DISPLAY_KEY]: { value: false, effective_value: false, source: "bot" },
            }),
        )
        hoisted.deleteSetting.mockRejectedValue(rejection({ status: 429 }))
        const vm = new BotCardSettingsVM("bot1", { retryDelayMs: 0 })
        await vm.loadSettings()

        expect(await vm.resetToDefault(BOT_CARD_DISPLAY_KEY)).toBe(false)
        expect(hoisted.listSettings).toHaveBeenCalledTimes(1)
        expect(vm.writeError?.kind).toBe("rateLimited")
        const row = vm
            .snapshot()
            .rows.find((r) => r.key === BOT_CARD_DISPLAY_KEY)!
        expect(row.disabled).toBe(false)
        expect(row.overridden).toBe(true)
    })

    it("总闸关闭时拒绝取消自定义（与整组开关置灰的信号保持一致）", async () => {
        hoisted.listSettings.mockResolvedValueOnce(
            fullCatalog({
                [BOT_CARD_MASTER_KEY]: { effective_value: false },
                [BOT_CARD_DISPLAY_KEY]: { value: false, effective_value: false, source: "bot" },
            }),
        )
        const vm = new BotCardSettingsVM("bot1", { retryDelayMs: 0 })
        await vm.loadSettings()

        expect(await vm.resetToDefault(BOT_CARD_DISPLAY_KEY)).toBe(false)
        expect(hoisted.deleteSetting).not.toHaveBeenCalled()
        // 覆盖仍在（信息保留），只是此刻不能删。
        const row = vm
            .snapshot()
            .rows.find((r) => r.key === BOT_CARD_DISPLAY_KEY)!
        expect(row.overridden).toBe(true)
        expect(row.disabled).toBe(true)
    })

    it("切 bot 后旧 bot 的 DELETE 回来不解除新 bot 的行禁用", async () => {
        hoisted.listSettings.mockResolvedValue(
            fullCatalog({
                [BOT_CARD_DISPLAY_KEY]: { value: false, effective_value: false, source: "bot" },
            }),
        )
        let releaseDelete: () => void = () => undefined
        hoisted.deleteSetting.mockImplementationOnce(
            () =>
                new Promise<void>((resolve) => {
                    releaseDelete = resolve
                }),
        )
        const vm = new BotCardSettingsVM("bot1", { retryDelayMs: 0 })
        await vm.loadSettings()

        const pending = vm.resetToDefault(BOT_CARD_DISPLAY_KEY) // bot1 的 DELETE 起飞
        await tick()
        vm.setRobotId("bot2")
        await tick()

        // bot2 上对同一 key 也起一个 DELETE，让它保持 busy。
        hoisted.deleteSetting.mockImplementationOnce(
            () => new Promise<void>(() => undefined),
        )
        void vm.resetToDefault(BOT_CARD_DISPLAY_KEY)
        await tick()
        expect(
            vm.snapshot().rows.find((r) => r.key === BOT_CARD_DISPLAY_KEY)!
                .disabled,
        ).toBe(true)

        releaseDelete() // bot1 的 DELETE 此刻才回来
        await pending
        await tick()

        // 曾经的缺陷：finally 无条件 delete，删掉的是 bot2 的键 —— bot2 自己的
        // DELETE 还在飞就被解除禁用，串行化白做。
        expect(
            vm.snapshot().rows.find((r) => r.key === BOT_CARD_DISPLAY_KEY)!
                .disabled,
        ).toBe(true)
    })
})

describe("BotCardSettingsVM 防串台", () => {
    it("切 bot 后旧请求的结果被丢弃", async () => {
        let releaseFirst: (value: unknown) => void = () => undefined
        hoisted.listSettings
            .mockImplementationOnce(
                () =>
                    new Promise((resolve) => {
                        releaseFirst = resolve
                    }),
            )
            .mockResolvedValueOnce(
                fullCatalog({
                    [BOT_CARD_REASONING_KEY]: { effective_value: false },
                }),
            )
        const vm = new BotCardSettingsVM("bot1", { retryDelayMs: 0 })
        const first = vm.loadSettings()

        vm.setRobotId("bot2")
        await tick()
        // 旧 bot 的响应此刻才回来，必须整段丢弃。
        releaseFirst(
            fullCatalog({ [BOT_CARD_DISPLAY_KEY]: { effective_value: false } }),
        )
        await first
        await tick()

        expect(vm.robotId).toBe("bot2")
        const rows = vm.snapshot().rows
        expect(rows.find((r) => r.key === BOT_CARD_DISPLAY_KEY)!.checked).toBe(
            true,
        )
        expect(rows.find((r) => r.key === BOT_CARD_REASONING_KEY)!.checked).toBe(
            false,
        )
    })
})

/**
 * 写路径的过期判据必须是 epoch（bot 是否换了），不能是 generation（数据是否重拉过）。
 * 下面两条都是 code review 里实际复现出来的回归。
 */
/**
 * `items` 有两个独立写入者：GET 的整体替换、逐 key 的乐观覆盖。只有写侧串行走 chain，
 * 所以读必须靠 writeSeq 对「已确认的写」作废，否则一个提交前发出的 GET 落地时会把
 * 已确认的写静默回退（PR #1282 第二轮 review P1，两条触发路径都在下面）。
 */
describe("BotCardSettingsVM 读写串行化", () => {
    const overrideOn = {
        value: true,
        effective_value: true,
        source: "bot",
    }

    it("触发 A：读在飞时提交的写，不能被后落地的读覆盖", async () => {
        hoisted.listSettings.mockResolvedValueOnce(fullCatalog())
        const vm = new BotCardSettingsVM("bot1", { retryDelayMs: 0 })
        await vm.loadSettings()

        // 第二次读（重开时的探测）在飞。
        let releaseRead: (value: unknown) => void = () => undefined
        hoisted.listSettings.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    releaseRead = resolve
                }),
        )
        void vm.loadSettings()
        await tick()

        // 读还没回来，用户点了开关，PUT 提交成功。
        vm.toggle(BOT_CARD_DISPLAY_KEY, false)
        await tick()
        expect(hoisted.putSettings).toHaveBeenCalledTimes(1)

        // 慢的读此刻才落地，带回的是提交前的目录。
        releaseRead(fullCatalog())
        await tick()
        await tick()

        const row = vm
            .snapshot()
            .rows.find((r) => r.key === BOT_CARD_DISPLAY_KEY)!
        // 服务端真值 = 刚提交的显式覆盖 false。读必须被判过期整段丢弃。
        expect(row.checked).toBe(false)
        expect(row.overridden).toBe(true)
        expect(row.source).toBe("bot")
        expect(vm.writeError).toBeNull()
        // 交集断言：被写作废的读也必须清掉自己的 loading。漏了这一条会让
        // probeCardSettings 的 `!vm.loading` 守卫吞掉之后每一次重开的探测。
        expect(vm.loading).toBe(false)
    })

    it("触发 B：写在飞时发起的读，也不能覆盖随后确认的写", async () => {
        hoisted.listSettings.mockResolvedValueOnce(fullCatalog())
        const vm = new BotCardSettingsVM("bot1", { retryDelayMs: 0 })
        await vm.loadSettings()

        let releasePut: () => void = () => undefined
        hoisted.putSettings.mockImplementationOnce(
            () =>
                new Promise<void>((resolve) => {
                    releasePut = resolve
                }),
        )
        vm.toggle(BOT_CARD_DISPLAY_KEY, false) // PUT 起飞
        await tick()

        // 关闭再打开 → 探测读起飞（此时 PUT 还没落地）。
        let releaseRead: (value: unknown) => void = () => undefined
        hoisted.listSettings.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    releaseRead = resolve
                }),
        )
        void vm.loadSettings()
        await tick()

        releasePut() // PUT 先确认
        await tick()
        releaseRead(fullCatalog()) // 读后落地，带回提交前的目录
        await tick()
        await tick()

        const row = vm
            .snapshot()
            .rows.find((r) => r.key === BOT_CARD_DISPLAY_KEY)!
        // 同上：交集断言，被写作废的读必须自己清 loading。
        expect(vm.loading).toBe(false)
        expect(row.checked).toBe(false)
        expect(row.overridden).toBe(true)
    })

    it("被写作废的读之后，下一次 loadSettings 仍然会发请求", async () => {
        hoisted.listSettings.mockResolvedValueOnce(fullCatalog())
        const vm = new BotCardSettingsVM("bot1", { retryDelayMs: 0 })
        await vm.loadSettings()

        let releaseRead: (value: unknown) => void = () => undefined
        hoisted.listSettings.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    releaseRead = resolve
                }),
        )
        void vm.loadSettings()
        await tick()
        vm.toggle(BOT_CARD_DISPLAY_KEY, false)
        await tick()
        releaseRead(fullCatalog()) // 被 writeSeq 判掉
        await tick()
        await tick()

        // 上层的探测守卫是 `if (!vm.loading)`。loading 卡住就等于此后所有重开
        // 都不再读取 —— 「每次打开一次新鲜读取」在整个会话里失效且无可见症状。
        expect(vm.loading).toBe(false)
        hoisted.listSettings.mockResolvedValueOnce(fullCatalog())
        await vm.loadSettings()
        expect(hoisted.listSettings).toHaveBeenCalledTimes(3)
    })

    it("读失败但期间有写落库：不接管错误态，仍要清 loading", async () => {
        hoisted.listSettings.mockResolvedValueOnce(fullCatalog())
        const vm = new BotCardSettingsVM("bot1", { retryDelayMs: 0 })
        await vm.loadSettings()

        let rejectRead: (e: unknown) => void = () => undefined
        hoisted.listSettings.mockImplementationOnce(
            () =>
                new Promise((_resolve, reject) => {
                    rejectRead = reject
                }),
        )
        void vm.loadSettings()
        await tick()
        vm.toggle(BOT_CARD_DISPLAY_KEY, false) // PUT 落库，writeSeq++
        await tick()

        rejectRead(rejection({ code: "err.server.robot.query_failed", status: 500 }))
        await tick()
        await tick()

        // 这次读已被写作废，它的失败也一并丢弃 —— 不该把整页切成「加载失败」，
        // 因为刚提交的写是有效的、items 里的值就是服务端真值。
        expect(vm.loadError).toBeNull()
        expect(vm.snapshot().rows).toHaveLength(3)
        // 但 loading 必须清（这一格是矩阵里最后一个没被断言的组合）。
        expect(vm.loading).toBe(false)
    })

    it("读期间新产生的写错误不被这次读清掉", async () => {
        hoisted.listSettings.mockResolvedValueOnce(fullCatalog())
        const vm = new BotCardSettingsVM("bot1", { retryDelayMs: 0 })
        await vm.loadSettings()

        let releaseRead: (value: unknown) => void = () => undefined
        hoisted.listSettings.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    releaseRead = resolve
                }),
        )
        void vm.loadSettings() // 读起飞
        await tick()

        // 读还没回来，写被限流拒了。失败的写不自增 writeSeq（什么都没提交），
        // 所以这次读落地时**不**算过期 —— 无条件清 writeError 会把这条比它更新的
        // 错误抹掉，用户看到开关弹回去却没有任何解释。
        hoisted.putSettings.mockRejectedValue(rejection({ status: 429 }))
        vm.toggle(BOT_CARD_DISPLAY_KEY, false)
        await tick()
        expect(vm.writeError?.kind).toBe("rateLimited")

        releaseRead(fullCatalog())
        await tick()
        await tick()

        expect(vm.writeError?.kind).toBe("rateLimited")
    })

    it("成功读把待写 key 的回滚快照对齐到新鲜服务端值", async () => {
        hoisted.listSettings.mockResolvedValueOnce(fullCatalog())
        const vm = new BotCardSettingsVM("bot1", { retryDelayMs: 0 })
        await vm.loadSettings()

        const writeFailure = rejection({
            code: "err.server.robot.store_failed",
            status: 500,
        })
        let rejectPut: (e: unknown) => void = () => undefined
        hoisted.putSettings.mockImplementationOnce(
            () =>
                new Promise<void>((_resolve, reject) => {
                    rejectPut = reject
                }),
        )
        // 有界重试的第二发也要失败。
        hoisted.putSettings.mockRejectedValue(writeFailure)

        vm.toggle(BOT_CARD_DISPLAY_KEY, false) // baseline 记的是「未覆盖 + true」
        await tick()

        // 别的客户端把这一项改成了显式 true，我们的重拉拿到了这个新值。
        hoisted.listSettings.mockResolvedValueOnce(
            fullCatalog({ [BOT_CARD_DISPLAY_KEY]: overrideOn }),
        )
        await vm.loadSettings()

        // 我们自己的写随后失败 → 必须回滚到「刚读到的」显式 true，
        // 而不是这次读之前的「未覆盖 + 继承默认」。
        rejectPut(writeFailure)
        await tick()
        await tick()

        const row = vm
            .snapshot()
            .rows.find((r) => r.key === BOT_CARD_DISPLAY_KEY)!
        expect(row.checked).toBe(true)
        expect(row.overridden).toBe(true)
        expect(row.source).toBe("bot")
        expect(vm.writeError?.kind).toBe("retryable")
    })

    it("成功读清掉上一次的写错误横幅", async () => {
        hoisted.listSettings.mockResolvedValue(fullCatalog())
        const vm = new BotCardSettingsVM("bot1", { retryDelayMs: 0 })
        await vm.loadSettings()
        hoisted.putSettings.mockRejectedValue(
            rejection({ code: "err.server.robot.store_failed", status: 500 }),
        )
        vm.toggle(BOT_CARD_DISPLAY_KEY, false)
        await tick()
        await tick()
        expect(vm.writeError?.kind).toBe("retryable")

        await vm.loadSettings()
        // 刷新成功后横幅还挂着会让用户以为现在仍是坏的。
        expect(vm.writeError).toBeNull()
    })

    it("读失败前不清 loadError，不支持的 bot 重开时菜单行不会闪现", async () => {
        hoisted.listSettings.mockRejectedValue(
            rejection({ code: "err.server.robot.not_found", status: 404 }),
        )
        const vm = new BotCardSettingsVM("bot1", { retryDelayMs: 0 })
        await vm.loadSettings()
        expect(vm.isUnsupported).toBe(true)

        // 重开触发的重拉：在 await 之前若清掉 loadError，isUnsupported 会瞬间变 false，
        // 上层的 showCardSettings 就会把那一行画出来（还可点）再撤掉。
        const pending = vm.loadSettings()
        expect(vm.isUnsupported).toBe(true)
        await pending
        expect(vm.isUnsupported).toBe(true)
    })
})

describe("BotCardSettingsVM 写入过滤与串行链", () => {
    it("批次被部分过滤时，被丢弃的 key 回滚且不进 payload", async () => {
        hoisted.listSettings.mockResolvedValueOnce(fullCatalog())
        const vm = new BotCardSettingsVM("bot1", { retryDelayMs: 0 })
        await vm.loadSettings()

        let releaseFirst: () => void = () => undefined
        hoisted.putSettings.mockImplementationOnce(
            () =>
                new Promise<void>((resolve) => {
                    releaseFirst = resolve
                }),
        )
        vm.toggle(BOT_CARD_INTERACTION_KEY, false) // 批次 1 起飞
        await tick()
        // 这两个排队进批次 2。
        vm.toggle(BOT_CARD_DISPLAY_KEY, false)
        vm.toggle(BOT_CARD_REASONING_KEY, false)

        // 中途的重拉把 reasoning 变成只读 —— 它永远不会被发送。
        hoisted.listSettings.mockResolvedValueOnce(
            fullCatalog({
                [BOT_CARD_REASONING_KEY]: { editable: false, source: "env" },
            }),
        )
        await vm.loadSettings()

        releaseFirst()
        await tick()
        await tick()

        // 批次 2 只带 display。
        expect(hoisted.putSettings).toHaveBeenCalledTimes(2)
        expect(hoisted.putSettings.mock.calls[1][1]).toEqual([
            { key: BOT_CARD_DISPLAY_KEY, value: false },
        ])

        const reasoning = vm
            .snapshot()
            .rows.find((r) => r.key === BOT_CARD_REASONING_KEY)!
        // 曾经的缺陷：被过滤的 key 留在 sending 里，成功分支按「已确认」销毁其快照，
        // 屏幕上就留下一个服务端从未接受过的「已自定义」—— 而只读行既点不动、
        // 又没有重置按钮，页内零恢复。
        expect(reasoning.overridden).toBe(false)
        expect(reasoning.effectiveValue).toBe(true)
    })

    it("有在飞写入时拒绝取消自定义（否则重置会被随后的 PUT 顶掉）", async () => {
        hoisted.listSettings.mockResolvedValueOnce(
            fullCatalog({
                [BOT_CARD_DISPLAY_KEY]: {
                    value: true,
                    effective_value: true,
                    source: "bot",
                },
            }),
        )
        const vm = new BotCardSettingsVM("bot1", { retryDelayMs: 0 })
        await vm.loadSettings()

        hoisted.putSettings.mockImplementationOnce(
            () => new Promise<void>(() => undefined),
        )
        vm.toggle(BOT_CARD_DISPLAY_KEY, false) // PUT 悬着不落地
        await tick()

        expect(await vm.resetToDefault(BOT_CARD_DISPLAY_KEY)).toBe(false)
        expect(hoisted.deleteSetting).not.toHaveBeenCalled()
    })

    it("切 bot 会换掉串行链，旧 bot 的挂死请求不阻塞新 bot 的写入", async () => {
        hoisted.listSettings.mockResolvedValue(fullCatalog())
        const vm = new BotCardSettingsVM("bot1", { retryDelayMs: 0 })
        await vm.loadSettings()

        // bot1 上一个永不 settle 的 PUT。
        hoisted.putSettings.mockImplementationOnce(
            () => new Promise<void>(() => undefined),
        )
        vm.toggle(BOT_CARD_DISPLAY_KEY, false)
        await tick()
        expect(hoisted.putSettings).toHaveBeenCalledTimes(1)

        vm.setRobotId("bot2")
        await tick()
        await tick()

        hoisted.putSettings.mockResolvedValue(undefined)
        vm.toggle(BOT_CARD_DISPLAY_KEY, false)
        await tick()

        // 链没换的话这一发会永远排在 bot1 那个挂死请求后面。
        expect(hoisted.putSettings).toHaveBeenCalledTimes(2)
        expect(hoisted.putSettings.mock.calls[1][0]).toBe("bot2")
    })
})

describe("BotCardSettingsVM 写路径过期判据", () => {
    it("连点两行「取消自定义」：第二次不能被第一次的重拉误判成过期", async () => {
        const overridden = {
            value: true,
            effective_value: true,
            source: "bot",
        }
        hoisted.listSettings.mockResolvedValue(
            fullCatalog({
                [BOT_CARD_DISPLAY_KEY]: overridden,
                [BOT_CARD_REASONING_KEY]: overridden,
            }),
        )
        const vm = new BotCardSettingsVM("bot1", { retryDelayMs: 0 })
        await vm.loadSettings()

        // 两次删除后服务端的目录里两项覆盖都没了。
        hoisted.listSettings.mockResolvedValue(fullCatalog())

        const [ok1, ok2] = await Promise.all([
            vm.resetToDefault(BOT_CARD_DISPLAY_KEY),
            vm.resetToDefault(BOT_CARD_REASONING_KEY),
        ])

        expect(hoisted.deleteSetting).toHaveBeenCalledTimes(2)
        expect(ok1).toBe(true)
        // 曾经的缺陷：第一次的删后重拉推进了 generation，第二次的 DELETE 明明成功
        // 却被判过期 → 跳过重拉，UI 继续显示已被删掉的覆盖。
        expect(ok2).toBe(true)
        const reasoning = vm
            .snapshot()
            .rows.find((r) => r.key === BOT_CARD_REASONING_KEY)!
        expect(reasoning.overridden).toBe(false)
    })

    it("切 bot 时旧 PUT 回来，不能清掉新 bot 批次导致回滚失效", async () => {
        hoisted.listSettings.mockResolvedValue(fullCatalog())
        const vm = new BotCardSettingsVM("bot1", { retryDelayMs: 0 })
        await vm.loadSettings()

        let releaseOldPut: () => void = () => undefined
        hoisted.putSettings.mockImplementationOnce(
            () =>
                new Promise<void>((resolve) => {
                    releaseOldPut = resolve
                }),
        )
        vm.toggle(BOT_CARD_DISPLAY_KEY, false) // bot1 的写入起飞
        await tick()
        expect(hoisted.putSettings).toHaveBeenCalledTimes(1)

        vm.setRobotId("bot2")
        await tick()

        // bot2 上的写入失败，必须能回滚。
        hoisted.putSettings.mockRejectedValue(
            rejection({ code: "err.server.robot.store_failed", status: 500 }),
        )
        vm.toggle(BOT_CARD_REASONING_KEY, false)
        await tick()

        releaseOldPut() // bot1 的旧 PUT 此刻才回来
        await tick()
        await tick()

        const row = vm
            .snapshot()
            .rows.find((r) => r.key === BOT_CARD_REASONING_KEY)!
        // 曾经的缺陷：旧 flush 按 generation 判过期时顺手清空了 sending，而那时
        // sending 已属于 bot2 的批次 → rollbackPending 找不到 key，开关停在从未
        // 落库的值上。
        expect(row.checked).toBe(true)
        expect(row.overridden).toBe(false)
        expect(vm.writeError?.kind).toBe("retryable")
    })
})
