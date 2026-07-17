/** 总结模式 */
export const SummaryMode = {
    BY_GROUP: 1,
    BY_PERSON: 2,
} as const;
export type SummaryModeType = typeof SummaryMode[keyof typeof SummaryMode];

/** 任务状态 */
export const TaskStatus = {
    PENDING: 0,
    WAITING_CONFIRM: 1,
    PROCESSING: 2,
    COMPLETED: 3,
    FAILED: 4,
    CANCELLED: 5,
} as const;
export type TaskStatusType = typeof TaskStatus[keyof typeof TaskStatus];

/** 触发类型 */
export const TriggerType = {
    MANUAL: 1,
    SCHEDULED: 2,
    AGENT: 3,
} as const;
export type TriggerTypeType = typeof TriggerType[keyof typeof TriggerType];

/** 信息来源类型 */
export const SourceType = {
    GROUP_CHAT: 1,
    THREAD: 2,
    DIRECT_MESSAGE: 3,
} as const;
export type SourceTypeValue = typeof SourceType[keyof typeof SourceType];

/** 参与者状态 */
export const ParticipantStatus = {
    PENDING: 0,
    CONFIRMED: 1,
    DECLINED: 2,
} as const;

/** 信息来源 */
export interface SourceItem {
    source_type: SourceTypeValue;
    source_id: string;
    source_name?: string;
}

/** 参与者 */
export interface Participant {
    user_id: string;
    user_name?: string;
    status?: number;
    confirmed_at?: string | null;
}

/** 时间范围 */
export interface TimeRange {
    start: string;
    end: string;
}

/** Citation 上下文消息 */
export interface CitationContextMessage {
    sender: string;
    content: string;
    sent_at: string;
    message_seq?: number;
}

/** Citation 引用项 */
export interface CitationItem {
    index: number;
    sender: string;
    content: string;
    sent_at: string;
    source: string;
    channel_id?: string;
    message_seq?: number;
    channel_type?: number;
    context_before?: CitationContextMessage[];
    context_after?: CitationContextMessage[];
}

/**
 * 团队引用项（[Pn]）。语义上不同于普通引用 [n]：[Pn] 指向「人」（参与者），
 * 只有 user_name / user_id，没有消息内容 / 跳转上下文。和 CitationItem 是
 * 两个独立命名空间，不要混用编号。
 */
export interface TeamCitationItem {
    index: number;
    user_id: string;
    user_name: string;
    /**
     * V5/§6.2：作者单人报告便利字段。`[Pn]` 点击时优先用它直取作者的 personal
     * result；缺省时回退到用 user_id 在已拉取的 members 列表里匹配。omitempty。
     */
    personal_result_id?: number;
    /** V5/§6.2：作者单人报告所属的本轮 task。便利字段，omitempty。 */
    task_id?: number;
}

/** 总结结果 */
export interface SummaryResult {
    content: string;
    total_msg_count: number;
    total_token_used: number;
    model_version: string;
    version: number;
    operation_type?: string;
    operation_note?: string;
    parent_result_id?: number | null;
    generated_at: string | null;
    citations?: CitationItem[];
    team_citations?: TeamCitationItem[];
}

export interface SummaryVersionItem {
    result_id: number;
    version_id?: number;
    version: number;
    operation_type: string;
    operation_note?: string;
    parent_result_id?: number | null;
    created_by?: string;
    generated_at: string;
    edited_at?: string | null;
}

export interface SummaryVersionDetail extends SummaryVersionItem {
    content: string;
    citations?: CitationItem[];
    team_citations?: TeamCitationItem[];
}

/** 个人总结结果（BY_PERSON 模式） */
export type WorkflowStage =
    | "understand_question"
    | "find_relevant_chats"
    | "filter_useful_content"
    | "analyze_chat_content"
    | "generate_summary";

export interface PersonalResult {
    id?: number;
    version?: number;
    worker_status: 0 | 1 | 2 | 3;
    workflow_stage?: WorkflowStage | "";
    content: string;
    citations?: CitationItem[];
    submitted_at: string | null;
    generated_at: string | null;
    msg_count: number;
    current_version_id?: number | null;
}

