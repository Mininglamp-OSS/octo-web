/**
 * FetchRules —— 埋点「中央映射·path」通道(①）的规则表 + 匹配器
 * =====================================================================
 * 背景:整合表 d_2c47796780d4efdd3c5aa8b3 里约 99 个事件的语义就是「某个后端 endpoint 被成功
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
 *     /issues/search 与 /issues/:id)——取**通配段更少**者(更具体者)。已离线验证:110 条规则
 *     在同 method 下无等具体度歧义,故该规则可完全消歧(见 dap350 碰撞分析)。
 */

/** 单条 fetch 映射规则。method 大写;path 用 ':' 段表通配;event 为整合表事件名。 */
export interface FetchRule {
    method: string
    path: string
    event: string
}

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
    return best?.event
}

/**
 * 「中央映射·path」通道规则表(①,整合表 d_2c47796780d4efdd3c5aa8b3)。
 * 由整合表「主要端点」列离线抽取、去碰撞后生成(110 条 / 97 事件 / 0 残留碰撞)。
 * 事件名须已在服务端采集器(octo-dap)注册。
 */
export const FETCH_RULES: FetchRule[] = [
    // ---- im/base(/api/v1)
    { method: 'GET', path: '/api/v1/common/appconfig', event: 'app_launched' },
    { method: 'POST', path: '/api/v1/user/login', event: 'user_login' },
    { method: 'POST', path: '/api/v1/user/emaillogin', event: 'user_login' },
    { method: 'POST', path: '/api/v1/conversation/sync', event: 'space_switched' },
    { method: 'POST', path: '/api/v1/space/join', event: 'space_join_new' },
    { method: 'POST', path: '/api/v1/message/revoke', event: 'message_revoked' },
    { method: 'POST', path: '/api/v1/groups/:id/threads', event: 'message_subchannel_created' },
    { method: 'DELETE', path: '/api/v1/message', event: 'message_multiselect_deleted' },
    { method: 'GET', path: '/api/v1/groups/:id/threads', event: 'channel_subchannel_panel_opened' },
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
    { method: 'GET', path: '/api/v1/robot/my_bots', event: 'contacts_module_entered' },
    { method: 'GET', path: '/api/v1/users/:id', event: 'contact_opened' },
    { method: 'POST', path: '/api/v1/friend/apply', event: 'contact_add_friend_clicked' },
    { method: 'GET', path: '/api/v1/docs/recent/creators', event: 'document_module_entered' },
    { method: 'POST', path: '/api/v1/docs', event: 'document_created' },
    { method: 'POST', path: '/api/v1/docs/:id/view', event: 'document_opened' },
    { method: 'GET', path: '/api/v1/docs/:id/comments', event: 'document_comment_panel_opened' },
    { method: 'POST', path: '/api/v1/docs/:id/comments', event: 'document_commented' },
    { method: 'POST', path: '/api/v1/docs/:id/forward-grant', event: 'document_forwarded' },
    { method: 'PUT', path: '/api/v1/docs/:id/members', event: 'document_share_managed' },
    { method: 'DELETE', path: '/api/v1/docs/:id/members/:seg', event: 'document_share_managed' },
    { method: 'GET', path: '/api/v1/docs/:id/versions', event: 'document_history_viewed' },
    { method: 'GET', path: '/api/v1/docs/:id/export/file', event: 'document_exported' },
    { method: 'DELETE', path: '/api/v1/docs/:id', event: 'document_deleted' },
    { method: 'GET', path: '/api/v1/app_bot/available', event: 'apps_module_entered' },
    { method: 'PUT', path: '/api/v1/user/language', event: 'language_switched' },
    { method: 'GET', path: '/version.json', event: 'settings_menu_opened' },
    { method: 'GET', path: '/api/v1/common/updater/web/1.0', event: 'settings_changelog_viewed' },
    { method: 'GET', path: '/api/v1/voice/local-config', event: 'settings_voice_opened' },
    { method: 'PUT', path: '/api/v1/voice/local-config', event: 'settings_voice_toggled' },
    { method: 'GET', path: '/api/v1/manager/secrets', event: 'settings_secrets_opened' },
    { method: 'POST', path: '/api/v1/manager/secrets', event: 'settings_secrets_configured' },
    { method: 'PUT', path: '/api/v1/manager/secrets/:id', event: 'settings_secrets_configured' },
    { method: 'POST', path: '/v1/auth/oidc/:seg/logout', event: 'user_logout' },
    // ---- fleet(task/project/expert/skill/workspace/automation)
    { method: 'POST', path: '/fleet/api/v1/workspaces', event: 'workspace_created' },
    { method: 'GET', path: '/fleet/api/v1/issues/search', event: 'task_board_filtered' },
    { method: 'GET', path: '/fleet/api/v1/issues/:id', event: 'task_opened' },
    { method: 'POST', path: '/fleet/api/v1/issues/:id/comments', event: 'task_commented' },
    { method: 'POST', path: '/fleet/api/v1/issues/:id/subscribe', event: 'task_subscription_toggled' },
    { method: 'POST', path: '/fleet/api/v1/issues/:id/unsubscribe', event: 'task_subscription_toggled' },
    { method: 'DELETE', path: '/fleet/api/v1/issues/:id', event: 'task_deleted' },
    { method: 'POST', path: '/fleet/api/v1/projects', event: 'project_created' },
    { method: 'GET', path: '/fleet/api/v1/projects/:id', event: 'project_opened' },
    { method: 'DELETE', path: '/fleet/api/v1/projects/:id', event: 'project_deleted' },
    { method: 'POST', path: '/fleet/api/v1/autopilots', event: 'automation_created' },
    { method: 'POST', path: '/fleet/api/v1/autopilots/:id/trigger', event: 'automation_run_manually' },
    { method: 'DELETE', path: '/fleet/api/v1/autopilots/:id/triggers/:id', event: 'automation_trigger_deleted' },
    { method: 'DELETE', path: '/fleet/api/v1/autopilots/:id', event: 'automation_deleted' },
    { method: 'POST', path: '/fleet/api/v1/agents', event: 'expert_created' },
    { method: 'GET', path: '/fleet/api/v1/agents/:id', event: 'expert_opened' },
    { method: 'POST', path: '/fleet/api/v1/agents/:id/restore', event: 'expert_unarchived' },
    { method: 'POST', path: '/fleet/api/v1/squads', event: 'expert_team_created' },
    { method: 'GET', path: '/fleet/api/v1/squads/:id/members/status', event: 'expert_team_opened' },
    { method: 'DELETE', path: '/fleet/api/v1/squads/:id/members', event: 'expert_team_member_removed' },
    { method: 'PATCH', path: '/fleet/api/v1/workspaces/:id', event: 'workspace_general_saved' },
    { method: 'POST', path: '/fleet/api/v1/workspaces/:id/octo-members', event: 'workspace_member_added' },
    { method: 'PATCH', path: '/fleet/api/v1/workspaces/:id/members/:id', event: 'workspace_member_role_changed' },
    { method: 'DELETE', path: '/fleet/api/v1/workspaces/:id/members/:id', event: 'workspace_member_removed' },
    { method: 'POST', path: '/fleet/api/v1/cli-token/headless', event: 'runtime_install_command_copied' },
    { method: 'PATCH', path: '/fleet/api/v1/runtimes/:id', event: 'runtime_machine_renamed' },
    { method: 'POST', path: '/fleet/api/v1/runtimes/:id/local-skills', event: 'skill_runtime_skills_pulled' },
    { method: 'POST', path: '/fleet/api/v1/skills', event: 'skill_created' },
    { method: 'POST', path: '/fleet/api/v1/skills/import', event: 'skill_created' },
    { method: 'POST', path: '/fleet/api/v1/runtimes/:id/local-skills/import', event: 'skill_created' },
    { method: 'GET', path: '/fleet/api/v1/skills/:id', event: 'skill_opened' },
    { method: 'PUT', path: '/fleet/api/v1/skills/:id', event: 'skill_saved' },
    { method: 'DELETE', path: '/fleet/api/v1/skills/:id', event: 'skill_deleted' },
    // ---- summary
    { method: 'GET', path: '/summary/api/v1/summary-templates', event: 'smart_summary_create_clicked' },
    { method: 'POST', path: '/summary/api/v1/summary-templates/my', event: 'smart_summary_custom_template_created' },
    { method: 'GET', path: '/summary/api/v1/summary-chat-candidates', event: 'smart_summary_scope_channel_selected' },
    { method: 'GET', path: '/summary/api/v1/summary-member-candidates', event: 'smart_summary_scope_participant_selected' },
    { method: 'POST', path: '/summary/api/v1/agent/chat', event: 'smart_summary_agent_message_sent' },
    { method: 'POST', path: '/summary/api/v1/summaries', event: 'smart_summary_started' },
    { method: 'GET', path: '/summary/api/v1/summaries/:id', event: 'smart_summary_completed' },
    { method: 'PUT', path: '/summary/api/v1/summaries/:id/edit', event: 'smart_summary_edited' },
    { method: 'POST', path: '/summary/api/v1/summary-schedules', event: 'smart_summary_timer_configured' },
    { method: 'PUT', path: '/summary/api/v1/summary-schedules/:id', event: 'smart_summary_timer_configured' },
    { method: 'POST', path: '/summary/api/v1/summaries/:id/regenerate', event: 'smart_summary_regenerated' },
    { method: 'DELETE', path: '/summary/api/v1/summaries/:id', event: 'smart_summary_deleted' },
    // ---- market
    { method: 'GET', path: '/market/api/v1/mcps/mine', event: 'market_view_switched' },
    { method: 'GET', path: '/market/api/v1/skills/mine', event: 'market_view_switched' },
    { method: 'GET', path: '/market/api/v1/mcp_tags', event: 'market_tag_filtered' },
    { method: 'GET', path: '/market/api/v1/skills/tags', event: 'market_tag_filtered' },
    { method: 'GET', path: '/market/api/v1/mcps/:id', event: 'market_card_viewed' },
    { method: 'GET', path: '/market/api/v1/skills/:id', event: 'market_card_viewed' },
    { method: 'GET', path: '/market/api/v1/skills/:id/versions', event: 'market_skill_version_history_viewed' },
    { method: 'POST', path: '/market/api/v1/mcps', event: 'market_manual_publish_submitted' },
    { method: 'POST', path: '/market/api/v1/skills', event: 'market_manual_publish_submitted' },
]
