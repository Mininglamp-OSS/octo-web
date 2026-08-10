/**
 * Tracker —— octo-dap 前端采集「蒙版底座」(外挂式)
 * =====================================================
 * 设计依据:`octo-dap 前端采集方案 · 蒙版优先` §2。
 *
 * 一句话:整套前端采集是**一层 bootstrap 注入的蒙版脚本**,不逐点插桩业务组件。
 * 采集主体全在本文件内,靠三大机制拿数据:
 *   ① 全局事件委托(document 捕获阶段)—— B/C/E 控件点击/开关/筛选(读 `data-track`)
 *   ② MutationObserver —— A 页面浏览/切页(观测 display 翻转,依赖 `data-page-id`)
 *   ③ fetch / XHR 包裹 —— HTTP 量 / 错误率 / 延迟(路径归一,不带 query,不泄正文)
 *
 * 硬约束(务必守住,见 §2.1 / §8):
 *   - 全程 try/catch 自吞异常:埋点崩溃**绝不**波及业务渲染,不弹 toast、不 console.error。
 *   - 上报走**独立裸 fetch(卸载期用 keepalive fetch)**,不复用业务 axios 拦截器(避免其 401 重定向等副作用),
 *     但**携带业务 `token` 头**,后端据 token 鉴权并归一 actor。(不用 sendBeacon:它设不了 token 头、过不了鉴权。)
 *   - 信封**不含** `flow_id`(一期放弃 FlowRegistry)、**不含** `actor_type` / `actor_id`(后端按 token 凭证归一)。
 *   - **不采任何内容正文**:不读 input/textarea value、不读消息正文/搜索词/文件名;属性名黑名单剔除(§8)。
 *   - 远程 kill switch:`enabled=false` 时 track/pageView 立即 return,清空队列,业务零影响。
 */

export type TrackPrimitive = string | number | boolean | null

/** 上报信封:每条事件出队前补齐(§2.4)。刻意不含 flow_id / actor_*。 */
interface TrackEnvelope {
    event_name: string
    /** 去重键:事件产生时生成,重试 / beacon 兜底复用同一 id(§2.5) */
    client_event_id: string
    /** 登录会话内生成一次;后沉淀 flow 主关联键之一 */
    session_id: string
    /** 持久化设备标识,非身份凭据 */
    device_id: string
    /** 只存不算,计算以后端 server_ts 为准 */
    client_ts: number
    page_id?: string
    /** 后沉淀 flow 核心键:拿得到必带,拿不到如实为空,不臆造(§2.4 / §7) */
    object_id?: string
    props?: Record<string, TrackPrimitive>
}

const DEVICE_ID_KEY = 'octo_track_device_id'
/**
 * 独立上报通道,不复用业务 axios(§2.1)。
 *
 * 采集端**恒为同源相对路径** `/track/batch`:上报(及其携带的业务 token 头)只发给
 * 页面自身 origin,绝不出跨域。octo-dap 采集端如需独立部署 / 外部域名,由运维层在业务
 * 域名下反代 `/track/*` 转发实现,前端不感知——从而避免"业务 token 被发往可配置任意
 * 外域"的凭据外泄风险(见 PR review P0-4)。BATCH_PATH 同时用于 fetch/XHR 包裹里识别
 * "上报请求自身"以排除自采环。
 */
const BATCH_PATH = '/track/batch'
const FLUSH_SIZE = 20
const FLUSH_INTERVAL_MS = 5000
const MAX_RETRY = 3

/**
 * 属性名黑名单(§8 合规):命中即从 props 剔除,绝不上报。
 * 前端本层先剔一道,后端 `/track/batch` 验签再拒一道,双保险。
 */
const PROP_KEY_BLACKLIST = /(text|content|body|keyword|query|token|secret|password|phone|email)/i

/** UUID v4;优先原生 crypto,退化到手写,保持本文件零依赖。 */
function genId(): string {
    try {
        const c = (globalThis as { crypto?: Crypto }).crypto
        if (c && typeof c.randomUUID === 'function') {
            return c.randomUUID()
        }
    } catch {
        /* ignore */
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
        const r = (Math.random() * 16) | 0
        const v = ch === 'x' ? r : (r & 0x3) | 0x8
        return v.toString(16)
    })
}

