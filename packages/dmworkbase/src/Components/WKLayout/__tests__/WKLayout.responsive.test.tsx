// @vitest-environment jsdom

import React from "react"
import ReactDOM from "react-dom"
import { act } from "react-dom/test-utils"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { WKLayout, WKLayoutProps } from "../index"
import { WKViewQueueContext } from "../../WKViewQueue"

let container: HTMLDivElement
let rightContext: WKViewQueueContext | null = null

// The component reads clientWidth off mounted nodes; jsdom returns 0 everywhere.
// We expose a mutable width through HTMLElement.prototype and restore it after
// each test. Both the shell (.wk-layout) and the content panel report the same
// width, which is enough to drive single/split selection.
let fakeClientWidth = 1200
const originalClientWidth = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "clientWidth",
)

// WKLayout wires ResizeObserver in componentDidMount; real jsdom does not
// implement it. Provide a fake so the shell RO path can be driven inline.
type FakeResizeHandler = (entries: unknown[]) => void
class FakeResizeObserver {
    static instances: FakeResizeObserver[] = []
    observed: Element[] = []
    disconnectCount = 0
    private callback: FakeResizeHandler

    constructor(callback: FakeResizeHandler) {
        this.callback = callback
        FakeResizeObserver.instances.push(this)
    }

    observe(target: Element) {
        this.observed.push(target)
    }

    unobserve() {
        // no-op
    }

    disconnect() {
        this.disconnectCount += 1
        this.observed = []
    }

    trigger() {
        this.callback([])
    }
}

const originalResizeObserver = Object.getOwnPropertyDescriptor(
    window,
    "ResizeObserver",
)
const originalRAF = window.requestAnimationFrame
const originalCancelRAF = window.cancelAnimationFrame

beforeEach(() => {
    fakeClientWidth = 1200
    rightContext = null
    FakeResizeObserver.instances = []

    container = document.createElement("div")
    document.body.appendChild(container)

    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
        configurable: true,
        get: () => fakeClientWidth,
    })
    Object.defineProperty(window, "ResizeObserver", {
        configurable: true,
        value: FakeResizeObserver,
    })
    // Run scheduled container resizes synchronously so expectations are
    // deterministic inside a single act() block.
    window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
        cb(0)
        return 0
    }) as typeof window.requestAnimationFrame
    window.cancelAnimationFrame = (() => {}) as typeof window.cancelAnimationFrame
})

afterEach(() => {
    act(() => {
        ReactDOM.unmountComponentAtNode(container)
    })
    container.remove()

    if (originalClientWidth) {
        Object.defineProperty(HTMLElement.prototype, "clientWidth", originalClientWidth)
    } else {
        Reflect.deleteProperty(HTMLElement.prototype, "clientWidth")
    }
    if (originalResizeObserver) {
        Object.defineProperty(window, "ResizeObserver", originalResizeObserver)
    } else {
        Reflect.deleteProperty(window, "ResizeObserver")
    }
    window.requestAnimationFrame = originalRAF
    window.cancelAnimationFrame = originalCancelRAF
})

const baseProps: WKLayoutProps = {
    contentLeft: <div>List</div>,
    contentRight: <div>Detail</div>,
    onRightContext: (context) => {
        rightContext = context
    },
}

const mount = (props: Partial<WKLayoutProps> = {}) => {
    act(() => {
        ReactDOM.render(
            <WKLayout {...baseProps} {...props} />,
            container,
        )
    })
}

const rerender = (props: Partial<WKLayoutProps> = {}) => {
    act(() => {
        ReactDOM.render(
            <WKLayout {...baseProps} {...props} />,
            container,
        )
    })
}

const contentEl = () => container.querySelector<HTMLElement>(".wk-layout-content")
const leftEl = () => container.querySelector<HTMLElement>(".wk-layout-content-left")
const openDetail = () => {
    act(() => {
        rightContext!.push(<div>Detail page</div>)
    })
}

