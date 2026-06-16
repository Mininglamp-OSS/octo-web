import { describe, expect, it } from "vitest"
import { getMentionRenderState } from "../mentionRenderState"

describe("getMentionRenderState", () => {
    it("renders broadcast mentions like ordinary member mentions without enabling clicks", () => {
        expect(getMentionRenderState("all")).toEqual({
            className: "mention-entity",
            interactive: false,
        })
    })

    it("keeps ordinary member mentions interactive", () => {
        expect(getMentionRenderState("uid_chen")).toEqual({
            className: "mention-entity",
            interactive: true,
        })
    })

    it("keeps channel and fallback mention states distinct", () => {
        expect(getMentionRenderState("channel")).toEqual({
            className: "mention-highlight",
            interactive: false,
        })
        expect(getMentionRenderState("")).toEqual({
            className: "mention-fallback",
            interactive: false,
        })
    })
})