/** 成员状态（BY_PERSON 模式） */
export interface MemberStatus {
    user_id: string;
    user_name: string;
    status: string;
    submitted_at: string | null;
    content?: string;
    citations?: CitationItem[];
}

/** 列表项 */
export interface SummaryListItem {
    task_id: number;
    task_no: string;
    title: string;
    summary_mode: SummaryModeType;
    status: TaskStatusType;
    trigger_type: number;
    /** 绑定的定时配置 id。存在即表示该总结是定时任务（无论是否已执行过）。 */
    schedule_id?: number | null;
    /** 任务创建者 user_id。用于列表卡片区分「删除」(creator) vs「退出」(参与者)。 */
    creator_id?: string;
    time_range_start: string;
    time_range_end: string;
    sources: SourceItem[];
    participants?: Participant[];
    total_msg_count: number;
    creator_name?: string;
    origin_channel_id: string;
    origin_channel_type: number;
    created_at: string;
    completed_at: string | null;
    is_unread?: boolean;
    has_pending_invitation?: boolean;
    needs_attention?: boolean;
    current_result_id?: number | null;
    current_personal_version_id?: number | null;
    activity_at?: string | null;
}

/** 详情 */
export interface SummaryDetail {
    task_id: number;
    task_no: string;
    title: string;
    summary_mode: SummaryModeType;
    status: TaskStatusType;
    trigger_type: number;
    time_range_start: string;
    time_range_end: string;
    sources: SourceItem[];
    participants: Participant[];
    result: SummaryResult | null;
    error_message: string | null;
    schedule_id?: number | null;
    /** 任务创建者 user_id。详情页区分 creator/participant 视角的移除/退出按钮。 */
    creator_id?: string;
    origin_channel_id: string;
    origin_channel_type: number;
    created_at: string;
    updated_at: string;
    result_id?: number;
    result_edited_at?: string | null;
    result_is_edited?: boolean;
    permissions?: {
        /** 旧字段，语义已迁移到 can_edit_team；前端勿用。 */
        can_edit: boolean;
        /** 定时**设置**按钮（仅 creator）。 */
        can_schedule?: boolean;
        /** need4：团队总结编辑按钮（仅 creator，多人也放开）。 */
        can_edit_team?: boolean;
        /** need3：本人可编辑自己的个人报告（本人是 participant）。 */
        can_edit_personal?: boolean;
        /** need2：定时**信息**只读展示（任意 participant 可见）。 */
        can_view_schedule?: boolean;
        /** need7：添加成员入口（仅 creator）。 */
        can_add_member?: boolean;
        /** 移除成员入口（仅 creator）。 */
        can_remove_member?: boolean;
    };
}

/** 创建请求 */
export interface CreateSummaryParams {
    topic: string;
    title?: string;
    summary_mode?: SummaryModeType;
    time_range?: TimeRange;
    sources?: SourceItem[];
    participants?: { user_id: string }[];
    confirm_timeout_hours?: number;
    origin_channel_id?: string;
    origin_channel_type?: number;
}

/**
 * Agent 总结创建请求（契约 v1.0）。
 *
 * 让后端 agent 自主总结当前对话的产出内容，落库为可检索的交付物。
 * POST /summary/api/v1/summaries/agent
 */
export interface CreateAgentSummaryParams {
    /** 当前 agent 对话的 session_id */
    session_id: string;
    /**
     * 触发对话的频道 id。可选:agent 对话入口没有"选来源"控件,
     * 前端一般不传;后端会从 session 的 tool_calls 记录反查 agent
     * 实际读过的第一个 channel_id 作为 origin。
     */
    origin_channel_id?: string;
    /** 频道类型:1=群聊 / 2=子区 / 3=私聊。仅当 origin_channel_id 有值时必填。 */
    origin_channel_type?: number;
    /** 用户填写的总结标题(必填,前端弹窗输入) */
    title?: string;
    /** 可选来源(沿用传统结构) */
    sources?: SourceItem[];
    /** 可选参与者(沿用传统结构) */
    participants?: { user_id: string; user_name?: string }[];
    /**
     * 可选:本次 agent chat 首轮引用的已有总结 task_id 数组。
     * 后端记录到 SummaryTask.referenced_task_ids 供衍生关系追溯。
     * 见 CHAT-REFERENCE-BASED-DESIGN-v1。
     */
    referenced_task_ids?: number[];
}

