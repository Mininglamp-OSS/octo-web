/**
 * BodyRules —— 埋点「中央映射·body 键」通道(②)的规则表 + 判别器
 * =====================================================================
 * 背景:整合表 d_2c47796780d4efdd3c5aa8b3 里约 53 个事件,后端是**部分更新**(partial PUT/PATCH)
 * 或**共用同一端点**,method+path 一样,真正的判别位在 **request body 的顶层键**
 * (如 `PUT /fleet/api/v1/issues/:id` 改 status / priority / assignee 落到同一 endpoint,
 * 靠 body 里出现哪个顶层键区分)。
 *
 * ⚠️ 隐私边界(见开发文档 §2② / PR #1320 review「不带正文」):
 *   body-clone 是对既有「不读正文」边界的**受控放宽**,须严格限定,合入前**须过隐私 review**:
 *     1. **端点白名单**:只有本表登记的 method+path 才会被读 body;其余请求一律不碰正文。
 *     2. **只读顶层枚举键,不读值**:判别只用「某顶层键是否存在」或「某白名单键 == 某白名单枚举值」;
 *        **绝不把 body 里的任何值 emit 出去**。computeBodyEvent 内部看完即弃,只返回一个**本表里的
 *        事件名常量**(全部硬编码在源码里,不含用户数据)。
 *     3. **只解析 JSON 字符串体**:multipart / Blob / ReadableStream(上传等)一律跳过 —— 那里才是
 *        文件名 / 对象键的高风险区。
 *     4. **同源 + 2xx 才触发**(由 Dap.installHttpWrap 保证):跨域不读、动作没成功不记。
 *   —— 这样即便放宽了「读 body」,能逃逸到 telemetry 的也只有一个我们自己声明的事件名,
 *      用户数据(名称 / 备注 / 指令正文 / 文件名)在任何路径上都不出现。
 *
 * ⚠️ 实现前提(XHR-only):body 通道的读取只覆盖 XHR(APIClient 走 axios/XHR)与 `fetch(url, {body})`
 *   字符串体两条路。`fetch(new Request(url, { body }))` 形态下 init 为 undefined,拿不到 body,
 *   本通道静默不发。今天所有已映射端点都经 APIClient(XHR),故无影响;若将来 APIClient 迁到
 *   fetch(Request),这些 conversation_* / group_* / webhook_* body 事件会悄悄归零(见二审 P2-7)。
 */

/** 顶层键的枚举值只允许基础量(用于「键==值」判别,值本身仅用于比较,绝不上报)。 */
type BodyPrimitive = string | number | boolean

/**
 * 单条判别子:命中即返回其 event。两种匹配(可组合,全部 AND):
 *   - `hasKeys`  body 顶层**存在**列出的全部键(presence-only,不看值)。
 *   - `equals`   body 顶层 `key` 的值 ∈ 白名单 `values`(唯一「看值」处,值只做相等比较不外泄)。
 * 判别子在 BodyRule.discriminators 里**按序**匹配,先中者胜。
 */
export interface BodyDiscriminator {
    event: string
    hasKeys?: string[]
    equals?: { key: string; values: BodyPrimitive[] }
}

/** 单条 body 规则:锚定一个白名单端点(method + path 通配,语义同 FetchRules)。 */
export interface BodyRule {
    method: string
    path: string
    /** 顺序判别:先匹配中的 discriminator 的 event 胜出。 */
    discriminators: BodyDiscriminator[]
    /** 都没中时的兜底事件(如 task_detail_edited);缺省则无兜底、返回 undefined。 */
    fallbackEvent?: string
}

interface CompiledBodyRule {
    segs: string[]
    wild: boolean[]
    discriminators: BodyDiscriminator[]
    fallbackEvent?: string
}

export interface BodyRuleIndex {
    byMethod: Map<string, CompiledBodyRule[]>
}

const isWild = (seg: string): boolean => seg.charCodeAt(0) === 58 /* ':' */

/** 解析 JSON 体最大字节数:超过一律不解析(大体多为上传/富文本,非本通道目标,且徒增开销)。 */
const MAX_BODY_BYTES = 64 * 1024

/** 建索引:按 method(大写)分桶 + 预编译 path 段。 */
export function buildBodyIndex(rules: BodyRule[]): BodyRuleIndex {
    const byMethod = new Map<string, CompiledBodyRule[]>()
    for (const rule of rules) {
        if (!rule || !rule.method || !rule.path || !rule.discriminators?.length) continue
        const segs = rule.path.split('/').filter((s) => s !== '')
        const compiled: CompiledBodyRule = {
            segs,
            wild: segs.map(isWild),
            discriminators: rule.discriminators,
            fallbackEvent: rule.fallbackEvent,
        }
        const m = rule.method.toUpperCase()
        const arr = byMethod.get(m)
        if (arr) arr.push(compiled)
        else byMethod.set(m, [compiled])
    }
    // 最具体者优先(与 FetchRules 的 most-specific-wins 一致):同一 method 桶内按通配段数升序,
    // 字面段多(通配少)的规则排前,先被 computeBodyEvent 命中。防止「字面规则被排在通配 fallbackEvent
    // 规则之后而被静默盖住」——本表未来新增同形 PUT 时的错归属风险(见二审 P2-6)。
    // 段数不同的规则在 pathMatches 里本就互斥,排序只影响「同段数、通配多寡不同」这一类。
    for (const arr of byMethod.values()) {
        arr.sort((a, b) => nWild(a) - nWild(b))
    }
    return { byMethod }
}

