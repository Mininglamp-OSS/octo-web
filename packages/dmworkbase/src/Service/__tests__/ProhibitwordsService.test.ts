import { describe, it, expect, vi } from "vitest"

// ProhibitwordsService 依赖 App / StorageService，仅为模块加载打桩；
// filter() 走真实的 sensitive-word-tool，以复现 #465 的崩溃场景。
vi.mock("../../App", () => ({ default: { apiClient: { get: () => Promise.resolve([]) } } }))
vi.mock("../StorageService", () => ({ default: { shared: { getItem: () => null, setItem: () => {} } } }))

import { ProhibitwordsService } from "../ProhibitwordsService"

describe("ProhibitwordsService.filter", () => {
    it("returns an empty string for undefined input", () => {
        expect(ProhibitwordsService.shared.filter(undefined)).toBe("")
    })

    it("returns an empty string for null input", () => {
        expect(ProhibitwordsService.shared.filter(null)).toBe("")
    })

    it("returns an empty string for non-string input", () => {
        expect(ProhibitwordsService.shared.filter(123 as unknown as string)).toBe("")
    })

    it("returns an empty string for an empty string", () => {
        expect(ProhibitwordsService.shared.filter("")).toBe("")
    })

    it("passes through a normal string", () => {
        expect(ProhibitwordsService.shared.filter("hello world")).toBe("hello world")
    })
})
