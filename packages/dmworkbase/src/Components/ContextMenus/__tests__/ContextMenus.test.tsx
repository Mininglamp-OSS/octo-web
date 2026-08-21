/**
 * @vitest-environment jsdom
 */

import React from "react"
import ReactDOM from "react-dom"
import { act } from "react-dom/test-utils"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Star } from "lucide-react"
import ContextMenus, { ContextMenusContext, ContextMenusData } from "../index"

let container: HTMLDivElement
let originalRequestAnimationFrame: typeof requestAnimationFrame | undefined
let originalCancelAnimationFrame: typeof cancelAnimationFrame | undefined

beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    originalRequestAnimationFrame = globalThis.requestAnimationFrame
    originalCancelAnimationFrame = globalThis.cancelAnimationFrame

    const runFrame = (callback: FrameRequestCallback) => {
        callback(0)
        return 1
    }
    const cancelFrame = vi.fn()
    Object.defineProperty(globalThis, "requestAnimationFrame", {
        configurable: true,
        value: runFrame,
    })
    Object.defineProperty(window, "requestAnimationFrame", {
        configurable: true,
        value: runFrame,
    })
    Object.defineProperty(globalThis, "cancelAnimationFrame", {
        configurable: true,
        value: cancelFrame,
    })
    Object.defineProperty(window, "cancelAnimationFrame", {
        configurable: true,
        value: cancelFrame,
    })
})

afterEach(() => {
    act(() => {
        ReactDOM.unmountComponentAtNode(container)
    })
    container.remove()

    restoreAnimationFrame("requestAnimationFrame", originalRequestAnimationFrame)
    restoreAnimationFrame("cancelAnimationFrame", originalCancelAnimationFrame)
})

function restoreAnimationFrame(
    key: "requestAnimationFrame" | "cancelAnimationFrame",
    original: typeof requestAnimationFrame | typeof cancelAnimationFrame | undefined
) {
    if (original) {
        Object.defineProperty(globalThis, key, {
            configurable: true,
            value: original,
        })
        Object.defineProperty(window, key, {
            configurable: true,
            value: original,
        })
    } else {
        delete (globalThis as any)[key]
        delete (window as any)[key]
    }
}

function dispatchContextMenu(element: Element) {
    const event = new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 120,
        clientY: 80,
    })
    act(() => {
        element.dispatchEvent(event)
    })
    return event
}

function renderContextMenus(onHide = vi.fn()) {
    let context: ContextMenusContext | null = null

    act(() => {
        ReactDOM.render(
            <div>
                <button
                    type="button"
                    className="trigger"
                    onContextMenu={(event) => context?.show(event)}
                >
                    open
                </button>
                <ContextMenus
                    onContext={(nextContext) => {
                        context = nextContext
                    }}
                    onHide={onHide}
                    menus={[{ title: "Copy", onClick: vi.fn() }]}
                />
            </div>,
            container
        )
    })

    const trigger = container.querySelector(".trigger")!
    const openEvent = dispatchContextMenu(trigger)
    expect(openEvent.defaultPrevented).toBe(true)
    expect(context?.isShow()).toBe(true)

    return { context, onHide }
}

describe("ContextMenus native contextmenu suppression", () => {
    it("closes the open menu and suppresses the browser menu on mask right-click", () => {
        const { context, onHide } = renderContextMenus()
        const mask = container.querySelector(".wk-contextmenus-mask")!

        const event = dispatchContextMenu(mask)

        expect(event.defaultPrevented).toBe(true)
        expect(context?.isShow()).toBe(false)
        expect(onHide).toHaveBeenCalledTimes(1)
    })

    it("suppresses the browser menu on the custom menu without hiding it", () => {
        const { context, onHide } = renderContextMenus()
        const menu = container.querySelector(".wk-contextmenus")!

        const event = dispatchContextMenu(menu)

        expect(event.defaultPrevented).toBe(true)
        expect(context?.isShow()).toBe(true)
        expect(onHide).not.toHaveBeenCalled()
    })

    it("guards document-level contextmenu events only while a menu is open", () => {
        const { context } = renderContextMenus()

        const guardedEvent = dispatchContextMenu(document.body)

        expect(guardedEvent.defaultPrevented).toBe(true)
        expect(context?.isShow()).toBe(true)

        act(() => {
            context?.hide()
        })

        const unguardedEvent = dispatchContextMenu(document.body)
        expect(unguardedEvent.defaultPrevented).toBe(false)
    })
})

describe("ContextMenus rounded hover boundaries", () => {
    it("keeps the first and last menu items selectable around separators at every level", () => {
        act(() => {
            ReactDOM.render(
                <ContextMenus
                    onContext={() => undefined}
                    menus={[
                        { separator: true } as ContextMenusData,
                        {
                            title: "Move to",
                            children: [
                                { separator: true } as ContextMenusData,
                                { title: "First group" },
                                { title: "Last group" },
                                { separator: true } as ContextMenusData,
                            ],
                        },
                        { title: "Delete" },
                        { separator: true } as ContextMenusData,
                    ]}
                />,
                container
            )
        })

        const rootMenu = container.querySelector(".wk-contextmenus [role='menu']")!
        const submenu = container.querySelector(".wk-ctx-submenu")!
        const rootItems = rootMenu.querySelectorAll(":scope > .wk-ctx-item > button")
        const submenuItems = submenu.querySelectorAll("button")

        expect(rootItems[0]?.textContent).toContain("Move to")
        expect(rootItems[rootItems.length - 1]?.textContent).toBe("Delete")
        expect(submenuItems[0]?.textContent).toBe("First group")
        expect(submenuItems[submenuItems.length - 1]?.textContent).toBe("Last group")
    })
})

describe("ContextMenus Lucide icons", () => {
    it("renders a Lucide component without changing the existing menu structure", () => {
        act(() => {
            ReactDOM.render(
                <ContextMenus
                    onContext={() => undefined}
                    menus={[{ title: "Follow", icon: Star }]}
                />,
                container
            )
        })

        expect(container.querySelector(".wk-contextmenus li .lucide-star.ctx-icon")).not.toBeNull()
        expect(container.querySelector(".wk-contextmenus li")?.textContent).toBe("Follow")
    })
})
