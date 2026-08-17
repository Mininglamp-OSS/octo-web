/**
 * Dap —— octo-dap 前端采集「蒙版底座」(外挂式)
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

// 唯一的模块依赖:埋点路由模板 registry(见 apiPath.ts)。apiPath 自身零依赖,不成环。
// 供 normalizePath 优先命中调用处已知的路由模板,命中不了才退回本文件的白名单归一兜底。
import { templateForPathname } from './apiPath'
// 锚点规则表(见 TrackRules.ts):点击委托 closest('[data-track]') 落空后的纯前端 fallback。
// TrackRules 自身零依赖,不成环。
import { TRACK_RULES, buildIndex, matchRoute, type TrackRule, type TrackRuleIndex } from './TrackRules'
// 中央映射·path 通道(①,见 FetchRules.ts):把成功(2xx)的第一方请求 method+path 映射成
// 整合表事件名再 track 一次。零依赖、零改组件;pathname 仅用于选事件名,绝不落库。
import { FETCH_RULES, buildFetchIndex, matchFetchEvent, rawPathname, type FetchRuleIndex } from './FetchRules'
// 中央映射·body 键通道(②,见 BodyRules.ts):对白名单端点 clone 请求体、只读顶层枚举键映射事件。
// 受控放宽「不读正文」边界:只碰白名单端点、只读键不读值、只解析 JSON 串体、同源+2xx 才触发。
import { BODY_RULES, buildBodyIndex, computeBodyEvent, type BodyRuleIndex } from './BodyRules'

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
 * **浏览器侧恒为同源相对路径** `/v1/e/b`:上报请求(及其携带的业务 token 头)从浏览器发出时
 * 只打到页面自身 origin,绝不由前端直连任何外域。这道同源锁把"前端可被配置成把 token 发往
 * 任意外部域名"的风险从结构上消除(见 PR review P0-4)。
 *
 * 边界要如实说清:同源只约束**浏览器这一跳**。请求到达业务 origin 后,由 nginx 的
 * `location = /v1/e/b` 反代到运维配置的 collector(TRACK_API_URL,rewrite 到 `/v1/dap/collect`),
 * 并透传 `token` 头供后端按凭证鉴权归一 actor——也就是说 token 确实会被中转给 TRACK_API_URL
 * 所指的后端,目的地由**运维配置**决定,而非前端写死。故安全性依赖两条**运维前置**
 * (见 nginx.conf.template 同名 location 注释):
 *   ① TRACK_API_URL 必须指向集群内 / 受信 collector,绝不可配成不受信的外部地址;
 *   ② collector 不得记录 / 落盘 `token` 头(它是会话业务凭据,仅供即时鉴权)。
 * 前端能保证的仅是浏览器这一跳的同源;越过该跳之后的信任由部署拓扑与 collector 承担。
 *
 * 路径刻意取中性名(不含 track/collect/analytics/beacon/telemetry/pixel 等词):这些词全在
 * EasyPrivacy / uBlock Origin 默认过滤表里,装了隐私插件的浏览器(企业内网常见)会直接
 * 掐掉该请求 → 前端拿到 blocked、走 retry→drop,静默丢数据且难排查(见 PR #1330 review)。
 * BATCH_PATH 同时用于 fetch/XHR 包裹里识别"上报请求自身"以排除自采环。
 */
const BATCH_PATH = '/v1/e/b'
const FLUSH_SIZE = 20
const FLUSH_INTERVAL_MS = 5000
const MAX_RETRY = 3

/**
 * 属性名黑名单(§8 合规):命中即从 props 剔除,绝不上报。
 * 前端本层先剔一道,后端 collector(`/v1/dap/collect`)验签再拒一道,双保险。
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
 * 第一方 API 的**静态路由词白名单**。normalizePath 只放行这些"固定路由词",其余任何段
 * (用户名 / 一次性登录码 / 邀请码 / token / 文件名 / 日期 / 对象键 / id)一律占位符化。
 *
 * >>> 新增第一方路由时,若希望它在埋点 path 里可辨识,把新的静态词补进此表即可。 <<<
 * 不补的后果仅是该段被并成 :seg(分析粒度变粗),**绝不会泄露数据**——默认分支即 mask。
 * 这也是相对旧实现的关键修正:旧版按"字符形状"(纯小写串)放行,凭证/用户名会原样漏出;
 * 现在反转为"只采声明过的",凭证这类高熵随机串永远不可能等于字典式路由词,结构上漏不了
 * (见 PR #1320 review:normalizePath 需从"黑名单形状脱敏"改为"白名单路由模板")。
 *
 * 词表来源:扫描生产源码里 API 路径字面量的静态段(见提交说明),而非手工臆造。
 */
