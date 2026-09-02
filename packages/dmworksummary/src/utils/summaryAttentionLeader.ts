/**
 * 跨标签页 leader 选举（租约式），用于让待关注红点的兜底轮询
 * （utils/summaryAttentionPoll.ts）在一个浏览器里【只跑一份】。
 *
 * 问题：用户常年开着三五个 OCTO 标签页。轮询若每个标签页各跑各的，请求量直接
 * 乘以标签页数，自适应退避省下来的量瞬间被抵消掉。
 *
 * ═══ 为什么是「租约」而不是「选一次」 ═══
 *
 * 直觉写法是：抢到锁的当 leader，卸载时（beforeunload）释放。这个写法有一个
 * 低概率但后果极重的死角：标签页可以在【不执行任何卸载回调】的情况下消失——
 * 进程 OOM 被杀、系统强杀、断电、崩溃、移动端被系统回收。此时 localStorage 里
 * 的锁还在，而持锁的那个标签页已经不存在了。剩下的所有标签页都会认为「已经有
 * leader 了，我不轮询」，于是【没有任何人轮询】，红点永久变暗，直到用户手动刷新
 * 全部标签页。更糟的是：单测发现不了它——单测里没有人会被 OOM 杀掉，
 * 「选一次」的实现在测试里表现完美。
 *
 * 所以这里用租约：leader 必须【持续】往 localStorage 写心跳时间戳；其它标签页
 * 看到租约过期（超过 STALE_AFTER_MS）就直接接管。leader 死了最多静默一个接管
 * 阈值的时间，之后自动恢复。正常卸载时清一下租约只是【优化】（让接管立即发生
 * 而不必等超时），正确性一点都不依赖它。
 *
 * ═══ 降级：宁可多打请求，也不能没人打 ═══
 *
 * 本仓库还出 Electron 包（apps/web 的 dev-ele / start:electron）。多窗口
 * Electron 下 localStorage 与 BroadcastChannel 是否跨窗口共享，取决于渲染进程的
 * partition 配置，未经验证；隐私模式、被策略禁用的存储、以及注入了残废
 * localStorage 的嵌入环境同样存在。所以任何一环不可用或不工作，一律降级成
 * 【每个标签页自己轮询】。
 *
 * 这是刻意选的方向：两种失败模式不对等。「多打几个请求」是可计量、可承受的
 * 浪费；「没人打」是功能静默消失，而且用户不会报 bug，只会觉得这个红点不准。
 * 探测也不能只看 `typeof localStorage !== 'undefined'`——Safari 隐私模式下它
 * 存在但 setItem 抛异常，必须真写一次。
 */

const LEASE_KEY = 'octo:summary-attention-leader';
const CHANNEL_NAME = 'octo:summary-attention';

/**
 * 心跳周期。3s 是在两件事之间取的折中：
 *   - 太长（比如 10s）→ 接管阈值跟着变长，leader 崩溃后的静默窗口更长；
 *   - 太短（比如 500ms）→ 每秒往 localStorage 写两次，而 localStorage 写是
 *     【同步】的，会阻塞主线程，还会在所有标签页触发 storage 事件。
 * 3s 相对轮询基础间隔 15s 足够密，代价又可以忽略。
 */
export const LEADER_HEARTBEAT_MS = 3_000;

/**
 * 接管阈值 = 2.5 × 心跳周期。
 *
 * 下界要 >2 个心跳：只等 1 个周期的话，一次 GC 停顿、一次主线程被长任务占住、
 * 或者系统休眠恢复的瞬间，都会让活着的 leader 被误判成死的，两个标签页同时
 * 认为自己是 leader（双份轮询 + 互相打架）。留 2 个周期意味着要连丢两拍才判死。
 * 取 2.5 而不是整 2，是给「刚好卡在边界上」留一点余量。
 *
 * 上界要够小：leader 崩溃后的红点静默窗口就是这个值（7.5s），明显短于轮询
 * 自身的基础间隔，用户感知不到。
 */
