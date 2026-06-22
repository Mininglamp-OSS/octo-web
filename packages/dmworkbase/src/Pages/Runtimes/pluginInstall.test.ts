import { describe, it, expect } from "vitest"
import { canInstallOctoPlugin, octoPluginInstalled } from "./pluginInstall"
import { canInstallCcPlugin } from "./pluginInstall"

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

describe("octoPluginInstalled", () => {
    it("true when metadata.plugins contains the component", () => {
        const meta = JSON.stringify({ plugins: [{ name: "memory-core", version: "1" }, { name: "octo", version: "0.7.0" }] })
        expect(octoPluginInstalled(meta, "octo")).toBe(true)
    })
    it("false when the component is not yet in plugins (fresh install not landed)", () => {
        const meta = JSON.stringify({ plugins: [{ name: "memory-core", version: "1" }] })
        expect(octoPluginInstalled(meta, "octo")).toBe(false)
    })
    it("false for empty / missing plugins", () => {
        expect(octoPluginInstalled(JSON.stringify({ plugins: [] }), "octo")).toBe(false)
        expect(octoPluginInstalled("{}", "octo")).toBe(false)
        expect(octoPluginInstalled(undefined, "octo")).toBe(false)
    })
    it("false on malformed metadata json", () => {
        expect(octoPluginInstalled("not json", "octo")).toBe(false)
    })
    it("false when component is empty", () => {
        const meta = JSON.stringify({ plugins: [{ name: "octo", version: "0.7.0" }] })
        expect(octoPluginInstalled(meta, "")).toBe(false)
    })
})

describe("canInstallCcPlugin", () => {
    it("claude with no cc-octo plugin -> true", () => {
        expect(canInstallCcPlugin("claude", false)).toBe(true)
    })
    it("claude with cc-octo already installed -> false", () => {
        expect(canInstallCcPlugin("claude", true)).toBe(false)
    })
    it("openclaw is out of cc scope -> false", () => {
        expect(canInstallCcPlugin("openclaw", false)).toBe(false)
    })
    it("unknown provider -> false", () => {
        expect(canInstallCcPlugin("codex", false)).toBe(false)
    })
})
