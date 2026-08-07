import type { BotSettingItem } from "../../Service/BotManageService"

/**
 * Bot 卡片消息设置 —— 纯函数层（key 注册表 / 目录解析 / 错误归类）。
 *
 * 配套后端：`/v1/robot/:robot_id/settings` 三端点（GET 目录 / PUT 批量覆盖 /
 * DELETE 删覆盖回落）。逻辑放在这里而不是 VM 里，是为了让「三态解析 + 总闸 AND +
 * 错误码分支」这三块最容易出错的规则可以脱离异步流程单独测。
 */

/**
 * 部署级卡片总闸。**只读**（`editable:false` / `source:"env"`，派生自部署环境变量），
 * 写它会 400。不作为一行开关渲染，只用来 AND 其余子开关。
 */
export const BOT_CARD_MASTER_KEY = "bot.card_enabled"

/** 展示型卡片（`octo/v1` raw 卡）。 */
export const BOT_CARD_DISPLAY_KEY = "bot.display_enabled"
/** 交互型卡片（`octo/v2` raw 卡，是 `octo/v1` 的严格超集）。 */
export const BOT_CARD_INTERACTION_KEY = "bot.interaction_enabled"
/** 服务端模板推理卡。 */
export const BOT_CARD_REASONING_KEY = "bot.reasoning_enabled"

/**
 * 已知子开关白名单 + 渲染顺序。
 *
 * 顺序即 UI 顺序：推理过程卡片最常被调整，放第一位；展示型在交互型之前，因为
 * `octo/v2` 是 `octo/v1` 的严格超集，展示能力是交互能力的下限，依赖项在前更好读。
 *
 * 服务端加新键时客户端不发版就能在响应里看到它 —— **遇到不认识的 key 必须跳过，
 * 不能阻塞整页渲染**，所以这里用白名单而不是直接遍历响应。
 *
 * 注意总闸 `bot.card_enabled` **不在这个列表里**：它不可写，不作为开关行渲染，
 * 只由视图层单独渲染成一条只读状态条（见 CardSettingsView 的 MasterStatus）。
 */
export const BOT_CARD_SETTING_KEYS: readonly string[] = [
    BOT_CARD_REASONING_KEY,
    BOT_CARD_DISPLAY_KEY,
    BOT_CARD_INTERACTION_KEY,
]

/** 视图层要用的一行开关的完整状态。 */
export interface BotCardSettingRow {
    key: string
    /**
     * 开关的视觉状态 = 该项 `effective_value` **AND** 总闸 `bot.card_enabled`
     * 的 `effective_value`。
     *
     * owner 接口返回的 `effective_value` 是**总闸之前**那一层的解析结果：部署级
     * 总开关关闭时它仍可能是 true，而这个 bot 一张卡也发不出去。直接渲染裸
     * `effective_value` 会显示「开」但完全不能用，所以必须在客户端自己 AND。
     * 服务端将来若改为直接支配这一层，`effective_value` 本身就是 false，
     * `false && false` 仍为 false —— 这个式子是幂等的，不需要为此留分支。
     */
    checked: boolean
    /** 该项自身的生效值（未 AND 总闸），用于判断依赖提示。 */
    effectiveValue: boolean
    /** 是否存在显式覆盖（`value !== null`）—— 决定「取消自定义」是否出现。 */
    overridden: boolean
    /** 生效值来自哪一层：bot / global / default / env。 */
    source: string
    /** 服务端是否允许写这一项。 */
    editable: boolean
    /** 写入在飞（乐观更新已应用，等服务端确认）。 */
    pending: boolean
    /**
     * 开关是否禁用：只读 / 总闸关闭 / 该项正在做不可本地推导的操作（取消自定义）。
     *
     * 注意「写入在飞」**不禁用**开关：乐观更新已经把新状态显示出来了，此时禁用会
     * 让用户在网络慢时连点第二下无效，也让写入合批失去意义（合批的前提是在飞期间
     * 还能继续接收点击）。
     */
    disabled: boolean
    /**
     * 交互型卡片专用：展示型卡片当前不生效时为 true。
     *
     * `octo/v2` 是 `octo/v1` 的严格超集，所以展示能力是交互能力的下限。owner 接口
     * **不会**替我们做 `display AND interaction`（那是 bot 侧 `/v1/bot/card/profile`
     * 的语义），这里也**不重组布尔值改变开关状态** —— 写 `interaction=true` 是合法的，
     * 只是当前不生效，所以开关保持可写，只挂一条文字提示。
     */
    needsDisplay: boolean
}