export const LEADER_STALE_AFTER_MS = LEADER_HEARTBEAT_MS * 2.5;

interface LeaseRecord {
    /** 持有者标识，用来确认「这条租约还是我的」。 */
    id: string;
    /** 最近一次心跳的时间戳。 */
    ts: number;
}

export interface AttentionLeaderDeps {
    /** 成为 leader 时调用（开始轮询）。 */
    onBecomeLeader: () => void;
    /** 失去 leader 身份时调用（停止轮询）。 */
    onResignLeader: () => void;
    /**
     * 收到别的标签页广播来的计数。`spaceId` 是 leader 取数时所在的 Space，
     * `sampleAt` 是这份样本【所反映的服务端时刻】（见 publish 的注释）。
     */
    onRemoteCount?: (count: number, spaceId: string, sampleAt: number) => void;
    /**
     * 本标签页当前是否可见。不传时按「一直可见」处理（非浏览器宿主）。
     *
     * 可见性必须是【选主资格】而不只是轮询开关。轮询本身在不可见时停表
     * （见 summaryAttentionPoll.setVisible），但如果 leader 身份不受可见性约束，
     * 隐藏的 leader 就会变成一个「占着租约却不干活」的空壳：它每 3s 照常续租，
     * 其它可见标签页看到租约新鲜、永不接管，于是整个浏览器【没有任何人轮询】。
     *
     * 这不是理论交错。Chrome 对隐藏标签页的节流是分级的：intensive throttling
     * （≤1 次/分钟）要隐藏满约 5 分钟才介入，在那之前 ≥1s 的 setInterval 照常
     * 触发（只有 <1s 会被钳到 1s）。所以「从 leader 标签页切到同窗口的另一个
     * OCTO 标签页」——最常见不过的操作——会让兜底轮询静默最长约 5 分钟，
     * 直到节流生效、租约终于馊掉才自愈。而这恰恰打在本功能唯一的存在理由上：
     * 用户盯着一个可见标签页、暂时没有交互时，红点必须自己会亮。
     */
    isVisible?: () => boolean;
    now?: () => number;
    setIntervalFn?: (handler: () => void, timeout: number) => unknown;
    clearIntervalFn?: (handle: unknown) => void;
    /** 注入存储，测试用；不传则用 window.localStorage。传 null 模拟不可用。 */
    storage?: Storage | null;
    /** 注入 BroadcastChannel 构造器；传 null 模拟不可用。 */
    broadcastChannelCtor?: typeof BroadcastChannel | null;
    /** 本标签页的唯一标识，测试可注入以获得确定性。 */
    tabId?: string;
    /** 当前登录会话作用域。不同 sid 必须使用独立租约与广播频道。 */
    scopeId?: string;
    /** 动态读取当前用户，广播接收时用于二次隔离校验。 */
    getUserId?: () => string;
    heartbeatMs?: number;
    staleAfterMs?: number;
}

export interface AttentionLeader {
    start(): void;
    stop(): void;
    /**
     * 把本次取到的计数广播给其它标签页（只有 leader 会调）。
     *
     * 必须带上取数时所在的 Space：各标签页可以停在【不同的 Space】上，而计数是
     * space-scoped 的（后端按 X-Space-Id 统计）。不带 Space 的广播会让停在
     * Space B 的标签页显示 Space A 的数字——那比不刷新更糟，用户会点进去发现
     * 什么都没有。跟随者按 Space 过滤后若长期收不到匹配广播，它自身的
     * 可见性/聚焦/切 Space 刷新仍然兜底（见 summaryAttentionSync）。
     */
    publish(count: number, spaceId: string, sampleAt: number): void;
    isLeader(): boolean;
    /**
     * 本标签页可见性变化。不可见 → 立即让位并清租约；可见 → 立即参与竞争。
     *
     * 走事件而不是等心跳发现：visibilitychange 是事件，不受后台节流影响，
     * 所以交接可以是即时的。租约过期（STALE_AFTER_MS）只保留给「标签页被强杀、
     * 什么回调都没跑」那条路——那才是租约真正不可替代的地方。
     */
    setVisible(visible: boolean): void;
    /**
     * 是否降级为「每个标签页自己轮询」。降级下 isLeader() 恒为 true：
     * 调用方不必分支，「我是 leader」与「没有协调、我自己来」对它是同一件事。
     */
    isDegraded(): boolean;
}

