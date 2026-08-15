/**
 * FetchRules —— 埋点「中央映射·path」通道(①）的规则表 + 匹配器
 * =====================================================================
 * 背景:整合表 d_2c47796780d4efdd3c5aa8b3 里一批事件的语义是「某个后端 endpoint 被成功
 * 调用」(如"文档已创建"= POST /docs 2xx)。这些无需改任何业务组件,只要在 Dap 的 HTTP 包裹
 * (installHttpWrap)里,把**成功(2xx)**的请求 method+path 映射成对应事件名再 track 一次即可。
 * 这是收益最大、零改组件、隐私最安全的通道,故最先落地(见开发文档 §6 step 2)。
 *
 * 硬约束(与 Dap §8 隐私边界一致):
 *   - 只在 emit 内、且请求已判定第一方(同源)后才匹配 —— 跨域一律不进这里。
 *   - 只在 **2xx** 命中时触发:4xx/5xx/err 不是"动作已发生",不映射。
 *   - **匹配用的是原始 pathname,但绝不落库**:pathname 仅用于在这张静态表里选一个事件名,
 *     真正上报的 http_request.path 仍是 normalizePath() 脱敏结果;映射事件本身不带任何来自
 *     路径的值(无 object_id、无 query、无正文)。故凭证 / 文件名 / 用户名不可能借此外泄。
 *   - 事件名须以整合表为准且**已在服务端采集器注册(octo-dap 侧)**,否则前端照发、服务端丢弃。
 *
 * 匹配语义:段级通配 + 最具体优先(most-specific-wins)。
 *   - 规则 path 里以 ':' 开头的段(:id / :seg)= 单段通配,匹配任意一个实际段。
 *   - 字面段必须精确相等。段数必须相同。
 *   - 一个实际 path 可能同时匹配「字面规则」与「通配规则」(如 /issues/search 同时匹配
 *     /issues/search 与 /issues/:id)——取**通配段更少**者(更具体者)。已离线验证:表内规则
 *     在同 method 下无等具体度歧义,故该规则可完全消歧(见 dap350 碰撞分析)。
 */

/** 单条 fetch 映射规则。method 大写;path 用 ':' 段表通配;event 为整合表事件名。 */
export interface FetchRule {
    method: string
    path: string
    event: string
}

/**
 * 抑制哨兵:命中但**主动不上报**。用途 —— 当一个过宽的 `:id` 通配规则(如 /mcps/:id → market_card_viewed)
 * 会把某个 list / 子资源字面路径(mine / tags)误吞时,给该字面路径挂一条 event=FETCH_IGNORE 的规则。
 * 因「最具体优先」,字面(nWild=0)压过 `:id`(nWild=1),matchFetchEvent 命中它时返回 undefined → 不 track。
 * 这样删除语义错误映射后,残留路径也不会顺着通配掉进别的事件。
 */
export const FETCH_IGNORE = '__ignore__'

/** 预编译后的规则:拆好段、标好每段是否通配、记通配数(特异度)。 */
interface CompiledFetchRule {
    segs: string[]
    wild: boolean[]
    nWild: number
    event: string
}

/** buildFetchIndex 产物:按 method 分桶(大写),桶内为预编译规则。 */
export interface FetchRuleIndex {
    byMethod: Map<string, CompiledFetchRule[]>
}

/** 从原始 URL 取 pathname(去 origin / 去 query),仅供匹配用,绝不上报。解析失败返回空串。 */
export function rawPathname(rawUrl: string): string {
    try {
        return new URL(rawUrl, 'http://x').pathname
    } catch {
        return ''
    }
}

const isWild = (seg: string): boolean => seg.charCodeAt(0) === 58 /* ':' */

