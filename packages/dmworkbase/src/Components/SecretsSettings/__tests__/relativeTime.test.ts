import { describe, it, expect } from 'vitest';
import { formatRelativeFromNow } from '../relativeTime';
import { createI18nFormatter } from '../../../i18n/format';

const fmt = createI18nFormatter('zh-CN');
const NOW = new Date('2026-06-07T12:00:00Z').getTime();

describe('formatRelativeFromNow', () => {
  it('returns empty string for invalid date', () => {
    expect(formatRelativeFromNow('not-a-date', fmt, NOW)).toBe('');
  });

  it('produces an hours-ago string for a few hours back', () => {
    const threeHoursAgo = new Date(NOW - 3 * 3600 * 1000).toISOString();
    const out = formatRelativeFromNow(threeHoursAgo, fmt, NOW);
    expect(out).toContain('小时');
  });

  it('produces a days-ago string within the month', () => {
    const twoDaysAgo = new Date(NOW - 2 * 24 * 3600 * 1000).toISOString();
    const out = formatRelativeFromNow(twoDaysAgo, fmt, NOW);
    expect(out).toContain('天');
  });

  it('falls back to an absolute date beyond 30 days', () => {
    const longAgo = new Date(NOW - 60 * 24 * 3600 * 1000).toISOString();
    const out = formatRelativeFromNow(longAgo, fmt, NOW);
    // absolute date contains a year; relative strings do not
    expect(out).toMatch(/2026|4月|April/);
  });
});
