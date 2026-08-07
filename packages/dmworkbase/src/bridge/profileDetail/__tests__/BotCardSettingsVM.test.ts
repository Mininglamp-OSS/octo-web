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

    it("写入失败整批回滚（全批原子），并记下可重试的写错误", async () => {
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