/** 建索引:按 method 分桶 + 预编译段。O(n) 构建,查询按桶线性(桶很小)。 */
export function buildFetchIndex(rules: FetchRule[]): FetchRuleIndex {
    const byMethod = new Map<string, CompiledFetchRule[]>()
    for (const rule of rules) {
        if (!rule || !rule.event || !rule.path || !rule.method) continue
        const segs = rule.path.split('/').filter((s) => s !== '')
        const wild = segs.map(isWild)
        const nWild = wild.reduce((n, w) => n + (w ? 1 : 0), 0)
        const compiled: CompiledFetchRule = { segs, wild, nWild, event: rule.event }
        const m = rule.method.toUpperCase()
        const arr = byMethod.get(m)
        if (arr) arr.push(compiled)
        else byMethod.set(m, [compiled])
    }
    return { byMethod }
}

/**
 * 给定 method + 原始 pathname,返回映射事件名;无命中返回 undefined。
 * 段数相同且每段(字面相等 | 任一方通配)即匹配;多命中取通配段最少者(most-specific-wins)。
 */
export function matchFetchEvent(index: FetchRuleIndex, method: string, pathname: string): string | undefined {
    const bucket = index.byMethod.get((method || 'GET').toUpperCase())
    if (!bucket) return undefined
    const actual = pathname.split('/').filter((s) => s !== '')
    let best: CompiledFetchRule | undefined
    for (const rule of bucket) {
        if (rule.segs.length !== actual.length) continue
        let ok = true
        for (let i = 0; i < actual.length; i++) {
            if (rule.wild[i]) continue
            if (rule.segs[i] !== actual[i]) { ok = false; break }
        }
        if (!ok) continue
        // 最具体优先:通配段更少者胜(离线已验证同 method 下无等具体度歧义)。
        if (!best || rule.nWild < best.nWild) best = rule
    }
    // 命中抑制哨兵 → 视作无映射(字面 ignore 规则已按最具体优先压过更宽的 :id 通配)。
    if (best && best.event === FETCH_IGNORE) return undefined
    return best?.event
}

/**
 * 「中央映射·path」通道规则表(①,整合表 d_2c47796780d4efdd3c5aa8b3)。
 * 由整合表「主要端点」列离线抽取、去碰撞后生成,再按 review 逐条对齐真实调用点。
 * 事件名须已在服务端采集器(octo-dap)注册。
 *
 * ⚠️ 只保留「端点被调用 ⇒ 用户确实做了该动作,且该动作已成功」两问皆 yes 的规则。已剔除:
 *   - 后台轮询 / 前台可见性刷新 / SDK 回调 / 重连触发的端点(会无脑放大基础指标);
 *   - 通用 profile / 列表加载类 GET(拉取 ≠ 意图/结果);
 *   - 走业务码信封(HTTP200 + code≠0 仍算失败)的 summary 成功类端点 —— 改由成功回调命令式 track;
 *   - octo-fleet / octo-docs 的越界且死(本运行时不发)规则。
 *   这些动作改由 UI 交互(data-testid / data-track / 命令式 Dap.shared.track)采集。
 */