/** Agent 对话单条消息（user 右气泡 / assistant 左气泡） */
export interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
}

/** Agent 对话请求：单条消息 + session_id。后端按 session_id 持久化多轮记忆，
 *  同一会话复用同一 session_id 即可续上下文（无需前端本地拼历史）。 */
export interface AgentChatParams {
    message: string;
    session_id: string;
    /** 指定后端 agent profile；总结场景传 'summary' 以挂载频道/消息等真实工具。 */
    profile?: string;
    /**
     * 引用的已有总结 task_id 列表。仅在**首轮**(该 session 的 history 为空时)生效:
     * 后端会 fetch 每个 task 的最新产物 + 快照,作为 system message 的附录喂给 agent。
     * 后续轮次此字段被忽略(引用一次锁定)。见 CHAT-REFERENCE-BASED-DESIGN-v1。
     */
    referenced_task_ids?: number[];
}

/** Agent 对话响应（post() 已解包 data） */
export interface AgentChatResult {
    reply: string;
    session_id: string;
}

/**
 * Agent 对话历史响应（get() 已解包 data）。
 * 对应只读接口 GET /agent/chat/history?session_id=xxx，
 * 后端按 session_id 返回该会话已持久化的全部消息，用于「退出不丢」回显。
 */

/** Agent 总结增量修改结果（需求2 P2） */
export interface RefineSummaryResult {
    task_id: number;
    new_version: number;
    content: string;
    citations?: CitationItem[];
}

export interface AgentChatHistory {
    session_id: string;
    messages: ChatMessage[];
}

/**
 * Agent SSE 流式事件类型 — progress 事件（每步/每工具）
 */
export interface AgentProgressEvent {
    /**
     * 抽象阶段枚举（后端脱敏，不再暴露原始工具名）：
     * understand 理解需求 | retrieve 检索 | filter 筛选 | distill 提炼 | compose 汇总 | reply 生成回复
     */
    phase: 'understand' | 'retrieve' | 'filter' | 'distill' | 'compose' | 'reply';
    step: number;
    ofSteps: number;
    elapsed_ms: number;
    /** 安全整型计数（如已处理消息条数）；后端在无意义时省略该字段 */
    count?: number;
}

/**
 * Agent SSE 流式事件类型 — done 事件（最后 1 条,收到就停）
 */
export interface AgentDoneEvent {
    reply: string;
    session_id: string;
}

/**
 * Agent SSE 流式事件类型 — error 事件（任何环节都可能来）
 */
export interface AgentErrorEvent {
    code: number;
    message: string;
    transient?: boolean;  // true = 传输层失败可重试, false/undefined = 后端 error 不重试
}

/**
 * Agent SSE 流式消费 handlers
 */
export interface AgentStreamHandlers {
    onProgress?: (event: AgentProgressEvent) => void;
    onDone?: (event: AgentDoneEvent) => void;
    onError?: (event: AgentErrorEvent) => void;
}

/** 列表查询参数 */
export interface ListSummariesParams {
    page?: number;
    page_size?: number;
    status?: TaskStatusType;
    summary_mode?: SummaryModeType;
    sort_by?: string;
    sort_order?: "asc" | "desc";
    created_after?: string;
    created_before?: string;
    trigger_type?: number;
    keyword?: string;
    origin_channel_id?: string;
}

/** 列表响应 */
export interface ListSummariesResponse {
    items: SummaryListItem[];
    total: number;
    attention_count: number;
    unread_count: number;
    pending_invitation_count: number;
}

/** 定时配置参与者（participant_config 内嵌，含 V5 一次性确认态） */
export interface ScheduleParticipantConfigItem {
    user_id: string;
    /** V5：该成员是否已对本 schedule 完成一次性确认 */
    confirmed?: boolean;
    confirmed_at?: string | null;
}