/** 设备 id:localStorage 持久化,首次生成。取不到 storage(隐身/禁用)则退回内存态。 */
function loadOrCreateDeviceId(): string {
    try {
        const ls = (globalThis as { localStorage?: Storage }).localStorage
        if (ls) {
            const existing = ls.getItem(DEVICE_ID_KEY)
            if (existing) return existing
            const fresh = genId()
            ls.setItem(DEVICE_ID_KEY, fresh)
            return fresh
        }
    } catch {
        /* storage 不可用:退回内存态,当次会话有效 */
    }
    return genId()
}

/**
 * 请求路径归一(§8 隐私边界:绝不泄文件名 / 对象键 / 正文)。策略是**白名单式收窄**而非
 * 黑名单式脱敏:每段只有"看起来是固定路由词"(纯小写字母打头、仅含小写字母/数字/-/_、
 * 无点无编码无大写、长度≤40)才原样保留;其余(带扩展名的文件名、percent-encoded 段、
 * 大写/混合串、长 hex/uuid、纯数字 id)一律替换为占位符。这样即使上游 URL 里塞进
 * `report-2024.pdf` / `memory%2F2026-05-07.md` / 对象存储 key,也不会进 telemetry。
 */
function normalizePath(rawUrl: string): string {
    try {
        // 相对/绝对都能解析;base 仅用于补全,不进结果
        const u = new URL(rawUrl, 'http://x')
        return u.pathname
            .split('/')
            .map((seg) => {
                if (!seg) return seg
                // 先按 id 形态强制脱敏(纯数字 / 长 hex / uuid)
                if (/^\d+$/.test(seg)) return ':id'
                if (/^[0-9a-fA-F-]{16,}$/.test(seg)) return ':id'
                if (/^[0-9a-fA-F]{24,}$/.test(seg)) return ':id'
                // 其余只保留"纯小写路由词",文件名 / 编码 / 大写混合串等一律占位
                if (/^[a-z][a-z0-9_-]{0,39}$/.test(seg)) return seg
                return ':seg'
            })
            .join('/')
    } catch {
        return ':seg'
    }
}

/**
 * 是否第一方(同源)请求。HTTP 包裹**只采第一方 API**:跨域请求(预签名对象存储上传/下载、
 * 第三方服务)路径里常含对象键 / 文件名,且归一后与第一方路径混在同一维度无法区分,故一律不采
 * (见 PR review P0-3)。相对 URL 天然同源;拿不到 location(SSR/测试无 DOM)时保守判为非第一方。
 */
function isFirstParty(rawUrl: string): boolean {
    try {
        const loc = (globalThis as { location?: Location }).location
        if (!loc || !loc.origin || loc.origin === 'null') return false
        return new URL(rawUrl, loc.origin).origin === loc.origin
    } catch {
        return false
    }
}

/**
 * 当前 runtime 是否支持采集。埋点恒发同源相对路径 /track/batch(P0-4 同源锁),
 * 只在标准 http(s) Web 运行时成立。桌面 / Electron / Tauri 打包后页面跑在 `file://`
 * (或自定义协议),API 走的是 apiURL.ts 解析出的**绝对后端域名**——此时相对 /track/batch
 * 既发不出去、也不该把跨域后端流量当第一方采,故在这些 runtime 里直接不启用 tracker
 * (见 PR #1320 review:desktop/file:// 上报打到错误 origin)。判据:protocol 必须是
 * http/https,且无桌面运行时标记。拿不到 location(SSR/测试无 DOM)时保守判为不支持。
 */
function isSupportedRuntime(): boolean {
    try {
        const loc = (globalThis as { location?: Location }).location
        if (!loc || (loc.protocol !== 'http:' && loc.protocol !== 'https:')) return false
        const w = globalThis as {
            __TAURI_IPC__?: unknown
            __POWERED_ELECTRON__?: unknown
        }
        if (w.__TAURI_IPC__ || w.__POWERED_ELECTRON__) return false
        if (import.meta.env.VITE_ELECTRON_BUILD === 'true') return false
        return true
    } catch {
        return false
    }
}