/** 编译规则的通配段数(越少越具体)。 */
function nWild(rule: CompiledBodyRule): number {
    let n = 0
    for (const w of rule.wild) if (w) n++
    return n
}

/** path 段级匹配(与 FetchRules 一致:':' 段通配,字面须相等,段数须同)。 */
function pathMatches(rule: CompiledBodyRule, actual: string[]): boolean {
    if (rule.segs.length !== actual.length) return false
    for (let i = 0; i < actual.length; i++) {
        if (rule.wild[i]) continue
        if (rule.segs[i] !== actual[i]) return false
    }
    return true
}

/** 单个判别子是否命中给定的已解析 body 对象(顶层键)。 */
function discriminatorHits(d: BodyDiscriminator, body: Record<string, unknown>): boolean {
    if (d.hasKeys) {
        for (const k of d.hasKeys) {
            if (!Object.prototype.hasOwnProperty.call(body, k)) return false
        }
    }
    if (d.equals) {
        const v = body[d.equals.key]
        if (!d.equals.values.some((x) => x === v)) return false
    }
    // 空判别子(既无 hasKeys 也无 equals)不允许命中一切:视为不中。
    return Boolean(d.hasKeys || d.equals)
}

/**
 * 通道②核心:给定 method + 原始 URL + 原始请求体(仅 JSON 字符串),返回映射事件名。
 * 全部「看键 / 看值」都发生在本函数内部,只把**本表里的事件名常量**返回;body 的任何值都不逃逸。
 * 非白名单端点 / 非字符串体 / 超限 / 解析失败 / 无判别命中且无兜底 → 返回 undefined(不采)。
 */
