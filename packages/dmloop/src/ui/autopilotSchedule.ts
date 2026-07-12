// @octo/loop — 自动化触发排程助手：Figma 频率(单次/每天/每周/每月) ↔ cron。
// 后端只吃 5 段 cron，单次以「钉日+月」近似，无法真正一次性触发。

export type Frequency = "once" | "daily" | "weekly" | "monthly";

export interface ScheduleConfig {
  frequency: Frequency;
  time: string; // "HH:MM"（24h）
  date: string; // "YYYY-MM-DD"，仅 once 使用
  dayOfWeek: number; // 0=周日..6=周六，仅 weekly 使用
  dayOfMonth: number; // 1..31，仅 monthly 使用
  timezone: string; // IANA
}

type TFn = (
  key: string,
  opts?: { values?: Record<string, string | number> },
) => string;

export function getLocalTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function getDefaultScheduleConfig(): ScheduleConfig {
  return {
    frequency: "daily",
    time: "09:00",
    date: todayStr(),
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
    case "once": {
      const [, mon, day] = cfg.date.split("-").map((s) => parseInt(s, 10));
      const D = Number.isFinite(day) ? day : 1;
      const M = Number.isFinite(mon) ? mon : 1;
      return `${min} ${hour} ${D} ${M} *`;
    }
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

  // 每天：dom=* mon=* dow=*
  if (dom === "*" && mon === "*" && dow === "*") {
    return { ...base, frequency: "daily", time };
  }
  // 每周：dom=* mon=* dow=单值
  if (dom === "*" && mon === "*" && /^[0-6]$/.test(dow)) {
    return { ...base, frequency: "weekly", time, dayOfWeek: parseInt(dow, 10) };
  }
  // 每月：dom=单值 mon=* dow=*
  if (/^\d{1,2}$/.test(dom) && mon === "*" && dow === "*") {
    return { ...base, frequency: "monthly", time, dayOfMonth: parseInt(dom, 10) };
  }
  // 单次：dom=单值 mon=单值 dow=*（钉日+月）
  if (/^\d{1,2}$/.test(dom) && /^\d{1,2}$/.test(mon) && dow === "*") {
    const year = new Date().getFullYear();
    const date = `${year}-${pad2(parseInt(mon, 10))}-${pad2(parseInt(dom, 10))}`;
    return { ...base, frequency: "once", time, date };
  }
  return base;
}

// 人读排程摘要，如「每天 09:00」「每周五 17:00」「每月 1 日 09:00」「单次 07-20 09:00」。
export function describeSchedule(cfg: ScheduleConfig, t: TFn): string {
  switch (cfg.frequency) {
    case "once":
      return t("loop.automation.summary.once", {
        values: { date: cfg.date.slice(5), time: cfg.time },
      });
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

// 卡片用：把 ISO 的 next_run_at 格式化为「M月D日 HH:MM」。
export function formatNextRunAt(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getMonth() + 1}月${d.getDate()}日 ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