/** 从请求路径提取 object_id(§2.4:如 /thread/{id})。拿不到返回 undefined。 */
function extractObjectId(rawUrl: string): string | undefined {
    try {
        const u = new URL(rawUrl, 'http://x')
        const segs = u.pathname.split('/').filter(Boolean)
        for (let i = segs.length - 1; i >= 0; i--) {
            const s = segs[i]
            if (/^\d{2,}$/.test(s) || /^[0-9a-fA-F-]{16,}$/.test(s)) return s
        }
    } catch {
        /* ignore */
    }
    return undefined
}

/** 状态码分桶:不报精确 code,只报量级(2xx/4xx/5xx/err)。 */
function statusBucket(status: number): string {
    if (status <= 0) return 'err'
    if (status >= 500) return '5xx'
    if (status >= 400) return '4xx'
    if (status >= 300) return '3xx'
    return '2xx'
}

class TrackerImpl {
    /** 会话内唯一;仅作为埋点事件 envelope 的 session_id 随上报发出(采集启用时才发)。纯内存,不落盘。 */
    readonly sessionId: string = genId()
    /**
     * 持久设备标识,仅作 envelope 的 device_id。**懒创建**:只有真正产出事件(即采集已启用)
     * 时才 loadOrCreateDeviceId() 并写 localStorage——fail-closed 下开关未开就绝不落盘标识
     * (见 PR review P0-1)。
     */
    private _deviceId: string | null = null
    private deviceId(): string {
        if (this._deviceId == null) this._deviceId = loadOrCreateDeviceId()
        return this._deviceId
    }

    // ship dark:默认不采,等 remoteConfig 显式启用(后端采集端就绪前一个请求都不发)
    private enabled = false
    private started = false
    /**
     * 采集代次。每次 setEnabled(false) 自增,使"停采前已捕获、尚在重试队列里的批次"整体作废,
     * 配合 retryTimers 清理,实现 kill switch 立即生效、不再有滞后上报(见 PR review P0-2)。
     */
    private generation = 0
    /** 在途重试定时器;停采时全部 clearTimeout,杜绝停采后仍 POST。 */
    private retryTimers = new Set<ReturnType<typeof setTimeout>>()
    /** 业务 token 取值回调(index.tsx 注入,避免 import WKApp 造成循环依赖)。上报带 token 头供后端鉴权。 */
    private tokenProvider: (() => string | undefined) | null = null
    private queue: TrackEnvelope[] = []
    private flushTimer: ReturnType<typeof setInterval> | null = null
    private lastPage: { pageId: string; enteredAt: number } | null = null
    private pageBootObserver: MutationObserver | null = null
    /** 曝光去重:每个元素实例只触发一次 data-track-view */
    private seenViews = new WeakSet<Element>()
    /** 内部计数:上报最终失败丢弃数,只自增不外抛 */
    private droppedCount = 0

    /**
     * 启动蒙版:装三大采集机制 + 卸载兜底。幂等,只装一次。
     * 由 app 启动处调用一次(见 apps/web/src/index.tsx),不由业务组件调用。
     */
    init(): void {
        if (this.started) return
        this.started = true
        this.safe(() => {
            this.installClickDelegation()
            this.installPageObserver()
            this.installExposureObserver()
            this.installHttpWrap()
            this.installUnloadFlush()
            this.flushTimer = setInterval(() => this.safe(() => this.flush()), FLUSH_INTERVAL_MS)
        })
    }

    /**
     * 远程 kill switch(§2.6)。关:立即停采——清队列、作废采集代次、清掉所有在途重试定时器,
     * 停采后不再有任何 POST(见 PR review P0-2)。开:补扫当前 DOM,把开关到位前就已渲染的
     * 首个 page_view 与已存在的曝光元素补采一次(启用是 remoteConfig 异步到达,通常晚于首屏,
     * 见 PR review P1-7)。
     */
    setEnabled(v: boolean): void {
        // 桌面 / file:// 等不支持的 runtime:即便远端下发 tracking_enabled 也保持停采,
        // 不向 file 相对路径发上报、不误采绝对后端域名流量(见 PR #1320 review)。
        if (v && !isSupportedRuntime()) v = false
        const was = this.enabled
        this.enabled = v
        if (!v) {
            this.generation++
            this.queue = []
            this.lastPage = null
            for (const t of this.retryTimers) clearTimeout(t)
            this.retryTimers.clear()
        } else if (!was) {
            this.rescanCurrent()
        }
    }

