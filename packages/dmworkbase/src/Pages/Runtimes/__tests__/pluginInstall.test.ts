import { describe, it, expect } from "vitest"
import { shouldShowCcInstall, canInstallCcPlugin } from "../pluginInstall"

describe("shouldShowCcInstall", () => {
    it("returns false when provider is not claude", () => {
        expect(shouldShowCcInstall("openclaw", false, "1.0.0")).toBe(false)
    })

    it("returns false when cc-octo plugin is already installed", () => {
        expect(shouldShowCcInstall("claude", true, "1.0.0")).toBe(false)
    })

    it("returns false when plugin_install_version is empty string", () => {
        expect(shouldShowCcInstall("claude", false, "")).toBe(false)
    })

    it("returns false when plugin_install_version is undefined", () => {
        expect(shouldShowCcInstall("claude", false, undefined)).toBe(false)
    })

    it("returns true when provider is claude, plugin not installed, and version available", () => {
        expect(shouldShowCcInstall("claude", false, "1.0.0")).toBe(true)
    })

    it("delegates to canInstallCcPlugin for provider check", () => {
        // Verify the helper matches canInstallCcPlugin behavior
        const providers = ["claude", "openclaw", "other"]
        const hasPluginValues = [true, false]
        const versions = ["1.0.0", "", undefined]

        for (const provider of providers) {
            for (const hasPlugin of hasPluginValues) {
                for (const version of versions) {
                    const expected = canInstallCcPlugin(provider, hasPlugin) && !!version
                    expect(shouldShowCcInstall(provider, hasPlugin, version)).toBe(expected)
                }
            }
        }
    })
})
