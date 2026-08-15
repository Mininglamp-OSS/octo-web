/**
 * TrackRules —— 埋点蒙版的「锚点规则表」(Dap fallback 支路的数据 + 索引)
 * =====================================================================
 * 背景:蒙版原路径靠业务组件挂 `data-track` 声明式采集(见 Dap.installClickDelegation)。
 * 但全站约 165 个「无网络的 UI 意图」动作当前没埋,逐个加 `data-track` 成本高。本表提供一条
 * **纯前端 fallback**:在 `closest('[data-track]')` 落空后,拿被点元素身上**现成的
 * `data-testid`** 去查这张打包进 bundle 的静态表,命中就用规则里的 `event` 走现有 track()。
 *
 * 硬约束(与 Dap 一致,见 Dap.ts §2 / installClickDelegation):
 *   - `data-track` 绝对优先:有 `data-track` 就走原路径,本表只吃「没有 data-track」的节点
 *     → 现有埋点 / 破例点零回归。
 *   - 隐私:规则只携带**静态枚举** props;运行时 props 仍复用 collectDatasetProps 读 data-*
 *     (如 data-object-id),**绝不读控件 value / innerText / 正文**。
 *   - 事件名必须**先在服务端采集器注册**,否则前端照发、服务端静默死信丢弃(前端不报错)。
 *   - 主路径 O(1):有 `testid` 的规则进 `byTestid` Map;无 `testid` 的 role/aria 规则进 `loose`
 *     线性兜底(数量应保持很小)。
 */

/** 规则携带的静态 props 只允许基础量,和 TrackEnvelope.props 的 TrackPrimitive 对齐。 */
type RulePrimitive = string | number | boolean | null

/**
 * 单条锚点规则。`event` 必填;其余为**命中约束**(全部 AND):
 *   - `testid`        主键:被 walk 到的祖先元素的 `data-testid` 精确等于它 → 进 byTestid 索引。
 *   - `role`          约束该元素的 `role` 属性(byTestid 规则的附加约束 / loose 规则的主键)。
 *   - `route`         仅当 `location.pathname` 命中(精确或前缀 + 段边界)时生效;string | string[]。
 *   - `closestTestid` 该元素需能 `closest([data-testid=closestTestid])`(用于同名 testid 消歧)。
 *   - `on`            仅在该交互类型触发('click' | 'submit' | 'keydown');缺省则三类都可。
 *   - `props`         合并进上报的**静态枚举**(如 { area: 'automation', action: 'run' });
 *                     运行时再叠加 collectDatasetProps(el) 读的 data-*(data-object-id 等)。
 */
export interface TrackRule {
    event: string
    testid?: string
    role?: string
    route?: string | string[]
    closestTestid?: string
    on?: 'click' | 'submit' | 'keydown'
    props?: Record<string, RulePrimitive>
}

/** buildIndex 产物:testid 主索引 + 无 testid 的 loose 线性表。 */
export interface TrackRuleIndex {
    byTestid: Map<string, TrackRule[]>
    loose: TrackRule[]
}

/**
 * 建索引:有 `testid` 的按 testid 分桶进 Map(同一 testid 可挂多条,靠 route/closestTestid/on
 * 消歧);无 `testid` 的进 loose(须带 role,否则会匹配一切)。O(n) 构建,查询主路径 O(1)。
 */
export function buildIndex(rules: TrackRule[]): TrackRuleIndex {
    const byTestid = new Map<string, TrackRule[]>()
    const loose: TrackRule[] = []
    for (const rule of rules) {
        if (!rule || !rule.event) continue
        if (rule.testid) {
            const arr = byTestid.get(rule.testid)
            if (arr) arr.push(rule)
            else byTestid.set(rule.testid, [rule])
        } else {
            loose.push(rule)
        }
    }
    return { byTestid, loose }
}

/**
 * route 约束匹配:规则的 `route` 缺省 → 恒真;否则要求 `current` 精确等于某项,或以「该项 + 段
 * 边界(`/`)」为前缀。段边界避免 `/automation` 误配 `/automationX`。
 */