    /** 注入业务 token 取值回调(见 index.tsx)。上报请求据此带 `token` 头供后端鉴权归一 actor。 */
    setTokenProvider(fn: () => string | undefined): void {
        this.tokenProvider = fn
    }

    /** 取当前业务 token;取不到 / 抛错都返回 undefined(不阻断上报)。 */
    private currentToken(): string | undefined {
        try {
            return this.tokenProvider ? this.tokenProvider() : undefined
        } catch {
            return undefined
        }
    }

    /** 通用上报(蒙版内部自动调;破例点如消息补点也调它)。 */
    track(eventName: string, props?: Record<string, unknown>): void {
        if (!this.enabled || !eventName) return
        this.safe(() => {
            const clean = this.sanitizeProps(props)
            const objectId = this.pickObjectId(clean)
            this.enqueue(this.envelope(eventName, clean.props, objectId))
        })
    }

    /** page_view(MutationObserver 内部调,按 pageId 去重 + 结算上一页停留)。 */
    pageView(pageId: string, extra?: Record<string, unknown>): void {
        if (!this.enabled || !pageId) return
        this.safe(() => {
            // 同页重复触发(菜单 setter + syncPath + mittBus 多次)只忽略,不重复计数(§3.2)
            if (this.lastPage && this.lastPage.pageId === pageId) return
            const now = Date.now()
            // 结算上一页停留:给上一页发带 duration_ms 的结束事件
            if (this.lastPage) {
                const durEnv = this.envelope('page_leave', {
                    duration_ms: now - this.lastPage.enteredAt,
                })
                durEnv.page_id = this.lastPage.pageId
                this.enqueue(durEnv, /* priority */ true)
            }
            this.lastPage = { pageId, enteredAt: now }
            const clean = this.sanitizeProps(extra)
            const env = this.envelope('page_view', clean.props)
            env.page_id = pageId
            this.enqueue(env)
        })
    }

    /** 手动刷新,调试用。 */
    flush(): void {
        if (this.queue.length === 0) return
        const batch = this.queue
        this.queue = []
        this.sendBatch(batch, 0, this.generation)
    }

    // ---------------------------------------------------------------- 内部

    private envelope(
        eventName: string,
        props?: Record<string, TrackPrimitive>,
        objectId?: string,
    ): TrackEnvelope {
        const env: TrackEnvelope = {
            event_name: eventName,
            client_event_id: genId(),
            session_id: this.sessionId,
            device_id: this.deviceId(),
            client_ts: Date.now(),
        }
        if (this.lastPage) env.page_id = this.lastPage.pageId
        if (objectId) env.object_id = objectId
        if (props && Object.keys(props).length > 0) env.props = props
        return env
    }

    /** 剔黑名单 + 只留 Primitive;顺带取出 object_id。绝不带正文/复杂对象。 */
    private sanitizeProps(input?: Record<string, unknown>): {
        props: Record<string, TrackPrimitive>
        objectId?: string
    } {
        const props: Record<string, TrackPrimitive> = {}
        let objectId: string | undefined
        if (!input) return { props }
        for (const key of Object.keys(input)) {
            if (key === 'object_id') {
                const v = input[key]
                if (typeof v === 'string' && v) objectId = v
                else if (typeof v === 'number') objectId = String(v)
                continue
            }
            if (PROP_KEY_BLACKLIST.test(key)) continue // 合规:命中黑名单直接丢
            const v = input[key]
            if (v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
                props[key] = v
            }
            // 复杂对象 / undefined 一律丢,不做序列化(避免夹带正文)
        }
        return { props }
    }

    private pickObjectId(clean: { props: Record<string, TrackPrimitive>; objectId?: string }): string | undefined {
        return clean.objectId
    }

    private enqueue(env: TrackEnvelope, priority = false): void {
        if (!this.enabled) return
        this.queue.push(env)
        // 带 duration_ms 的结束事件优先 flush(§2.1)
        if (priority || this.queue.length >= FLUSH_SIZE) {
            this.flush()
        }
    }

