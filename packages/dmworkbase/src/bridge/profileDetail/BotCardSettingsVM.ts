import { ProviderListener } from "../../Service/Provider"
import BotManageService, {
    type BotSettingItem,
    type BotSettingWriteItem,
} from "../../Service/BotManageService"
import {
    applyOverride,
    buildRows,
    classifyBotSettingError,
    hasUsableMasterKey,
    indexSettingItems,
    BOT_CARD_MASTER_KEY,
    type BotCardSettingsSnapshot,
    type BotSettingError,
} from "./botCardSettings"

/**
 * BotCardSettingsVM —— L3「卡片消息能力」ViewModel。
 *
 * 配套后端：`/v1/robot/:robot_id/settings`
 *   GET    读配置项目录（value / effective_value / source / editable）
 *   PUT    批量写覆盖（全批原子）
 *   DELETE 删覆盖 = 回落上一层（幂等）
 *
 * 与 MentionFreeVM 分开而不是合并：两者数据源、生命周期、错误语义完全无关，
 * 且 BotManageVM.ts 已 284 行。共用的只有 generation 防串台这一个模式。
 *
 * 三条关键约定（规则细节见 botCardSettings.ts 的注释）：
 *   1. 开关视觉状态必须自己 AND 总闸 `bot.card_enabled`；
 *   2. 一律按 `error.code` 分支，服务端错误重试而不是提示用户改输入；
 *   3. PUT 结果可本地推导，DELETE 的回落值不可推导 —— 删完必须重拉。
 *
 * 写入策略：**在飞合批**，不用 debounce。第一次点击立刻发（即时反馈，1 个请求），
 * 在飞期间的后续点击进 queued，等在飞的回来后作为**一次** `items[]` 批量 PUT 发出
 * （吃到服务端承诺的全批原子）。相比定时器合批的好处：没有「点完立刻关窗口导致
 * 写入丢失」的窗口期，也不需要在卸载时补 flush。
 *
 * 所有写操作（PUT 批 / DELETE + 重拉）串行走同一个 chain，避免「删一项触发的重拉」
 * 和「另一项的写入」互相盖状态。
 */

/** 服务端错误的自动重试次数上限（总请求数 = 1 + 该值）。 */
const MAX_RETRY = 1

/**
 * 重试间隔默认值。压到 1 次重试 + 数百毫秒，是因为这些端点带按登录用户的限流 ——
 * 无界重试会把一次服务端抖动放大成 429，用户反而彻底卡死。
 */
const DEFAULT_RETRY_DELAY_MS = 600

export interface BotCardSettingsVMOptions {
    /** 仅供测试注入 0 以免真实等待。 */
    retryDelayMs?: number
}

export class BotCardSettingsVM extends ProviderListener {
    /** 当前管理的 bot uid（= robot_id）。可被上层 setRobotId 更新以支持复用实例。 */
    robotId: string

    loading: boolean = false
    /** 首屏终态错误（决定整页渲染哪种兜底）。 */
    loadError: BotSettingError | null = null
    /** 写入 / 恢复默认的错误（行内提示，不接管整页）。 */
    writeError: BotSettingError | null = null

    private items: Map<string, BotSettingItem> = new Map()
    /** 已排队待发送的覆盖（key → value）。 */
    private queued: Map<string, boolean> = new Map()
    /** 已从队列取出、等待服务端确认的这一批覆盖。 */
    private sending: Map<string, boolean> = new Map()
    /** 回滚快照：key → 进入待写状态前最后一次被服务端确认的 item。 */
    private baseline: Map<string, BotSettingItem | undefined> = new Map()
    /** 正在「恢复默认」的 key（DELETE + 重拉期间禁用该行）。 */
    private busy: Set<string> = new Set()
    private flushing: boolean = false
    /** 写操作串行链。 */
    private chain: Promise<unknown> = Promise.resolve()
    private readonly retryDelayMs: number

    /**
     * 单调递增的请求世代号。每次 setRobotId / loadSettings 自增，异步回来后比对，
     * 不等则整段丢弃。用 generation 而不是裸比 robotId 是为了消除 A→B→A 的 ABA
     * 误判（与 MentionFreeVM 同款，见 BotManageVM.ts:64-72）。
     */
    private generation: number = 0

    constructor(robotId: string, options: BotCardSettingsVMOptions = {}) {
        super()
        this.robotId = robotId
        this.retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS
    }

    didMount(): void {
        void this.loadSettings()
    }

    /** 切换到另一个 bot：清空全部状态并重拉。 */
    setRobotId(robotId: string): void {
        if (this.robotId === robotId) return
        this.robotId = robotId
        this.generation++
        this.items = new Map()
        this.queued = new Map()
        this.sending = new Map()
        this.baseline = new Map()
        this.busy = new Set()
        this.flushing = false
        this.loading = false
        this.loadError = null
        this.writeError = null
        void this.loadSettings()
    }

