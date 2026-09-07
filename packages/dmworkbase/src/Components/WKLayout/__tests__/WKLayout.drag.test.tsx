// @vitest-environment jsdom

import React from "react"
import ReactDOM from "react-dom"
import { act } from "react-dom/test-utils"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { WKLayout } from "../index"

let container: HTMLDivElement

beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
})

afterEach(() => {
    act(() => {
        ReactDOM.unmountComponentAtNode(container)
    })
    container.remove()
    localStorage.clear()
})

const renderLayout = (element: React.ReactElement) => {
    act(() => {
        ReactDOM.render(element, container)
    })
}

describe("WKLayout NavRail drag", () => {
    it("removes the NavRail and its splitter in embedded mode", () => {
        renderLayout(
            <WKLayout
                embedded
                onRenderTab={() => <nav>Navigation</nav>}
                contentLeft={<div>Conversation list</div>}
                contentRight={<div>Conversation</div>}
            />,
        )

        expect(container.querySelector(".wk-layout-tab")).toBeNull()
        expect(container.querySelector(".wk-layout-nav-splitter")).toBeNull()
        expect(container.querySelector(".wk-layout-content")).not.toBeNull()
    })

    it("expands the NavRail when its splitter is dragged to the right", () => {
        renderLayout(
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

        act(() => {
            splitter!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: 56 }))
            document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 57 }))
            document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }))
        })

        expect(navRail?.style.width).toBe("180px")
        expect(navRail?.classList.contains("wk-layout-tab-expanded")).toBe(true)
    })
})
