import {
    SummaryMode,
    TaskStatus,
    SourceType,
    ParticipantStatus,
    type TaskStatusType,
    type SummaryModeType,
    type SourceTypeValue,
    type ScheduleConfig,
} from "../types/summary";
import { t } from "@octo/base";

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

/** 预设 cron 表达式选项 */
export function getCronPresetOptions() {
    return [
        { value: "0 9 * * *", label: t("summary.cron.everyDayAt") },
        { value: "0 9 * * 1-5", label: t("summary.cron.workdaysAt") },
        { value: "0 9 * * 1", label: t("summary.cron.weeklyMondayAt") },
        { value: "0 9 1 * *", label: t("summary.cron.monthlyFirstAt") },
    ];
}

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

/** ScheduleConfig → cron 表达式（与 cronToScheduleConfig 对称） */
export function scheduleToCron(config: ScheduleConfig): string {
    const [hourStr, minStr] = config.time.split(":");
    const hour = parseInt(hourStr, 10);
    const min = parseInt(minStr, 10);
    if (config.period === "daily") {
        return `${min} ${hour} * * *`;
    }
    if (config.period === "weekly") {
        const cronDow = (config.dayOfWeek ?? 1) % 7;
        return `${min} ${hour} * * ${cronDow}`;
    }
    return `${min} ${hour} ${config.dayOfMonth ?? 1} * *`;
}

/** cron 表达式 → ScheduleConfig（用于回填弹窗） */
export function cronToScheduleConfig(cron_expr: string): ScheduleConfig {
    const parts = cron_expr.trim().split(/\s+/);
    if (parts.length !== 5) return { period: "daily", time: "09:00" };
    const [minStr, hourStr, dom, , dow] = parts;
    const time = `${hourStr.padStart(2, "0")}:${minStr.padStart(2, "0")}`;

    if (dom !== "*") {
        return { period: "monthly", dayOfMonth: parseInt(dom, 10), time };
    }
    if (dow !== "*") {
        // cron dow: 0=Sun,1=Mon,...,6=Sat  → ISO: 1=Mon,...,7=Sun
        const cronDow = parseInt(dow, 10);
        const isoDow = cronDow === 0 ? 7 : cronDow;
        return { period: "weekly", dayOfWeek: isoDow, time };
    }
    return { period: "daily", time };
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
