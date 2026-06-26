import { describe, it, expect } from "vitest"
import { octoComponentName } from "./octoComponent"

describe("octoComponentName", () => {
    it("maps openclaw to octo", () => {
        expect(octoComponentName("openclaw")).toBe("octo")
    })
    it("maps claude to cc-octo", () => {
        expect(octoComponentName("claude")).toBe("cc-octo")
    })
    it("returns null for an unknown provider", () => {
        expect(octoComponentName("codex")).toBeNull()
        expect(octoComponentName("")).toBeNull()
    })
    it("returns null for octo_daemon — it has no octo adapter plugin", () => {
        // octo_daemon is only a virtual key for CreateRuntimeModal's install guide,
        // never an agent_runtime.provider. The "Octo plugin version" field guard
        // relies on this returning null so a daemon-shaped provider never shows the
        // plugin row (the field guard switched from getInstallGuide to octoComponentName).
        expect(octoComponentName("octo_daemon")).toBeNull()
    })
    it("returns null for prototype-chain keys (no whitelist bypass)", () => {
        expect(octoComponentName("constructor")).toBeNull()
        expect(octoComponentName("toString")).toBeNull()
        expect(octoComponentName("hasOwnProperty")).toBeNull()
    })
})
