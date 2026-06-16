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

/** 总结结果 */
export interface SummaryResult {
    content: string;
    total_msg_count: number;
    total_token_used: number;
    model_version: string;
    version: number;
    generated_at: string | null;
    citations?: CitationItem[];
}

/** 个人总结结果（BY_PERSON 模式） */
export interface PersonalResult {
    worker_status: 0 | 1 | 2 | 3;
    content: string;
    citations?: CitationItem[];
    submitted_at: string | null;
    generated_at: string | null;
    msg_count: number;
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
    origin_channel_id: string;
    origin_channel_type: number;
    created_at: string;
    updated_at: string;
    result_id?: number;
    result_edited_at?: string | null;
    result_is_edited?: boolean;
    permissions?: {
        can_edit: boolean;
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
}

/** 定时配置 */
export interface ScheduleItem {
    schedule_id: number;
    title: string;
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
}

export interface CreateScheduleParams {
    title: string;
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
    participants?: { user_id: string }[];
    /**
     * scope='task' 让后端在一个事务里原子完成「建定时 + 绑定到 task_id」：
     * 校验 task 归属 → 建定时 → Update summary_task.schedule_id 绑定（一对一约束）。
     * 不带 scope 的旧两步式（create 再 update 绑定）已被后端 C1 直接 400 拒绝。
     */
    scope?: 'task';
    /** scope==='task' 时必填：把新建定时原子绑定到该 task。 */
    task_id?: number;
}

export interface UpdateScheduleParams {
    title?: string;
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
    participants?: { user_id: string }[];
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
    /**
     * 非阻塞1：原始遗留 cron 表达式（仅当回填的定时是遗留 cron 时存在）。
     * 新表单仅支持 interval(天/周/月)，无法精确回填 cron。带此标记时弹窗会
     * 提示「保存将把该遗留 cron 转换为间隔模式」，避免用户没改周期却被默默
     * 转成「每 1 天」。用户改动周期字段后该标记清空。
     */
    legacyCron?: string;
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
