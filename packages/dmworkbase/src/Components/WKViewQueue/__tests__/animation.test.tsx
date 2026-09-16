// @vitest-environment jsdom

import React from "react"
import ReactDOM from "react-dom"
import { act, Simulate } from "react-dom/test-utils"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import WKViewQueue, { WKViewQueueContext } from "../index"

let container: HTMLDivElement
let context: WKViewQueueContext | null = null

beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    context = null
})

afterEach(() => {
    act(() => {
        ReactDOM.unmountComponentAtNode(container)
    })
    container.remove()
})

function renderQueue(children: React.ReactNode, animateFirstRoute = false) {
    act(() => {
        ReactDOM.render(
            <WKViewQueue animateFirstRoute={animateFirstRoute} onContext={(c) => { context = c }}>
                {children}
            </WKViewQueue>,
            container,
        )
    })
}

describe("WKViewQueue animation guard", () => {
    it("animates first detail entry only when the layout opts in", () => {
        renderQueue(<div>Root</div>, true)
        act(() => {
            context!.replaceToRoot(<div>First detail</div>)
        })
        expect(container.querySelector(".wk-viewqueue-view-in")).not.toBeNull()
        expect(context!.viewCount()).toBe(1)
        act(() => {
            Simulate.animationEnd(container.querySelector("#wk-viewqueue-view-last")!)
            context!.replaceToRoot(<div>Another detail</div>)
        })
        expect(container.querySelector(".wk-viewqueue-view-in")).toBeNull()
        expect(context!.viewCount()).toBe(1)
    })

    it("keeps legacy root replacement immediate", () => {
        renderQueue(<div>Root</div>)
        act(() => {
            context!.replaceToRoot(<div>Detail</div>)
        })
        expect(container.querySelector(".wk-viewqueue-view-in")).toBeNull()
        expect(context!.viewCount()).toBe(1)
    })

    it("ignores an animationend bubbling from a child", () => {
        renderQueue(<div data-testid="root-view">Root</div>)
        act(() => {
            context!.push(<div data-testid="pushed-view">Pushed</div>)
        })
        expect(container.querySelectorAll(".wk-viewqueue-view").length).toBe(2)

        act(() => {
            context!.pop()
        })
        expect(container.querySelectorAll(".wk-viewqueue-view").length).toBe(2)

        const child = container.querySelector('[data-testid="pushed-view"]')!
        act(() => {
            Simulate.animationEnd(child)
        })

        expect(container.querySelectorAll(".wk-viewqueue-view").length).toBe(2)
        expect(container.querySelector(".wk-viewqueue-view-out")).not.toBeNull()
    })

    it("pops exactly once when the last view's own animationend fires", () => {
        renderQueue(<div data-testid="root-view">Root</div>)
        act(() => {
            context!.push(<div data-testid="pushed-view">Pushed</div>)
            context!.push(<div data-testid="pushed-view-2">Pushed 2</div>)
        })
        expect(container.querySelectorAll(".wk-viewqueue-view").length).toBe(3)

        act(() => {
            context!.pop()
        })
        expect(container.querySelectorAll(".wk-viewqueue-view").length).toBe(3)

        const lastView = container.querySelector("#wk-viewqueue-view-last")!
        act(() => {
            Simulate.animationEnd(lastView)
        })
        expect(container.querySelectorAll(".wk-viewqueue-view").length).toBe(2)
        expect(context!.viewCount()).toBe(1)
    })

    it("does not double-pop on repeated animationend", () => {
        renderQueue(<div data-testid="root-view">Root</div>)
        act(() => {
            context!.push(<div data-testid="pushed-view">Pushed</div>)
            context!.push(<div data-testid="pushed-view-2">Pushed 2</div>)
        })

        act(() => {
            context!.pop()
        })

        const lastView = container.querySelector("#wk-viewqueue-view-last")!
        act(() => {
            Simulate.animationEnd(lastView)
        })
        expect(context!.viewCount()).toBe(1)

        // A subsequent event on the remaining view must not pop another entry.
        act(() => {
            Simulate.animationEnd(container.querySelector("#wk-viewqueue-view-last")!)
        })
        expect(context!.viewCount()).toBe(1)
    })
})
