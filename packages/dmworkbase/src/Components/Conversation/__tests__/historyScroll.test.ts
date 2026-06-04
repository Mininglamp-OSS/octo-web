import { describe, expect, it } from "vitest"
import {
    getPulldownRestoredScrollTop,
    getRestoredAnchorScrollTop,
    getScrollAnchorOffsetY,
    shouldPulldownOnWheel,
    TOP_HISTORY_TRIGGER_OFFSET,
} from "../historyScroll"

describe("getPulldownRestoredScrollTop", () => {
    it("keeps the visible anchor stable by restoring the scroll height delta", () => {
        expect(getPulldownRestoredScrollTop({
            previousScrollHeight: 1200,
            previousScrollTop: 180,
            nextScrollHeight: 1560,
        })).toBe(540)
    })

    it("never restores to a negative scrollTop", () => {
        expect(getPulldownRestoredScrollTop({
            previousScrollHeight: 1200,
            previousScrollTop: 0,
            nextScrollHeight: 1000,
        })).toBe(0)
    })
})

describe("message anchor scroll restore", () => {
    it("stores the viewport offset from the first visible message anchor", () => {
        expect(getScrollAnchorOffsetY({
            scrollTop: 260,
            anchorOffsetTop: 220,
        })).toBe(40)
    })

    it("does not store a negative anchor offset", () => {
        expect(getScrollAnchorOffsetY({
            scrollTop: 180,
            anchorOffsetTop: 220,
        })).toBe(0)
    })

    it("restores scrollTop from the message anchor and stored offset", () => {
        expect(getRestoredAnchorScrollTop({
            anchorOffsetTop: 500,
            keepOffsetY: 35,
        })).toBe(535)
    })
})

describe("shouldPulldownOnWheel", () => {
    it("triggers pulldown when content is not full screen", () => {
        expect(shouldPulldownOnWheel(-12, 600, false)).toBe(true)
    })

    it("triggers pulldown near the top even when content is full screen", () => {
        expect(shouldPulldownOnWheel(-12, TOP_HISTORY_TRIGGER_OFFSET, true)).toBe(true)
    })

    it("does not trigger pulldown away from the top in a full screen list", () => {
        expect(shouldPulldownOnWheel(-12, TOP_HISTORY_TRIGGER_OFFSET + 1, true)).toBe(false)
    })

    it("does not trigger pulldown on downward wheel movement", () => {
        expect(shouldPulldownOnWheel(12, 0, false)).toBe(false)
    })
})
