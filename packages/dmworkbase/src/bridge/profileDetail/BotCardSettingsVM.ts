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
 * BotCardSettingsVM —— L3「卡片消息设置」ViewModel。
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
    /** 写入 / 取消自定义的错误（行内提示，不接管整页）。 */
    writeError: BotSettingError | null = null

    private items: Map<string, BotSettingItem> = new Map()
    /** 已排队待发送的覆盖（key → value）。 */
    private queued: Map<string, boolean> = new Map()
    /** 已从队列取出、等待服务端确认的这一批覆盖。 */
    private sending: Map<string, boolean> = new Map()
    /** 回滚快照：key → 进入待写状态前最后一次被服务端确认的 item。 */
    private baseline: Map<string, BotSettingItem | undefined> = new Map()
    /** 正在「取消自定义」的 key（DELETE + 重拉期间禁用该行）。 */
    private busy: Set<string> = new Set()
    private flushing: boolean = false
    /** 写操作串行链。 */
    private chain: Promise<unknown> = Promise.resolve()
    private readonly retryDelayMs: number

    /**
     * 单调递增的请求世代号。每次 setRobotId / loadSettings 自增，异步回来后比对，
     * 不等则整段丢弃。用 generation 而不是裸比 robotId 是为了消除 A→B→A 的 ABA
     * 误判（与 MentionFreeVM 同款，见 BotManageVM.ts:64-72）。
     *
     * ⚠️ 只用于「GET 响应是否过期」。写路径**不能**用它 —— 见 epoch。
     */
    private generation: number = 0

    /**
     * bot 身份世代号，**只在 setRobotId 时**自增。
     *
     * 写路径（flush / resetToDefault）的过期判据必须是「bot 换了吗」，而不是
     * 「数据重拉过吗」。早先两者共用 generation，因为 loadSettings 也自增它，
     * 导致两个真实缺陷：
     *
     *   1. 连续点两行的「取消自定义」：第一次的删后重拉推进了 generation，第二次的
     *      DELETE 明明成功了却被判成过期 → 跳过重拉，UI 继续显示已被删掉的覆盖。
     *   2. 切 bot 时旧 bot 的 PUT 还在飞：它回来后按 generation 判过期并顺手清空
     *      了 `sending`，而那时 `sending` 已经属于新 bot 的批次 → 新 bot 写入失败时
     *      rollbackPending 找不到 key，乐观状态回滚不掉，开关停在从未落库的值上。
     *
     * 两者都有回归测试兜着（见 __tests__/BotCardSettingsVM.test.ts 的
     *「写路径过期判据」一节）。
     */
    private epoch: number = 0

    /**
     * 已确认写入的序号，**每次 PUT / DELETE 被服务端确认后自增**。
     *
     * `items` 有两个独立写入者 —— GET 的整体替换、以及逐 key 的乐观覆盖 —— 而只有
     * 写侧串行走 `chain`。`loadSettings` 是唯一不上链的请求路径，光靠 `generation`
     * （只有读会自增）无法发现「这个读比某次已提交的写更旧」：
     *
     *   probe GET 发出 → 用户点开关 → PUT 提交（服务端已改） → GET 才落地
     *
     * 此时 GET 带回的是提交前的快照，而 `reapplyOptimistic` 只重放 `sending ∪ queued`
     * —— 已确认的写两个集合都不在（成功分支已清），于是那次写被静默回退：开关显示
     * 「开」而服务端是关、副标题谎称「未自定义」、`overridden` 变 false 连「取消自定义」
     * 都没了，且 `writeError` 为 null 什么都不提示。
     *
     * 所以读要同时对写作废：发起前捕获 writeSeq，落地时若已变化就整段丢弃。丢弃是安全的
     * —— 被丢的只是一次刷新，`items` 里留着的是刚被确认的值（对那些 key 就是服务端真值），
     * 其余 key 保持上一次读到的值，下次打开会重新拉。
     *
     * 用 writeSeq 而不是把 loadSettings 也挂上 `chain`：探测请求不该被排在写入队列后面
     * 等着，而且 `chain` 无超时（见 setRobotId 对 chain 的重置）。
     */
    private writeSeq: number = 0

    constructor(robotId: string, options: BotCardSettingsVMOptions = {}) {
        super()
        this.robotId = robotId
        this.retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS
    }

    /**
     * 切换到另一个 bot：清空全部状态并重拉。
     *
     * 刻意丢弃 `queued` 里尚未发出的写入。这些是用户已经在旧 bot 上看到"生效"的
     * 点击，理论上应该补发，但补发意味着往一个用户已经离开的 bot 上写入，而此刻
     * 界面已经切走、失败也无处提示 —— 静默写比静默丢更糟。窗口本身也极窄：`queued`
     * 只在真有 PUT 在飞时才有内容，而 L3 是覆盖在资料卡上的模态，从 L3 直接切 bot
     * 很难触达。这是个明确的取舍，不是疏漏。
     */
    setRobotId(robotId: string): void {
        if (this.robotId === robotId) return
        this.robotId = robotId
        this.generation++
        this.epoch++
        this.items = new Map()
        this.queued = new Map()
        this.sending = new Map()
        this.baseline = new Map()
        this.busy = new Set()
        this.flushing = false
        // 重置串行链。链上没有超时，一个永不 settle 的请求会队头阻塞**后续所有 bot**
        // 的所有写入，并让 resetToDefault 的 finally 永远不执行、那一行永久禁用。
        // 换掉链就把新 bot 从旧 bot 的卡死里解脱出来（旧请求本身无法取消 ——
        // BotManageService 没有 AbortController —— 但它的结果会被 epoch 判掉）。
        this.chain = Promise.resolve()
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
     * 响应带 `Cache-Control: private, no-store`，本地也不做任何缓存：每次打开都会
     * 重拉，改完配置立刻重读必须看到新值。
     *
     * @param silent true = 不翻转 loading（「取消自定义」后的重拉走这条，避免整页
     *   spinner 闪一下）。
     */
    async loadSettings(options: { silent?: boolean } = {}): Promise<void> {
        const requestedUid = this.robotId
        if (!requestedUid) return
        const gen = ++this.generation
        // 捕获写序号：见 writeSeq 的说明。读**必须**同时对写作废，否则一个在 PUT
        // 提交之前发出的 GET 落在提交之后时会把已确认的值覆盖回提交前的快照。
        const seq = this.writeSeq
        // 读期间新产生的写错误不能被这次读清掉（见下面清 writeError 的地方）。
        // 用对象身份比较即可：每次失败都会 new 一个新的 BotSettingError。
        const writeErrorAtStart = this.writeError

        /**
         * 「被取代」：有更新的读在飞，或者已经切了 bot。**只有这种情况才该让位**
         * —— 接管 loading 的是那个更新的请求。
         */
        const isSuperseded = (): boolean => this.generation !== gen
        /**
         * 「响应不可用」：被取代，或者期间有写入落库 —— 后者意味着我们手上这份
         * 响应是提交前的快照，不能拿它去覆盖已确认的值。
         *
         * 和 isSuperseded 分开是必须的：被写作废时**没有更新的读**，如果 finally
         * 也用 isStale 判断，`loading` 就永远没人清，而 probeCardSettings 的
         * `!vm.loading` 守卫会把之后每一次重开的探测全部吞掉 —— 「每次打开一次
         * 新鲜读取」在整个会话里被废掉，且没有任何可见症状。
         */
        const isStale = (): boolean => isSuperseded() || this.writeSeq !== seq

        if (!options.silent) {
            this.loading = true
        }
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
            // 把待写 key 的回滚快照对齐到刚读到的服务端值。不对齐的话，后续写失败会
            // 回滚到「这次读之前」的值 —— 那个值服务端和最新一次读都不认（比如别的
            // 客户端 / 别的设备刚改过）。
            this.reconcileBaseline()
            // 重拉整体替换 items，所以要把「尚未被服务端确认」的乐观覆盖重新盖回去，
            // 否则用户刚点的开关会在别的行「取消自定义」触发重拉时被打回原值。
            this.reapplyOptimistic()
            this.loadError = null
            // 只清「比这次读更早」的写错误横幅：读成功说明那次失败的解释已经过时。
            // 但失败的写**不**自增 writeSeq（什么都没提交，这是对的），所以一个在写
            // 失败之前发出的读落地时不算过期 —— 无条件清就会把一条比它更新的错误
            // 抹掉，用户看到开关弹回去却没有任何解释（读屏用户更糟：先被 role="alert"
            // 播报、然后文字消失）。
            if (this.writeError === writeErrorAtStart) {
                this.writeError = null
            }
        } catch (e) {
            if (isStale()) return
            this.items = new Map()
            this.loadError = classifyBotSettingError(e)
        } finally {
            // 注意是 isSuperseded 而不是 isStale：被写作废的读也必须清掉自己的
            // loading，否则没有任何人会清。
            if (!isSuperseded()) {
                this.loading = false
                this.notifyListener()
            }
        }
    }

    /**
     * 切换某项开关。立刻本地乐观更新（bot 覆盖是最顶层，写入后的三元组可完整
     * 推导），然后进入合批队列。
     *
     * 返回是否已受理（只读 / 总闸关闭 / 该行正在取消自定义 → false）。
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
     * 取消自定义 = DELETE 覆盖，回落到上一层（全局默认 / 代码默认），**不是设为 false**。
     *
     * 删完必须重拉：回落目标是哪一层、回落后的值是什么，前端无法本地推导 ——
     * 这正是 value / effective_value / source 三个字段不能合并的另一面。
     */
    async resetToDefault(key: string): Promise<boolean> {
        const requestedUid = this.robotId
        if (!requestedUid) return false
        const row = this.snapshot().rows.find((item) => item.key === key)
        // row.disabled 已涵盖只读 / 总闸关闭 / 该行正在取消自定义三种情况。总闸关闭
        // 时也拒绝：此刻这一项的生效值反正是 false，删覆盖没有任何可观察效果，而
        // 界面已经把整组开关置灰了 —— 再留一个能生效的删除动作等于自相矛盾。
        //
        // 还要挡 pending（视图的 disabled 里有、VM 这边原先漏了，等于只靠一个渲染
        // 属性守卫）。有在飞写入时删除会排出 PUT#1 → DELETE+重拉 → PUT#2 的顺序，
        // 于是重置报成功后立刻被 PUT#2 重建的覆盖顶掉。
        if (!row || !row.overridden || row.disabled || row.pending) {
            return false
        }
        // 同 flush：过期判据是 epoch。用 generation 会让「连点两行取消自定义」的第二次
        // 被第一次的删后重拉误判成过期，从而跳过重拉、UI 停在已删掉的覆盖上。
        const myEpoch = this.epoch

        this.busy.add(key)
        this.writeError = null
        this.notifyListener()
        let ok = false
        try {
            await this.enqueue(async () => {
                await this.withRetry(() =>
                    BotManageService.deleteSetting(requestedUid, key),
                )
                if (this.epoch !== myEpoch) return
                // 该 key 的覆盖已不存在，针对它的乐观状态 / 回滚快照一并作废。
                this.queued.delete(key)
                this.baseline.delete(key)
                // 服务端状态已改：让任何在飞的读作废（见 writeSeq）。必须在下面
                // 的重拉之前自增，否则那次重拉自己就会被判过期。
                this.writeSeq++
                await this.loadSettings({ silent: true })
                // 删除成功但重拉失败时 loadError 已被置上，整页会切到「加载失败 +
                // 重试」—— 那种情况不算成功，否则调用方会以为界面已是权威状态。
                ok = this.loadError === null
            })
            return ok
        } catch (e) {
            if (this.epoch === myEpoch) {
                this.writeError = classifyBotSettingError(e)
                this.logIfInvalid(this.writeError, "deleteSetting", key)
            }
            return false
        } finally {
            // busy 的清理必须按 epoch 隔离。`setRobotId` 会把 busy 整个换成新 Set，
            // 此时旧 bot 的 reset 回来若无条件 delete，删掉的是**新 bot** 的键 ——
            // 新 bot 自己的 DELETE 还在飞就被解除禁用，串行化白做了。
            //
            // epoch 未变时则必须清理，否则这一行永久禁用。注意判据只能是 epoch：
            // loadSettings 会自增 generation，用它会让正常的删后重拉跳过清理。
            if (this.epoch === myEpoch) {
                this.busy.delete(key)
                this.notifyListener()
            }
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
        // 过期判据是 epoch（bot 是否换了），不是 generation —— 中途的重拉不能让这一
        // 轮写入作废，否则 baseline 清理会被跳过，后续失败会回滚到过期值。
        const myEpoch = this.epoch
        this.flushing = true
        try {
            while (this.queued.size > 0) {
                if (this.epoch !== myEpoch) return
                this.sending = this.queued
                this.queued = new Map()
                const { items, dropped } = this.buildWriteItems(this.sending)
                if (dropped.length > 0) {
                    // 这些 key 在点击与 flush 之间变成了只读（例如中途的重拉带回
                    // editable:false），永远不会被发送。必须立刻回滚它们的乐观覆盖并
                    // 移出 sending —— 否则下面的成功分支会把它们当作「已确认」走
                    // baseline.delete，销毁一个从未发送过的覆盖的回滚快照。那样留在
                    // 屏幕上的是：服务端从未接受过的「已自定义」，而只读行既点不动、
                    // 又因 overridden && editable 为假而没有重置按钮 —— 页内零恢复。
                    this.rollbackKeys(dropped)
                    for (const key of dropped) this.sending.delete(key)
                    this.notifyListener()
                }
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
                    // 已切 bot：直接退出，**不要**碰 sending / queued —— setRobotId
                    // 早已重置过它们，此刻里面装的是新 bot 的批次，清掉会让新 bot
                    // 的失败回滚失效。
                    if (this.epoch !== myEpoch) return
                    // 服务端状态已改：让任何在飞的读作废（见 writeSeq）。
                    this.writeSeq++
                    // 这一批已被服务端确认，逐 key 处理它的回滚快照：
                    //   - 该 key 没有新的排队 → 快照可以丢；
                    //   - 该 key 又被排队了（在飞期间用户再点了同一行）→ **必须把
                    //     快照推进到刚被确认的状态**，不能留着「第一次写入之前」的。
                    //
                    // 留旧快照会回滚过头：PUT#1 成功、同 key 的 PUT#2 失败时，
                    // rollbackPending 会把 UI 退回未覆盖状态，而服务端已经有了
                    // PUT#1 写进去的显式覆盖。更糟的是 overridden 随之变回 false，
                    // 「取消自定义」按钮消失 —— 用户在界面上再没有任何途径清掉那个
                    // 刚被创建的覆盖，且写失败不触发重拉，错状态会一直留着。
                    for (const [key, confirmed] of this.sending) {
                        if (this.queued.has(key)) {
                            this.baseline.set(
                                key,
                                applyOverride(
                                    this.baseline.get(key),
                                    key,
                                    confirmed,
                                ),
                            )
                        } else {
                            this.baseline.delete(key)
                        }
                    }
                    this.sending = new Map()
                    this.notifyListener()
                } catch (e) {
                    if (this.epoch !== myEpoch) return
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
            // 已切 bot 时不复位：setRobotId 已经把 flushing 置回 false，而那之后
            // 可能已有属于新 epoch 的 flush 在跑，这里再写一次会误清它的标记。
            if (this.epoch === myEpoch) this.flushing = false
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

    /**
     * 构造 PUT payload，同时报告被丢弃的 key。
     *
     * 丢弃只读键（写只读键会 400 并拖垮整批）。调用方必须把 `dropped` 回滚掉 ——
     * 它们的乐观覆盖不会有任何请求去落实。
     */
    private buildWriteItems(source: Map<string, boolean>): {
        items: BotSettingWriteItem[]
        dropped: string[]
    } {
        const items: BotSettingWriteItem[] = []
        const dropped: string[] = []
        for (const [key, value] of source) {
            const item = this.items.get(key)
            if (item && item.editable === false) {
                dropped.push(key)
                continue
            }
            items.push({ key, value })
        }
        return { items, dropped }
    }

    /** 把给定 key 回滚到 baseline 并丢弃它们的快照。 */
    private rollbackKeys(keys: Iterable<string>): void {
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
    }

    /** 把 sending + queued 全部回滚到 baseline 并清空待写状态。 */
    private rollbackPending(): void {
        this.rollbackKeys(
            new Set<string>([...this.sending.keys(), ...this.queued.keys()]),
        )
        this.sending = new Map()
        this.queued = new Map()
    }

    /**
     * 把待写 key 的回滚快照对齐到 `items` 里刚读到的服务端值。
     *
     * 必须在 reapplyOptimistic **之前**调用 —— 那之后 items 里是乐观值，不是服务端值。
     */
    private reconcileBaseline(): void {
        for (const key of Array.from(this.baseline.keys())) {
            this.baseline.set(key, this.items.get(key))
        }
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
            // 服务端消息只落日志，不进 DOM（见 BotSettingError.message）。
            message: error.message,
        })
    }
}

export default BotCardSettingsVM