/** 解析后的整页状态。 */
export interface BotCardSettingsSnapshot {
    rows: BotCardSettingRow[]
    /** 总闸生效值。响应里缺失该键时 fail-open 取 true（见 resolveMasterEnabled）。 */
    masterEnabled: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

/** 只接受真正的 bool。字符串 "true" 等不在读接口的契约里，不做兼容以免掩盖异常。 */
function asBool(value: unknown): boolean | undefined {
    return typeof value === "boolean" ? value : undefined
}

/**
 * 把响应 list 收成 key → item 的索引，顺带丢掉形状不合法的元素。
 * 未知 key 不在这里过滤（索引全收），由 buildRows 按白名单取用。
 */
export function indexSettingItems(
    list: BotSettingItem[] | undefined,
): Map<string, BotSettingItem> {
    const map = new Map<string, BotSettingItem>()
    if (!Array.isArray(list)) return map
    for (const item of list) {
        if (!isRecord(item)) continue
        const key = item.key
        if (typeof key !== "string" || key.length === 0) continue
        map.set(key, item)
    }
    return map
}

/**
 * 解析总闸生效值。
 *
 * 缺失时 **fail-open 取 true**：服务端文档承诺 `bot.card_enabled` 一定在同一份
 * 响应里，但客户端不能假设。取 false 会因为一次响应形状异常把整页开关全置灰 ——
 * 在卡片实际开着的部署上这是纯误伤；取 true 最坏退化成「显示开、发不出」，
 * 不比不做 AND 的现状更糟。
 *
 * 保持纯函数（本函数在渲染路径上被反复调用）。缺失的告警由 VM 在每次拉取后打一次，
 * 不放在这里，否则每帧渲染都会刷一条日志。
 */
export function resolveMasterEnabled(items: Map<string, BotSettingItem>): boolean {
    const master = items.get(BOT_CARD_MASTER_KEY)
    const value = asBool(master?.effective_value)
    return value === undefined ? true : value
}

/** 目录里是否带着可用的总闸键（供 VM 打一次性告警）。 */
export function hasUsableMasterKey(items: Map<string, BotSettingItem>): boolean {
    return asBool(items.get(BOT_CARD_MASTER_KEY)?.effective_value) !== undefined
}

/**
 * 按白名单 + 固定顺序把目录解析成可渲染的行。
 *
 * 跳过规则（任一命中即整行不渲染，但不影响其余行）：
 *   - 白名单里但响应缺失该 key
 *   - `type` 不是 "bool"（防将来新增 int/string 键把 UI 打挂）
 *   - `effective_value` 不是 bool
 */
export function buildRows(
    items: Map<string, BotSettingItem>,
    options: {
        /** 有乐观更新在飞 / 排队中的 key（视觉上标 pending，但不禁用）。 */
        pendingKeys?: ReadonlySet<string>
        /** 正在执行「取消自定义」的 key（值不可本地推导，必须禁用直到重拉完成）。 */
        busyKeys?: ReadonlySet<string>
    } = {},
): BotCardSettingsSnapshot {
    const masterEnabled = resolveMasterEnabled(items)
    const pendingKeys = options.pendingKeys ?? new Set<string>()
    const busyKeys = options.busyKeys ?? new Set<string>()
    const rows: BotCardSettingRow[] = []

    for (const key of BOT_CARD_SETTING_KEYS) {
        const item = items.get(key)
        if (!item) continue
        if (item.type !== undefined && item.type !== "bool") continue
        const effectiveValue = asBool(item.effective_value)
        if (effectiveValue === undefined) continue

        // `value !== null` 是「存在覆盖」的唯一判据。不看 source —— 若出现
        // source:"bot" 但 value:null 这种矛盾形状，以 value 为准，否则
        //「取消自定义」按钮会亮在没有覆盖可删的行上。
        const overridden =
            item.value !== null && item.value !== undefined
        const editable = item.editable !== false
        const busy = busyKeys.has(key)
        rows.push({
            key,
            checked: effectiveValue && masterEnabled,
            effectiveValue,
            overridden,
            source: typeof item.source === "string" ? item.source : "",
            editable,
            pending: pendingKeys.has(key) || busy,
            disabled: !editable || !masterEnabled || busy,
            needsDisplay: false,
        })
    }

    // 交互型卡片的依赖提示：展示型卡片自身生效值为 false 时挂提示。
    // 用 effectiveValue（未 AND 总闸）判断，因为总闸关闭时整页已有独立提示，
    // 不需要在每行重复。
    const display = rows.find((row) => row.key === BOT_CARD_DISPLAY_KEY)
    const displayOff = display ? !display.effectiveValue : false
    return {
        masterEnabled,
        rows: rows.map((row) =>
            row.key === BOT_CARD_INTERACTION_KEY
                ? { ...row, needsDisplay: displayOff }
                : row,
        ),
    }
}

/**
 * 本地乐观更新：写入一项覆盖后的 item 形状。
 *
 * bot 覆盖是最顶层，所以 PUT 成功后的三元组完全可本地推导：
 * `value = next`、`effective_value = next`、`source = "bot"`。
 * （DELETE 不可如此推导 —— 回落目标是 global 还是 default、回落值是什么，
 * 只有服务端知道，所以删除后必须重拉。）
 */
export function applyOverride(
    item: BotSettingItem | undefined,
    key: string,
    next: boolean,
): BotSettingItem {
    return {
        ...(item ?? { key, type: "bool", editable: true }),
        key,
        value: next,
        effective_value: next,
        source: "bot",
    }
}

/** 错误归类结果。UI 按 kind 决定渲染哪种终态 / 是否可重试。 */
export type BotSettingErrorKind =
    /** 后端路由不存在（未部署）→ 「功能即将上线」骨架 */
    | "backendMissing"
    /** err.server.robot.not_found：bot 无 robot 记录（含 App Bot）→ 不支持自定义 */
    | "unsupported"
    /** err.server.robot.creator_only：非属主 */
    | "forbidden"
    /** 服务端错误（真实 500，线路状态码可能被钉成 400）→ 应当重试 */
    | "retryable"
    /** 参数非法 → 前端 bug，重试必然再失败 */
    | "invalid"
    /** 限流 */
    | "rateLimited"
    | "unknown"

export interface BotSettingError {
    kind: BotSettingErrorKind
    /**
     * 服务端已本地化的消息（APIClient 归一化后的 msg）。
     *
     * **刻意只用于日志，不渲染。** 用户可见文案全部走本地 labels：一是服务端消息的
     * 措辞和这一页的语境未必对得上，二是不让服务端控制的字符串进 DOM。
     */
    message: string
    code?: string
    /** request_invalid 时服务端给的出错字段（items / key / value），仅用于日志。 */
    field?: string
}

const RETRYABLE_CODES = new Set([
    "err.server.robot.query_failed",
    "err.server.robot.store_failed",
    "err.shared.internal",
])

/**
 * 按 `error.code` 归类，**不按 HTTP 状态码**。
 *
 * 这几个端点的线路状态码不统一：属主类错误（404/403）返回真实状态码，而服务端
 * 错误（query_failed / store_failed，真实 500）的线路状态被钉成 400。所以
 *「看到 400」不等于「参数错了」。
 *
 * 好消息是 APIClient 的响应拦截器已经把这层解开了：`normalizeApiError` 优先取
 * 响应体里的 `error.http_status`（Service/apiError.ts:114），所以到这里的
 * `status` 对 query_failed / store_failed 已经是 500，`code` 也已透传。
 */
export function classifyBotSettingError(err: unknown): BotSettingError {
    const record = isRecord(err) ? err : undefined
    const code =
        typeof record?.code === "string" ? (record.code as string) : undefined
    const status =
        typeof record?.status === "number" ? (record.status as number) : undefined
    const message = typeof record?.msg === "string" ? (record.msg as string) : ""
    const details = isRecord(record?.details) ? record?.details : undefined
    const field = typeof details?.field === "string" ? details.field : undefined

    if (code === "err.server.robot.not_found") {
        return { kind: "unsupported", message, code }
    }
    if (code === "err.server.robot.creator_only") {
        return { kind: "forbidden", message, code }
    }
    if (code === "err.server.robot.request_invalid") {
        return { kind: "invalid", message, code, field }
    }
    if (code && RETRYABLE_CODES.has(code)) {
        return { kind: "retryable", message, code }
    }
    if (status === 429) {
        return { kind: "rateLimited", message, code }
    }
    // 无 code 的 404 = 路由不存在（后端未部署）。带 code 的 404 已在上面被
    // not_found 分支接掉，两者不能混：前者会上线，后者（App Bot）不会。
    if (status === 404 && !code) {
        return { kind: "backendMissing", message, code }
    }
    // 无 code 的 403 兜底（网关、代理、将来服务端换码）。落到 unknown 会渲染带
    // 重试按钮的「加载失败」，等于请用户对着一个永久拒绝反复打限流端点。
    // 401 不在这里处理：APIClient 的拦截器已按 auth 码统一触发登出。
    if (status === 403) {
        return { kind: "forbidden", message, code }
    }
    if (status !== undefined && status >= 500) {
        return { kind: "retryable", message, code }
    }
    return { kind: "unknown", message, code }
}