    /** 当前可渲染快照（行 + 总闸）。 */
    snapshot(): BotCardSettingsSnapshot {
        const pendingKeys = new Set<string>([
            ...this.queued.keys(),
            ...this.sending.keys(),
        ])
        return buildRows(this.items, { pendingKeys, busyKeys: this.busy })
    }

    /** 是否已有可渲染数据（用于区分「首屏 spinner」和「静默刷新」）。 */
    get hasData(): boolean {
        return this.items.size > 0
    }

    get isBackendMissing(): boolean {
        return this.loadError?.kind === "backendMissing"
    }

    /** `err.server.robot.not_found`：该 bot 无 robot 记录（含 App Bot）。 */
    get isUnsupported(): boolean {
        return this.loadError?.kind === "unsupported"
    }

    get isForbidden(): boolean {
        return this.loadError?.kind === "forbidden"
    }

    /**
     * 拉取配置项目录。
     *
     * 响应带 `Cache-Control: private, no-store`，本地也不做任何缓存：每次进入 L3
     * 都会重拉，改完配置立刻重读必须看到新值。
     *
     * @param silent true = 不翻转 loading（「恢复默认」后的重拉走这条，避免整页
     *   spinner 闪一下）。
     */
    async loadSettings(options: { silent?: boolean } = {}): Promise<void> {
        const requestedUid = this.robotId
        if (!requestedUid) return
        const gen = ++this.generation
        const isStale = (): boolean => this.generation !== gen

        if (!options.silent) {
            this.loading = true
        }
        this.loadError = null
        this.notifyListener()
        try {
            const res = await this.withRetry(() =>
                BotManageService.listSettings(requestedUid),
            )
            if (isStale()) return
            this.items = indexSettingItems(res?.list)
            if (!hasUsableMasterKey(this.items)) {
                // 文档承诺总闸键一定在响应里。缺了就 fail-open（见 resolveMasterEnabled），
                // 但要留一条线索 —— 每次拉取只记一次，不能放进渲染路径。
                // eslint-disable-next-line no-console
                console.warn(
                    `[BotCardSettings] ${BOT_CARD_MASTER_KEY} missing from settings response; assuming enabled`,
                )
            }
            // 重拉整体替换 items，所以要把「尚未被服务端确认」的乐观覆盖重新盖回去，
            // 否则用户刚点的开关会在别的行「恢复默认」触发重拉时被打回原值。
            this.reapplyOptimistic()
        } catch (e) {
            if (isStale()) return
            this.items = new Map()
            this.loadError = classifyBotSettingError(e)
        } finally {
            if (!isStale()) {
                this.loading = false
                this.notifyListener()
            }
        }
    }

    /**
     * 切换某项开关。立刻本地乐观更新（bot 覆盖是最顶层，写入后的三元组可完整
     * 推导），然后进入合批队列。
     *
     * 返回是否已受理（只读 / 总闸关闭 / 该行正在恢复默认 → false）。
     *
     * 不做「目标态 == 当前生效值就短路」：用户可能就是想把「继承默认恰好为 true」
     * 固化成显式覆盖 true（这样上层全局默认改动后本 bot 不受影响），那是一次
     * 有意义的写入。
     */
    toggle(key: string, next: boolean): boolean {
        const row = this.snapshot().rows.find((item) => item.key === key)
        if (!row || row.disabled) return false
        if (!this.baseline.has(key)) {
            this.baseline.set(key, this.items.get(key))
        }
        this.items.set(key, applyOverride(this.items.get(key), key, next))
        this.queued.set(key, next)
        this.writeError = null
        this.notifyListener()
        void this.flush()
        return true
    }

    /**
     * 恢复默认 = DELETE 覆盖，回落到上一层（全局默认 / 代码默认），**不是设为 false**。
     *
     * 删完必须重拉：回落目标是哪一层、回落后的值是什么，前端无法本地推导 ——
     * 这正是 value / effective_value / source 三个字段不能合并的另一面。
     */
    async resetToDefault(key: string): Promise<boolean> {
        const requestedUid = this.robotId
        if (!requestedUid) return false
        const row = this.snapshot().rows.find((item) => item.key === key)
        if (!row || !row.editable || !row.overridden || this.busy.has(key)) {
            return false
        }
        const gen = this.generation

        this.busy.add(key)
        this.writeError = null
        this.notifyListener()
        let ok = false
        try {
            await this.enqueue(async () => {
                await this.withRetry(() =>
                    BotManageService.deleteSetting(requestedUid, key),
                )
                if (this.generation !== gen) return
                // 该 key 的覆盖已不存在，针对它的乐观状态 / 回滚快照一并作废。
                this.queued.delete(key)
                this.baseline.delete(key)
                await this.loadSettings({ silent: true })
                ok = true
            })
            return ok
        } catch (e) {
            if (this.generation === gen) {
                this.writeError = classifyBotSettingError(e)
                this.logIfInvalid(this.writeError, "deleteSetting", key)
            }
            return false
        } finally {
            // busy 不是世代作用域的状态：无论是否已切 bot 都必须清理，否则这一行
            // 会永久禁用（注意 loadSettings 自身会自增 generation，所以这里绝不能
            // 套 isStale 守卫）。
            this.busy.delete(key)
            this.notifyListener()
        }
    }

