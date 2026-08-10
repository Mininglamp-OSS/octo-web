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
    /** 登录会话内生成一次;后沉淀 flow 主关联键之一,亦作方案 A 注入头 */
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
 * 采集端 base URL 由构建期 env `VITE_DAP_COLLECT_BASE_URL` 控制:
 *   - 缺省(未设/空):BATCH_URL = '/track/batch' 相对路径,经业务域名内部转发到采集端。
 *   - 设为绝对地址(如 https://dap.example.com):直连外部采集域名,支持 octo-dap
 *     采集端独立部署 / 外部域名而非内部转发(此时需采集端配好 CORS 放行 token 头)。
 * BATCH_PATH(路径后缀)保留用于 fetch/XHR 包裹里识别"上报请求自身"以排除自采环——
 * 绝对 URL 里同样含该子串,indexOf 仍能命中。
 */
const COLLECT_BASE_URL = (import.meta.env.VITE_DAP_COLLECT_BASE_URL ?? '').replace(/\/+$/, '')
const BATCH_PATH = '/track/batch'
const BATCH_URL = COLLECT_BASE_URL + BATCH_PATH
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

/** 请求路径归一:去 query、把 id 段(数字 / uuid / 长 hash)替换为 `:id`,避免泄对象内容(§8)。 */
function normalizePath(rawUrl: string): string {
    try {
        // 相对/绝对都能解析;base 仅用于补全,不进结果
        const u = new URL(rawUrl, 'http://x')
        return u.pathname
            .split('/')
            .map((seg) => {
                if (!seg) return seg
                if (/^\d+$/.test(seg)) return ':id'
                if (/^[0-9a-fA-F-]{16,}$/.test(seg)) return ':id'
                if (/^[0-9a-fA-F]{24,}$/.test(seg)) return ':id'
                return seg
            })
            .join('/')
    } catch {
        return rawUrl.split('?')[0] || rawUrl
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
    /** 会话内唯一;仅作为埋点事件 envelope 的 session_id 随上报发出(采集启用时才发) */
    readonly sessionId: string = genId()
    /** 持久设备标识;仅作为埋点事件 envelope 的 device_id 随上报发出(采集启用时才发) */
    readonly deviceId: string = loadOrCreateDeviceId()

    // ship dark:默认不采,等 remoteConfig 显式启用(后端采集端就绪前一个请求都不发)
    private enabled = false
    private started = false
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

    /** 远程 kill switch(§2.6):false 时立即停采、清空队列,业务零影响。由 index.tsx 依 remoteConfig 注入。 */
    setEnabled(v: boolean): void {
        this.enabled = v
        if (!v) {
            this.queue = []
            this.lastPage = null
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
        this.sendBatch(batch, 0)
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
            device_id: this.deviceId,
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

    /** 独立通道上报:带业务 token 头供后端鉴权;指数退避重试,最多 3 次;仍失败丢弃 + 计数,绝不外抛。 */
    private sendBatch(batch: TrackEnvelope[], attempt: number): void {
        if (batch.length === 0) return
        this.safe(() => {
            const headers: Record<string, string> = { 'Content-Type': 'application/json' }
            const token = this.currentToken()
            if (token) headers['token'] = token // 与业务同名头,后端按 token 鉴权并归一 actor
            const body = JSON.stringify({ events: batch })
            void fetch(BATCH_URL, {
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
                    if (attempt < MAX_RETRY) {
                        const delay = 500 * Math.pow(2, attempt) // 500 / 1000 / 2000ms
                        setTimeout(() => this.sendBatch(batch, attempt + 1), delay)
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
            void fetch(BATCH_URL, {
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
     * 曝光观测器:新挂载(或初始已存在)的元素若带 `data-track-view`,触发一次曝光事件。
     * 每个元素实例只触发一次(WeakSet 去重)。props 复用 collectDatasetProps(已跳过 trackView 键)。
     */
    private installExposureObserver(): void {
        const fire = (el: HTMLElement) => {
            if (!el.dataset || !el.dataset.trackView) return
            if (this.seenViews.has(el)) return
            this.seenViews.add(el)
            this.track(el.dataset.trackView, this.collectDatasetProps(el))
        }
        const scan = (node: Element) => {
            if ((node as HTMLElement).dataset && (node as HTMLElement).dataset.trackView) fire(node as HTMLElement)
            if (typeof node.querySelectorAll === 'function') {
                node.querySelectorAll<HTMLElement>('[data-track-view]').forEach(fire)
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
                // 只采本层可归一的路径 telemetry:量/错误率/延迟,不带 query、不带正文
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

/** 蒙版单例(唯一上报出口)。`Tracker.shared` 供极少数破例点 / 方案 A 拦截器引用。 */
export const Tracker = {
    shared: new TrackerImpl(),
}

export type { TrackEnvelope }
