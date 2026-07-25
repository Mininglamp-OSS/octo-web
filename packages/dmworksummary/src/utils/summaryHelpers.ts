import {
    SummaryMode,
    TaskStatus,
    SourceType,
    ParticipantStatus,
    type TaskStatusType,
    type SummaryModeType,
    type SourceTypeValue,
    type ScheduleConfig,
    type ScheduleItem,
} from "../types/summary";
import { t } from "@octo/base";

// crypto.randomUUID 在非安全上下文/旧环境可能不存在，降级生成一个唯一 id。
export function genSessionId(): string {
    return crypto?.randomUUID
        ? crypto.randomUUID()
        : 'sid-' + Date.now() + '-' + Math.random().toString(16).slice(2);
}

// ─── Agent 对话 session_id 持久化（「退出不丢」） ──────────────
// session_id 写入 localStorage，按 channel/入口隔离，避免不同群会话串号。
// 无 channelId 的入口（完整创建页无频道上下文）落到统一兜底 key。
const AGENT_CHAT_SESSION_KEY_PREFIX = 'agent-chat-session:';
const AGENT_CHAT_SESSION_FALLBACK = '__workbench__';

/** 构造某入口的 localStorage key。channelId 缺省时用统一兜底段。 */
export function agentChatSessionKey(channelId?: string | null): string {
    return AGENT_CHAT_SESSION_KEY_PREFIX + (channelId || AGENT_CHAT_SESSION_FALLBACK);
}

/**
 * 读取该入口已持久化的 session_id；无则返回空串。
 * localStorage 在隐私模式/禁用时可能抛错，一律吞掉降级为「无会话」。
 */
export function readAgentChatSession(channelId?: string | null): string {
    try {
        return localStorage.getItem(agentChatSessionKey(channelId)) || '';
    } catch {
        return '';
    }
}

/** 写入 session_id（空串跳过，避免把「无会话」持久化）。异常静默降级。 */
export function writeAgentChatSession(channelId: string | null | undefined, sessionId: string): void {
    if (!sessionId) return;
    try {
        localStorage.setItem(agentChatSessionKey(channelId), sessionId);
    } catch {
        // localStorage 不可用（隐私模式/配额）：不持久化，不影响当前会话。
    }
}

/** 清除该入口的 session_id（「新会话」用）。异常静默降级。 */
export function clearAgentChatSession(channelId?: string | null): void {
    try {
        localStorage.removeItem(agentChatSessionKey(channelId));
    } catch {
        // 同上，忽略。
    }
}

// ─── Agent 对话 referencedTask 持久化（「退出不丢引用」） ──────────────
// referencedTask 与 session_id 同生命周期：session 存活时它也存活，session
// 清掉（新会话/保存成功）时它也被清。修 SUM-161 fast-follow：未保存的
// 引用总结 chat 退出重进后，session_id 从 localStorage 恢复了、消息也
// 通过 GET /agent/chat/history 拉回来了，但 referencedTask 只活在 React
// state 里，重进后丢失。用户随后点保存 → 前端不发 referenced_task_ids
// → 后端 CreateAgentSummary 走 fallback 借 origin 失败 → 40001。持久化
// 它到 localStorage 让 refresh/重进后自动回填。
//
// 只存最小可恢复信息：task_id + title（UI 显示用）。task_id 是唯一必要
// 键，title 是显示用的 snapshot（可能 stale，但不影响功能——后端保存时
// 会用 task_id 走 canAccessTaskDB 校验）。
const AGENT_CHAT_REFERENCED_KEY_PREFIX = 'agent-chat-referenced:';

/** 持久化的引用总结精简结构（只存 UI 恢复必需的字段）。 */
export interface PersistedReferencedTask {
    task_id: number;
    title: string;
}

/** 构造 referencedTask localStorage key。channelId 缺省时用统一兜底段。 */
export function agentChatReferencedKey(channelId?: string | null): string {
    return AGENT_CHAT_REFERENCED_KEY_PREFIX + (channelId || AGENT_CHAT_SESSION_FALLBACK);
}

