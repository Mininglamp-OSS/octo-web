import { describe, it, expect } from "vitest"
import { canCreateBot } from "./botGating"

describe("canCreateBot", () => {
    it("returns false for an empty list", () => {
        expect(canCreateBot([])).toBe(false)
    })
    it("returns false when every runtime is offline", () => {
        expect(canCreateBot([{ status: "offline" }, { status: "offline" }])).toBe(false)
    })
    it("returns true when at least one runtime is online", () => {
        expect(canCreateBot([{ status: "offline" }, { status: "online" }])).toBe(true)
    })
    it("treats only the exact string 'online' as online", () => {
        expect(canCreateBot([{ status: "Online" }, { status: "" }])).toBe(false)
    })
})