export function matchRoute(route: TrackRule['route'], current: string): boolean {
    if (!route) return true
    const list = Array.isArray(route) ? route : [route]
    return list.some((r) => current === r || current.startsWith(r.endsWith('/') ? r : r + '/'))
}

/**
 * 全站锚点规则表(打包进 bundle)。**按对账 sheet(d_e8d2c5702b3b58abb5f85777)分模块逐条填**,
 * 事件名须以 sheet 为准且已在服务端采集器注册。首个切片:automation 模块(见任务)。
 *
 * 示例(结构参考,勿直接启用未注册的事件名):
 *   { event: 'automation_run_clicked', testid: 'automation-run-btn', route: '/automation',
 *     props: { area: 'automation', action: 'run' } },
 *   { event: 'automation_toggle_switched', role: 'switch', route: '/automation',
 *     closestTestid: 'automation-rule-row' },   // loose:靠 role 命中,无独立 testid
 */
export const TRACK_RULES: TrackRule[] = [
    // ---- A_rule:控件已带稳定 data-testid（dmworksummary summaryTestIds.*），只写规则、零改组件。
    //      事件名以整合表 d_2c47796780d4efdd3c5aa8b3 为准，须先在服务端采集器注册（octo-dap 侧）。
    { event: 'channel_summary_panel_opened', testid: 'summary-chat-panel-header-btn', on: 'click' },
    { event: 'smart_summary_edit_opened', testid: 'summary-detail-edit-btn', on: 'click' },
    { event: 'smart_summary_regenerate_dialog_opened', testid: 'summary-detail-regenerate-btn', on: 'click' },
    { event: 'smart_summary_delete_dialog_opened', testid: 'summary-detail-delete-btn', on: 'click' },
    // smart_summary_agent_message_sent 不走本表 —— 点击规则漏 Enter 发送(焦点在 textarea,keydown
    // fallback 会跳过原生可激活元素),已改为 AgentChatPanel.handleSend 里命令式 track(覆盖点击+Enter)。见 review P1-4。
    { event: 'smart_summary_agent_new_session', testid: 'summary-agent-new-session-btn', on: 'click' },

    // ---- IM / 消息（dmworkbase）：右键菜单 testid 透传链 + 输入区控件（agent A）。
    { event: 'message_copied', testid: 'ctx-message-copy', on: 'click' },
    { event: 'message_forward_panel_opened', testid: 'ctx-message-forward', on: 'click' },
    { event: 'message_subchannel_create_dialog_opened', testid: 'ctx-message-create-thread', on: 'click' },
    { event: 'message_multiselect_started', testid: 'ctx-message-multiselect', on: 'click' },
    // 20 号一个 event 两枚 testid（逐条转发 + 合并转发）。
    { event: 'message_multiselect_forward_panel_opened', testid: 'multiselect-forward-btn', on: 'click' },
    { event: 'message_multiselect_forward_panel_opened', testid: 'multiselect-mergeforward-btn', on: 'click' },
    { event: 'message_multiselect_delete_dialog_opened', testid: 'multiselect-delete-btn', on: 'click' },
    { event: 'channel_search_opened', testid: 'channel-search-entry', on: 'click' },
    // channel_search_filter_panel_opened / input_emoji_picker_opened / input_expanded 不在本表 ——
    //   三者都是 toggle 控件(开+关同一个 click),点击规则会把「关」也计成「开」→ 翻倍。已改为各自
    //   组件在「打开/展开」分支命令式 track(ChannelSearchPanel.toggleFilterOpen / EmojiToolbar.togglePanel /
    //   MessageInput.toggleExpand),见 review P2-7。
    { event: 'input_sticker_sent', testid: 'input-sticker-item', on: 'click' },
    { event: 'input_attachment_clicked', testid: 'input-attachment-btn', on: 'click' },

    // ---- 群 / 联系人（dmworkcontacts 等，agent B）。
    // group_qrcode_invite_link_copied 不在本表 —— 点击委托在 copy promise 落定前就发、失败也计;
    //   已改为 ChannelQRCode.handleCopyLink 的 ok 分支命令式 track(见六审 P2)。
    { event: 'group_member_add_dialog_opened', testid: 'group-member-add-btn', on: 'click' },
    { event: 'group_member_remove_dialog_opened', testid: 'group-member-remove-btn', on: 'click' },
    { event: 'group_md_preview_toggled', testid: 'group-md-preview-btn', on: 'click' },
    { event: 'webhook_create_dialog_opened', testid: 'webhook-create-btn', on: 'click' },
    { event: 'webhook_edit_dialog_opened', testid: 'webhook-edit-btn', on: 'click' },
    { event: 'group_admin_add_dialog_opened', testid: 'group-add-manager-btn', on: 'click' },
    { event: 'group_bot_admin_add_dialog_opened', testid: 'group-add-bot-admin-btn', on: 'click' },
    { event: 'group_dissolve_dialog_opened', testid: 'group-disband-btn', on: 'click' },
    { event: 'group_bot_admin_remove_dialog_opened', testid: 'group-bot-admin-remove-btn', on: 'click' },

    // ---- 市场 M11（dmworkmcp / dmworkskillmarket，agent C）。
    // market_tab_switched / market_category_filtered 不在本表 —— 都是「重复点当前项」会经 DOM 委托
    //   重复触发的选择型控件,已改为在切换 handler 里按「实际变化」gate 后命令式 track(MarketSidebar.handleClick /
    //   McpMarketListPage.handleCategory / CategoryChips.choose),见 review P2-7。
    { event: 'market_skill_sorted', testid: 'skill-sort-option', on: 'click' },
    // market_skill_install_prompt_copied / market_mcp_connect_prompt_copied 不在本表 ——
    //   点击委托在 clipboard.writeText promise 落定前就发、权限拒绝/非安全上下文也计;已分别改为
    //   InstallPromptModal.handleCopy 的 .then 与 McpDetailModal.handleCopy 的 try 成功分支命令式 track(六审 P2)。
    { event: 'market_publish_entry_clicked', testid: 'mcp-publish-entry', on: 'click' },
    { event: 'market_publish_entry_clicked', testid: 'skill-publish-entry', on: 'click' },
    { event: 'market_publish_method_selected', testid: 'mcp-publish-method-bot', on: 'click', props: { method: 'bot' } },
    { event: 'market_publish_method_selected', testid: 'mcp-publish-method-manual', on: 'click', props: { method: 'manual' } },
    { event: 'market_publish_method_selected', testid: 'skill-publish-method-bot', on: 'click', props: { method: 'bot' } },
    { event: 'market_publish_method_selected', testid: 'skill-publish-method-manual', on: 'click', props: { method: 'manual' } },
    { event: 'market_bot_publish_prompt_copied', testid: 'skill-bot-publish-copy', on: 'click' },
    // 331 MCP 侧走共享 PromptForwardActions；用 route 门与 Expert/squad(/mcp-market/experts) 消歧。
    { event: 'market_bot_publish_prompt_copied', testid: 'mcp-bot-publish-copy', on: 'click', route: '/mcp-market/mcp' },

    // ---- onboarding / 设置（agent D）。
    { event: 'onboarding_opensource_clicked', testid: 'onboarding-opensource-link', on: 'click' },
    { event: 'onboarding_about_clicked', testid: 'onboarding-about-link', on: 'click' },
    { event: 'settings_onboarding_guide_reopened', testid: 'nav-settings-onboarding', on: 'click' },
    { event: 'settings_notification_toggled', testid: 'nav-settings-notification-toggle', on: 'click' },
    { event: 'my_info_opened', testid: 'nav-user-avatar', on: 'click' },

    // whiteboard_bg_changed（testid board-canvas-color-control）在 octo-docs-module 独立仓，
    // 需 route 消歧 + 跨仓版本联动，随该仓 PR 一并加，不在本仓盲填。
]