    /**
     * 独立通道上报:带业务 token 头供后端鉴权;指数退避重试,最多 3 次;仍失败丢弃 + 计数,绝不外抛。
     * gen 为发起时的采集代次:每次发送/重试前都要 enabled 且 gen 未过期,否则整批丢弃——保证
     * kill switch 关闭后停采前捕获的批次不再 POST(见 PR review P0-2)。
     */
    private sendBatch(batch: TrackEnvelope[], attempt: number, gen: number): void {
        if (batch.length === 0) return
        // kill switch:已停采或本批所属采集代次已作废,直接丢弃不发
        if (!this.enabled || gen !== this.generation) return
        this.safe(() => {
            const headers: Record<string, string> = { 'Content-Type': 'application/json' }
            const token = this.currentToken()
            if (token) headers['token'] = token // 与业务同名头,后端按 token 鉴权并归一 actor
            const body = JSON.stringify({ events: batch })
            void fetch(BATCH_PATH, {
                method: 'POST',
                headers,
                body,
                keepalive: true,
                // 鉴权走 token 头,不依赖 cookie;仍用裸 fetch 不走业务拦截器,401 不触发登出重定向
                credentials: 'omit',
            })
                .then((resp) => {
                    if (!resp.ok) throw new Error('track batch http ' + resp.status)
                })
                .catch(() => {
                    // 重试前再次确认未停采且代次未过期;定时器登记后可被 setEnabled(false) 统一取消
                    if (attempt < MAX_RETRY && this.enabled && gen === this.generation) {
                        const delay = 500 * Math.pow(2, attempt) // 500 / 1000 / 2000ms
                        const timer = setTimeout(() => {
                            this.retryTimers.delete(timer)
                            this.sendBatch(batch, attempt + 1, gen)
                        }, delay)
                        this.retryTimers.add(timer)
                    } else {
                        this.droppedCount += batch.length // 丢弃,只内部计数,不外抛
                    }
                })
        })
    }

    /**
     * 卸载兜底(§2.1):visibilitychange(hidden)+ pagehide 一次性发残留。
     * 用 **keepalive fetch** 而非 sendBeacon —— sendBeacon 设不了 `token` 头、过不了后端 header 鉴权;
     * keepalive fetch 是其现代替代,能带头,鉴权与常规上报统一。不重试。
     */
    private unloadFlush(): void {
        this.safe(() => {
            if (!this.enabled) return // 停采后不发残留
            if (this.queue.length === 0) return
            const batch = this.queue
            this.queue = []
            const g = globalThis as { fetch?: typeof fetch }
            if (typeof g.fetch !== 'function') {
                // 无 fetch 的老运行时:无法带 token 鉴权,直接丢弃计数,不做无鉴权上报
                this.droppedCount += batch.length
                return
            }
            const headers: Record<string, string> = { 'Content-Type': 'application/json' }
            const token = this.currentToken()
            if (token) headers['token'] = token
            void fetch(BATCH_PATH, {
                method: 'POST',
                headers,
                body: JSON.stringify({ events: batch }),
                keepalive: true, // unload 期后台发送,sendBeacon 的现代替代
                credentials: 'omit',
            }).catch(() => undefined)
        })
    }

    // ----------------------------------------------- 机制① 全局事件委托

    private installClickDelegation(): void {
        const handler = (e: Event) => {
            this.safe(() => {
                const target = e.target as HTMLElement | null
                if (!target || typeof target.closest !== 'function') return
                const el = target.closest<HTMLElement>('[data-track]')
                if (!el) return
                const name = el.dataset.track
                if (!name) return
                this.track(name, this.collectDatasetProps(el))
            })
        }
        // 捕获阶段:即使业务层 stopPropagation 也能采到
        document.addEventListener('click', handler, true)
        document.addEventListener('change', handler, true)
        document.addEventListener('submit', handler, true)
    }

