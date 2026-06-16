import { describe, it, expect } from 'vitest';
import {
    scheduleToParams,
    scheduleItemToConfig,
    formatScheduleSummary,
    describeSchedule,
    formatNextRunAt,
    parseBackendTime,
    shouldReactivateOnSave,
    DAYS_PER_WEEK,
} from './summaryHelpers';
import type { ScheduleConfig, ScheduleItem } from '../types/summary';

// ─── scheduleToParams ──────────────────────────────────
describe('scheduleToParams', () => {
    it('day mode → interval_days, cron empty', () => {
        const cfg: ScheduleConfig = { unit: 'day', every: 3, time: '08:30' };
        expect(scheduleToParams(cfg)).toEqual({
            cron_expr: '',
            interval_days: 3,
            interval_months: 0,
            day_of_week: 0,
            day_of_month: 0,
            run_time: '08:30',
        });
    });

    it('week mode → interval_days = every * 7 and carries day_of_week', () => {
        const cfg: ScheduleConfig = { unit: 'week', every: 2, time: '09:00', dayOfWeek: 1 };
        const p = scheduleToParams(cfg);
        expect(p.interval_days).toBe(2 * DAYS_PER_WEEK);
        expect(p.interval_months).toBe(0);
        expect(p.day_of_week).toBe(1);
        expect(p.day_of_month).toBe(0);
        expect(p.cron_expr).toBe('');
    });

    it('month mode → interval_months and carries day_of_month', () => {
        const cfg: ScheduleConfig = { unit: 'month', every: 1, time: '10:00', dayOfMonth: 15 };
        const p = scheduleToParams(cfg);
        expect(p.interval_months).toBe(1);
        expect(p.interval_days).toBe(0);
        expect(p.day_of_month).toBe(15);
        expect(p.day_of_week).toBe(0);
        expect(p.cron_expr).toBe('');
    });

    it('coerces sub-1 / fractional every to a positive integer', () => {
        expect(scheduleToParams({ unit: 'day', every: 0, time: '09:00' }).interval_days).toBe(1);
        expect(scheduleToParams({ unit: 'day', every: 2.9, time: '09:00' }).interval_days).toBe(2);
    });
});

// ─── scheduleItemToConfig ──────────────────────────────
describe('scheduleItemToConfig', () => {
    it('month item → month config with dayOfMonth', () => {
        const cfg = scheduleItemToConfig({
            cron_expr: '',
            interval_months: 2,
            day_of_month: 9,
            run_time: '07:00',
        });
        expect(cfg).toMatchObject({ unit: 'month', every: 2, time: '07:00', dayOfMonth: 9 });
    });

    it('weekly item (multiple of 7) → week config with dayOfWeek', () => {
        const cfg = scheduleItemToConfig({
            cron_expr: '',
            interval_days: 14,
            day_of_week: 3,
            run_time: '12:00',
        });
        expect(cfg).toMatchObject({ unit: 'week', every: 2, time: '12:00', dayOfWeek: 3 });
    });

    it('daily item (non-multiple of 7) → day config', () => {
        const cfg = scheduleItemToConfig({ cron_expr: '', interval_days: 3, run_time: '06:30' });
        expect(cfg).toMatchObject({ unit: 'day', every: 3, time: '06:30' });
    });

    it('legacy cron item → flags legacyCron and does NOT silently lose it (非阻塞1)', () => {
        const cfg = scheduleItemToConfig({ cron_expr: '0 9 * * 1' });
        // 时刻应从 cron 提取
        expect(cfg.time).toBe('09:00');
        // 关键：携带 legacyCron 标记，供弹窗提示“保存将转间隔”，避免静默改成每天
        expect(cfg.legacyCron).toBe('0 9 * * 1');
    });

    it('empty item (no cron, no interval) → default day/1 without legacyCron', () => {
        const cfg = scheduleItemToConfig({ cron_expr: '' });
        expect(cfg).toMatchObject({ unit: 'day', every: 1, time: '09:00' });
        expect(cfg.legacyCron).toBeUndefined();
    });

    // Blocking 3：列表页编辑流程用 scheduleItemToConfig(...).legacyCron 判定是否
    // 弹「保存将转间隔」警告。这里固化该判定：仅 legacy cron（有 cron_expr、无 interval）
    // 触发警告；interval 模式不触发（不会被静默转换）。
    it('Blocking 3: legacyCron flag drives the list-page edit warning only for cron-only schedules', () => {
        // legacy cron → 应触发警告
        expect(scheduleItemToConfig({ cron_expr: '0 9 * * 1' }).legacyCron).toBe('0 9 * * 1');
        // interval_days 模式 → 不触发
        expect(scheduleItemToConfig({ cron_expr: '', interval_days: 7 }).legacyCron).toBeUndefined();
        // interval_months 模式 → 不触发
        expect(scheduleItemToConfig({ cron_expr: '', interval_months: 1 }).legacyCron).toBeUndefined();
        // 即使同时带了遗留 cron_expr，只要有 interval 就优先 interval、不算 legacy
        expect(scheduleItemToConfig({ cron_expr: '0 9 * * 1', interval_days: 7 }).legacyCron).toBeUndefined();
    });
});