function defaultTabId(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * 真写一次再读回来，确认 storage 确实可用。
 *
 * 只判 `typeof localStorage !== 'undefined'` 是不够的：Safari 隐私模式提供一个
 * 存在但 setItem 抛 QuotaExceededError 的对象；配额写满、被企业策略禁用、
 * 被扩展替换成空壳的情况也都是「对象在、功能不在」。探测失败就降级。
 */
function probeStorage(storage: Storage | null | undefined, leaseKey: string): Storage | null {
    if (!storage) return null;
    try {
        const probeKey = `${leaseKey}:probe`;
        storage.setItem(probeKey, '1');
        const ok = storage.getItem(probeKey) === '1';
        storage.removeItem(probeKey);
        return ok ? storage : null;
    } catch {
        return null;
    }
}

/**
 * 取默认存储。【读 `window.localStorage` 这个属性本身就可能抛】——不是 setItem，
 * 是属性访问：无 allow-same-origin 的 sandbox iframe、浏览器为本 origin 屏蔽了
 * 站点数据、Firefox 的 dom.storage.enabled=false、企业策略禁用站点数据，都会
 * 抛 SecurityError。
 *
 * probeStorage 挡不住它：那一层跑起来的时候，属性已经读完了。而这个抛点在一条
 * 【没有任何人 catch】的同步链上——module.tsx 的 createAttentionLeader 调用没包
 * try，ModuleManager.register 裸调 init()，而 registerModule 又在 apps/web
 * src/index.tsx 的【顶层求值】期执行，早于 main()。于是后果不是「红点不更新」，
 * 是 root.render() 一次都跑不到：整个应用白屏。
 *
 * 形态照抄仓库既有的 dmworkbase/src/Service/SessionScope.ts safeLocalStorage()。
 * 返回 null 走既有的降级路径（每个标签页自己轮询），与本文件头注释声明的
 * 「任何一环不可用一律降级」对齐。
 */
function defaultLocalStorage(): Storage | null {
    if (typeof window === 'undefined') return null;
    try {
        return window.localStorage;
    } catch {
        return null;
    }
}

type LeaseReadResult =
    | { ok: true; lease: LeaseRecord | null }
    | { ok: false };

function readLease(storage: Storage, leaseKey: string): LeaseReadResult {
    let raw: string | null;
    try {
        raw = storage.getItem(leaseKey);
    } catch {
        // 运行期间 storage 也可能失效（配额、策略切换、宿主替换实现）。这和
        // 「租约不存在」不能混为一谈：后者应该竞争，前者必须切到人人自轮。
        return { ok: false };
    }
    if (!raw) return { ok: true, lease: null };
    try {
        const parsed = JSON.parse(raw) as Partial<LeaseRecord> | null;
        if (!parsed || typeof parsed.id !== 'string' || typeof parsed.ts !== 'number') {
            return { ok: true, lease: null };
        }
        if (!Number.isFinite(parsed.ts)) return { ok: true, lease: null };
        return { ok: true, lease: { id: parsed.id, ts: parsed.ts } };
    } catch {
        // 内容被别的东西写坏（同名 key 冲突、手改、旧版本格式）时按「没有租约」
        // 处理：接管会用合法内容覆盖它，比在这里抛异常把整条链路带崩要好。
        return { ok: true, lease: null };
    }
}

export function createAttentionLeader(deps: AttentionLeaderDeps): AttentionLeader {
    const now = deps.now ?? Date.now;
    const setIntervalFn = deps.setIntervalFn ?? ((h, t) => setInterval(h, t));
    const clearIntervalFn = deps.clearIntervalFn ?? ((h) => clearInterval(h as ReturnType<typeof setInterval>));
    const heartbeatMs = deps.heartbeatMs ?? LEADER_HEARTBEAT_MS;
    const staleAfterMs = deps.staleAfterMs ?? LEADER_STALE_AFTER_MS;
    const tabId = deps.tabId ?? defaultTabId();
    const scopeId = deps.scopeId?.trim() ?? '';
    const leaseKey = scopeId ? `${LEASE_KEY}:${scopeId}` : LEASE_KEY;
    const channelName = scopeId ? `${CHANNEL_NAME}:${scopeId}` : CHANNEL_NAME;
    const getUserId = deps.getUserId ?? (() => '');
    const isVisibleFn = deps.isVisible ?? (() => true);

    const rawStorage = deps.storage !== undefined
        ? deps.storage
        : defaultLocalStorage();
    let storage = probeStorage(rawStorage, leaseKey);

    const ChannelCtor = deps.broadcastChannelCtor !== undefined
        ? deps.broadcastChannelCtor
        : (typeof BroadcastChannel !== 'undefined' ? BroadcastChannel : null);

    const openChannel = (): BroadcastChannel | null => {
        if (!ChannelCtor) return null;
        try {
            return new ChannelCtor(channelName);
        } catch {
            // 构造失败（宿主给了个会抛的壳）等同不可用，下面按降级处理。
            return null;
        }
    };
    let channel = openChannel();

    /**
     * 降级判定。
     *
     * storage 不可用 → 没有共享的地方放租约 → 无从选举。
     * channel 不可用 → 就算选得出 leader，它取到的数也送不到其它标签页，
     * 那些标签页的红点会一直是旧的——比多发几个请求糟得多。
     * 两者任缺其一都降级成「人人自己轮询」，绝不降级成「没人轮询」。
     */
    let degraded = storage === null || channel === null;

    let started = false;
    let leader = degraded; // 降级时每个标签页都视自己为 leader
    let heartbeatTimer: unknown = null;
    let unloadHandler: (() => void) | null = null;
    let pageShowHandler: (() => void) | null = null;
    // pagehide/beforeunload 后即使宿主仍短暂派发定时器，也不能重新抢回租约。
    // bfcache 恢复由 pageshow 显式重新开启。
    let pageActive = true;
    /**
     * 本标签页当前是否可见。初值从注入的判定读一次；之后由 setVisible 更新，
     * 并且每一拍心跳都会重新校准（见 beat）——所以它是缓存，不是唯一真相。
     *
     * 不可见的标签页【没有当 leader 的资格】：它自己的轮询已经停表，再占着租约
     * 就是把整个浏览器的兜底轮询扣死。见 AttentionLeaderDeps.isVisible 的注释。
     */
    let visible = isVisibleFn();

    const resign = () => {
        if (!leader) return;
        leader = false;
        deps.onResignLeader();
    };

    const promote = () => {
        if (leader) return;
        leader = true;
        deps.onBecomeLeader();
    };

    const enterDegradedMode = () => {
        if (degraded) return;
        degraded = true;
        storage = null;
        if (heartbeatTimer !== null) {
            clearIntervalFn(heartbeatTimer);
            heartbeatTimer = null;
        }
        // 协调能力丢失后，每个标签页都必须继续自轮；若当前是 follower，立即拉起。
        promote();
    };

    const writeLease = (): boolean => {
        if (!storage) return false;
        // 不可见时绝不续租：这是「可见性即选主资格」的落点。少了这一行，隐藏的
        // leader 会一边停着自己的表、一边每 3s 告诉所有人「我还活着」。
        if (!visible) return false;
        try {
            storage.setItem(leaseKey, JSON.stringify({ id: tabId, ts: now() } satisfies LeaseRecord));
            return true;
        } catch {
            enterDegradedMode();
            return false;
        }
    };

    const clearLeaseIfMine = () => {
        if (!storage) return;
        try {
            const result = readLease(storage, leaseKey);
            if (!result.ok) return;
            const lease = result.lease;
            // 只清自己的：接管发生后租约已经属于别人，清掉会让它平白掉线。
            if (lease && lease.id === tabId) storage.removeItem(leaseKey);
        } catch {
            // 清不掉就等它过期，正确性不依赖这一步。
        }
    };

    /**
     * 租约是否已经馊了（含【未来时间戳】这条）。
     *
     * 只算 `current - lease.ts > staleAfterMs` 会漏掉一整类静默死锁：ts 落在未来时，
     * 这个差值恒为负，租约【永远】不馊。持有者随后死掉的话，谁都不会接管——正是
     * 租约机制存在的唯一理由被一个没校验的数字抵消掉，而且是整个会话级别、无任何
     * 报错。可达路径两条：墙上时钟被往回校准（休眠唤醒后的 NTP 纠正、虚拟机对时、
     * 手动改时间）；以及任何同源代码往 `octo:summary-attention-leader` 写一条
     * `{"id":"x","ts":1e15}`——localStorage 是同源共享的可写面，这里只校验过类型，
     * 没校验过量级。
     *
     * 容差取一个心跳周期：合法的续租都是 `now()` 写的，同源标签页共用同一个时钟，
     * 所以正常情况下 ts 绝不会大于本地的 current。留一拍的余量是为了吸收「另一个
     * 标签页刚写完、本标签页读到时定时器精度/时钟粗化造成的几毫秒偏差」，同时又
     * 不给一个伪造值留出可用窗口。
     *
     * 判成馊的后果是安全的：抢占逻辑会用 `now()` 覆盖掉那条租约，自愈。
     */
    const isLeaseStale = (lease: LeaseRecord, current: number): boolean => {
        if (lease.ts > current + heartbeatMs) return true;
        return current - lease.ts > staleAfterMs;
    };

    /**
     * 心跳一拍：是 leader 就续租；不是就看看租约是不是已经馊了，馊了就接管。
     * 两件事合在一拍里做，跟随者才不需要另一个独立的观察定时器。
     */
    const beat = () => {
        if (!storage || !pageActive) return;
        // 每拍现问一次可见性，而不是只信 setVisible 留下的缓存值。
        //
        // 心跳定时器特意【不】随可见性停表，理由写在 start() 里：宿主可能根本不发
        // visibilitychange，那时只剩这条心跳能把标签页拉回竞争。可若这里读的是一个
        // 只由 visibilitychange 维护的变量，在恰恰是那种宿主里它会永远冻在构造时的
        // 取值，幸存下来的定时器便没有任何新信息可依据——理由与实现对不上。
        //
        // 轮询那边本来就每拍现读 document.visibilityState（summaryAttentionPoll 的
        // schedule/tick）。这里用同一把尺子、同样的频率，两者才不会分叉成「自己停着
        // 表、却还每 3s 续租」的空心 leader——那正是可见性门控要防的那种静默。
        // 代价是每 3s 一次判定调用，可忽略。
        visible = isVisibleFn();
        if (!visible) {
            // 隐藏标签页主动退出竞争：让位 + 清掉自己的租约，可见的跟随者下一拍
            // 就能接管，不必空等 staleAfterMs。租约过期只留给「被强杀、连
            // visibilitychange 都没跑」的那条路。
            if (leader) {
                resign();
                clearLeaseIfMine();
            }
            return;
        }
        const leaseResult = readLease(storage, leaseKey);
        if (!leaseResult.ok) {
            enterDegradedMode();
            return;
        }
        const lease = leaseResult.lease;
        const current = now();

        if (lease && lease.id === tabId) {
            // 还是我的租约。但要防「自己已经馊了」这种情况：标签页被挂起
            // （休眠、后台节流、断点）很久后醒来，期间别人可能已经接管过。
            // 若确实过期了，先按丢失身份处理，再由下面的抢占逻辑重新竞争。
            if (isLeaseStale(lease, current)) {
                resign();
            } else {
                if (!writeLease()) return;
                promote();
                return;
            }
        }

        const stale = !lease || isLeaseStale(lease, current);
        if (stale) {
            // 抢占。多个标签页可能在同一拍同时抢，最后写入的赢；输的那个会在
            // 下一拍读到别人的 id 并退位。这个窗口最长一个心跳周期，期间可能有
            // 两个标签页各发一次轮询——比「谁都不敢抢」好得多，
            // 而 localStorage 没有 CAS，纯前端做不到真正的原子抢占。
            if (!writeLease() || !storage) return;
            const afterResult = readLease(storage, leaseKey);
            if (!afterResult.ok) {
                enterDegradedMode();
                return;
            }
            const after = afterResult.lease;
            // 刚成功写入自己的租约却读回 null，说明 storage 是 silent no-op 空壳，
            // 不是一场正常竞争。继续选举会让所有标签页每拍都 resign，必须降级自轮。
            if (!after) {
                enterDegradedMode();
                return;
            }
            if (after.id === tabId) promote();
            else resign();
            return;
        }

        // 租约新鲜且属于别人：我是跟随者。
        resign();
    };

    const handleMessage = (event: MessageEvent) => {
        const data = event?.data as {
            type?: string;
            count?: number;
            spaceId?: string;
            sampleAt?: number;
            scopeId?: string;
            userId?: string;
        } | null;
        if (!data || data.type !== 'attention-count') return;
        if ((data.scopeId ?? '') !== scopeId) return;
        if ((data.userId ?? '') !== getUserId()) return;
        if (typeof data.count !== 'number' || !Number.isFinite(data.count)) return;
        if (typeof data.spaceId !== 'string' || !data.spaceId) return;
        // sampleAt 缺失/非法 → 丢弃，不要用 0 或 now() 兜底：前者会让这条广播
        // 永远排不过任何本地写入（等于静默失效），后者会让它永远排得过（等于
        // 绕开排序）。两种兜底都比直接丢一条广播糟——广播丢了还有各标签页自己的
        // 可见性/聚焦刷新兜底。唯一会走到这里的是跨版本标签页（老版本不带这个
        // 字段），那种情况下丢弃正是想要的行为。
        if (typeof data.sampleAt !== 'number' || !Number.isFinite(data.sampleAt)) return;
        deps.onRemoteCount?.(data.count, data.spaceId, data.sampleAt);
    };

    return {
        start(): void {
            if (started) return;
            started = true;
            pageActive = true;

            // stop() 会关闭 channel；同一实例重新 start 时要恢复协调能力。
            if (!degraded && channel === null) {
                channel = openChannel();
                if (channel === null) degraded = true;
            }

            if (typeof window !== 'undefined') {
                // pagehide 可能进入 bfcache，也可能紧接着销毁 document。无论哪种，
                // 都必须先停掉本页 poll，再释放租约；只清租约会留下一个仍会开火的
                // 定时器，而 MSW 已可能把旧 client 注销，造成请求直穿代理。
                // 降级模式也必须装这组监听：它虽然没有租约，却仍有自己的 poll。
                unloadHandler = () => {
                    pageActive = false;
                    visible = false;
                    resign();
                    clearLeaseIfMine();
                };
                // bfcache 恢复不会重新执行模块初始化，pageshow 要把存活实例重新拉回
                // 竞争；普通 reload 的旧 document 不会走到这里。
                pageShowHandler = () => {
                    if (!started) return;
                    pageActive = true;
                    visible = isVisibleFn();
                    if (!visible) return;
                    if (degraded) promote();
                    else beat();
                };
                window.addEventListener('pagehide', unloadHandler);
                window.addEventListener('beforeunload', unloadHandler);
                window.addEventListener('pageshow', pageShowHandler);
            }

            if (degraded) {
                // 没有协调手段：直接自己轮询。这里【不】设心跳定时器，也不写租约。
                //
                // 显式置位而不是只依赖构造时的 `let leader = degraded`：stop() 会把
                // leader 置回 false，若这里不重新置上，第二次 start() 会把轮询拉起来
                // 却留下 leader === false，接着的 stop() 就跳过 onResignLeader()，
                // 轮询定时器漏出去。今天不可达（dispose 会丢掉实例、init 重新构造），
                // 但这个对象没理由不可重启。
                leader = true;
                deps.onBecomeLeader();
                return;
            }

            if (channel) channel.onmessage = handleMessage;

            // 先抢一拍再起定时器，否则冷启动后要白等一个心跳周期才有人轮询。
            // 不可见启动时这一拍什么都不做（beat 自己拦），等 setVisible(true) 拉起。
            beat();
            // 心跳定时器【不】随可见性停掉：它同时承担「观察租约、适时抢占」的
            // 职责，停了之后本标签页重新可见却没有 visibilitychange（比如宿主根本
            // 不发这个事件的嵌入环境）时，就再也没东西把它拉回竞争。隐藏期间的
            // 每一拍开销是一次 early return，可忽略。
            if (!degraded) heartbeatTimer = setIntervalFn(beat, heartbeatMs);

        },
        stop(): void {
            if (!started) return;
            started = false;
            pageActive = false;
            if (heartbeatTimer !== null) {
                clearIntervalFn(heartbeatTimer);
                heartbeatTimer = null;
            }
            if (unloadHandler && typeof window !== 'undefined') {
                window.removeEventListener('pagehide', unloadHandler);
                window.removeEventListener('beforeunload', unloadHandler);
            }
            if (pageShowHandler && typeof window !== 'undefined') {
                window.removeEventListener('pageshow', pageShowHandler);
            }
            unloadHandler = null;
            pageShowHandler = null;
            clearLeaseIfMine();
            if (channel) {
                channel.onmessage = null;
                try {
                    channel.close();
                } catch {
                    // 已关闭 / 宿主实现不全，忽略。
                }
                channel = null;
            }
            // 降级模式下 leader 恒为 true 且没有 onResignLeader 的对手方，
            // 但停机时仍要通知调用方停表，否则轮询定时器会漏出去。
            if (leader) {
                leader = false;
                deps.onResignLeader();
            }
        },
        publish(count: number, spaceId: string, sampleAt: number): void {
            if (!channel) return;
            try {
                channel.postMessage({
                    type: 'attention-count',
                    count,
                    spaceId,
                    sampleAt,
                    scopeId,
                    userId: getUserId(),
                });
            } catch {
                // 广播失败不影响本标签页自己的红点，静默。
            }
        },
        isLeader(): boolean {
            return leader;
        },
        setVisible(nextVisible: boolean): void {
            if (nextVisible === visible) return;
            visible = nextVisible;
            if (!pageActive) return;
            // 降级模式下没有租约也没有心跳，leader 恒为 true；可见性对轮询的门控
            // 已经在 summaryAttentionPoll 里做过了，这里再动一次只会把「每个标签页
            // 自己轮询」这个降级保底拆掉。
            if (degraded || !started) return;
            // 不可见 → beat() 里的分支会 resign + 清租约；
            // 可见 → beat() 立即参与竞争，不必白等一个心跳周期。
            beat();
        },
        isDegraded(): boolean {
            return degraded;
        },
    };
}

export type { LeaseRecord };