describe("WKLayout adaptive single-page behavior", () => {
    it.each([
        { contentMinWidth: undefined, width: 1200, renders: 1 },
        { contentMinWidth: 400, width: 1200, renders: 1 },
        { contentMinWidth: undefined, width: 500, renders: 2 },
        { contentMinWidth: 400, width: 500, renders: 2 },
    ])("renders only when mount measurement changes: $contentMinWidth/$width", ({ contentMinWidth, width, renders }) => {
        fakeClientWidth = width
        const render = vi.spyOn(WKLayout.prototype, "render")
        try {
            mount({ contentMinWidth })
            expect(render).toHaveBeenCalledTimes(renders)
        } finally {
            render.mockRestore()
        }
    })

    it("treats contentMinWidth as optional and preserves legacy layout when omitted", () => {
        fakeClientWidth = 500
        mount()

        expect(contentEl()?.getAttribute("data-layout-mode")).toBeNull()
        // Legacy behavior: the left panel keeps its clamped px width, no 100%
        // backing-page override, and no hidden/inert treatment.
        expect(leftEl()?.style.width).toBe("225px")
        expect(leftEl()?.getAttribute("aria-hidden")).toBeNull()
        expect(leftEl()?.hasAttribute("inert")).toBe(false)
    })

    it("selects single or split from the initial mounted container width", () => {
        fakeClientWidth = 500
        mount({ contentMinWidth: 400 })
        expect(contentEl()?.getAttribute("data-layout-mode")).toBe("single")
        expect(leftEl()?.style.width).toBe("100%")

        act(() => {
            ReactDOM.unmountComponentAtNode(container)
        })
        fakeClientWidth = 1200
        mount({ contentMinWidth: 400 })
        expect(contentEl()?.getAttribute("data-layout-mode")).toBe("split")
        expect(leftEl()?.style.width).toBe("300px")
    })

    it("re-resizes through the shell ResizeObserver without firing a window resize", () => {
        let windowResizeFired = false
        const onResize = () => {
            windowResizeFired = true
        }

        fakeClientWidth = 500
        mount({ contentMinWidth: 400 })
        window.addEventListener("resize", onResize)
        openDetail()

        expect(contentEl()?.getAttribute("data-layout-mode")).toBe("single")

        fakeClientWidth = 1200
        act(() => {
            FakeResizeObserver.instances[0].trigger()
        })

        expect(windowResizeFired).toBe(false)
        expect(contentEl()?.getAttribute("data-layout-mode")).toBe("split")
        window.removeEventListener("resize", onResize)
    })

    it("hides and inerts the list in single mode with detail open, then unhides on split", () => {
        fakeClientWidth = 500
        mount({ contentMinWidth: 400 })
        openDetail()

        expect(contentEl()?.getAttribute("data-layout-mode")).toBe("single")
        expect(leftEl()?.getAttribute("aria-hidden")).toBe("true")
        expect(leftEl()?.hasAttribute("inert")).toBe(true)

        fakeClientWidth = 1200
        act(() => {
            FakeResizeObserver.instances[0].trigger()
        })

        expect(contentEl()?.getAttribute("data-layout-mode")).toBe("split")
        expect(leftEl()?.getAttribute("aria-hidden")).toBeNull()
        expect(leftEl()?.hasAttribute("inert")).toBe(false)
    })

    it("leaves legacy behavior when the contentMinWidth prop is removed", () => {
        fakeClientWidth = 500
        mount({ contentMinWidth: 400 })
        openDetail()
        expect(contentEl()?.getAttribute("data-layout-mode")).toBe("single")
        expect(leftEl()?.getAttribute("aria-hidden")).toBe("true")

        rerender({ contentMinWidth: undefined })

        expect(contentEl()?.getAttribute("data-layout-mode")).toBeNull()
        expect(leftEl()?.getAttribute("aria-hidden")).toBeNull()
        expect(leftEl()?.hasAttribute("inert")).toBe(false)
    })

    it("disconnects the container ResizeObserver on unmount", () => {
        fakeClientWidth = 1200
        mount({ contentMinWidth: 400 })
        const instance = FakeResizeObserver.instances[0]

        expect(instance.disconnectCount).toBe(0)
        act(() => {
            ReactDOM.unmountComponentAtNode(container)
        })
        expect(instance.disconnectCount).toBe(1)
    })
})
