// @octo/loop — 自动化触发排程助手：频率(每天/每周/每月) ↔ cron。
// 后端只支持 5 段 cron 的定时触发，无一次性触发，故不提供「单次」（与产品设计一致）。

export type Frequency = "daily" | "weekly" | "monthly";

export interface ScheduleConfig {
  frequency: Frequency;
  time: string; // "HH:MM"（24h）
  dayOfWeek: number; // 0=周日..6=周六，仅 weekly 使用
  dayOfMonth: number; // 1..31，仅 monthly 使用
  timezone: string; // IANA
}

type TFn = (
  key: string,
  opts?: { values?: Record<string, string | number> },
) => string;

function getLocalTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function getDefaultScheduleConfig(): ScheduleConfig {
  return {
    frequency: "daily",
    time: "09:00",
    dayOfWeek: 1,
    dayOfMonth: 1,
    timezone: getLocalTimezone(),
  };
}

function splitTime(time: string): [number, number] {
  const [h, m] = time.split(":");
  return [parseInt(h ?? "9", 10) || 0, parseInt(m ?? "0", 10) || 0];
}

export function toCron(cfg: ScheduleConfig): string {
  const [hour, min] = splitTime(cfg.time);
  switch (cfg.frequency) {
    case "daily":
      return `${min} ${hour} * * *`;
    case "weekly":
      return `${min} ${hour} * * ${cfg.dayOfWeek}`;
    case "monthly":
      return `${min} ${hour} ${cfg.dayOfMonth} * *`;
  }
}

// cron → ScheduleConfig（尽力解析，识别不出的沿用默认 daily）。
export function parseCron(cron: string | null | undefined, timezone: string): ScheduleConfig {
  const base: ScheduleConfig = { ...getDefaultScheduleConfig(), timezone };
  if (!cron) return base;
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return base;
  const [minStr, hourStr, dom, mon, dow] = parts;
  const min = parseInt(minStr, 10);
  const hour = parseInt(hourStr, 10);
  if (Number.isNaN(min) || Number.isNaN(hour)) return base;
  const time = `${pad2(hour)}:${pad2(min)}`;

  // 每周：dom=* mon=* dow=单值
  if (dom === "*" && mon === "*" && /^[0-6]$/.test(dow)) {
    return { ...base, frequency: "weekly", time, dayOfWeek: parseInt(dow, 10) };
  }
  // 每月：dom=单值 mon=* dow=*
  if (/^\d{1,2}$/.test(dom) && mon === "*" && dow === "*") {
    return { ...base, frequency: "monthly", time, dayOfMonth: parseInt(dom, 10) };
  }
  // 每天（含旧数据里 dom=* mon=* dow=* 或其它无法识别的形状，回退每天）
  return { ...base, frequency: "daily", time };
}

// 人读排程摘要，如「每天 09:00」「每周五 17:00」「每月 1 日 09:00」。
export function describeSchedule(cfg: ScheduleConfig, t: TFn): string {
  switch (cfg.frequency) {
    case "daily":
      return t("loop.automation.summary.daily", { values: { time: cfg.time } });
    case "weekly":
      return t("loop.automation.summary.weekly", {
        values: { day: t(`loop.automation.weekdays.${cfg.dayOfWeek}`), time: cfg.time },
      });
    case "monthly":
      return t("loop.automation.summary.monthly", {
        values: { day: cfg.dayOfMonth, time: cfg.time },
      });
  }
}

// 卡片/详情用：把 ISO 的 next_run_at 格式化为语言中立的「M/D HH:MM」。
export function formatNextRunAt(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getMonth() + 1}/${d.getDate()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
