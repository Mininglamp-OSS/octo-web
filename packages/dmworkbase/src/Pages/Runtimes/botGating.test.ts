import { describe, it, expect } from "vitest"
import { canCreateBot } from "./botGating"

describe("canCreateBot", () => {
    it("returns false for an empty list", () => {
        expect(canCreateBot([])).toBe(false)
    })
    it("returns false when every runtime is offline", () => {
        expect(canCreateBot([{ status: "offline", provider: "claude" }, { status: "offline", provider: "openclaw" }])).toBe(false)
    })
    it("returns true when a supported runtime is online", () => {
        expect(canCreateBot([{ status: "offline", provider: "claude" }, { status: "online", provider: "openclaw" }])).toBe(true)
    })
    it("returns false when the only online runtime is an unsupported kind", () => {
        expect(canCreateBot([{ status: "online", provider: "codex" }])).toBe(false)
    })
    it("treats only the exact string 'online' as online", () => {
        expect(canCreateBot([{ status: "Online", provider: "claude" }, { status: "", provider: "claude" }])).toBe(false)
    })
})