const ROUTE_WORDS = new Set<string>([
    'accept', 'access', 'access-requests', 'action', 'agent', 'agent-auth', 'agent-cards', 'agent-mailboxes', 'api', 'app_bot',
    'appbot', 'appconfig', 'apply', 'attachments', 'avatar', 'batch', 'batch-status', 'bind',
    'blacklist', 'blobs', 'bot_admin', 'cancel', 'card', 'categories', 'channel', 'chat',
    'collab-token', 'comments', 'common', 'config', 'confirm', 'contacts', 'conversation', 'conversations',
    'copy', 'create', 'current', 'decline', 'disband', 'dm', 'docs', 'download',
    'drafts', 'drawings', 'drive', 'edit', 'email', 'emoji', 'emojis', 'entrypoints', 'exit',
    'extra', 'file', 'files', 'folders', 'follow', 'friend', 'global', 'grants',
    'group', 'groups', 'im', 'imtransfer', 'incoming-webhooks', 'internal', 'invite', 'invites',
    'join', 'leave', 'local-config', 'login', 'login_authcode', 'loginuuid', 'managers', 'market',
    'mail-api', 'mail-gateway', 'mail-rules', 'mailboxes', 'mcp', 'mcp_categories', 'mcp-market', 'mcps', 'mcp_tags', 'me', 'members', 'mention_pref',
    'message', 'messages', 'migrations', 'mine', 'move', 'my_bots', 'obo', 'octo',
    'oidc', 'org', 'organizations', 'otp', 'owned_bots', 'participants', 'personal', 'personal-draft',
    'personal-edit', 'personal-refine', 'personal-versions', 'plugins', 'ppt', 'present', 'preview', 'qrcode',
    'reddot', 'refine', 'regenerate', 'reminder', 'rename', 'requests', 'respond', 'restore', 'robot',
    'scopes', 'screenshots', 'search', 'sendcode', 'setting', 'settings', 'share', 'shares',
    'skills', 'sort', 'space', 'space_bots', 'spaces', 'sticker', 'submit', 'summaries',
    'summary', 'summary-chat-candidates', 'summary-infer', 'summary-member-candidates', 'summary-schedules', 'summary-templates', 'sync', 'thirdlogin',
    'thread', 'threads', 'toggle', 'track', 'transcribe', 'transfer', 'upload', 'user',
    'users', 'v0', 'v1', 'v2', 'v3', 'verify', 'versions', 'voice', 'webapi', 'webhooks',
    'worksheets',
])

/**
 * 请求路径归一(§8 隐私边界:绝不泄文件名 / 对象键 / 用户名 / 凭证 / 正文)。
 *
 * **优先**:命中调用处经 `apiPath` 登记的路由模板(见 apiPath.ts)——直接上报源码里的静态
 * 路由模板(`/api/v1/spaces/:id/categories/:id`),字面业务段原样可见、变量段占位 :id,
 * 同一 endpoint 无论 id 怎么变都是同一个稳定模板,且模板里从不含变量值,隐私天然安全。
 *
 * **兜底**(未经 apiPath 的请求 / 直接 axios / 第三方库):**白名单路由词式**归一——每段只有
 * 命中 ROUTE_WORDS(声明过的静态路由词)才原样保留;其余一切一律占位符化——纯数字 / 长 hex /
 * uuid 记作 :id(仅为可读性,安全上等价),其余记作 :seg。默认即 mask,故用户名、一次性
 * login_authcode、邀请码、invite token、文件名、percent-encoded 段等都不可能进 telemetry。
 */
