// Best-effort cron preview without pulling in a heavyweight cron library.
// Supports the standard 5-field (m h dom mon dow) and 6-field (with leading
// seconds) expressions with `*`, `*/N`, `A,B,C` and `A-B` ranges.
// Returns an error string for syntactically invalid inputs.

export interface CronPreviewResult {
  runs: Date[];
  error?: string;
}

interface Field {
  min: number;
  max: number;
  values: number[]; // sorted, unique
}

function parseField(raw: string, min: number, max: number, label: string): Field {
  if (!raw) throw new Error(`${label}: empty`);
  const values = new Set<number>();
  for (const part of raw.split(",")) {
    let step = 1;
    let body = part;
    const slashIdx = part.indexOf("/");
    if (slashIdx >= 0) {
      step = Number(part.slice(slashIdx + 1));
      body = part.slice(0, slashIdx) || "*";
      if (!Number.isInteger(step) || step <= 0) throw new Error(`${label}: bad step "${part}"`);
    }
    let lo = min;
    let hi = max;
    if (body !== "*") {
      const dashIdx = body.indexOf("-");
      if (dashIdx >= 0) {
        lo = Number(body.slice(0, dashIdx));
        hi = Number(body.slice(dashIdx + 1));
      } else {
        lo = Number(body);
        hi = lo;
      }
      if (!Number.isInteger(lo) || !Number.isInteger(hi)) {
        throw new Error(`${label}: bad range "${part}"`);
      }
      if (lo < min || hi > max || lo > hi) {
        throw new Error(`${label}: out of range "${part}"`);
      }
    }
    for (let v = lo; v <= hi; v += step) values.add(v);
  }
  return { min, max, values: Array.from(values).sort((a, b) => a - b) };
}

function match(field: Field, value: number): boolean {
  return field.values.includes(value);
}

export function previewNextCronRuns(expr: string, count: number, from: Date = new Date()): CronPreviewResult {
  const trimmed = expr.trim();
  if (!trimmed) return { runs: [] };

  const parts = trimmed.split(/\s+/);
  let secs: Field;
  let mins: Field, hrs: Field, doms: Field, mons: Field, dows: Field;
  try {
    if (parts.length === 6) {
      secs = parseField(parts[0], 0, 59, "seconds");
      mins = parseField(parts[1], 0, 59, "minutes");
      hrs = parseField(parts[2], 0, 23, "hours");
      doms = parseField(parts[3], 1, 31, "day-of-month");
      mons = parseField(parts[4], 1, 12, "month");
      dows = parseField(parts[5], 0, 6, "day-of-week");
    } else if (parts.length === 5) {
      secs = { min: 0, max: 0, values: [0] };
      mins = parseField(parts[0], 0, 59, "minutes");
      hrs = parseField(parts[1], 0, 23, "hours");
      doms = parseField(parts[2], 1, 31, "day-of-month");
      mons = parseField(parts[3], 1, 12, "month");
      dows = parseField(parts[4], 0, 6, "day-of-week");
    } else {
      return { runs: [], error: "需要 5 或 6 个字段" };
    }
  } catch (e) {
    return { runs: [], error: (e as Error).message };
  }

  const runs: Date[] = [];
  const cursor = new Date(from.getTime());
  cursor.setMilliseconds(0);
  // Step forward one second so we don't return the current instant.
  cursor.setSeconds(cursor.getSeconds() + 1);

  // Bound search to ~2 years to avoid pathological loops on impossible exprs.
  const limit = cursor.getTime() + 1000 * 60 * 60 * 24 * 365 * 2;

  while (runs.length < count && cursor.getTime() < limit) {
    if (
      match(secs, cursor.getSeconds()) &&
      match(mins, cursor.getMinutes()) &&
      match(hrs, cursor.getHours()) &&
      match(doms, cursor.getDate()) &&
      match(mons, cursor.getMonth() + 1) &&
      match(dows, cursor.getDay())
    ) {
      runs.push(new Date(cursor.getTime()));
      cursor.setSeconds(cursor.getSeconds() + 1);
    } else {
      cursor.setSeconds(cursor.getSeconds() + 1);
    }
  }

  if (runs.length === 0) return { runs: [], error: "无法计算下一次触发时间" };
  return { runs };
}
