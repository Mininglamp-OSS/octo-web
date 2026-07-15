import type { I18nFormatter } from "@octo/base";

/**
 * 相对时间展示：近 10 天内用「x 分钟/小时/天前」，更早回退到「M月D日」短日期。
 * 列表/详情共用（项目、技能等）。
 */
export function formatRelativeTime(
  value: string | undefined,
  format: Pick<I18nFormatter, "date" | "relativeTime">,
): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const diff = date.getTime() - Date.now();
  const absDiff = Math.abs(diff);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (absDiff < minute) return format.relativeTime(0, "minute");
  if (absDiff < hour) return format.relativeTime(Math.round(diff / minute), "minute");
  if (absDiff < day) return format.relativeTime(Math.round(diff / hour), "hour");
  if (absDiff < 10 * day) return format.relativeTime(Math.round(diff / day), "day");
  return format.date(date, { month: "short", day: "numeric" });
}

/** 时长展示：<1min → Ns；<1h → Nm SSs；否则 Nh Mm。用于运行履历。 */
export function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))}s`;
  if (ms < 3_600_000) {
    const m = Math.floor(ms / 60_000);
    const s = Math.round((ms % 60_000) / 1000);
    return `${m}m ${String(s).padStart(2, "0")}s`;
  }
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return `${h}h ${m}m`;
}
