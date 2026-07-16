import { t } from "@octo/base";

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function formatRelativeTime(iso: string, baseDate = new Date()): string {
  const diffMs = baseDate.getTime() - new Date(iso).getTime();
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diffMs < minute) return t("skillMarket.time.justNow");
  if (diffMs < hour) return t("skillMarket.time.minutesAgo", { values: { count: Math.max(1, Math.floor(diffMs / minute)) } });
  if (diffMs < day) return t("skillMarket.time.hoursAgo", { values: { count: Math.max(1, Math.floor(diffMs / hour)) } });
  if (diffMs < 30 * day) return t("skillMarket.time.daysAgo", { values: { count: Math.max(1, Math.floor(diffMs / day)) } });
  return formatDate(iso);
}

export function tagsFromInput(value: string): string[] {
  return value
    .split(/[,，\s]+/)
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 5);
}