/**
 * 读取该入口已持久化的引用总结；无则返回 null。
 * localStorage 在隐私模式/禁用时可能抛错、JSON 损坏时可能解析失败，
 * 一律吞掉降级为「无引用」，不影响正常打开会话。
 */
export function readAgentChatReferenced(channelId?: string | null): PersistedReferencedTask | null {
    try {
        const raw = localStorage.getItem(agentChatReferencedKey(channelId));
        if (!raw) return null;
        const parsed = JSON.parse(raw) as unknown;
        if (
            parsed && typeof parsed === 'object'
            && typeof (parsed as PersistedReferencedTask).task_id === 'number'
            && typeof (parsed as PersistedReferencedTask).title === 'string'
        ) {
            return parsed as PersistedReferencedTask;
        }
        return null;
    } catch {
        return null;
    }
}

/**
 * 写入引用总结（null 清除）。异常静默降级。
 * 传 null 时清除，与 clearAgentChatReferenced 等价——统一入口方便调用点。
 */
export function writeAgentChatReferenced(
    channelId: string | null | undefined,
    task: PersistedReferencedTask | null,
): void {
    if (!task) {
        clearAgentChatReferenced(channelId);
        return;
    }
    try {
        localStorage.setItem(
            agentChatReferencedKey(channelId),
            JSON.stringify({ task_id: task.task_id, title: task.title }),
        );
    } catch {
        // 同 writeAgentChatSession：localStorage 不可用（隐私模式/配额）
        // 时静默降级，本次会话仍然可用，只是 refresh 后不恢复。
    }
}

/** 清除该入口的引用总结（「新会话」或「保存成功」用）。异常静默降级。 */
export function clearAgentChatReferenced(channelId?: string | null): void {
    try {
        localStorage.removeItem(agentChatReferencedKey(channelId));
    } catch {
        // 同上。
    }
}

/** 周对应天数 */
export const DAYS_PER_WEEK = 7;
/** interval_days 上界（与后端 MaxIntervalDays 对齐） */
export const MAX_INTERVAL_DAYS = 3650;
/** interval_months 上界（与后端 MaxIntervalMonths 对齐） */
export const MAX_INTERVAL_MONTHS = 120;