export const FETCH_RULES: FetchRule[] = [
    // ---- im/base(/api/v1)
    // app_launched 不在此通道 —— GET /common/appconfig 也被前台可见性/focus 刷新调用(每次 alt-tab 回来
    //   都刷,见 App.tsx),请求成功 ≠ 应用启动。改为 Dap.setEnabled 首次启用分支命令式 track 一次
    //   (采集随 remoteConfig 下发 tracking_enabled 才打开,该时刻即「启动且可测」的唯一点;见 review P1-1)。
    { method: 'POST', path: '/api/v1/user/login', event: 'user_login' },
    { method: 'POST', path: '/api/v1/user/emaillogin', event: 'user_login' },
    // space_switched 不在此通道 —— POST /conversation/sync 是 WuKongIM SDK 的会话同步回调,连接/重连/冷启动
    //   都会触发,不只切换空间。改为 Pages/Main applySpaceSelection(切换确认后)命令式 track(见 review P1-3)。
    { method: 'POST', path: '/api/v1/space/join', event: 'space_join_new' },
    { method: 'POST', path: '/api/v1/message/revoke', event: 'message_revoked' },
    { method: 'POST', path: '/api/v1/groups/:id/threads', event: 'message_subchannel_created' },
    { method: 'DELETE', path: '/api/v1/message', event: 'message_multiselect_deleted' },
    // channel_subchannel_panel_opened 不在此通道 —— GET /groups/:id/threads(threadList)在删除/归档/重试
    //   刷新时也会再拉,请求成功 ≠ 打开面板。改为 ThreadList.componentDidMount 命令式 track(见 review §4)。
    { method: 'POST', path: '/api/v1/messages/_search_media', event: 'channel_search_tab_switched' },
    { method: 'POST', path: '/api/v1/messages/_search_files', event: 'channel_search_tab_switched' },
    { method: 'POST', path: '/api/v1/groups/:id/avatar', event: 'group_avatar_edited' },
    { method: 'GET', path: '/api/v1/groups/:id/qrcode', event: 'group_qrcode_viewed' },
    { method: 'POST', path: '/api/v1/groups/:id/members', event: 'group_member_added' },
    { method: 'DELETE', path: '/api/v1/groups/:id/members', event: 'group_member_removed' },
    { method: 'POST', path: '/api/v1/groups/:id/transfer/:id', event: 'group_transferred' },
    { method: 'GET', path: '/api/v1/groups/:id/md', event: 'group_md_viewed' },
    { method: 'PUT', path: '/api/v1/groups/:id/md', event: 'group_md_edited' },
    { method: 'GET', path: '/api/v1/groups/:id/incoming-webhooks', event: 'group_webhook_panel_opened' },
    { method: 'POST', path: '/api/v1/groups/:id/incoming-webhooks', event: 'webhook_created' },
    { method: 'POST', path: '/api/v1/groups/:id/incoming-webhooks/:id/regenerate', event: 'webhook_url_reset' },
    { method: 'POST', path: '/api/v1/groups/:id/incoming-webhooks/:id/test', event: 'webhook_tested' },
    { method: 'DELETE', path: '/api/v1/groups/:id/incoming-webhooks/:id', event: 'webhook_deleted' },
    { method: 'POST', path: '/api/v1/groups/:id/managers', event: 'group_admin_added' },
    { method: 'DELETE', path: '/api/v1/groups/:id/managers', event: 'group_admin_removed' },
    { method: 'PUT', path: '/api/v1/groups/:id/bot_admin/:id', event: 'group_bot_admin_added' },
    { method: 'DELETE', path: '/api/v1/groups/:id/bot_admin/:id', event: 'group_bot_admin_removed' },
    { method: 'DELETE', path: '/api/v1/groups/:id/disband', event: 'group_dissolved' },
    { method: 'PUT', path: '/api/v1/groups/:id/members/:id', event: 'group_nickname_edited' },
    { method: 'POST', path: '/api/v1/message/offset', event: 'conversation_cleared' },
    { method: 'POST', path: '/api/v1/groups/:id/exit', event: 'conversation_left' },
    { method: 'DELETE', path: '/api/v1/conversations/:id/:id', event: 'conversation_left' },
    // contacts_module_entered 不在此通道 —— GET /robot/my_bots 也被 BotStore / PersonaSettings 调用,
    //   不只进联系人模块。改为 apps/web 导航回调(桌面 NavRail + 低屏 tab,按 menu id 判定)命令式 track(见 review P2-4)。
    // contact_opened 不在此通道 —— GET /users/:id 是通用 profile 拉取(bot profile / 内部查库都会打),
    //   已在 Contacts handleContactClick 命令式 track(联系人行点击);删除此处避免双计(见 review P2-3)。
    { method: 'POST', path: '/api/v1/friend/apply', event: 'contact_add_friend_clicked' },
    // 注意:/api/v1/docs/* 全套(document_*)已移除 —— issue #1406 明确「24 个 octo-docs 模块事件(独立仓库/嵌入编辑器)
    //       不在本次范围」,且这些请求由**独立的 octo-docs 编辑器**发出,octo-web 运行时根本不发 → 抓不到(死规则)。
    { method: 'GET', path: '/api/v1/app_bot/available', event: 'apps_module_entered' },
    { method: 'PUT', path: '/api/v1/user/language', event: 'language_switched' },
    // 注意:settings_menu_opened 不在此通道。/version.json 由 versionChecker 定时轮询(cache-bust),
    // 请求成功 ≠ 用户打开设置 —— 该事件改由「设置入口」点击(data-testid / 命令式 track)采集。
    { method: 'GET', path: '/api/v1/common/updater/web/1.0', event: 'settings_changelog_viewed' },
    { method: 'GET', path: '/api/v1/voice/local-config', event: 'settings_voice_opened' },
    { method: 'PUT', path: '/api/v1/voice/local-config', event: 'settings_voice_toggled' },
    { method: 'GET', path: '/api/v1/manager/secrets', event: 'settings_secrets_opened' },
    { method: 'POST', path: '/api/v1/manager/secrets', event: 'settings_secrets_configured' },
    { method: 'PUT', path: '/api/v1/manager/secrets/:id', event: 'settings_secrets_configured' },
    { method: 'POST', path: '/v1/auth/oidc/:seg/logout', event: 'user_logout' },
    // ---- fleet(task/project/expert/skill/workspace/automation)全套已移除 ----
    //   issue #1406 明确「133 个 octo-fleet 事件(独立 SPA)不在本次范围」;且这些 /fleet/api/v1/* 请求
    //   由**独立的 octo-fleet SPA** 发出,octo-web 运行时(Dap 所在)根本不发这些请求 → 抓不到(死规则)。
    // ---- summary
    // 本模块**整体不在 path 通道**。两类原因:
    //  (1) GET 只证明「拉取」不证明「意图/结果」,改由 UI 采集:
    //   smart_summary_create_clicked        ← 「新建总结」按钮点击(GET /summary-templates 是页面 init 加载)
    //   smart_summary_scope_channel_selected ← 勾选 channel 的 onChange(GET /summary-chat-candidates 只加载候选)
    //   smart_summary_scope_participant_selected ← 勾选 participant 的 onChange(GET /summary-member-candidates 同理)
    //   smart_summary_completed              ← 详情响应 status===completed 时命令式 track(GET /summaries/:id 对失败/进行中/导航都会 2xx)
    //   smart_summary_agent_message_sent     ← AgentChatPanel.handleSend 命令式 track(覆盖点击+Enter;见 review P1-4)
    //  (2) summary 走 {code,message,data} 信封 —— HTTP200 + code≠0 是**逻辑失败**,2xx 通道会把失败也计成
    //      成功(见 review P1-5)。故所有成功类 mutation 事件改由 summaryApi.ts 在 api 层按 code===0 gate 后
    //      命令式 track(trackOnEnvelopeSuccess):smart_summary_started / _edited / _regenerated / _deleted /
    //      _timer_configured / _custom_template_created。此处不再挂任何 /summary/api/v1/* 规则。
    // ---- market
    // 注意:market_view_switched / market_tag_filtered 不在此通道 —— «mine» 列表也用于建议/初始化,
    //       tag 列表在 init/搜索时加载,请求成功 ≠ 用户切视图/选标签。改由 Tab / tag chip 点击采集。
    // 抑制:mine / skills-tags 是 list/子资源,须压过下面 /mcps|skills/:id 的 card_viewed 通配,否则
    //       删掉 view/tag 映射后它们会被 :id 误吞成 market_card_viewed(mcp_tags 是 4 段,不碰撞,无需抑制)。
    { method: 'GET', path: '/market/api/v1/mcps/mine', event: FETCH_IGNORE },
    { method: 'GET', path: '/market/api/v1/skills/mine', event: FETCH_IGNORE },
    { method: 'GET', path: '/market/api/v1/skills/tags', event: FETCH_IGNORE },
    { method: 'GET', path: '/market/api/v1/mcps/:id', event: 'market_card_viewed' },
    { method: 'GET', path: '/market/api/v1/skills/:id', event: 'market_card_viewed' },
    { method: 'GET', path: '/market/api/v1/skills/:id/versions', event: 'market_skill_version_history_viewed' },
    { method: 'POST', path: '/market/api/v1/mcps', event: 'market_manual_publish_submitted' },
    { method: 'POST', path: '/market/api/v1/skills', event: 'market_manual_publish_submitted' },
]