// ─── describeSchedule (非阻塞3: 周几/几号) ──────────────
describe('describeSchedule', () => {
    it('weekly description includes the weekday name (周几)', () => {
        const out = describeSchedule('', 7, 0, '09:00', 1, 0);
        expect(out).toContain('周'); // 每 1 周
        expect(out).toContain('周一'); // day_of_week=1
        expect(out).toContain('09:00');
    });

    it('every-2-weeks description includes weekday', () => {
        const out = describeSchedule('', 14, 0, '08:00', 5, 0);
        expect(out).toContain('周五');
        expect(out).toContain('08:00');
    });

    it('monthly description includes the day-of-month (几号)', () => {
        const out = describeSchedule('', 0, 1, '10:00', 0, 15);
        expect(out).toContain('15日');
        expect(out).toContain('10:00');
    });

    it('daily description has no weekday/day-of-month noise', () => {
        const out = describeSchedule('', 3, 0, '09:00', 0, 0);
        expect(out).toContain('天');
        expect(out).not.toContain('周一');
        expect(out).not.toContain('日 ');
    });

    it('omits weekday/day-of-month when not provided (backward compatible)', () => {
        const weekly = describeSchedule('', 7, 0, '09:00');
        expect(weekly).toContain('周');
        expect(weekly).not.toContain('周一');
    });
});

// ─── formatNextRunAt / parseBackendTime (非阻塞2: 时区) ──
describe('parseBackendTime / formatNextRunAt', () => {
    it('parses a naive (no-timezone) string as Asia/Shanghai, not browser local', () => {
        // "2026-06-05 09:00:00" 应被当作上海 09:00，等价 UTC 01:00
        const d = parseBackendTime('2026-06-05 09:00:00');
        expect(d).not.toBeNull();
        expect(d!.toISOString()).toBe('2026-06-05T01:00:00.000Z');
    });

    it('parses naive "T" separated string as Asia/Shanghai', () => {
        const d = parseBackendTime('2026-06-05T09:00:00');
        expect(d!.toISOString()).toBe('2026-06-05T01:00:00.000Z');
    });

    it('respects explicit timezone offsets', () => {
        const d = parseBackendTime('2026-06-05T09:00:00+08:00');
        expect(d!.toISOString()).toBe('2026-06-05T01:00:00.000Z');
    });

    it('respects explicit UTC (Z)', () => {
        const d = parseBackendTime('2026-06-05T01:00:00Z');
        expect(d!.toISOString()).toBe('2026-06-05T01:00:00.000Z');
    });

    it('formatNextRunAt renders naive string in Shanghai time correctly', () => {
        // naive 上海 09:00 → 展示 09:00（而非按浏览器时区漂移）
        expect(formatNextRunAt('2026-06-05 09:00:00')).toBe('2026-06-05 09:00');
    });

    it('formatNextRunAt renders an offset string converted to Shanghai time', () => {
        // UTC 01:00 == 上海 09:00
        expect(formatNextRunAt('2026-06-05T01:00:00Z')).toBe('2026-06-05 09:00');
    });

    it('formatNextRunAt returns empty for empty input', () => {
        expect(formatNextRunAt('')).toBe('');
        expect(formatNextRunAt(null)).toBe('');
    });
});

// ─── formatScheduleSummary ─────────────────────────────
function baseItem(over: Partial<ScheduleItem>): ScheduleItem {
    return {
        schedule_id: 1,
        title: 't',
        summary_mode: 1,
        cron_expr: '',
        time_range_type: 2,
        sources: [],
        participants: [],
        is_active: true,
        next_run_at: null,
        created_at: '',
        updated_at: '',
        ...over,
    } as ScheduleItem;
}

describe('formatScheduleSummary', () => {
    it('inactive item → disabled hint (停用回显)', () => {
        const out = formatScheduleSummary(baseItem({ is_active: false }));
        expect(out).toBe('定时已关闭');
    });

    it('weekly active item shows weekday and next-run in Shanghai time', () => {
        const out = formatScheduleSummary(
            baseItem({ interval_days: 7, day_of_week: 1, run_time: '09:00', next_run_at: '2026-06-08 09:00:00' }),
        );
        expect(out).toContain('定时：');
        expect(out).toContain('周一');
        expect(out).toContain('09:00');
        // next_run naive 字符串应按上海展示
        expect(out).toContain('2026-06-08 09:00');
    });

    it('monthly active item shows day-of-month', () => {
        const out = formatScheduleSummary(
            baseItem({ interval_months: 1, day_of_month: 15, run_time: '10:00' }),
        );
        expect(out).toContain('15日');
        expect(out).toContain('10:00');
    });
});

// ─── shouldReactivateOnSave (Blocking 1) ───────────────
describe('shouldReactivateOnSave (停用后再保存应重新启用)', () => {
    it('returns true when the existing schedule is inactive', () => {
        expect(shouldReactivateOnSave({ is_active: false })).toBe(true);
    });

    it('returns false when the existing schedule is active', () => {
        expect(shouldReactivateOnSave({ is_active: true })).toBe(false);
    });

    it('returns false when there is no existing schedule', () => {
        expect(shouldReactivateOnSave(null)).toBe(false);
        expect(shouldReactivateOnSave(undefined)).toBe(false);
    });

    it('end-to-end: a disabled weekly schedule re-saved must re-enable & keep its period', () => {
        // 模拟“停用”的记录
        const disabled = baseItem({ interval_days: 7, day_of_week: 2, run_time: '09:00', is_active: false });
        // 1) 回填弹窗：保留原周期（周二 09:00），不丢
        const cfg = scheduleItemToConfig(disabled);
        expect(cfg).toMatchObject({ unit: 'week', every: 1, dayOfWeek: 2, time: '09:00' });
        // 2) 保存逻辑应判定“需重新启用”
        expect(shouldReactivateOnSave(disabled)).toBe(true);
        // 3) 提交参数仍是有效间隔配置（保存后 + toggle(true) 即可恢复生效）
        const params = scheduleToParams(cfg);
        expect(params.interval_days).toBe(7);
        expect(params.day_of_week).toBe(2);
        expect(params.run_time).toBe('09:00');
    });
});
