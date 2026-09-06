import { afterEach, describe, expect, it, vi } from "vitest"
import { i18n } from "../../i18n/instance"
import { formatMessageTimestamp, formatRelativeTime, getTimeStringAutoShort2, dateFormat } from "../time"

describe("formatMessageTimestamp", () => {
    afterEach(() => {
        vi.useRealTimers()
        i18n.setLocale("zh-CN", { notify: false, persist: false })
    })

    it("shows only HH:mm for messages from today", () => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date(2026, 5, 8, 12, 0, 0))

        const timestamp = new Date(2026, 5, 8, 8, 20, 0).getTime() / 1000

        expect(formatMessageTimestamp(timestamp)).toBe("08:20")
    })

    it("shows MM-DD HH:mm for older same-year history messages", () => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date(2026, 5, 8, 12, 0, 0))

        const timestamp = new Date(2026, 4, 12, 8, 20, 0).getTime() / 1000

        expect(formatMessageTimestamp(timestamp)).toBe("05-12 08:20")
    })

    it("shows localized weekday for recent same-week history messages", () => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date(2026, 5, 8, 12, 0, 0))
        i18n.setLocale("zh-CN", { notify: false, persist: false })

        const timestamp = new Date(2026, 5, 2, 15, 20, 0).getTime() / 1000

        expect(formatMessageTimestamp(timestamp)).toBe("周二 15:20")
    })

    it("shows English weekday when locale is en-US", () => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date(2026, 5, 8, 12, 0, 0))
        i18n.setLocale("en-US", { notify: false, persist: false })

        const timestamp = new Date(2026, 5, 2, 15, 20, 0).getTime() / 1000

        expect(formatMessageTimestamp(timestamp)).toBe("Tue 15:20")
    })

    it("shows YYYY-MM-DD HH:mm for cross-year history messages", () => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date(2026, 5, 8, 12, 0, 0))

        const timestamp = new Date(2025, 11, 31, 23, 59, 0).getTime()

        expect(formatMessageTimestamp(timestamp)).toBe("2025-12-31 23:59")
    })

    it("formats calendar tokens and relative time ranges", () => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date(2026, 5, 8, 12, 0, 0))
        expect(dateFormat(new Date(2026, 5, 8, 12, 3, 4), "yyyy-MM-dd hh:mm:ss q S")).toBe("2026-06-08 12:03:04 2 0")
        expect(getTimeStringAutoShort2(Date.now() - 30_000, true)).toBe("刚刚")
        expect(getTimeStringAutoShort2(Date.now() - 90_000, false)).toMatch(/^\d{2}:\d{2}$/)
        expect(getTimeStringAutoShort2(new Date(2026, 5, 7, 10, 0).getTime(), true)).toMatch(/^昨天 \d{2}:\d{2}$/)
        expect(getTimeStringAutoShort2(new Date(2026, 5, 6, 10, 0).getTime(), true)).toMatch(/^前天 \d{2}:\d{2}$/)
        expect(formatRelativeTime()).toBe("")
        expect(formatRelativeTime(new Date(Date.now() - 30_000).toISOString())).toBe("刚刚")
        expect(formatRelativeTime(new Date(Date.now() - 2 * 3600_000).toISOString())).toContain("2")
        expect(formatRelativeTime(new Date(Date.now() - 2 * 86400_000).toISOString())).toBe("前天")
        expect(formatRelativeTime(new Date(Date.now() - 10 * 86400_000).toISOString())).toMatch(/^2026\//)
    })

    it("uses short English labels for date column so it does not overflow", () => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date(2026, 5, 8, 12, 0, 0))
        i18n.setLocale("en-US", { notify: false, persist: false })

        // Today → HH:mm
        expect(getTimeStringAutoShort2(new Date(2026, 5, 8, 9, 27).getTime(), false)).toMatch(/^\d{2}:\d{2}$/)
        // Yesterday → "Yesterday HH:mm"
        expect(getTimeStringAutoShort2(new Date(2026, 5, 7, 4, 12).getTime(), true)).toBe("Yesterday 04:12")
        // 2 days ago → short "2d ago HH:mm", not "The day before yesterday …"
        const twoDaysAgo = getTimeStringAutoShort2(new Date(2026, 5, 6, 21, 34).getTime(), true)
        expect(twoDaysAgo).toBe("2d ago 21:34")
        expect(twoDaysAgo).not.toContain("day before yesterday")
        // Within a week → short weekday, not long ("Tue" not "Tuesday")
        const sameWeek = getTimeStringAutoShort2(new Date(2026, 5, 2, 15, 20).getTime(), true)
        expect(sameWeek).toBe("Tue 15:20")
        expect(sameWeek).not.toContain("Tuesday")
        // Older-than-a-week same-year → localized numeric calendar date + time (not "10 days ago").
        // Intl date is locale-shaped; only assert time suffix and that the label carries no long-form
        // weekday text, then check the 96px column budget for the pathological cross-year case below.
        const olderSameYear = getTimeStringAutoShort2(new Date(2026, 3, 12, 8, 20).getTime(), true)
        expect(olderSameYear).toMatch(/ \d{2}:\d{2}$/)
        expect(olderSameYear).not.toContain("Wednesday")
        // Cross-year → same numeric calendar path (formatCalendarDate switches to en-US Intl format).
        const crossYear = getTimeStringAutoShort2(new Date(2025, 11, 31, 23, 59).getTime(), true)
        expect(crossYear).toMatch(/ \d{2}:\d{2}$/)
        expect(crossYear).toContain("2025")
        // Every en-US bucket must stay within the ~16-char / 96px date-column budget.
        for (const label of [
            getTimeStringAutoShort2(new Date(2026, 5, 8, 9, 27).getTime(), false),
            getTimeStringAutoShort2(new Date(2026, 5, 7, 4, 12).getTime(), true),
            twoDaysAgo,
            sameWeek,
            olderSameYear,
            crossYear,
        ]) {
            expect(label.length).toBeLessThanOrEqual(16)
        }
    })

    it("emits the short zh-CN weekday for the within-a-week bucket", () => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date(2026, 5, 8, 12, 0, 0))
        i18n.setLocale("zh-CN", { notify: false, persist: false })

        // Pinned direction: 星期二 → 周二 (matches formatMessageTimestamp; short weekday keeps
        // the conversation-list date column within budget for future long-name locales too).
        const sameWeek = getTimeStringAutoShort2(new Date(2026, 5, 2, 15, 20).getTime(), true)
        expect(sameWeek).toBe("周二 15:20")
        expect(sameWeek).not.toContain("星期二")
    })
})
