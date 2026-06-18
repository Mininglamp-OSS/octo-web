import { describe, it, expect } from "vitest"
import { canInstallOctoPlugin } from "./pluginInstall"

describe("canInstallOctoPlugin", () => {
    it("openclaw with no octo plugin installed -> true", () => {
        expect(canInstallOctoPlugin("openclaw", false)).toBe(true)
    })
    it("openclaw with octo plugin already installed -> false", () => {
        expect(canInstallOctoPlugin("openclaw", true)).toBe(false)
    })
    it("claude (cc-octo) is out of 1a scope -> false even when plugin absent", () => {
        expect(canInstallOctoPlugin("claude", false)).toBe(false)
    })
    it("unknown provider -> false", () => {
        expect(canInstallOctoPlugin("codex", false)).toBe(false)
    })
})
