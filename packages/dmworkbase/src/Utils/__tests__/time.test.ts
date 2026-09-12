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
        expect(getTimeStringAutoShort2(new Date(2026, 5, 8, 9, 27).getTime(), false)).toBe("09:27")
        // Yesterday → "Yesterday HH:mm"
        expect(getTimeStringAutoShort2(new Date(2026, 5, 7, 4, 12).getTime(), true)).toBe("Yesterday 04:12")

        // 2 days ago — default (non-compact) keeps the natural English prose used
        // in the chat stream / global search / thread-created surfaces.
        expect(getTimeStringAutoShort2(new Date(2026, 5, 6, 21, 34).getTime(), true))
            .toBe("The day before yesterday 21:34")
        // 2 days ago — compact=true is the conversation-list opt-in; only this
        // caller trades prose for `2d ago` to fit the 112px date column.
        expect(getTimeStringAutoShort2(new Date(2026, 5, 6, 21, 34).getTime(), true, true))
            .toBe("2d ago 21:34")

        // Within a week → short weekday under en-US (matches formatMessageTimestamp).
        expect(getTimeStringAutoShort2(new Date(2026, 5, 2, 15, 20).getTime(), true))
            .toBe("Tue 15:20")

        // Older-than-a-week same-year → en-US numeric Intl format `M/D/YYYY HH:mm`.
        // Test node's ICU emits e.g. "4/12/2026" for Intl.DateTimeFormat with
        // month/day/year all numeric; pin the exact string so a future format
        // regression in this bucket (the one that hit the 96px cap in round 1)
        // is caught instead of masked by a loose char-count budget.
        expect(getTimeStringAutoShort2(new Date(2026, 3, 12, 8, 20).getTime(), true))
            .toBe("4/12/2026 08:20")
        // Cross-year → same `M/D/YYYY HH:mm` path.
        expect(getTimeStringAutoShort2(new Date(2025, 11, 31, 23, 59).getTime(), true))
            .toBe("12/31/2025 23:59")

        // NOTE on width coverage: this Vitest / jsdom suite has no layout engine,
        // so char count is *not* a proxy for pixel width in a proportional font
        // (`Yesterday 04:12` = 15 chars ≈ 83px vs `12/31/2025 23:59` = 16 chars
        // ≈ 95px). The 112px `.wk-conversationlist-item-time { max-width }` is
        // pinned by a separate stylesheet assertion in the ConversationList
        // layout test; a rendered-width regression would need Playwright
        // coverage of the conversation-list row (out of scope for this file).
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

        // zh-CN -2d: `前天` in both compact and non-compact paths. The two keys
        // (`.dayBeforeYesterday` and `.dayBeforeYesterdayShort`) are defined
        // identically in zh-CN.json to satisfy i18n:check parity; this test
        // pins them equal so a translator editing one and not the other
        // (silently forking the conversation list from the chat stream)
        // trips CI.
        const twoDaysAgoDefault = getTimeStringAutoShort2(new Date(2026, 5, 6, 21, 34).getTime(), true)
        const twoDaysAgoCompact = getTimeStringAutoShort2(new Date(2026, 5, 6, 21, 34).getTime(), true, true)
        expect(twoDaysAgoDefault).toBe("前天 21:34")
        expect(twoDaysAgoCompact).toBe("前天 21:34")
        expect(twoDaysAgoCompact).toBe(twoDaysAgoDefault)
    })
})
