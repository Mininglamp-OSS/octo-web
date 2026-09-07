/**
 * 侧边栏待关注红点的【自适应兜底轮询】。
 *
 * 为什么还需要定时器（summaryAttentionSync 的注释里刚说过不加轮询）：
 * 那句话针对的是 #1213 那种「固定 5s、不管标签页可不可见、每个标签页各轮各的」
 * 的轮询——~720 请求/用户/小时，产品砍掉它的判断至今有效，本文件不打算翻案。
 *
 * 但 summaryAttentionSync 覆盖的全是【已经发生的事件】：IM 提示消息、IM 重连、
 * 用户切回标签页。有两个状态压根没有任何事件可以搭：
 *   1. 别人把你拉进一个多人总结（产品定下邀请不发 IM，internal/notify 只有
 *      completed/failed，所以 IM 侧永远等不到）；
 *   2. 「轮到你提交了」（pending_submission）——它是别人提交或后端生成完成后
 *      在服务端算出来的派生状态，同样没有推送。
 * 这两个状态下用户【什么都不做】，桌面端一开就是一整天，红点可以一整天不动。
 * 所以兜底必须由时间驱动，不能由动作驱动。
 *
 * 于是代价压在四个维度上，缺一不可：
 *   - 自适应：值不变就退避 15→30→60s。真正在等邀请/等提交的用户，值一变就被
 *     拉回 15s；没事发生的用户（绝大多数时间）自动滑到 60s。
 *   - 可见性门控：标签页不可见时【停表】而不是空转跳过。后台标签页占了挂机
 *     时间的绝大部分，停表把这部分请求归零；而且浏览器本来就会把后台
 *     setTimeout 节流到 ≥1min，空转跳过只是把节流后的醒来浪费掉。
 *   - 跨标签页只有一个 leader 在轮询（见 summaryAttentionLeader.ts）。开五个
 *     OCTO 标签页不该是五倍请求。
 *   - 抖动：±10%。否则一批同时开机的客户端会长期同相，把负载堆成尖峰。
 *
 * 所有外部依赖（时钟、setTimeout/clearTimeout、可见性、取数函数、随机数）都从
 * 参数注入：定时器逻辑不可注入就只能靠 sleep 测，那种测试必然又慢又飘。
 */

/** 基础间隔。值有变化、或有事件唤醒时，一律回到这一档。 */
export const POLL_BASE_INTERVAL_MS = 15_000;

/** 退避上限。再长的话，「轮到你提交」的感知延迟就超出可接受范围了。 */
export const POLL_MAX_INTERVAL_MS = 60_000;

/**
 * 连续多少次「值没变」才升一档。
 *
 * 取 3 而不是 1：值没变是常态（大多数轮询本就该什么都不返回），一次没变就退避
 * 会让间隔几乎永远停在上限，自适应形同虚设。3 次 ≈ 45s 的观察窗口，既能确认
 * 「这段时间确实是安静的」，又不会让刚变完的用户马上被退避拖慢。
 */
export const POLL_UNCHANGED_THRESHOLD = 3;

/** 抖动幅度：实际间隔 = interval × (1 ± 0.1)。 */
export const POLL_JITTER_RATIO = 0.1;

export interface AttentionPollDeps {
    /**
     * 取一次计数。resolve 的值参与「变没变」的比较；reject 视为失败。
     *
     * ⚠️ 实现方内部必须自己完成 ticket 的领/交/还（见 summaryAttentionBadge）。
     * 本文件【不碰】ticket：定时器是号段的第三个并发写者，如果它在这里自己领号，
     * 就会出现「轮询领了号 → 用户打开列表也领了号 → 轮询的旧响应最后到达」这条
     * 竞态，而判断哪个号该作废需要知道请求实际发出的时刻——那是取数函数的内部
     * 信息，不是调度器的。调度器只关心「返回的数跟上次比变没变」。
     */
    fetchCount: () => Promise<number>;
    /** 标签页当前是否可见。不传时按「一直可见」处理（非浏览器宿主）。 */
    isVisible?: () => boolean;
    now?: () => number;
    setTimeoutFn?: (handler: () => void, timeout: number) => unknown;
    clearTimeoutFn?: (handle: unknown) => void;
    /** [0,1) 随机数，注入以便测试抖动边界。 */
    random?: () => number;
    /** 每次成功取到计数后的回调（leader 用它广播给其它标签页）。 */
    onCount?: (count: number) => void;
}

export interface AttentionPoll {
    /** 开始调度。重复调用是幂等的。 */
    start(): void;
    /** 停表并丢弃已排期的 tick。在飞的请求不取消，但它的结果不会再排下一次。 */
    stop(): void;
    /**
     * 有事件发生（聚焦 / 变可见 / 切 Space / 站内路由切换）。
     * 语义：间隔重置到基础档 + 立刻取一次数。
     */
    notifyActivity(): void;
    /** 可见性变化。可见→开表并立即取数；不可见→停表。 */
    setVisible(visible: boolean): void;
    /** 测试/诊断用：当前这一档间隔（未加抖动）。 */
    getCurrentIntervalMs(): number;
    /** 测试/诊断用：是否有请求在飞。 */
    isFetching(): boolean;
}