    /**
     * 从 data-track-* / data-object-id 收 props。
     * **只读 data-* 属性,绝不读控件 value**(§4.3 / §8:不采正文)。
     */
    private collectDatasetProps(el: HTMLElement): Record<string, unknown> {
        const out: Record<string, unknown> = {}
        const ds = el.dataset
        for (const key of Object.keys(ds)) {
            if (key === 'track') continue
            if (key === 'trackView') continue // 曝光标记键(data-track-view),只用于触发曝光,不进 props
            if (key === 'objectId') {
                out.object_id = ds[key]
                continue
            }
            if (key.startsWith('track') && key.length > 5) {
                // dataset.trackTabName -> track_tab_name
                const rest = key.slice(5)
                const snake = rest.replace(/([A-Z])/g, (m, c: string, i: number) =>
                    (i === 0 ? '' : '_') + c.toLowerCase(),
                )
                out[snake] = ds[key]
            }
        }
        return out
    }

    // ----------------------------------------------- 机制② MutationObserver(切页)

    private installPageObserver(): void {
        const attach = (root: Element) => {
            const obs = new MutationObserver((mutations) => {
                this.safe(() => {
                    for (const m of mutations) {
                        const el = m.target as HTMLElement
                        if (el && el.style && el.style.display === 'block' && el.dataset && el.dataset.pageId) {
                            this.pageView(el.dataset.pageId)
                        }
                    }
                })
            })
            obs.observe(root, { subtree: true, attributes: true, attributeFilter: ['style'] })
            // 挂载即补扫当前已可见页,避免观测器只响应后续 style 翻转而漏掉首屏 page_view(P1-7)
            root.querySelectorAll<HTMLElement>('[data-page-id]').forEach((el) => {
                if (el.style && el.style.display === 'block' && el.dataset && el.dataset.pageId) {
                    this.pageView(el.dataset.pageId)
                }
            })
        }
        const found = document.querySelector('.wk-layout-content-left')
        if (found) {
            attach(found)
            return
        }
        // 容器尚未渲染:临时观测 body 等它出现,出现后切到 scoped 观测并断开引导观测
        this.pageBootObserver = new MutationObserver(() => {
            this.safe(() => {
                const root = document.querySelector('.wk-layout-content-left')
                if (root) {
                    this.pageBootObserver?.disconnect()
                    this.pageBootObserver = null
                    attach(root)
                }
            })
        })
        this.pageBootObserver.observe(document.body, { childList: true, subtree: true })
    }

    // ----------------------------------------------- 机制②b MutationObserver(曝光)

    /**
     * 触发一次元素曝光。**未启用时不标记 seen 也不触发**——否则开关到位前渲染的元素会被
     * 永久标记已见,启用后再也不补采(见 PR review P1-7)。每个元素实例只触发一次(WeakSet 去重)。
     */
    private fireExposure(el: HTMLElement): void {
        if (!el.dataset || !el.dataset.trackView) return
        if (!this.enabled) return
        if (this.seenViews.has(el)) return
        this.seenViews.add(el)
        this.track(el.dataset.trackView, this.collectDatasetProps(el))
    }

    /**
     * 补扫当前 DOM(setEnabled(true) 时调):把开关到位前就已可见的首个 page_view 与已存在的
     * 曝光元素补采一次。启用是 remoteConfig 异步到达、通常晚于首屏,不补扫会永久漏掉首屏(P1-7)。
     */
    private rescanCurrent(): void {
        this.safe(() => {
            const d = (globalThis as { document?: Document }).document
            if (!d) return
            d.querySelectorAll<HTMLElement>('[data-page-id]').forEach((el) => {
                if (el.style && el.style.display === 'block' && el.dataset && el.dataset.pageId) {
                    this.pageView(el.dataset.pageId)
                }
            })
            d.querySelectorAll<HTMLElement>('[data-track-view]').forEach((el) => this.fireExposure(el))
        })
    }

    /**
     * 曝光观测器:新挂载(或初始已存在)的元素若带 `data-track-view`,触发一次曝光事件。
     * props 复用 collectDatasetProps(已跳过 trackView 键)。
     */
    private installExposureObserver(): void {
        const scan = (node: Element) => {
            if ((node as HTMLElement).dataset && (node as HTMLElement).dataset.trackView) this.fireExposure(node as HTMLElement)
            if (typeof node.querySelectorAll === 'function') {
                node.querySelectorAll<HTMLElement>('[data-track-view]').forEach((el) => this.fireExposure(el))
            }
        }
        const obs = new MutationObserver((mutations) => {
            this.safe(() => {
                for (const m of mutations) {
                    m.addedNodes.forEach((n) => {
                        if (n.nodeType === 1) scan(n as Element)
                    })
                }
            })
        })
        obs.observe(document.body, { childList: true, subtree: true })
        scan(document.body)
    }

