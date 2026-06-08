import { afterEach, describe, expect, it, vi } from "vitest"
import { formatMessageTimestamp } from "../time"

describe("formatMessageTimestamp", () => {
    afterEach(() => {
        vi.useRealTimers()
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

    it("shows YYYY-MM-DD HH:mm for cross-year history messages", () => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date(2026, 5, 8, 12, 0, 0))

        const timestamp = new Date(2025, 11, 31, 23, 59, 0).getTime()

        expect(formatMessageTimestamp(timestamp)).toBe("2025-12-31 23:59")
    })
})
