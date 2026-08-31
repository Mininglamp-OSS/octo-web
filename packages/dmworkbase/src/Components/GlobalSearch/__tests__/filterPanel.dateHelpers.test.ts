import { describe, expect, it } from "vitest"
import {
  dateDisplayValue,
  dateFromSeconds,
  datePickerValueToDate,
  endOfDay,
  startOfDay,
  toSeconds,
} from "../GlobalSearchFilterPanel"

describe("global search filter date helpers", () => {
  it("normalizes browser dates and serializes seconds", () => {
    const input = new Date(2026, 6, 10, 13, 14, 15)
    expect(startOfDay(input).getHours()).toBe(0)
    expect(endOfDay(input).getHours()).toBe(23)
    expect(endOfDay(input).getMilliseconds()).toBe(999)
    expect(toSeconds(input)).toBe(Math.floor(input.getTime() / 1000))
    expect(dateFromSeconds()).toBeUndefined()
    expect(dateFromSeconds(0)).toBeUndefined()
    expect(dateFromSeconds(1000)?.getTime()).toBe(1000000)
    expect(dateDisplayValue()).toBe("")
    const local = new Date(2026, 0, 15, 12, 0, 0)
    expect(dateDisplayValue(Math.floor(local.getTime() / 1000), "en-US")).toMatch(/^2026\/01\/15 /)
  })

  it("accepts picker dates, arrays, strings, and invalid values", () => {
    const date = new Date("2026-07-10T00:00:00Z")
    expect(datePickerValueToDate(date)).toBe(date)
    expect(datePickerValueToDate([date])?.getTime()).toBe(date.getTime())
    expect(datePickerValueToDate("2026-07-10")?.getFullYear()).toBe(2026)
    expect(datePickerValueToDate(["not-a-date"])).toBeUndefined()
    expect(datePickerValueToDate(null)).toBeUndefined()
    expect(datePickerValueToDate([])).toBeUndefined()
  })
})
