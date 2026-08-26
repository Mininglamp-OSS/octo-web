import React from "react"
import { cleanup, fireEvent, render } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { WKLayout } from "../index"

afterEach(() => {
    cleanup()
    localStorage.clear()
})

describe("WKLayout NavRail drag", () => {
    it("expands the NavRail when its splitter is dragged to the right", () => {
        const { container } = render(
            <WKLayout
                onRenderTab={() => <nav>Navigation</nav>}
                contentLeft={<div>Conversation list</div>}
                contentRight={<div>Conversation</div>}
            />,
        )

        const splitter = container.querySelector<HTMLElement>(".wk-layout-nav-splitter")
        const navRail = container.querySelector<HTMLElement>(".wk-layout-tab")

        expect(splitter).not.toBeNull()
        expect(navRail?.style.width).toBe("56px")

        fireEvent.mouseDown(splitter!, { clientX: 56 })
        fireEvent.mouseMove(document, { clientX: 57 })
        fireEvent.mouseUp(document)

        expect(navRail?.style.width).toBe("180px")
        expect(navRail?.classList.contains("wk-layout-tab-expanded")).toBe(true)
    })
})