    /** 手动重试首屏。 */
    reload(): void {
        void this.loadSettings()
    }

    /**
     * 发送排队中的覆盖。已在发送则直接返回 —— 新点击留在 queued 里，等这一批回来
     * 后由本方法的循环作为下一批发出（把连点 N 次压成 2 个请求）。
     */
    private async flush(): Promise<void> {
        if (this.flushing) return
        const requestedUid = this.robotId
        if (!requestedUid) return
        this.flushing = true
        try {
            while (this.queued.size > 0) {
                const gen = this.generation
                this.sending = this.queued
                this.queued = new Map()
                const items = this.buildWriteItems(this.sending)
                if (items.length === 0) {
                    this.sending = new Map()
                    continue
                }
                try {
                    await this.enqueue(() =>
                        this.withRetry(() =>
                            BotManageService.putSettings(requestedUid, items),
                        ),
                    )
                    if (this.generation !== gen) {
                        this.sending = new Map()
                        return
                    }
                    // 这一批已被服务端确认。仍在 queued 里的同 key 保留其 baseline
                    // 作为后续回滚目标，其余 key 的快照可以丢。
                    for (const key of this.sending.keys()) {
                        if (!this.queued.has(key)) this.baseline.delete(key)
                    }
                    this.sending = new Map()
                    this.notifyListener()
                } catch (e) {
                    if (this.generation !== gen) {
                        this.sending = new Map()
                        return
                    }
                    const error = classifyBotSettingError(e)
                    this.writeError = error
                    this.logIfInvalid(error, "putSettings")
                    // 全批原子：整批都没生效，所以把这一批 + 还在排队的改动一起
                    // 回滚到 baseline，让开关弹回真实状态。
                    this.rollbackPending()
                    this.notifyListener()
                    return
                }
            }
        } finally {
            this.flushing = false
        }
    }

    /** 把写操作排到串行链尾。前一个失败不阻断后一个。 */
    private enqueue<T>(task: () => Promise<T>): Promise<T> {
        const run = this.chain.then(task, task)
        this.chain = run.then(
            () => undefined,
            () => undefined,
        )
        return run
    }

    /** 构造 PUT payload。防御性排除只读键（写只读键会 400 并拖垮整批）。 */
    private buildWriteItems(source: Map<string, boolean>): BotSettingWriteItem[] {
        const items: BotSettingWriteItem[] = []
        for (const [key, value] of source) {
            const item = this.items.get(key)
            if (item && item.editable === false) continue
            items.push({ key, value })
        }
        return items
    }

    /** 把 sending + queued 全部回滚到 baseline 并清空待写状态。 */
    private rollbackPending(): void {
        const keys = new Set<string>([
            ...this.sending.keys(),
            ...this.queued.keys(),
        ])
        for (const key of keys) {
            if (!this.baseline.has(key)) continue
            const original = this.baseline.get(key)
            if (original) {
                this.items.set(key, original)
            } else {
                this.items.delete(key)
            }
            this.baseline.delete(key)
        }
        this.sending = new Map()
        this.queued = new Map()
    }

    /** 重拉后把未确认的乐观覆盖重新盖回 items。 */
    private reapplyOptimistic(): void {
        for (const [key, value] of this.sending) {
            this.items.set(key, applyOverride(this.items.get(key), key, value))
        }
        for (const [key, value] of this.queued) {
            this.items.set(key, applyOverride(this.items.get(key), key, value))
        }
    }

    /**
     * 有界自动重试。三个端点都是幂等的（GET 天然；PUT 是覆盖赋值；DELETE 文档
     * 明确幂等），所以重试不会叠加副作用。
     *
     * 只重试服务端错误（query_failed / store_failed / err.shared.internal）——
     * 这类错误的线路状态码被钉成 400，**不能**当成「参数有问题」提示用户改输入。
     * request_invalid / creator_only / not_found / 429 一律不重试。
     */
    private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
        let lastError: unknown
        for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
            try {
                return await fn()
            } catch (e) {
                lastError = e
                if (classifyBotSettingError(e).kind !== "retryable") throw e
                if (attempt === MAX_RETRY) break
                if (this.retryDelayMs > 0) {
                    await new Promise((resolve) =>
                        setTimeout(resolve, this.retryDelayMs),
                    )
                }
            }
        }
        throw lastError
    }

    /**
     * `request_invalid` 正常流程下不该出现（出现即前端 bug：写了未注册的 key、
     * 只读键或非法 value）。把服务端给的 details.field 打出来便于定位，对用户
     * 只显示通用失败文案。
     */
    private logIfInvalid(
        error: BotSettingError,
        op: string,
        key?: string,
    ): void {
        if (error.kind !== "invalid") return
        // eslint-disable-next-line no-console
        console.warn(`[BotCardSettings] ${op} rejected as invalid`, {
            field: error.field,
            key,
            code: error.code,
        })
    }
}

export default BotCardSettingsVM
