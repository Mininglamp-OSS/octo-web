import { describe, expect, it } from "vitest"
import { formatDraftPreview } from "../draftPreview"

describe("formatDraftPreview", () => {
    it("renders member mention placeholders as display labels", () => {
        expect(formatDraftPreview("hello @[u_123:沈鑫] see this")).toBe("hello @沈鑫 see this")
    })

    it("renders broadcast mention sentinels as localized labels", () => {
        expect(formatDraftPreview("@[-1:所有人] @[-2:所有人] @[-3:所有AI]")).toBe("@所有人 @所有人 @所有AI")
    })

    it("leaves malformed placeholders unchanged", () => {
        expect(formatDraftPreview("hello @[u_123]")).toBe("hello @[u_123]")
    })

    it("continues after malformed placeholders", () => {
        expect(formatDraftPreview("hello @[u_123] and @[u_456:李雷]")).toBe("hello @[u_123] and @李雷")
    })

    it("handles adversarial unfinished placeholders in linear time", () => {
        const draft = `${"@[9".repeat(1000)} done`

        expect(formatDraftPreview(draft)).toBe(draft)
    })
})
