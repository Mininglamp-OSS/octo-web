import { t } from "@octo/base";

export function formatDate(iso: string): string {
  // Undefined locale lets the browser pick the user's language, matching
  // the other formatters below. Hardcoding zh-CN would give
  // English-locale users Chinese-formatted dates.
  return new Intl.DateTimeFormat(undefined, {
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

export function formatFullDate(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

export function formatFullDateTime(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function formatCount(count: number): string {
  const safeCount = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  return new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(safeCount);
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

export function formatRecentOrDate(iso: string, baseDate = new Date()): string {
  const diffMs = baseDate.getTime() - new Date(iso).getTime();
  const day = 24 * 60 * 60 * 1000;
  if (diffMs < 7 * day) return formatRelativeTime(iso, baseDate);
  return formatFullDate(iso);
}

export function tagsFromInput(value: string): string[] {
  return value
    .split(/[,，\s]+/)
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, MAX_SKILL_TAGS);
}

export const MAX_SKILL_TAGS = 5;
export const MAX_SKILL_TAG_LENGTH = 24;

const SKILL_TAG_PATTERN = /^[\p{L}\p{N} _./#+-]+$/u;

export function tagLength(value: string): number {
  return Array.from(value).length;
}

export function validateSkillTag(value: string): string | null {
  const tag = value.trim();
  if (!tag) return null;
  if (tagLength(tag) > MAX_SKILL_TAG_LENGTH) {
    return t("skillMarket.form.tagLengthLimit", { values: { count: MAX_SKILL_TAG_LENGTH } });
  }
  if (!SKILL_TAG_PATTERN.test(tag)) {
    return t("skillMarket.form.tagInvalidChars");
  }
  return null;
}