export function computeBodyEvent(
    index: BodyRuleIndex,
    method: string,
    rawUrl: string,
    body: unknown,
): string | undefined {
    // 只处理 JSON 字符串体:multipart/Blob/stream(上传等高风险区)一律不碰。
    if (typeof body !== 'string' || body.length === 0 || body.length > MAX_BODY_BYTES) return undefined
    const bucket = index.byMethod.get((method || 'GET').toUpperCase())
    if (!bucket) return undefined
    let pathname: string
    try {
        pathname = new URL(rawUrl, 'http://x').pathname
    } catch {
        return undefined
    }
    const actual = pathname.split('/').filter((s) => s !== '')
    // 先看该端点有没有登记规则,没有就绝不解析 body(白名单门在解析之前)。
    const rules = bucket.filter((r) => pathMatches(r, actual))
    if (rules.length === 0) return undefined
    let parsed: unknown
    try {
        parsed = JSON.parse(body)
    } catch {
        return undefined
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
    const obj = parsed as Record<string, unknown>
    for (const rule of rules) {
        for (const d of rule.discriminators) {
            if (discriminatorHits(d, obj)) return d.event
        }
        if (rule.fallbackEvent) return rule.fallbackEvent
    }
    return undefined
}

/**
 * 「中央映射·body 键」通道规则表(②,整合表 d_2c47796780d4efdd3c5aa8b3)。
 * 逐端点填,须先核对**前端真实 payload 顶层键**(见 dap350 调查);事件名须已在服务端采集器
 * (octo-dap)注册。**部分事件的判别位可能并不在 body(而是纯 UI 上下文),那些不进本表、退回前端。**
 */
export const BODY_RULES: BodyRule[] = [
    // ==== im/base(/api/v1,主 API,octo-web 原生 axios/XHR 发出)——已核对前端真实 payload ====

    // PUT /api/v1/groups/:id —— 群资料单键部分更新(updateChannelField 发 { [field]: value }):
    // name → 改名;notice → 改公告。二者互斥,每次只带一个键。
    // (ChannelSettingService.ts updateChannelField;ChannelField.channelName='name' / .notice='notice')
    {
        method: 'PUT',
        path: '/api/v1/groups/:id',
        discriminators: [
            { event: 'group_name_edited', hasKeys: ['name'] },
            { event: 'group_announcement_edited', hasKeys: ['notice'] },
        ],
    },

    // PUT /api/v1/groups/:id/incoming-webhooks/:id —— 启停 vs 编辑:
    // 启停走 updateStatus,body 只带 status(枚举 0/1);编辑走 buildWebhookUpsertReq,只带
    // name/avatar/allow_mention_* / mention_uids 且**从不带 status**。故 status 在=启停,否则=编辑。
    {
        method: 'PUT',
        path: '/api/v1/groups/:id/incoming-webhooks/:id',
        discriminators: [{ event: 'webhook_enabled_toggled', hasKeys: ['status'] }],
        fallbackEvent: 'webhook_edited',
    },

    // PUT /api/v1/groups/:g/threads/:t/incoming-webhooks/:id —— 子区(thread)作用域的 webhook 编辑/启停,
    // 与群级同构(IncomingWebhookService.update 在 threadShortId 存在时切到 threads/:t 嵌套路径)。十审 🔴:
    // 群级 body 规则(段数固定)不命中子区路径,子区 webhook 的 启停/编辑 会漏计;补一条 thread 平行规则。
    {
        method: 'PUT',
        path: '/api/v1/groups/:id/threads/:seg/incoming-webhooks/:id',
        discriminators: [{ event: 'webhook_enabled_toggled', hasKeys: ['status'] }],
        fallbackEvent: 'webhook_edited',
    },

    // PUT /api/v1/groups/:id/setting —— 会话/群设置单键部分更新(updateChannelSetting 发单键对象):
    // mute→免打扰,top→置顶,remark→备注,save→存到通讯录,allow_no_mention→机器人免@。
    // (bridge/channelSetting/channelSettingActions.ts & groupManagementActions.ts)
    {
        method: 'PUT',
        path: '/api/v1/groups/:id/setting',
        discriminators: [
            { event: 'conversation_muted', equals: { key: 'mute', values: [1] } },
            { event: 'conversation_pinned', equals: { key: 'top', values: [1] } },
            { event: 'conversation_remark_edited', hasKeys: ['remark'] },
            { event: 'conversation_saved_to_contacts', equals: { key: 'save', values: [1] } },
            { event: 'group_bot_free_mention_toggled', hasKeys: ['allow_no_mention'] },
        ],
    },

    // PUT /api/v1/users/:id/setting —— 1:1 会话设置。updateChannelSetting 对 ChannelTypePerson 发到
    // users/:id/setting,body 与群设置**同构**(单键部分更新)。conversation_* 事件名本就按「会话」命名,
    // 若只挂 groups/:id/setting 会漏掉所有 DM(读作「没人静音 DM」而非「没测量」)。见 review P2-6。
    // (allow_no_mention 是群机器人专属键,DM 不会出现,presence-only 判别不命中即可,无副作用。)
    {
        method: 'PUT',
        path: '/api/v1/users/:id/setting',
        discriminators: [
            { event: 'conversation_muted', equals: { key: 'mute', values: [1] } },
            { event: 'conversation_pinned', equals: { key: 'top', values: [1] } },
            { event: 'conversation_remark_edited', hasKeys: ['remark'] },
            { event: 'conversation_saved_to_contacts', equals: { key: 'save', values: [1] } },
        ],
    },

    // PUT /api/v1/groups/:g/threads/:t/setting —— 话题(CommunityTopic)会话设置,同上同构。见 review P2-6。
    {
        method: 'PUT',
        path: '/api/v1/groups/:id/threads/:seg/setting',
        discriminators: [
            { event: 'conversation_muted', equals: { key: 'mute', values: [1] } },
            { event: 'conversation_pinned', equals: { key: 'top', values: [1] } },
            { event: 'conversation_remark_edited', hasKeys: ['remark'] },
            { event: 'conversation_saved_to_contacts', equals: { key: 'save', values: [1] } },
        ],
    },

    // ==== 以下 body 键事件经源码核对**无法在 octo-web 落地**,不填本表(见 Phase 3 findings) ====
    //  · /fleet/api/v1/* 的 issues / autopilots / agents / squads / webhook-subscriptions 全套
    //    (task_* / project_* / automation_* / expert_* / workspace_* / skill_* / *_webhook_*):
    //    请求由**独立的 octo-fleet SPA** 发出,octo-web 运行时(Dap 所在)根本不发这些请求 → 抓不到。
    //  · /api/v1/docs/:id/attachments/presign 等编辑器事件(document_slash_command_used /
    //    document_insert_used):由**独立的 octo-docs 编辑器**发出(packages/docs 为空壳)→ 抓不到。
    //  · POST /api/v1/message/channel/sync 的 6 个(channel_opened / subchannel_opened /
    //    channel_search_result_clicked / contact_message_clicked / botfather_opened /
    //    contacts_botfather_banner_clicked):sync body 顶层键恒定,判别位是**纯 UI 上下文**,
    //    body 里没有 → 退前端 DOM/命令式采集。
    //  · POST /api/v1/messages/_search_* 的 channel_search_query / channel_search_filtered:
    //    判别在 keyword 值 / 嵌套 filters(值级,且被 PROP_KEY_BLACKLIST/sanitizeProps 拦)→ 退前端。
    //  · POST /api/v1/app_bot/apply 的 app_opened / octo_assistant_opened:仅靠 robot_uid **值**
    //    区分,且 octo_assistant 的 uid 不在本仓 → 退前端 / 由 octo-dap 侧按 uid 映射。
]