/** 定时配置的 participant_config（GET /summary-schedules/:id 透出） */
export interface ScheduleParticipantConfig {
    participants?: ScheduleParticipantConfigItem[];
    /** V5：首次确认门槛是否达成（全员确认） */
    confirm_gate_passed?: boolean;
}

/** 定时配置 */
export interface ScheduleItem {
    schedule_id: number;
    title: string;
    generation_instruction?: string;
    summary_mode: SummaryModeType;
    cron_expr: string;
    interval_days?: number;
    interval_months?: number;
    /** 周模式：1=周一 .. 7=周日，0=不限 */
    day_of_week?: number;
    /** 月模式：1..31（月末自动钳位），0=不限 */
    day_of_month?: number;
    run_time?: string;
    time_range_type: 1 | 2 | 3 | 4;
    sources: SourceItem[];
    participants: { user_id: string }[];
    is_active: boolean;
    next_run_at: string | null;
    created_at: string;
    updated_at: string;
    /**
     * V5：确认策略。0=AUTO（无需确认）、1=CONFIRM（一次性确认）。
     * 多人定时默认 1；后端 GET /summary-schedules/:id 响应携带。
     * （confirm_lead_minutes 已废弃，不传不显示。）
     */
    confirm_policy?: number;
    /**
     * V5：内嵌确认名单（每个成员的 confirmed 态 + confirm_gate_passed）。
     * GET /summary-schedules/:id 透出，前端据此判断当前用户是否仍需确认。
     * 兼容旧纯数组（["u_a"]）：归一化由消费方处理。
     */
    participant_config?: ScheduleParticipantConfig | string[];
}

export interface CreateScheduleParams {
    title: string;
    generation_instruction?: string;
    summary_mode: SummaryModeType;
    cron_expr: string;
    interval_days?: number;
    interval_months?: number;
    /** 周模式：1=周一 .. 7=周日，0=不限 */
    day_of_week?: number;
    /** 月模式：1..31（月末自动钳位），0=不限 */
    day_of_month?: number;
    run_time?: string;
    time_range_type: 1 | 2 | 3 | 4;
    sources: SourceItem[];
    participants?: { user_id: string; user_name?: string }[];
    /**
     * scope='task' 让后端在一个事务里原子完成「建定时 + 绑定到 task_id」：
     * 校验 task 归属 → 建定时 → Update summary_task.schedule_id 绑定（一对一约束）。
     * 不带 scope 的旧两步式（create 再 update 绑定）已被后端 C1 直接 400 拒绝。
     */
    scope?: 'task';
    /** scope==='task' 时必填：把新建定时原子绑定到该 task。 */
    task_id?: number;
    /**
     * V5：确认策略。0=AUTO / 1=CONFIRM。多人定时场景传 1（一次性确认）；
     * 后端 resolveCreateConfirmPolicy 有兜底。confirm_lead_minutes 已废弃，不传。
     */
    confirm_policy?: number;
}

export interface UpdateScheduleParams {
    title?: string;
    generation_instruction?: string;
    summary_mode?: SummaryModeType;
    cron_expr?: string;
    interval_days?: number;
    interval_months?: number;
    /** 周模式：1=周一 .. 7=周日，0=不限 */
    day_of_week?: number;
    /** 月模式：1..31（月末自动钳位），0=不限 */
    day_of_month?: number;
    run_time?: string;
    time_range_type?: 1 | 2 | 3 | 4;
    sources?: SourceItem[];
    participants?: { user_id: string; user_name?: string }[];
    /**
     * Plan A1: scope distinguishes the caller. "task" means a summary detail
     * page is editing the period of ONE summary — if the schedule is shared by
     * multiple tasks the backend clones a new schedule for this task instead of
     * mutating the shared row. Omit (schedule list page) to edit the template
     * in place.
     */
    scope?: 'task';
    /** Required when scope === 'task': the task whose schedule_id is rebound. */
    task_id?: number;
    /**
     * V5：确认策略。0=AUTO / 1=CONFIRM。手动转定时/启用时多人场景传 1。
     * confirm_lead_minutes 已废弃，不传。
     */
    confirm_policy?: number;
}

