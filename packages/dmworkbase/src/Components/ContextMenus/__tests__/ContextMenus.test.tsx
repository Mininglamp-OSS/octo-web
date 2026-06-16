/**
 * @vitest-environment jsdom
 */

import React from "react"
import ReactDOM from "react-dom"
import { act } from "react-dom/test-utils"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import ContextMenus, { ContextMenusContext } from "../index"

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