const weekdayKeys = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const isoWeekdayKeys = ["", "mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

/** 任务状态 → 显示文本 */
export function getStatusLabel(status: TaskStatusType): string {
    switch (status) {
        case TaskStatus.PENDING: return t("summary.status.pending");
        case TaskStatus.WAITING_CONFIRM: return t("summary.status.waitingConfirm");
        case TaskStatus.PROCESSING: return t("summary.status.processing");
        case TaskStatus.COMPLETED: return t("summary.status.completed");
        case TaskStatus.FAILED: return t("summary.status.failed");
        case TaskStatus.CANCELLED: return t("summary.status.cancelled");
        default: return t("summary.common.unknown");
    }
}

/** 任务状态 → Semi Tag 颜色 */
export function getStatusColor(status: TaskStatusType): string {
    switch (status) {
        case TaskStatus.PENDING: return "grey";
        case TaskStatus.WAITING_CONFIRM: return "amber";
        case TaskStatus.PROCESSING: return "blue";
        case TaskStatus.COMPLETED: return "green";
        case TaskStatus.FAILED: return "red";
        case TaskStatus.CANCELLED: return "grey";
        default: return "grey";
    }
}

/** 总结模式 → 显示文本 */
export function getModeLabel(mode: SummaryModeType): string {
    return mode === SummaryMode.BY_GROUP ? t("summary.mode.byGroup") : t("summary.mode.byPerson");
}

/** 信息来源类型 → 显示文本 */
export function getSourceTypeLabel(type: SourceTypeValue): string {
    switch (type) {
        case SourceType.GROUP_CHAT: return t("summary.source.groupChat");
        case SourceType.THREAD: return t("summary.source.thread");
        case SourceType.DIRECT_MESSAGE: return t("summary.source.directMessage");
        default: return t("summary.common.unknown");
    }
}

export function getSourceTypeOptions(sourceTypes?: SourceTypeValue[]) {
    const options = [
        { value: SourceType.GROUP_CHAT, label: getSourceTypeLabel(SourceType.GROUP_CHAT) },
        { value: SourceType.THREAD, label: getSourceTypeLabel(SourceType.THREAD) },
        { value: SourceType.DIRECT_MESSAGE, label: getSourceTypeLabel(SourceType.DIRECT_MESSAGE) },
    ];
    return sourceTypes ? options.filter((option) => sourceTypes.includes(option.value)) : options;
}

/** 参与者状态 → 显示文本 */
export function getParticipantStatusLabel(status: number): string {
    switch (status) {
        case ParticipantStatus.PENDING: return t("summary.participant.pending");
        case ParticipantStatus.CONFIRMED: return t("summary.participant.confirmed");
        case ParticipantStatus.DECLINED: return t("summary.participant.declined");
        default: return t("summary.common.unknown");
    }
}

/** 时间范围类型 → 显示文本 */
export function getTimeRangeTypeLabel(type: number): string {
    switch (type) {
        case 1: return t("summary.timeRange.last24h");
        case 2: return t("summary.timeRange.last7d");
        case 3: return t("summary.timeRange.last30d");
        case 4: return t("summary.timeRange.sinceLastSummary");
        default: return t("summary.common.unknown");
    }
}

export function getTimeRangeTypeOptions() {
    return [1, 2, 3, 4].map((value) => ({
        value,
        label: getTimeRangeTypeLabel(value),
    }));
}

/** 格式化日期 */
export function formatDate(dateStr: string | null | undefined): string {
    if (!dateStr) return "-";
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return "-";
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 格式化日期（仅日期） */
export function formatDateOnly(dateStr: string | null | undefined): string {
    if (!dateStr) return "-";
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return "-";
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 校验时间范围不超过 maxDays 天 */
export function validateTimeRange(start: Date, end: Date, maxDays = 31): string | null {
    if (end <= start) return t("summary.timeRange.validationEndAfterStart");
    const diffMs = end.getTime() - start.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    if (diffDays > maxDays) {
        return t("summary.timeRange.validationMaxDays", { values: { maxDays } });
    }
    return null;
}

/** 任务是否可以取消 */
export function canCancel(status: TaskStatusType): boolean {
    return (
        status === TaskStatus.PENDING ||
        status === TaskStatus.WAITING_CONFIRM ||
        status === TaskStatus.PROCESSING
    );
}

/** 任务是否可以重新生成 */
export function canRegenerate(status: TaskStatusType): boolean {
    return (
        status === TaskStatus.COMPLETED ||
        status === TaskStatus.FAILED ||
        status === TaskStatus.CANCELLED
    );
}

/** 删除：自定义 cron 新建/编辑入口已彻底下线，interval(天/周/月) 为唯一对外口径。
 *  cron 仅保留遗留任务的展示(describeCron/cronToLabel)与执行，不再有预设/新建入口。 */

export function getWeekdayName(dayOfWeek: number): string {
    const key = isoWeekdayKeys[dayOfWeek] || "mon";
    return t(`summary.cron.weekdayNames.${key}`);
}

export function getDayOfMonthLabel(day: number): string {
    return t("summary.cron.dayOfMonth", { values: { day } });
}

/** cron 表达式 → 可读标签（用于详情页展示） */
export function cronToLabel(cron_expr: string): string {
    const parts = cron_expr.trim().split(/\s+/);
    if (parts.length !== 5) return cron_expr;
    const [minStr, hourStr, dom, , dow] = parts;
    const pad = (n: string) => n.padStart(2, "0");
    const timeStr = `${pad(hourStr)}:${pad(minStr)}`;

    if (dom !== "*") {
        // monthly: e.g. "0 9 27 * *"
        return t("summary.cron.monthlyAt", { values: { day: dom, time: timeStr } });
    }
    if (dow !== "*") {
        // weekly: e.g. "30 11 * * 1"
        const dowNum = parseInt(dow, 10);
        const label = weekdayKeys[dowNum]
            ? t(`summary.cron.weekdays.${weekdayKeys[dowNum]}`)
            : dow;
        return t("summary.cron.weeklyAt", { values: { day: label, time: timeStr } });
    }
    // daily
    return t("summary.cron.dailyAt", { values: { time: timeStr } });
}

/** ScheduleConfig → 提交后端的调度参数（数量×单位 → interval_days / interval_months）
 *  三者互斥：天/周走 interval_days，月走 interval_months，cron_expr 始终置空。
 *  run_time 携带用户选择的 HH:MM，后端据此锁定运行时刻。 */
export function scheduleToParams(config: ScheduleConfig): {
    cron_expr: string;
    interval_days: number;
    interval_months: number;
    day_of_week: number;
    day_of_month: number;
    run_time: string;
    confirm_policy?: number;
} {
    const every = Math.max(1, Math.floor(config.every || 1));
    // V5：仅在 ScheduleConfig 携带 confirm_policy 时透传（多人定时场景），
    // 避免改变现有单人/旧调用方的返回形状。
    const confirmPolicy =
        config.confirm_policy !== undefined ? { confirm_policy: config.confirm_policy } : {};
    if (config.unit === "month") {
        return {
            cron_expr: "",
            interval_days: 0,
            interval_months: every,
            day_of_week: 0,
            day_of_month: config.dayOfMonth || 0,
            run_time: config.time,
            ...confirmPolicy,
        };
    }
    const days = config.unit === "week" ? every * DAYS_PER_WEEK : every;
    return {
        cron_expr: "",
        interval_days: days,
        interval_months: 0,
        day_of_week: config.unit === "week" ? (config.dayOfWeek || 0) : 0,
        day_of_month: 0,
        run_time: config.time,
        ...confirmPolicy,
    };
}

/** 校验数量是否在合理范围（返回错误文案或 null） */
export function validateScheduleConfig(config: ScheduleConfig): string | null {
    const every = Math.floor(config.every);
    if (!Number.isFinite(every) || every < 1) {
        return t("summary.schedule.config.everyMin");
    }
    if (config.unit === "month") {
        if (every > MAX_INTERVAL_MONTHS) {
            return t("summary.schedule.config.everyMaxMonths", { values: { max: MAX_INTERVAL_MONTHS } });
        }
    } else {
        const days = config.unit === "week" ? every * DAYS_PER_WEEK : every;
        if (days > MAX_INTERVAL_DAYS) {
            return t("summary.schedule.config.everyMaxDays", { values: { max: MAX_INTERVAL_DAYS } });
        }
    }
    return null;
}

/** 调度展示：interval_months > 0 按月，interval_days > 0 按天/周，否则解析 cron(遗留)
 *  非阻塞3：周/月模式补上「周几 / 几号」，避免创建页与列表页漏显。 */
export function describeSchedule(
    cron_expr: string,
    interval_days?: number,
    interval_months?: number,
    run_time?: string,
    day_of_week?: number,
    day_of_month?: number,
): string {
    const at = run_time ? ` ${run_time}` : "";
    if (interval_months && interval_months > 0) {
        const base = t("summary.cron.everyNMonths", { values: { months: interval_months, at: "" } });
        // 月模式：插入「N 号」，再补运行时刻。
        const dom =
            day_of_month && day_of_month > 0
                ? t("summary.cron.dayOfMonth", { values: { day: day_of_month } })
                : "";
        return [base, dom].filter(Boolean).join(" ") + at;
    }
    if (interval_days && interval_days > 0) {
        if (interval_days % DAYS_PER_WEEK === 0) {
            const base = t("summary.cron.everyNWeeks", {
                values: { weeks: interval_days / DAYS_PER_WEEK, at: "" },
            });
            // 周模式：插入「周一..周日」，再补运行时刻。
            let dow = "";
            if (day_of_week && day_of_week >= 1 && day_of_week <= 7) {
                const key = isoWeekdayKeys[day_of_week];
                if (key) dow = t(`summary.cron.weekdayNames.${key}`);
            }
            return [base, dow].filter(Boolean).join(" ") + at;
        }
        return t("summary.cron.everyNDays", { values: { days: interval_days, at } });
    }
    return describeCron(cron_expr);
}

/**
 * Blocking 1 决策（纯函数，便于单测）：详情页保存定时时，若当前 scheduleItem
 * 存在但 is_active === false，说明用户是在「停用后重新设置」——仅 update 不会把
 * is_active 切回 true，需额外调 toggleSchedule(id, true) 重新启用（同时把 next_run 推到
 * 未来）。返回 true 表示「保存后需重新启用」。
 */
export function shouldReactivateOnSave(item?: { is_active?: boolean } | null): boolean {
    return !!item && item.is_active === false;
}

/** ScheduleItem → ScheduleConfig（用于回填弹窗）。优先 interval，遗留 cron 降级为默认。 */
export function scheduleItemToConfig(item: {
    cron_expr: string;
    interval_days?: number;
    interval_months?: number;
    day_of_week?: number;
    day_of_month?: number;
    run_time?: string;
    generation_instruction?: string;
}): ScheduleConfig {
    const generationInstruction = item.generation_instruction || "";
    if (item.interval_months && item.interval_months > 0) {
        return {
            unit: "month",
            every: item.interval_months,
            time: item.run_time || "09:00",
            dayOfMonth: item.day_of_month || 0,
            generationInstruction,
        };
    }
    if (item.interval_days && item.interval_days > 0) {
        if (item.interval_days % DAYS_PER_WEEK === 0) {
            return {
                unit: "week",
                every: item.interval_days / DAYS_PER_WEEK,
                time: item.run_time || "09:00",
                dayOfWeek: item.day_of_week || 0,
                generationInstruction,
            };
        }
        return { unit: "day", every: item.interval_days, time: item.run_time || "09:00", generationInstruction };
    }
    // 遗留 cron：尽量从 cron 提取时刻，默认每 1 天。
    // 非阻塞1：打上 legacyCron 标记，供弹窗提示「保存将转换为间隔模式」，
    // 避免用户未主动改周期却被默默转成「每 1 天」。
    if (item.cron_expr) {
        return { unit: "day", every: 1, time: cronToTime(item.cron_expr), legacyCron: item.cron_expr, generationInstruction };
    }
    return { unit: "day", every: 1, time: "09:00", generationInstruction };
}

/** 从标准 5 段 cron 提取 HH:MM，解析失败返回 09:00 */
function cronToTime(cron_expr: string): string {
    const parts = (cron_expr || "").trim().split(/\s+/);
    if (parts.length !== 5) return "09:00";
    const [minStr, hourStr] = parts;
    const h = parseInt(hourStr, 10);
    const m = parseInt(minStr, 10);
    if (isNaN(h) || isNaN(m)) return "09:00";
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** 简单 cron 表达式可视化 */
export function describeCron(expr: string): string {
    const parts = expr.trim().split(/\s+/);
    if (parts.length !== 5) return expr;
    const [min, hour, , , dow] = parts;

    const dowMap: Record<string, string> = {
        "0": t("summary.cron.weekdayNames.sun"),
        "1": t("summary.cron.weekdayNames.mon"),
        "2": t("summary.cron.weekdayNames.tue"),
        "3": t("summary.cron.weekdayNames.wed"),
        "4": t("summary.cron.weekdayNames.thu"),
        "5": t("summary.cron.weekdayNames.fri"),
        "6": t("summary.cron.weekdayNames.sat"),
        "7": t("summary.cron.weekdayNames.sun"),
        "*": t("summary.cron.everyDay"),
        "1-5": t("summary.cron.workdays"),
    };

    const dayStr = dowMap[dow] || t("summary.cron.weekdayFallback", { values: { day: dow } });
    const timeStr = `${hour.padStart(2, "0")}:${min.padStart(2, "0")}`;
    return `${dayStr} ${timeStr}`;
}

/**
 * 解析后端返回的时间字符串为 Date。
 * - 带时区（末尾 Z 或 ±HH:MM / ±HHMM）：直接交给 new Date 按绝对时刻解析。
 * - 无时区的 naive 字符串（如 "2026-06-05 09:00:00" 或 "2026-06-05T09:00:00"）：
 *   后端以 Asia/Shanghai(+08:00) 为准，这里显式拼上 +08:00 再解析，
 *   避免 new Date() 默认按浏览器本地时区解析造成偏移。
 * 解析失败返回 null。
 */
export function parseBackendTime(value?: string | null): Date | null {
    if (!value) return null;
    const s = value.trim();
    // 已带时区信息：Z / +08:00 / -0500 等。
    const hasTz = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(s);
    if (hasTz) {
        const d = new Date(s);
        return isNaN(d.getTime()) ? null : d;
    }
    // naive 格式："YYYY-MM-DD HH:MM(:SS)?" 或 "YYYY-MM-DDTHH:MM(:SS)?"
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
    if (m) {
        const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] || "00"}+08:00`;
        const d = new Date(iso);
        return isNaN(d.getTime()) ? null : d;
    }
    const fallback = new Date(s);
    return isNaN(fallback.getTime()) ? null : fallback;
}

/**
 * 把后端返回的时间字符串格式化为「Asia/Shanghai」本地可读时间（YYYY-MM-DD HH:MM）。
 * 后端 next_run_at 使用上海时区，这里固定按上海时区展示，避免浏览器时区漂移。
 * 解析失败时原样返回。
 */
export function formatNextRunAt(value?: string | null): string {
    if (!value) return "";
    const d = parseBackendTime(value);
    if (!d || isNaN(d.getTime())) return value;
    try {
        const parts = new Intl.DateTimeFormat("zh-CN", {
            timeZone: "Asia/Shanghai",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
        }).formatToParts(d);
        const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
        const hour = get("hour") === "24" ? "00" : get("hour");
        return `${get("year")}-${get("month")}-${get("day")} ${hour}:${get("minute")}`;
    } catch {
        return value;
    }
}

/**
 * 纯函数：把 ScheduleItem 转成一行人类可读的中文定时描述。
 * 覆盖三种周期：
 *  - interval_months：按月（可附「N 号」）
 *  - interval_days：按天 / 按周（7 的倍数视为周，可附「周几」）
 *  - cron_expr：遗留，复用 describeCron 简单展示
 * 末尾附运行时刻（run_time）与下次运行时间（next_run_at，按上海时区）。
 * is_active=false 时返回「定时已关闭」。
 */
export function formatScheduleSummary(item: ScheduleItem): string {
    if (!item) return "";
    if (item.is_active === false) {
        return t("summary.detail.scheduleDisabledHint");
    }

    const segments: string[] = [];
    const runTime = item.run_time || "";

    if (item.interval_months && item.interval_months > 0) {
        // 每 N 个月
        segments.push(
            item.interval_months === 1
                ? t("summary.cron.everyMonth")
                : t("summary.schedule.summary.everyNMonths", { values: { months: item.interval_months } }),
        );
        if (item.day_of_month && item.day_of_month > 0) {
            segments.push(t("summary.cron.dayOfMonth", { values: { day: item.day_of_month } }));
        }
    } else if (item.interval_days && item.interval_days > 0) {
        if (item.interval_days % DAYS_PER_WEEK === 0) {
            const weeks = item.interval_days / DAYS_PER_WEEK;
            segments.push(
                weeks === 1
                    ? t("summary.cron.everyWeek")
                    : t("summary.schedule.summary.everyNWeeks", { values: { weeks } }),
            );
            if (item.day_of_week && item.day_of_week >= 1 && item.day_of_week <= 7) {
                const key = isoWeekdayKeys[item.day_of_week];
                if (key) {
                    segments.push(t(`summary.cron.weekdayNames.${key}`));
                }
            }
        } else {
            segments.push(
                item.interval_days === 1
                    ? t("summary.cron.everyDay")
                    : t("summary.schedule.summary.everyNDays", { values: { days: item.interval_days } }),
            );
        }
    } else if (item.cron_expr) {
        segments.push(describeCron(item.cron_expr));
    }

    if (runTime) {
        segments.push(runTime);
    }

    let body = segments.filter(Boolean).join(" ");
    if (!body) {
        // 兜底：无法识别周期
        body = t("summary.detail.scheduleActiveLabel");
    }

    const next = formatNextRunAt(item.next_run_at);
    const nextPart = next ? ` · ${t("summary.detail.scheduleNextRun", { values: { time: next } })}` : "";

    return `${t("summary.detail.schedulePrefix")}${body}${nextPart}`;
}