    // ----------------------------------------------- 机制③ fetch / XHR 包裹
    private installHttpWrap(): void {
        const emit = (rawUrl: string, method: string, status: number, durationMs: number) => {
            this.safe(() => {
                if (!rawUrl) return
                // 只采第一方(同源)API telemetry:跨域(预签名对象存储/第三方)路径含对象键/文件名,一律不采
                if (!isFirstParty(rawUrl)) return
                // 量/错误率/延迟,不带 query、不带正文;路径按白名单收窄脱敏
                const objectId = extractObjectId(rawUrl)
                this.track('http_request', {
                    method: (method || 'GET').toUpperCase(),
                    path: normalizePath(rawUrl),
                    status_bucket: statusBucket(status),
                    duration_ms: Math.round(durationMs),
                    object_id: objectId,
                })
            })
        }

        // fetch
        const g = globalThis as { fetch?: typeof fetch }
        if (typeof g.fetch === 'function') {
            const orig = g.fetch.bind(globalThis)
            g.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
                const start = Date.now()
                const url =
                    typeof input === 'string'
                        ? input
                        : input instanceof URL
                          ? input.toString()
                          : (input as Request).url
                const method = init?.method || (typeof input !== 'string' && !(input instanceof URL) ? (input as Request).method : 'GET')
                // 埋点自身通道不采,避免自采自
                if (url && url.indexOf(BATCH_PATH) !== -1) {
                    return orig(input as RequestInfo, init)
                }
                return orig(input as RequestInfo, init)
                    .then((resp) => {
                        emit(url, method || 'GET', resp.status, Date.now() - start)
                        return resp
                    })
                    .catch((err) => {
                        emit(url, method || 'GET', 0, Date.now() - start)
                        throw err
                    })
            }
        }

        // XMLHttpRequest
        const XHR = (globalThis as { XMLHttpRequest?: typeof XMLHttpRequest }).XMLHttpRequest
        if (XHR && XHR.prototype) {
            const proto = XHR.prototype
            const origOpen = proto.open
            const origSend = proto.send
            type Tracked = XMLHttpRequest & { __trackMethod?: string; __trackUrl?: string; __trackStart?: number }
            proto.open = function (this: Tracked, method: string, url: string | URL, ...rest: unknown[]) {
                this.__trackMethod = method
                this.__trackUrl = typeof url === 'string' ? url : url.toString()
                // @ts-expect-error 透传原始可变参数
                return origOpen.call(this, method, url, ...rest)
            }
            proto.send = function (this: Tracked, ...args: unknown[]) {
                const start = Date.now()
                const url = this.__trackUrl || ''
                if (url && url.indexOf(BATCH_PATH) === -1) {
                    this.addEventListener('loadend', () => {
                        emit(url, this.__trackMethod || 'GET', this.status, Date.now() - start)
                    })
                }
                // @ts-expect-error 透传原始参数
                return origSend.apply(this, args)
            }
        }
    }

    // ----------------------------------------------- 卸载兜底

    private installUnloadFlush(): void {
        const onHide = () => this.unloadFlush()
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') onHide()
        })
        window.addEventListener('pagehide', onHide)
    }

    /** 统一异常自吞:埋点任何环节抛错都不得波及业务。 */
    private safe(fn: () => void): void {
        try {
            fn()
        } catch {
            /* 埋点内部异常一律吞掉,不 console、不 toast、不外抛 */
        }
    }
}

/** 蒙版单例(唯一上报出口)。`Tracker.shared` 供极少数破例点(如消息补点)引用。 */
export const Tracker = {
    shared: new TrackerImpl(),
}

export type { TrackEnvelope }

/**
 * 仅供单元测试引用的隐私关键纯函数(不属于运行时公共 API)。normalizePath / isFirstParty
 * 是 §8 隐私边界的核心,单测直接断言其脱敏 / 同源判定,避免只靠集成路径覆盖。
 */
export const __trackerInternals = { normalizePath, isFirstParty, isSupportedRuntime }