function normalizePath(rawUrl: string): string {
    try {
        // 相对/绝对都能解析;base 仅用于补全,不进结果
        const u = new URL(rawUrl, 'http://x')
        // 优先:调用处已知的路由模板(无损、稳定、隐私安全)。按 pathname 精确命中。
        const template = templateForPathname(u.pathname)
        if (template !== undefined) return template
        return u.pathname
            .split('/')
            .map((seg) => {
                if (!seg) return seg
                // 只放行声明过的静态路由词
                if (ROUTE_WORDS.has(seg)) return seg
                // 其余全部占位:id 形态(纯数字 / 长 hex / uuid)记 :id,纯为可读性
                if (/^\d+$/.test(seg)) return ':id'
                if (/^[0-9a-fA-F-]{16,}$/.test(seg)) return ':id'
                // 兜底:用户名 / 凭证 / 邀请码 / 文件名 / 编码段 / 短随机串 …… 一律 :seg
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
 * 当前 runtime 是否支持采集。埋点恒发同源相对路径 /v1/e/b(P0-4 同源锁),
 * 只在标准 http(s) Web 运行时成立。桌面 / Electron / Tauri 打包后页面跑在 `file://`
 * (或自定义协议),API 走的是 apiURL.ts 解析出的**绝对后端域名**——此时相对 /v1/e/b
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

/** 状态码分桶:不报精确 code,只报量级(2xx/4xx/5xx/err)。 */
function statusBucket(status: number): string {
    if (status <= 0) return 'err'
    if (status >= 500) return '5xx'
    if (status >= 400) return '4xx'
    if (status >= 300) return '3xx'
    return '2xx'
}

/** fetch reject 是否为「被取消」而非真实失败:AbortController.abort() 抛 name==='AbortError' 的 DOMException。 */
function isAbortError(err: unknown): boolean {
    return !!err && typeof err === 'object' && (err as { name?: string }).name === 'AbortError'
}

/**
 * 点击委托 resolver 的归宿:命中的元素 + 事件名 + 可选静态 props。
 * data-track 路径 event 取 dataset.track、props 省略;规则表路径 event/props 来自 TrackRule。
 */
type Resolved = { el: HTMLElement; event: string; props?: Record<string, TrackPrimitive> }

class DapImpl {
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
    // app_launched 一次性哨兵:整个页面生命周期只发一次「应用启动」。见 setEnabled 首启分支。
    private launchTracked = false
    /**
     * 采集机制是否已装:**每个采集器一个 flag**,而非一个总开关。
     * 单一总开关下,若某个 install 抛错(总开关保持 false),下次 setEnabled(true) 会把
     * 四个采集器**全部重装**——已成功的那些会被再装一遍:document 上多一个 click/submit
     * 捕获监听(声明式事件双记)、fetch/XHR 多包一层(见 PR #1320 review P2-3)。
     * 拆成 per-collector 后,每个采集器至多装一次,与其它是否失败无关。
     */
    private installed: { click: boolean; page: boolean; exposure: boolean; http: boolean } = {
        click: false,
        page: false,
        exposure: false,
        http: false,
    }
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
    private lastPage: { pageId: string; enteredAt: number; settled: boolean } | null = null
    /** 卸载期标记:置真时 enqueue 不再走普通 flush,残留统一由 unloadFlush 的单个 keepalive 批次送出。
     *  切后台(hidden)时置真、回前台(visible)复位;真实关页时不复位(页已走)。 */
    private unloading = false
    private pageBootObserver: MutationObserver | null = null
    /** 曝光去重:每个元素实例只触发一次 data-track-view */
    private seenViews = new WeakSet<Element>()
    /** 内部计数:上报最终失败丢弃数,只自增不外抛 */
    private droppedCount = 0
    /**
     * 停采钩子:setEnabled(false) 时逐个调用。给「模块级持有缓存」的破例点(如消息补点的
     * intents Map)一个在 kill switch 触发时清空自身的入口——否则停采后这些缓存会继续常驻。
     * 幂等注册由调用方保证(如 ensureGlobalAckListener 只注册一次)。
     */
    private disableHooks: Array<() => void> = []

    /**
     * 启动蒙版:登记卸载兜底 + 定时 flush。幂等,只装一次。
     * **不在此装采集机制**(observer / fetch·XHR 包裹)——那些改会给所有用户加常驻开销,
     * 而本特性默认 dark 上线;改到首次 setEnabled(true) 时惰性装(见 installCollectors)。
     * 由 app 启动处调用一次(见 apps/web/src/index.tsx),不由业务组件调用。
     */
    init(): void {
        if (this.started) return
        this.started = true
        this.safe(() => {
            this.installUnloadFlush()
            this.flushTimer = setInterval(() => this.safe(() => this.flush()), FLUSH_INTERVAL_MS)
            // 极少数情况:enable 早于 init(如同步下发)。此时补装采集机制。
            if (this.enabled) this.installCollectors()
        })
    }

    /**
     * 惰性装采集机制:点击委托 + 切页/曝光 observer + fetch·XHR 包裹。
     * 只在特性真正启用时装,dark 态(默认)不给 prod 用户加任何常驻开销。
     * **每个采集器独立幂等**(installOnce):某个抛错不影响其它,重试也只补装未成功的那个,
     * 绝不会把已装的采集器再装一遍(避免重复监听 / 重复包裹,见 PR #1320 review P2-3)。
     * installOnce 内 safe() 包裹:setEnabled 在 App remoteConfig 回调里内联调用,采集安装
     * 抛错绝不能中断后续业务逻辑。
     */
    private installCollectors(): void {
        this.installOnce('click', () => this.installClickDelegation())
        this.installOnce('page', () => this.installPageObserver())
        this.installOnce('exposure', () => this.installExposureObserver())
        this.installOnce('http', () => this.installHttpWrap())
    }

    /** 装单个采集器:已装则跳过;装成功才置位(中途抛错保持 false,下次重试仅补这一个)。 */
    private installOnce(key: keyof DapImpl['installed'], fn: () => void): void {
        if (this.installed[key]) return
        this.safe(() => {
            fn()
            this.installed[key] = true
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
            // 通知破例点清空各自的模块级缓存(如消息补点 intents),使停采后零常驻残留。
            for (const cb of this.disableHooks) this.safe(cb)
        } else if (!was) {
            // 首次启用:惰性装采集机制(dark 态从未装过),再补扫当前 DOM。
            this.installCollectors()
            this.rescanCurrent()
            // app_launched **不在此发**(六审 P2):首次 setEnabled(true) 由 appconfig 回调驱动
            //   (App.tsx:502-503),而 appconfig 在**登录页(未登录、无 token)**就会拉,此处发会
            //   逼 envelope()→deviceId() 给匿名访客写持久 localStorage 标识 + 发一条无 token 上报,
            //   破坏 Dap.ts:255-258 的「惰性创建」保证。改由 maybeTrackLaunch() 在**登录后拿到 token、
            //   首个真正产出的事件到来时**补发一次(整生命周期仍仅一次,launchTracked 哨兵保证)。
        }
    }

    /**
     * app_launched 惰性补发(六审 P2 / owner 决策 b):登录(currentToken 有值)后、采集开启、
     * 且首个真正 track 到来时发一次「应用启动」。放在 track() 顶部——匿名登录页无 token 时不发,
     * 从而不写 device_id、不产生无 token 上报;登录后首个鉴权事件(通常是 http_request / page 进入)
     * 触发它,并排在该事件之前。launchTracked 哨兵保证整生命周期仅一次(停采→再启用亦不重复)。
     */
    private maybeTrackLaunch(): void {
        if (this.launchTracked) return
        if (!this.enabled) return
        if (!this.currentToken()) return
        this.launchTracked = true
        this.track('app_launched', {})
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
        this.maybeTrackLaunch() // 登录后首个事件时补发 app_launched(见其注释);哨兵防重入
        this.safe(() => {
            const clean = this.sanitizeProps(props)
            const objectId = this.pickObjectId(clean)
            this.enqueue(this.envelope(eventName, clean.props, objectId))
        })
    }

    /** page_view(MutationObserver 内部调,按 pageId 去重 + 结算上一页停留)。 */
    pageView(pageId: string, extra?: Record<string, unknown>): void {
        if (!this.enabled || !pageId) return
        this.maybeTrackLaunch() // 首个鉴权页进入亦可触发 app_launched(排在 page_view 前)
        this.safe(() => {
            // 同页重复触发(菜单 setter + syncPath + mittBus 多次)只忽略,不重复计数(§3.2)
            if (this.lastPage && this.lastPage.pageId === pageId) return
            const now = Date.now()
            // 结算上一页停留(若尚未在切后台时结算过)
            this.settleLastPage(now)
            this.lastPage = { pageId, enteredAt: now, settled: false }
            const clean = this.sanitizeProps(extra)
            const env = this.envelope('page_view', clean.props)
            env.page_id = pageId
            this.enqueue(env)
        })
    }

    /**
     * 结算当前页停留:给上一页发带 duration_ms 的 page_leave(优先入队,便于随卸载/切后台
     * 的 keepalive 批次一起送)。幂等——已结算过则不再发,避免「切后台结算 + 随后切页」双记。
     * 由 pageView(切页)与 unloadFlush(切后台/卸载)共同调用。
     */
    private settleLastPage(now: number): void {
        if (!this.lastPage || this.lastPage.settled) return
        const durEnv = this.envelope('page_leave', {
            duration_ms: now - this.lastPage.enteredAt,
        })
        durEnv.page_id = this.lastPage.pageId
        this.enqueue(durEnv, /* priority */ true)
        this.lastPage.settled = true
    }

    /** 手动刷新,调试用。 */
    flush(): void {
        if (this.queue.length === 0) return
        const batch = this.queue
        this.queue = []
        this.sendBatch(batch, 0, this.generation)
    }

    /**
     * 运维可读的采集健康快照。`dropped` 是「重试耗尽后被丢弃的事件数」——此前是私有
     * 计数,运维无从得知丢批(如某环境 /v1/e/b 未配路由时会静默累积)。可在控制台
     * `Dap.shared.getStats()` 读取。(见 PR #1320 review 的可观测性缺口。)
     */
    getStats(): { enabled: boolean; queued: number; dropped: number } {
        return { enabled: this.enabled, queued: this.queue.length, dropped: this.droppedCount }
    }

    /**
     * 采集是否启用。供极少数破例点(如消息补点 trackMessage.ts)做 **fail-closed 前置判断**:
     * dark 态(默认未启用)下这些点应彻底不工作——不绑监听、不建缓存,真正零常驻开销。
     */
    isEnabled(): boolean {
        return this.enabled
    }

    /**
     * 注册停采钩子:setEnabled(false) 时被调用一次。破例点若持有模块级缓存,应在此清空,
     * 使 kill switch 关闭后不留任何常驻状态。调用方须保证只注册一次(见 trackMessage.ts)。
     */
    onDisabled(cb: () => void): void {
        this.disableHooks.push(cb)
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
        return { props, objectId }
    }

    private pickObjectId(clean: { props: Record<string, TrackPrimitive>; objectId?: string }): string | undefined {
        return clean.objectId
    }

    private enqueue(env: TrackEnvelope, priority = false): void {
        if (!this.enabled) return
        this.queue.push(env)
        // 卸载期:不走普通 fetch flush(会被浏览器随页面卸载取消),残留一律留给
        // unloadFlush 的单个 keepalive 批次统一送出(见 unloadFlush / installUnloadFlush)。
        if (this.unloading) return
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
            // 常规批次用普通 fetch,**不加 keepalive**:keepalive 请求共享一个很小的配额
            // (整页所有 keepalive 请求 body 合计上限约 64KB),且语义是为「文档卸载中仍要发出」
            // 而设——常规运行期的批次不需要它,滥用会挤占真正卸载兜底(unloadFlush)的配额
            // (见 PR review P2)。卸载期才用 keepalive,见 unloadFlush。
            void fetch(BATCH_PATH, {
                method: 'POST',
                headers,
                body,
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
     * 先置 `unloading` 抑制普通 flush,再**结算当前页**(settleLastPage 幂等,截到此刻),
     * 使最后一页的 page_leave 与队列残留一并进入这**唯一一个 keepalive 批次**——普通 fetch
     * 会随页面卸载被浏览器取消,只有 keepalive 请求能在卸载中发完(见 P1 回归修复)。
     * 用 **keepalive fetch** 而非 sendBeacon —— sendBeacon 设不了 `token` 头、过不了后端 header 鉴权;
     * keepalive fetch 是其现代替代,能带头,鉴权与常规上报统一。不重试。
     */
    private unloadFlush(): void {
        this.safe(() => {
            if (!this.enabled) return // 停采后不发残留
            // 卸载期:后续 enqueue(含下面的 page_leave 结算)不再各自 flush,统一进本批次
            this.unloading = true
            this.settleLastPage(Date.now())
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
        // 规则表索引:安装时构建一次(此刻读 TRACK_RULES)。data-track 落空才查它,故对现有
        // 声明式埋点零影响;表为空时 fallback 恒 miss,行为与旧实现完全一致。
        const index = buildIndex(TRACK_RULES)
        // 解析被点/被激活元素归属的埋点归宿:先 data-track(绝对优先),落空再查规则表 fallback。
        // 返回从「元素」升级为 { el, event, props? }:data-track 命中时 event 取 dataset.track、
        // 无静态 props;规则命中时 event / props 来自规则表。两路统一交给 fire()。
        const resolveTracked = (
            target: HTMLElement | null,
            evType: 'click' | 'submit' | 'keydown',
        ): Resolved | null => {
            if (!target || typeof target.closest !== 'function') return null
            const el = target.closest<HTMLElement>('[data-track]')
            if (el) {
                // 落在被显式标记「本次交互不代表该 data-track 动作」的子控件里则跳过:
                // 如会话行(channel_opened)内的拖拽柄/展开线程标签、市场卡片 footer 的编辑/删除
                // 按钮——它们 stopPropagation 表示「不代表该事件」,但捕获阶段先于 stopPropagation
                // 执行,故改用 data-track-ignore 显式排除(ignore 须是被点元素到 tracked 元素之间的一层)。
                if (this.isTrackIgnored(target, el)) return null
                const event = el.dataset.track
                if (!event) return null
                return { el, event }
            }
            // data-track 落空 → 规则表 fallback。只吃「没有 data-track」的节点 → 现有埋点零回归。
            return this.resolveByRules(target, evType, index)
        }
        const fire = (r: Resolved) => {
            if (!r.event) return
            // 合并规则静态 props 与 collectDatasetProps(el)(读 data-*,不读 value/正文);
            // 让运行时 data-object-id 等覆盖同名静态项。data-track 路径无静态 props,退化为原行为。
            const dsProps = this.collectDatasetProps(r.el)
            const props = r.props ? { ...r.props, ...dsProps } : dsProps
            this.track(r.event, props)
        }
        const clickHandler = (e: Event) => {
            this.safe(() => {
                const evType = e.type === 'submit' ? 'submit' : 'click'
                const r = resolveTracked(e.target as HTMLElement | null, evType)
                if (r) fire(r)
            })
        }
        // 键盘激活补采:role="button" 等**非原生**控件(如市场卡片 McpCard/SkillCard 是
        // div/article + role=button + 自定义 onKeyDown)被 Enter/Space 激活时,浏览器**不会**
        // 派发 click,声明式 click 委托整条漏采——键盘用户打开详情却无任何事件(见 PR #1320
        // review P1-4)。这里补一条 keydown:仅对**非原生可激活**的聚焦元素在 Enter/Space 时
        // 补发;原生 button/a[href]/input/select/textarea/summary 会自行合成 click(已被上面的
        // 委托覆盖),显式排除以免双记。规则表命中的节点走同一 resolver,故键盘激活同样能采到。
        const keydownHandler = (e: KeyboardEvent) => {
            this.safe(() => {
                if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return
                const target = e.target as HTMLElement | null
                if (!target || this.isNativeActivatable(target)) return
                const r = resolveTracked(target, 'keydown')
                if (r) fire(r)
            })
        }
        // 捕获阶段:即使业务层 stopPropagation 也能采到。
        // click 只听 click(不听 change):Semi Switch / 原生 checkbox 一次切换会同时冒泡
        // click 和 change,两者都命中同一个 [data-track] wrapper → 声明式事件被记两遍
        // (如 group_setting_toggled)。click 已覆盖指针点击与原生控件的键盘激活;非原生
        // 控件的键盘激活由 keydownHandler 补齐。
        // 注:当前无任何 data-track 挂在只靠 change 的控件(<select>/radio)上;
        // 若将来需要,应针对该控件单独加一条 guard 过的 change 监听,而非全局恢复。
        document.addEventListener('click', clickHandler, true)
        document.addEventListener('submit', clickHandler, true)
        document.addEventListener('keydown', keydownHandler, true)
    }

    /**
     * 规则表 fallback:从被点元素沿 parentElement 向上 walk,逐个祖先看 `data-testid`,用它查
     * byTestid 主索引;再用 route + closestTestid + on + role 做 AND 约束消歧。命中数 >1 打 warn
     * 取第一条。testid 主路径 miss 后,再走少量 loose(role/aria)线性兜底。全程只读 data-testid /
     * role 属性,绝不读 value / 正文。
     */
    private resolveByRules(
        target: HTMLElement,
        evType: 'click' | 'submit' | 'keydown',
        index: TrackRuleIndex,
    ): Resolved | null {
        const route = this.currentRoute()
        // ① testid 主路径(O(1) 查 Map):第一个「有 data-testid 且规则命中」的祖先胜出。
        let node: HTMLElement | null = target
        while (node) {
            const testid = node.dataset ? node.dataset.testid : undefined
            if (testid) {
                const rules = index.byTestid.get(testid)
                if (rules && rules.length) {
                    const el = node
                    const matched = rules.filter(
                        (r) =>
                            matchRoute(r.route, route) &&
                            this.matchOn(r.on, evType) &&
                            this.matchClosest(el, r.closestTestid) &&
                            this.matchRole(el, r.role),
                    )
                    if (matched.length) {
                        if (matched.length > 1) this.warnAmbiguous(testid, matched)
                        // data-track-ignore 复用:落在 ignore 子树里则视为「不代表该事件」,跳过。
                        if (this.isTrackIgnored(target, el)) return null
                        return { el, event: matched[0].event, props: matched[0].props }
                    }
                }
            }
            node = node.parentElement
        }
        // ② loose 兜底(线性,数量应很小):无 testid、靠 role/aria 命中。沿祖先找首个 role 匹配的元素。
        for (const r of index.loose) {
            if (!r.role) continue // loose 规则必须带 role,否则会匹配一切
            let n: HTMLElement | null = target
            while (n) {
                const el = n
                if (
                    this.matchRole(el, r.role) &&
                    matchRoute(r.route, route) &&
                    this.matchOn(r.on, evType) &&
                    this.matchClosest(el, r.closestTestid)
                ) {
                    if (this.isTrackIgnored(target, el)) return null
                    return { el, event: r.event, props: r.props }
                }
                n = n.parentElement
            }
        }
        return null
    }

    /** 当前路由(location.pathname);拿不到(SSR/测试无 DOM)返回空串 → 带 route 约束的规则一律不命中。 */
    private currentRoute(): string {
        try {
            const loc = (globalThis as { location?: Location }).location
            return loc && loc.pathname ? loc.pathname : ''
        } catch {
            return ''
        }
    }

    /** on 约束:规则缺省 on → 三类交互都可;否则仅在指定交互类型触发。 */
    private matchOn(on: TrackRule['on'], evType: 'click' | 'submit' | 'keydown'): boolean {
        return !on || on === evType
    }

    /** closestTestid 约束:规则缺省 → 恒真;否则该元素需能 closest 到带此 data-testid 的祖先(消歧用)。 */
    private matchClosest(el: HTMLElement, closestTestid?: string): boolean {
        if (!closestTestid) return true
        try {
            return !!el.closest(`[data-testid="${closestTestid}"]`)
        } catch {
            return false
        }
    }

    /** role 约束:规则缺省 → 恒真;否则该元素的 role 属性需精确等于它。 */
    private matchRole(el: HTMLElement, role?: string): boolean {
        if (!role) return true
        return typeof el.getAttribute === 'function' && el.getAttribute('role') === role
    }

    /**
     * data-track-ignore 排除(data-track 路径与规则表路径共用):被点元素最近的 data-track-ignore
     * 若严格落在归宿元素 `el` 内部(el.contains(ignore) 且 el !== ignore),则本次交互「不代表该
     * 事件」,跳过。
     */
    private isTrackIgnored(target: HTMLElement, el: HTMLElement): boolean {
        const ignore = target.closest<HTMLElement>('[data-track-ignore]')
        return !!ignore && el !== ignore && el.contains(ignore)
    }

    /**
     * 规则表消歧告警:同一 data-testid 在当前约束下命中多条规则,取第一条并 warn,提示规则表
     * 作者补 route/closestTestid/on 约束。仅为配置期质量信号,包在 try 里绝不抛、不影响业务。
     */
    private warnAmbiguous(testid: string, matched: TrackRule[]): void {
        try {
            const c = (globalThis as { console?: Console }).console
            c?.warn?.(
                `[Dap] ambiguous track rules for data-testid="${testid}" (${matched.length} matched); using "${matched[0].event}"`,
            )
        } catch {
            /* ignore */
        }
    }

    /**
     * 原生「Enter/Space 会自动合成 click」的可激活元素。用于 keydown 补采时排除它们
     * (避免与浏览器合成的 click 双记)。非原生的 role="button" 等返回 false → 需 keydown 补发。
     */
    private isNativeActivatable(el: HTMLElement): boolean {
        const tag = el.tagName
        if (tag === 'BUTTON' || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'SUMMARY') {
            return true
        }
        if (tag === 'A' && el.hasAttribute('href')) return true
        return false
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
                // dataset.trackTabName -> tab_name(去掉 track 前缀后转 snake_case)
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
        // 命中一个「可见的 [data-page-id]」元素 → page_view(内部按 pageId 去重)。
        const visit = (el: HTMLElement | null) => {
            if (el && el.style && el.style.display === 'block' && el.dataset && el.dataset.pageId) {
                this.pageView(el.dataset.pageId)
            }
        }
        // 扫一个新插入节点及其子树里所有已可见的页节点。
        const scan = (node: Node) => {
            if (!(node instanceof HTMLElement)) return
            visit(node)
            node.querySelectorAll<HTMLElement>('[data-page-id]').forEach(visit)
        }
        let attachedRoot: Element | null = null
        let scoped: MutationObserver | null = null
        const attach = (root: Element) => {
            if (attachedRoot === root) return // 已绑同一节点,勿重复观测
            // 容器被替换(审批屏卸载再挂回 shell 等):断开旧 scoped 观测,重绑到新节点。
            scoped?.disconnect()
            attachedRoot = root
            scoped = new MutationObserver((mutations) => {
                this.safe(() => {
                    for (const m of mutations) {
                        if (m.type === 'attributes') {
                            // 已存在节点的 display 翻转(切页)
                            visit(m.target as HTMLElement)
                        } else {
                            // 路由首次访问:页节点是「新插入」而非 style 翻转。只监听 style
                            // 会整条漏掉首访 page_view,并使后续 page_leave 的 duration_ms
                            // 错误累计到别的页(看着对、其实错的数据,见 PR #1320 review)。
                            // 故一并监听 childList,对新增子树补扫。
                            m.addedNodes.forEach(scan)
                        }
                    }
                })
            })
            scoped.observe(root, { subtree: true, attributes: true, attributeFilter: ['style'], childList: true })
            // 挂载即补扫当前已可见页,避免漏掉挂载(或重挂)那一刻的首屏 page_view(P1-7);
            // 重挂场景下这一扫还会 pageView 新容器的当前页 → settleLastPage 结算掉此前那条
            // 停留在旧页的 lastPage,顺带修正 page_leave 的错误归属。
            root.querySelectorAll<HTMLElement>('[data-page-id]').forEach(visit)
        }
        const resolve = () => {
            const root = document.querySelector('.wk-layout-content-left')
            // 仅当出现「新的、未绑定过的」容器实例时才重绑。容器被移除时 root 为 null,
            // 保留旧引用即可(旧节点已卸载,残留观测无害),等新容器出现再重解析。
            if (root && root !== attachedRoot) attach(root)
        }
        resolve() // 立即尝试绑定当前容器(若首屏已渲染)
        // 常驻引导观测:容器**首次出现**或**被替换重挂**都触发重解析重绑。
        // 关键修正(PR #1320 review P1-1):JoinSpaceModal 的 NEED_APPROVAL/PENDING 会让
        // AppLayout 换成审批屏、关闭后再换回 shell —— 同一 JS 上下文,单例不重建,.wk-layout-content-left
        // 被卸载再重建。旧实现 attach 后 return、且引导观测出现容器即 disconnect,故 scoped 观测
        // 会永久绑死在已卸载的旧容器上:此后整会话 page_view 全丢、page_leave 继续错记到旧页。
        // 因此引导观测**不再一次性 disconnect**,常驻监听 body 以便随时重解析。
        this.pageBootObserver = new MutationObserver(() => this.safe(resolve))
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
        // 只在元素**真正可见**时算一次曝光。shell(MainContentLeft)把访问过的路由全留在
        // DOM 里用 inline `display:none` 藏着,隐藏子树里的节点重渲染 / setEnabled 补扫都会
        // 触发 childList,若不判可见性就会给用户没看到的页面记 impression(见 PR review P1-1)。
        // 与 page 路径的 `display==='block'` 闸对齐:任一祖先 inline display:none 即视为不可见,
        // 此时不标 seen,留待其真正可见时再采。
        if (this.isHiddenByDisplay(el)) return
        if (this.seenViews.has(el)) return
        this.seenViews.add(el)
        this.track(el.dataset.trackView, this.collectDatasetProps(el))
    }

    /** 沿 parentElement 链上溯,任一祖先(含自身)inline `display:none` → 判为不可见。 */
    private isHiddenByDisplay(el: HTMLElement): boolean {
        let node: HTMLElement | null = el
        while (node) {
            if (node.style && node.style.display === 'none') return true
            node = node.parentElement
        }
        return false
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
        // XHR proto.send 里的 this 是 XMLHttpRequest 实例,拿不到 DapImpl;用 dap 别名读 enabled。
        const dap = this
        // 中央映射索引:一次性构建,emit 闭包复用(installOnce('http') 保证只装一次)。
        const fetchIndex: FetchRuleIndex = buildFetchIndex(FETCH_RULES)
        const bodyIndex: BodyRuleIndex = buildBodyIndex(BODY_RULES)
        // bodyEvent 在包裹处(能拿到请求体时)算好传入:body 键通道优先于 path 通道,避免重复计事件。
        const emit = (rawUrl: string, method: string, status: number, durationMs: number, bodyEvent?: string) => {
            this.safe(() => {
                if (!rawUrl) return
                // 只采第一方(同源)API telemetry:跨域(预签名对象存储/第三方)路径含对象键/文件名,一律不采
                if (!isFirstParty(rawUrl)) return
                const m = (method || 'GET').toUpperCase()
                // 量/错误率/延迟,不带 query、不带正文;路径按白名单收窄脱敏。
                // **不从 URL 路径提取 object_id**:路径末段可能是一次性登录码 / 邀请 token / 对象键
                // (见 PR #1320 review),原样取出即等于把凭证放进 telemetry。http_request 只保留
                // 已脱敏的 path 维度,不再单列 object_id(path 已覆盖其可分析的信息)。
                this.track('http_request', {
                    method: m,
                    path: normalizePath(rawUrl),
                    status_bucket: statusBucket(status),
                    duration_ms: Math.round(durationMs),
                })
                // 中央映射(①path / ②body):仅在 **2xx**(动作确已发生)时补发一条映射事件。
                // body 键通道优先(更具体);其次 path 通道。映射事件不带任何来自请求的值
                // (无 object_id / query / 正文),故凭证 / 文件名不可能借此外泄。
                if (status >= 200 && status < 300) {
                    const mapped = bodyEvent ?? matchFetchEvent(fetchIndex, m, rawPathname(rawUrl))
                    if (mapped) this.track(mapped, {})
                }
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
                // body 键通道:只在能拿到 JSON 字符串体时算(Request 对象体是流、只能异步读,跳过);
                // computeBodyEvent 内部做白名单门 + 只读键,返回的只是本表里的事件名常量。
                // P2-1:必须在**第一方(同源) + 已启用**时才读体 —— BodyRules.ts:17 承诺「跨域不读」,
                // 且 kill switch(enabled=false)要连「读」一并停掉,不能只停 emit。这里把不变式落进代码,
                // 不再只靠 emit 里的 isFirstParty 兜底(那只挡上报、挡不住 parse)。
                const reqBody = typeof init?.body === 'string' ? init.body : undefined
                const bodyEvent =
                    this.enabled && isFirstParty(url)
                        ? dap.safeCall(() => computeBodyEvent(bodyIndex, method || 'GET', url, reqBody))
                        : undefined
                return orig(input as RequestInfo, init)
                    .then((resp) => {
                        emit(url, method || 'GET', resp.status, Date.now() - start, bodyEvent)
                        return resp
                    })
                    .catch((err) => {
                        // 被取消的请求不是失败:搜索每次按键都会 abort 在途请求(APIClient 的
                        // AbortSignal 即为此),记成 status 0→'err' 会把 http_request 错误率打爆
                        // (见 PR review P1-2)。仅真实网络失败才记 err。
                        if (!isAbortError(err)) emit(url, method || 'GET', 0, Date.now() - start)
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
            type Tracked = XMLHttpRequest & { __trackMethod?: string; __trackUrl?: string }
            proto.open = function (this: Tracked, method: string, url: string | URL, ...rest: unknown[]) {
                this.__trackMethod = method
                this.__trackUrl = typeof url === 'string' ? url : url.toString()
                // @ts-expect-error 透传原始可变参数
                return origOpen.call(this, method, url, ...rest)
            }
            proto.send = function (this: Tracked, ...args: unknown[]) {
                const start = Date.now()
                const url = this.__trackUrl || ''
                const method = this.__trackMethod || 'GET'
                if (url && url.indexOf(BATCH_PATH) === -1) {
                    // body 键通道:axios 走 XHR,JSON payload 序列化为字符串体传入 send(args[0])。
                    // 只在字符串体上算(Blob/FormData 上传等一律跳过);内部白名单门 + 只读键。
                    // P2-1:同 fetch —— 只在第一方 + 已启用时读体,把「跨域不读 / 停采即停读」落进代码。
                    const bodyEvent =
                        dap.enabled && isFirstParty(url)
                            ? dap.safeCall(() =>
                                  computeBodyEvent(
                                      bodyIndex,
                                      method,
                                      url,
                                      typeof args[0] === 'string' ? (args[0] as string) : undefined,
                                  ),
                              )
                            : undefined
                    // 在闭包里定住 url/method/start(不在 loadend 时读实例字段,避免复用/
                    // 重 open 后读到串味的路径);once:true 保证复用实例多次 send 不累积监听
                    // (否则一个 loadend 会补发历史请求的 http_request,见 review P2)。
                    // abort 与 loadend 都会在取消时触发,且 abort 先于 loadend;命中 abort 就
                    // 标记跳过,不把用户主动取消记成 status 0→'err'(见 PR review P1-2)。
                    // 正常完成(无 abort)时在 loadend 里主动摘掉 abort 监听:once 的 abort 监听
                    // 若一直不触发就不会自动摘,复用实例多次正常完成会累积一串死监听(见 review P2)。
                    let aborted = false
                    const onAbort = () => { aborted = true }
                    const onLoadEnd = () => {
                        this.removeEventListener('abort', onAbort)
                        if (!aborted) emit(url, method, this.status, Date.now() - start, bodyEvent)
                    }
                    this.addEventListener('abort', onAbort, { once: true })
                    this.addEventListener('loadend', onLoadEnd, { once: true })
                    // P2-5:监听器在 native send() 之前挂上;若 send() 同步抛(如对已 open 的实例重复
                    // send() 触发 InvalidStateError),这两个监听器会残留,等首个请求 loadend 时连带
                    // 补发一次历史请求的 http_request。故 send 抛错时先摘掉两个监听器再重抛。
                    try {
                        // @ts-expect-error 透传原始参数
                        return origSend.apply(this, args)
                    } catch (e) {
                        this.removeEventListener('abort', onAbort)
                        this.removeEventListener('loadend', onLoadEnd)
                        throw e
                    }
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
            this.safe(() => {
                if (document.visibilityState === 'hidden') {
                    // 切后台/即将卸载:交给 unloadFlush 统一处理——它会先结算当前页停留
                    // (duration 截到隐藏这一刻),再随唯一的 keepalive 批次一起送。否则最后一页
                    // 永无 page_leave,且后台挂机时长会被错记进「下一次切页」的停留里(看着像
                    // 一次超长阅读,实为无人在看)。
                    onHide()
                } else if (document.visibilityState === 'visible') {
                    // 回到前台:退出卸载期,允许普通 flush 恢复;并重置停留起点 + 允许再次结算,
                    // 后台时长不计入本页停留。
                    this.unloading = false
                    if (this.lastPage) {
                        this.lastPage.enteredAt = Date.now()
                        this.lastPage.settled = false
                    }
                }
            })
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

    /**
     * safe 的取值版:执行 fn 并返回其值,内部抛错时降级为 undefined(绝不外抛)。
     * 六审 P5:computeBodyEvent 在 fetch/XHR 拦截热路径里同步调用,虽已内含 try/catch,但它是外部
     * 纯函数,一旦将来重构引入抛错(或 URL/JSON 极端输入),异常会顺着我们 wrap 的 fetch/send 冒泡、
     * 污染宿主网络层。这里把「算 body 事件」也纳入 Dap「内部异常一律吞」的统一边界,埋点永不拖累业务请求。
     */
    private safeCall<T>(fn: () => T): T | undefined {
        try {
            return fn()
        } catch {
            return undefined
        }
    }
}

/** 蒙版单例(唯一上报出口)。`Dap.shared` 供极少数破例点(如消息补点)引用。 */
export const Dap = {
    shared: new DapImpl(),
}

export type { TrackEnvelope }

/**
 * 仅供单元测试引用的隐私关键纯函数(不属于运行时公共 API)。normalizePath / isFirstParty
 * 是 §8 隐私边界的核心,单测直接断言其脱敏 / 同源判定,避免只靠集成路径覆盖。
 */
export const __dapInternals = { normalizePath, isFirstParty, isSupportedRuntime }
