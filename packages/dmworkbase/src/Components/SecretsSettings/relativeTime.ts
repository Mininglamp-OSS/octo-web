import type { I18nFormatter } from "../../i18n/format";

/**
 * 把一个过去的时间点格式化成「3 小时前 / 2 天前」式相对时间。
 *
 * 复用 i18n format.relativeTime（底层 Intl.RelativeTimeFormat，自动按 locale 出
 * 「3 小时前」/「3 hours ago」），自己只负责选合适的单位 + 算差值（取负数表示过去）。
 * 超过 30 天回落到绝对日期，避免「45 天前」这种读起来没意义的相对值。
 */
export function formatRelativeFromNow(
  isoTime: string,
  format: Pick<I18nFormatter, "relativeTime" | "date">,
  now: number = Date.now()
): string {
  const then = new Date(isoTime).getTime();
  if (isNaN(then)) return "";
  const diffMs = then - now; // 过去为负
  const absSec = Math.abs(diffMs) / 1000;

  const MIN = 60;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;

  if (absSec < MIN) {
    return format.relativeTime(Math.round(diffMs / 1000), "second");
  }
  if (absSec < HOUR) {
    return format.relativeTime(Math.round(diffMs / 1000 / MIN), "minute");
  }
  if (absSec < DAY) {
    return format.relativeTime(Math.round(diffMs / 1000 / HOUR), "hour");
  }
  if (absSec < 30 * DAY) {
    return format.relativeTime(Math.round(diffMs / 1000 / DAY), "day");
  }
  return format.date(isoTime);
}