/** API 统一响应 */
export interface ApiResponse<T = unknown> {
    code: number;
    message: string;
    data: T;
}

/** 总结模板 */
export interface SummaryTemplate {
    template_id: string;
    name: string;
    description: string;
    default_mode: SummaryModeType;
    default_time_range_type: 1 | 2 | 3 | 4;
}

/** 主题推断结果 */
export interface InferResult {
    suggested_mode: SummaryModeType;
    suggested_sources: SourceItem[];
    suggested_time_range: { start: string; end: string } | null;
}

/** 批量状态查询 - 单任务状态 */
export interface BatchStatusItem {
    id: number;
    status: TaskStatusType;
    progress: number;
    updated_at: string;
}

/** 批量状态查询 - 响应 */
export interface BatchStatusResponse {
    tasks: BatchStatusItem[];
}

/** 聊天候选项（选择聊天弹窗用） */
export interface ChatCandidate {
    chat_id: string;
    chat_type: "group" | "direct" | "thread";
    name: string;
    member_count: number | null;
    parent_group_no?: string;
    is_bot?: boolean;
    /** 是否为已归档子区（status=2）；群聊/私聊恒为 false */
    is_archived?: boolean;
}

/** 成员候选项（添加成员弹窗用） */
export interface MemberCandidate {
    user_id: string;
    name: string;
    avatar: string;
    department: string;
}

/** 定时配置（内部状态用）：通用「数量 × 单位」组合 */
export type ScheduleUnit = "day" | "week" | "month";

export interface ScheduleConfig {
    unit: ScheduleUnit;   // 天 / 周 / 月
    every: number;        // 正整数数量，如 every=2 + unit="week" => 每 2 周
    time: string;         // "HH:MM" — 运行时刻，始终保留
    dayOfWeek?: number;   // 周模式：1=周一 .. 7=周日，0/undefined=不限
    dayOfMonth?: number;  // 月模式：1..31，0/undefined=不限
    generationInstruction?: string; // 定时任务后续生成时参考的要求
    /**
     * 非阻塞1：原始遗留 cron 表达式（仅当回填的定时是遗留 cron 时存在）。
     * 新表单仅支持 interval(天/周/月)，无法精确回填 cron。带此标记时弹窗会
     * 提示「保存将把该遗留 cron 转换为间隔模式」，避免用户没改周期却被默默
     * 转成「每 1 天」。用户改动周期字段后该标记清空。
     */
    legacyCron?: string;
    /**
     * V5：确认策略。0=AUTO / 1=CONFIRM（一次性确认）。多人定时设 1。
     * scheduleToParams 仅在本字段存在时透传，不影响单人/旧调用方。
     */
    confirm_policy?: number;
}

/** 主题模板占位符 */
export interface TopicTemplatePlaceholder {
    key: string;
    label: string;
    position?: [number, number];
}

/** 主题模板 */
export interface TopicTemplate {
    id: string;
    label: string;
    icon: string;
    description: string;
    type: 'fixed' | 'parameterized';
    pattern: string;
    placeholders?: TopicTemplatePlaceholder[];
    is_custom?: boolean;
    is_overridden?: boolean;
    sort_order?: number;
}

export interface CustomTopicTemplatePayload {
    label: string;
    description: string;
    pattern?: string;
}

export interface TopicTemplatesResponse {
    templates: TopicTemplate[];
    custom_template_limit: number;
}

/** 前端兜底主题模板占位符（存 i18n key，渲染期解析为明文） */
export interface LocalTopicTemplatePlaceholder {
    key: string;
    labelKey: string;
    position?: [number, number];
}

/**
 * 前端离线兜底模板：字段存 i18n key 而非明文，进组件后由 resolveTemplate
 * 在 render() 期用当前 locale 解析为明文 TopicTemplate，保证切语言即时刷新。
 */
export interface LocalTopicTemplate {
    id: string;
    icon: string;
    type: 'fixed' | 'parameterized';
    labelKey: string;
    descriptionKey: string;
    patternKey: string;
    placeholders?: LocalTopicTemplatePlaceholder[];
}
