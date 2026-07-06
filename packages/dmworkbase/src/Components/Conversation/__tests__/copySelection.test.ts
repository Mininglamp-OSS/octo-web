// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * Tests for the copy-selection behavior (Issue #814):
 *
 * When the user right-clicks a message bubble, showContextMenus() captures
 * the current window.getSelection().  The copy handler then uses that cached
 * text if available, falling back to the full message text otherwise.
 *
 * We test the two pieces of logic independently:
 *   1. Selection capture — cacheSelectedTextForBubble()
 *   2. Copy text resolution — resolveCopyText()
 */

// ─── helpers that mirror the production logic ──────────────────────────

/**
 * Mirrors the selection-capture logic in Conversation.showContextMenus().
 * Returns the selected text when the selection is entirely inside the bubble,
 * or null otherwise.
 */
function cacheSelectedTextForBubble(
    selection: Selection | null,
    eventTarget: HTMLElement
): string | null {
    if (!selection || selection.rangeCount === 0 || selection.toString().length === 0) {
        return null
    }
    const range = selection.getRangeAt(0)
    const bubble = eventTarget.closest(".wk-message-base-bubble")
    if (bubble && bubble.contains(range.commonAncestorContainer)) {
        return selection.toString()
    }
    return null
}

/**
 * Mirrors the text-resolution logic in the contextmenus.copy handler.
 */
function resolveCopyText(
    cachedSelectedText: string | null,
    fullMessageText: string
): string {
    return cachedSelectedText || fullMessageText
}

// ─── tests ─────────────────────────────────────────────────────────────

describe("cacheSelectedTextForBubble", () => {
    let bubble: HTMLDivElement
    let innerSpan: HTMLSpanElement
    let outsideDiv: HTMLDivElement

    beforeEach(() => {
        document.body.innerHTML = ""

        bubble = document.createElement("div")
        bubble.className = "wk-message-base-bubble"

        innerSpan = document.createElement("span")
        innerSpan.textContent = "Hello, this is a message"
        bubble.appendChild(innerSpan)

        outsideDiv = document.createElement("div")
        outsideDiv.textContent = "Outside content"

        document.body.appendChild(bubble)
        document.body.appendChild(outsideDiv)
    })

    it("returns null when there is no selection", () => {
        const selection = {
            rangeCount: 0,
            toString: () => "",
            getRangeAt: vi.fn(),
        } as unknown as Selection

        expect(cacheSelectedTextForBubble(selection, innerSpan)).toBeNull()
    })

    it("returns null when selection is null", () => {
        expect(cacheSelectedTextForBubble(null, innerSpan)).toBeNull()
    })

    it("returns selected text when selection is inside the bubble", () => {
        const textNode = innerSpan.firstChild!
        const range = document.createRange()
        range.setStart(textNode, 7)
        range.setEnd(textNode, 11)

        const selection = {
            rangeCount: 1,
            toString: () => "this",
            getRangeAt: () => range,
        } as unknown as Selection

        expect(cacheSelectedTextForBubble(selection, innerSpan)).toBe("this")
    })

    it("returns null when selection is outside the bubble (cross-message fallback)", () => {
        const outsideTextNode = outsideDiv.firstChild!
        const range = document.createRange()
        range.setStart(outsideTextNode, 0)
        range.setEnd(outsideTextNode, 7)

        const selection = {
            rangeCount: 1,
            toString: () => "Outside",
            getRangeAt: () => range,
        } as unknown as Selection

        expect(cacheSelectedTextForBubble(selection, innerSpan)).toBeNull()
    })

    it("returns null when selection spans across the bubble boundary", () => {
        // commonAncestorContainer would be document.body when spanning
        const range = document.createRange()
        range.setStart(innerSpan.firstChild!, 0)
        range.setEnd(outsideDiv.firstChild!, 7)

        const selection = {
            rangeCount: 1,
            toString: () => "Hello, this is a messageOutside",
            getRangeAt: () => range,
        } as unknown as Selection

        expect(cacheSelectedTextForBubble(selection, innerSpan)).toBeNull()
    })

    it("does not trim the selected text", () => {
        const textNode = innerSpan.firstChild!
        const range = document.createRange()
        range.setStart(textNode, 6)
        range.setEnd(textNode, 12)

        const selection = {
            rangeCount: 1,
            toString: () => " this ",
            getRangeAt: () => range,
        } as unknown as Selection

        const result = cacheSelectedTextForBubble(selection, innerSpan)
        expect(result).toBe(" this ")
    })
})

describe("resolveCopyText", () => {
    const fullMessage = "Hello, this is the full message text"

    it("returns full message text when cached selection is null", () => {
        expect(resolveCopyText(null, fullMessage)).toBe(fullMessage)
    })

    it("returns cached selected text when available", () => {
        expect(resolveCopyText("partial", fullMessage)).toBe("partial")
    })

    it("returns full message text when cached selection is empty string", () => {
        // empty string is falsy, so it falls back
        expect(resolveCopyText("", fullMessage)).toBe(fullMessage)
    })

    it("preserves whitespace in selected text (no trim)", () => {
        expect(resolveCopyText("  spaced  ", fullMessage)).toBe("  spaced  ")
    })
})