export function createAttentionPoll(deps: AttentionPollDeps): AttentionPoll {
    const isVisible = deps.isVisible ?? (() => true);
    const setTimeoutFn = deps.setTimeoutFn ?? ((h, t) => setTimeout(h, t));
    const clearTimeoutFn = deps.clearTimeoutFn ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    const random = deps.random ?? Math.random;

    let started = false;
    let timer: unknown = null;
    let intervalMs = POLL_BASE_INTERVAL_MS;
    let unchangedRuns = 0;
    /**
     * 上一次成功取到的计数。undefined = 还没成功取过。
     * 用 undefined 而不是 -1 做哨兵：计数被规范化成非负整数，-1 不可能出现，
     * 但把哨兵混进值域里迟早会有人拿它去比大小。
     */
    let lastCount: number | undefined;
    /**
     * 请求互斥。绝不允许两个轮询同时在飞：它们会各自领一个 ticket，两个号在
     * 号段里互相作废，其中一个的结果注定被丢——发出去只是白费一个请求，还平白
     * 增加一次「新号作废旧号的正确值」的机会。
     */
    let fetching = false;

    const clearTimer = () => {
        if (timer !== null) {
            clearTimeoutFn(timer);
            timer = null;
        }
    };

    /**
     * 给间隔加 ±POLL_JITTER_RATIO 的抖动。
     *
     * 必要性来自「唤醒是同相的」：一批客户端往往在同一时刻被同一件事唤醒
     * （早上开工、断网恢复、发版后全员刷新），此后它们的 tick 会长期锁在同一
     * 相位上，把本该摊平的负载堆成周期性尖峰。抖动让相位随时间发散。
     * 向下取整到 ms，并夹到 ≥0：注入的 random 若给出边界值也不能排出负延时。
     */
    const withJitter = (base: number): number => {
        const factor = 1 + (random() * 2 - 1) * POLL_JITTER_RATIO;
        return Math.max(0, Math.round(base * factor));
    };

    const schedule = () => {
        clearTimer();
        if (!started || !isVisible()) return;
        timer = setTimeoutFn(tick, withJitter(intervalMs));
    };

    const onUnchanged = () => {
        unchangedRuns += 1;
        if (unchangedRuns >= POLL_UNCHANGED_THRESHOLD && intervalMs < POLL_MAX_INTERVAL_MS) {
            intervalMs = Math.min(intervalMs * 2, POLL_MAX_INTERVAL_MS);
            // 升档后重新计数，否则一旦越过阈值就会每次都升，直接冲到上限。
            unchangedRuns = 0;
        }
    };

    const onChanged = () => {
        unchangedRuns = 0;
        intervalMs = POLL_BASE_INTERVAL_MS;
    };

    async function tick(): Promise<void> {
        timer = null;
        if (!started || !isVisible()) return;
        // 互斥：上一次还没回来就跳过这一拍，并且【不】重排——在飞请求收尾时
        // 会自己排下一拍，在这里再排一次就是把两条调度链并成两倍频率。
        if (fetching) return;

        fetching = true;
        try {
            const count = await deps.fetchCount();
            if (lastCount === undefined || count !== lastCount) {
                lastCount = count;
                onChanged();
            } else {
                onUnchanged();
            }
            deps.onCount?.(count);
        } catch {
            /**
             * 失败静默：红点是锦上添花，网络异常不该打扰用户，值保持原样
             * （与 refreshSummaryAttentionBadge 同一策略）。
             *
             * 失败按【比未变化更强】的退避处理：直接升到下一档，不走
             * unchangedRuns 的三次窗口。后端 5xx 或断网时，正常节奏的重试
             * 只会给已经出问题的服务端继续加压。
             *
             * 同时【不】动 unchangedRuns：失败没有带回任何关于「值变没变」的
             * 信息，把它当成一次「未变化」会污染自适应的判据——一串失败会伪装
             * 成一段安静期，恢复后的第一次成功还得从被失败推高的档位慢慢爬。
             * 也【不】动 lastCount：下一次成功若与失败前的值相同，那就是真的
             * 没变；若不同，才该回到基础档。
             */
            intervalMs = Math.min(intervalMs * 2, POLL_MAX_INTERVAL_MS);
        } finally {
            fetching = false;
        }
        schedule();
    }

    return {
        start(): void {
            if (started) return;
            started = true;
            schedule();
        },
        stop(): void {
            started = false;
            clearTimer();
            // fetching 不在这里清：在飞的请求仍会走完 finally 把它放掉。
            // 强行清零会让那个请求回来时与新一轮轮询并发，互斥就漏了。
        },
        notifyActivity(): void {
            onChanged();
            if (!started || !isVisible()) return;
            // 立刻取一次，然后由 tick 自己重排。已排期的 tick 先撤掉，避免
            // 立刻这次和它挨在一起打两枪。
            clearTimer();
            void tick();
        },
        setVisible(visible: boolean): void {
            if (!visible) {
                // 【停表】而不是留着定时器空转跳过：后台标签页的 setTimeout 会被
                // 浏览器节流到 ≥1min，留着它既省不了什么，又要在每次醒来时判空，
                // 还会在标签页被丢进 bfcache 时留一个悬挂回调。
                clearTimer();
                return;
            }
            if (!started) return;
            // 重新可见等同于一次活动：用户回到页面时看到的第一眼必须是新的。
            this.notifyActivity();
        },
        getCurrentIntervalMs(): number {
            return intervalMs;
        },
        isFetching(): boolean {
            return fetching;
        },
    };
}
