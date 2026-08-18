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
    // market_skill_sorted 不在本表 —— 每个排序项都挂无条件 onClick,DOM 委托会把「重复点当前排序」也计一次
    //   (与 market_tab_switched 同类过计),且所有项事件相同、无法区分选了哪种排序;已改为 SkillListPage.setSort
    //   按「实际变化」gate 后命令式 track,并带 props.sort 区分排序值(八审 P2)。
    // market_skill_install_prompt_copied / market_mcp_connect_prompt_copied 不在本表 ——
    //   点击委托在 clipboard.writeText promise 落定前就发、权限拒绝/非安全上下文也计;已分别改为
    //   InstallPromptModal.handleCopy 的 .then 与 McpDetailModal.handleCopy 的 try 成功分支命令式 track(六审 P2)。
    { event: 'market_publish_entry_clicked', testid: 'mcp-publish-entry', on: 'click' },
    { event: 'market_publish_entry_clicked', testid: 'skill-publish-entry', on: 'click' },
    { event: 'market_publish_method_selected', testid: 'mcp-publish-method-bot', on: 'click', props: { method: 'bot' } },
    { event: 'market_publish_method_selected', testid: 'mcp-publish-method-manual', on: 'click', props: { method: 'manual' } },
    { event: 'market_publish_method_selected', testid: 'skill-publish-method-bot', on: 'click', props: { method: 'bot' } },
    { event: 'market_publish_method_selected', testid: 'skill-publish-method-manual', on: 'click', props: { method: 'manual' } },
    // market_bot_publish_prompt_copied 不在本表 —— 与上面三条 *_copied 同因:点击委托在 clipboard 落定前
    //   就发、失败也计。已改为复制成功后命令式 track:skill 侧 BotPublishModal.handleCopy 的 .then;MCP 侧走
    //   共享 PromptForwardActions.handleCopy 的 ok 分支,并在组件内沿用原 route 门(/mcp-market/mcp,与
    //   Expert/squad 的 /mcp-market/experts 消歧,matchRoute 同源)(八审 P2)。

    // ---- onboarding / 设置（agent D）。
    { event: 'onboarding_opensource_clicked', testid: 'onboarding-opensource-link', on: 'click' },
    { event: 'onboarding_about_clicked', testid: 'onboarding-about-link', on: 'click' },
    { event: 'settings_onboarding_guide_reopened', testid: 'nav-settings-onboarding', on: 'click' },
    { event: 'settings_notification_toggled', testid: 'nav-settings-notification-toggle', on: 'click' },
    { event: 'my_info_opened', testid: 'nav-user-avatar', on: 'click' },

    // doc 画板类事件(whiteboard_bg_changed / element_added / zoomed / saved_to_file /
    //   image_exported / help_viewed / asset_library_action)均由 octo-docs-module BoardShell 源码内
    //   命令式 Dap.track,不进本表(toggle/来源无法靠点击委托区分)。唯一进本表的是 151 find_on_canvas
    //   (Excalidraw 原生 toolbar-search),见下方 doc 段。

    // ---- fleet(Loop,@dmwork/loop):testid 由 octo-loop-module 源码挂(dmloop/src)。fleet 源直编入
    //      本 bundle(WKApp.shared.registerModule),Dap 全局 DOM 委托可命中;testid 前缀 loop-* 全局唯一,
    //      无需 route 约束。事件名须已在 octo-dap 采集器注册。(dap350 §8 step4 / T1 复核)
    //   A1/A2A3/B/C —— 侧边栏 + 任务板 + 任务详情菜单。
    { event: 'workspace_switcher_opened', testid: 'loop-sidebar-ws-switcher', on: 'click' }, // 158
    { event: 'workspace_create_clicked', testid: 'loop-sidebar-ws-create', on: 'click' }, // 160 下拉
    { event: 'workspace_create_clicked', testid: 'loop-sidebar-ws-create-empty', on: 'click' }, // 160 空态
    { event: 'task_create_dialog_opened', testid: 'loop-sidebar-new-issue', on: 'click' }, // 164 侧栏
    { event: 'task_create_dialog_opened', testid: 'loop-issue-board-new-issue', on: 'click' }, // 164 工具栏
    { event: 'task_create_dialog_opened', testid: 'loop-issue-board-empty-new-issue', on: 'click' }, // 164 空态
    { event: 'my_tasks_viewed', testid: 'loop-sidebar-tab-myloop', on: 'click' }, // 163
    { event: 'task_board_viewed', testid: 'loop-sidebar-tab-issue', on: 'click' }, // 166
    { event: 'project_module_entered', testid: 'loop-sidebar-tab-project', on: 'click' }, // 186
    { event: 'automation_module_entered', testid: 'loop-sidebar-tab-automation', on: 'click' }, // 201
    // 222/243:专家/专家团经 workspaceTabs 侧栏 tab 进入(item.key=agent/squad),实际渲染元素即
    //   loop-sidebar-tab-agent/squad;工作表原写 loop-nav-* 与实际约定不符 → 校正为实际 testid。
    { event: 'expert_module_entered', testid: 'loop-sidebar-tab-agent', on: 'click' }, // 222
    { event: 'expert_team_module_entered', testid: 'loop-sidebar-tab-squad', on: 'click' }, // 243
    { event: 'workspace_settings_opened', testid: 'loop-sidebar-tab-settings', on: 'click' }, // 259
    // 167 作用域 tab(全部/成员/专家)—— 同一事件三 testid。⚠️「重复点当前 tab」经 DOM 委托会再计一次
    //     (同 octo-web market_tab_switched 的过计),已向 owner 标注待裁,暂按工作表 dom-testid。
    { event: 'task_board_segment_switched', testid: 'loop-issue-scope-all', on: 'click' },
    { event: 'task_board_segment_switched', testid: 'loop-issue-scope-members', on: 'click' },
    { event: 'task_board_segment_switched', testid: 'loop-issue-scope-agents', on: 'click' },
    // 168 视图切换(看板/分组/列表)—— 同上,同一事件三 testid,同「重复点」过计风险。
    { event: 'task_board_view_switched', testid: 'loop-issue-view-board', on: 'click' },
    { event: 'task_board_view_switched', testid: 'loop-issue-view-grouped', on: 'click' },
    { event: 'task_board_view_switched', testid: 'loop-issue-view-list', on: 'click' },
    { event: 'task_edit_properties_opened', testid: 'loop-idp-menu-edit-props', on: 'click' }, // 180
    { event: 'task_subtask_create_dialog_opened', testid: 'loop-idp-menu-new-subtask', on: 'click' }, // 181 菜单
    { event: 'task_subtask_create_dialog_opened', testid: 'loop-idp-subissue-add', on: 'click' }, // 181 子回路区 +
    { event: 'task_delete_dialog_opened', testid: 'loop-idp-menu-delete', on: 'click' }, // 184
    //   C —— 自动化模块(AutomationPage / AutopilotDetailPage)。backend-only(207)与无净锚点(219)已跳过。
    { event: 'automation_create_dialog_opened', testid: 'automation-create-btn', on: 'click' }, // 202 头部
    { event: 'automation_create_dialog_opened', testid: 'automation-create-btn-empty', on: 'click' }, // 202 空态(工作表未列,补齐,同 164 模式)
    { event: 'automation_trigger_add_dialog_opened', testid: 'automation-trigger-add-btn', on: 'click' },
    { event: 'automation_trigger_edit_dialog_opened', testid: 'automation-trigger-edit-btn', on: 'click' },
    { event: 'automation_trigger_delete_dialog_opened', testid: 'automation-trigger-delete-btn', on: 'click' },
    { event: 'automation_delete_dialog_opened', testid: 'automation-delete-btn', on: 'click' }, // 列表卡片 + 详情页同 testid
    //   B —— 项目模块(ProjectPage / ProjectDetailPage / WebhooksSection / SettingsPage)。
    //     命令式事件(project_status/priority/assignee_changed、project_detail_edited、
    //     project/workspace_webhook_toggled/deleted、workspace_settings_tab_switched)在 dmloop 源码内
    //     Dap.shared.track,不进本表。
    { event: 'project_view_switched', testid: 'project-view-list', on: 'click' }, // 187
    { event: 'project_view_switched', testid: 'project-view-card', on: 'click' }, // 187 同事件二 testid(本地视图切换,重复点当前项过计待裁)
    { event: 'project_searched', testid: 'project-search-input' }, // 188 输入框
    { event: 'project_create_dialog_opened', testid: 'project-create-btn', on: 'click' }, // 189 头部
    { event: 'project_create_dialog_opened', testid: 'project-create-btn-empty', on: 'click' }, // 189 空态(工作表未列,补齐入口一致,同 164/202 模式)
    { event: 'project_delete_dialog_opened', testid: 'project-row-delete-btn', on: 'click' }, // 199 列表+卡片同 testid
    //   E —— 专家团模块(SquadPage / SquadDetailPage)。命令式(expert_team_leader_changed/
    //     instruction_saved/archived/deleted)在源码内 track,不进本表。
    { event: 'expert_team_tab_switched', testid: 'loop-squad-scope-mine', on: 'click' }, // 244 作用域 tab(重复点过计待裁)
    { event: 'expert_team_tab_switched', testid: 'loop-squad-scope-all', on: 'click' },
    // 245 筛选/排序:领队/创建人为运行时聚合的 actor,无静态语义值 → 按筛选维度给 testid;sort 为静态枚举逐项。
    { event: 'expert_team_filtered', testid: 'loop-squad-filter-leader', on: 'click' },
    { event: 'expert_team_filtered', testid: 'loop-squad-filter-creator', on: 'click' },
    { event: 'expert_team_filtered', testid: 'loop-squad-filter-clear', on: 'click' },
    { event: 'expert_team_filtered', testid: 'loop-squad-sort-name', on: 'click' },
    { event: 'expert_team_filtered', testid: 'loop-squad-sort-members', on: 'click' },
    { event: 'expert_team_filtered', testid: 'loop-squad-sort-created', on: 'click' },
    { event: 'expert_team_filtered', testid: 'loop-squad-sort-dir', on: 'click' },
    { event: 'expert_team_create_dialog_opened', testid: 'loop-squad-create-btn', on: 'click' }, // 246 头部+空态同 testid
    { event: 'expert_team_member_add_dialog_opened', testid: 'loop-squad-add-member-btn', on: 'click' },
    { event: 'expert_team_instruction_edit_opened', testid: 'loop-squad-instruction-editor', on: 'click' },
    { event: 'expert_team_archive_dialog_opened', testid: 'loop-squad-archive-btn', on: 'click' },
    { event: 'expert_team_delete_dialog_opened', testid: 'loop-squad-row-delete-btn', on: 'click' },
    //   D —— 专家模块(AgentPage / AgentDetailPage)。命令式(expert_deleted/runtime_changed/
    //     property_edited/instruction_saved/mcp_saved/skill_attached/skill_removed/env_var_added/
    //     env_var_removed/archived)在源码内 track,不进本表。225/233/236 头部+空态同 testid。
    { event: 'expert_tab_switched', testid: 'loop-agent-scope-mine', on: 'click' }, // 作用域 tab(重复点过计待裁)
    { event: 'expert_tab_switched', testid: 'loop-agent-scope-all', on: 'click' },
    { event: 'expert_tab_switched', testid: 'loop-agent-scope-archived', on: 'click' },
    { event: 'expert_searched', testid: 'loop-agent-search-input' },
    { event: 'expert_create_dialog_opened', testid: 'loop-agent-create-btn', on: 'click' }, // 头部+空态同 testid
    { event: 'expert_run_history_viewed', testid: 'loop-agent-tab-profile', on: 'click' },
    { event: 'expert_skill_add_dialog_opened', testid: 'loop-agent-add-skill-btn', on: 'click' }, // 头部+空态同 testid
    { event: 'expert_env_var_add_dialog_opened', testid: 'loop-agent-add-env-btn', on: 'click' }, // 头部+空态同 testid
    { event: 'expert_archive_dialog_opened', testid: 'loop-agent-archive-btn', on: 'click' },
    //   M10 —— 个人/runtime/skill(dmpersonal:RuntimePage/SkillPage/SkillDetailPage/SkillFileViewer)。
    //     命令式(runtime_install_command_copied、skill_searched、skill_create_method_switched、
    //     skill_created[runtime 分支]、skill_create_failed、skill_file_added、skill_edit_preview_toggled)
    //     在源码内 track,不进本表。268/273/276 跳过(宿主壳/无 polling 信号)。278 create-btn 头部+空态同 testid。
    { event: 'runtime_tab_viewed', testid: 'dmpersonal-tab-runtime', on: 'click' },
    { event: 'skills_tab_viewed', testid: 'dmpersonal-tab-skill', on: 'click' },
    { event: 'runtime_add_computer_dialog_opened', testid: 'runtime-add-computer-btn', on: 'click' },
    { event: 'runtime_machine_rename_dialog_opened', testid: 'runtime-rename-btn', on: 'click' },
    { event: 'skill_create_dialog_opened', testid: 'skill-create-btn', on: 'click' }, // 头部+空态同 testid
    { event: 'skill_file_opened', testid: 'skill-file-tree-item', on: 'click' },
    { event: 'skill_delete_dialog_opened', testid: 'skill-delete-btn', on: 'click' },

    // ---- doc(octo-docs-module,@octo/docs):源直编入本 bundle(同 fleet),Dap 全局委托可命中。
    //      testid 由 docs 源码挂(src/editor、src/board)。命令式事件(document_edited/format_applied/
    //      slash_command_used/comment_panel_opened + 全部 whiteboard_* + 全部 table_*)在 docs 源码内
    //      Dap.track,不进本表。doc 视图统一在 /docs 路由下渲染(编辑器/表格/画板非独立 route)。
    //   编辑器(EditorShell / Toolbar / DocMoreMenu):testid 均 doc-*/docs-* 自命名,全局唯一,无需 route。
    { event: 'document_tab_switched', testid: 'docs-tab-recent', on: 'click' }, // 重复点当前 tab 过计待裁(同 fleet 作用域 tab)
    { event: 'document_tab_switched', testid: 'docs-tab-mine', on: 'click' },
    { event: 'document_comment_input_opened', testid: 'comment-bubble-start', route: '/docs', on: 'click' }, // 非 doc- 前缀,加 route 门防误配
    { event: 'document_forward_panel_opened', testid: 'doc-forward-btn', on: 'click' },
    { event: 'document_open_in_new_page', testid: 'doc-more-item-open-new-page', on: 'click' },
    { event: 'document_history_viewed', testid: 'doc-more-item-history', on: 'click' },
    { event: 'document_outline_toggled', testid: 'doc-outline-toggle', on: 'click' }, // toggle:开+关同 testid,重复触发待裁
    // 139 插入:同一事件多 testid(image/file/table/bookmark/emoji/mention/details/callout/formula*/link)。
    //   emoji 工作表未列但为真实插入项,已补;formula 拆 inline/block 两 testid(docs 代理核实)。
    { event: 'document_insert_used', testid: 'doc-insert-image', on: 'click' },
    { event: 'document_insert_used', testid: 'doc-insert-file', on: 'click' },
    { event: 'document_insert_used', testid: 'doc-insert-table', on: 'click' },
    { event: 'document_insert_used', testid: 'doc-insert-bookmark', on: 'click' },
    { event: 'document_insert_used', testid: 'doc-insert-emoji', on: 'click' },
    { event: 'document_insert_used', testid: 'doc-insert-mention', on: 'click' },
    { event: 'document_insert_used', testid: 'doc-insert-details', on: 'click' },
    { event: 'document_insert_used', testid: 'doc-insert-callout', on: 'click' },
    { event: 'document_insert_used', testid: 'doc-insert-formula-inline', on: 'click' },
    { event: 'document_insert_used', testid: 'doc-insert-formula-block', on: 'click' },
    { event: 'document_insert_used', testid: 'doc-insert-link', on: 'click' },
    //   画板(BoardShell,Excalidraw):151 find_on_canvas 用 Excalidraw 原生 toolbar-search(泛名),
    //     加 route:/docs 锁定;⚠️ Cmd+F 键盘打开查找不产生对该元素的点击 → 纯委托漏键盘路径(待裁)。
    { event: 'whiteboard_find_on_canvas', testid: 'toolbar-search', route: '/docs', on: 'click' }, // 151
]
