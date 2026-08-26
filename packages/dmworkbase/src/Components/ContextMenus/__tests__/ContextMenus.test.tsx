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

function renderContextMenus(
    onHide = vi.fn(),
    menus: ContextMenusData[] = [{ title: "Copy", onClick: vi.fn() }],
) {
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
                    menus={menus}
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
    it("clears a previous submenu offset before each open cycle", () => {
        const { context } = renderContextMenus(vi.fn(), [{
            title: "Add to favorites",
            children: [{ title: "Group 1" }],
        }])
        const trigger = container.querySelector(".trigger")!
        const submenu = container.querySelector<HTMLElement>(".wk-ctx-submenu")!
        submenu.style.top = "-320px"

        act(() => {
            context?.hide()
        })
        dispatchContextMenu(trigger)

        expect(submenu.style.top).toBe("")
    })

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

        const rootList = container.querySelector(".wk-contextmenus > ul")!
        const submenu = container.querySelector(".wk-ctx-submenu")!

        expect(rootList.querySelector(":scope > li:first-of-type")?.textContent).toContain("Move to")
        expect(rootList.querySelector(":scope > li:last-of-type")?.textContent).toBe("Delete")
        expect(submenu.querySelector(":scope > .wk-ctx-submenu-list > li:first-of-type")?.textContent).toBe("First group")
        expect(submenu.querySelector(":scope > .wk-ctx-submenu-list > li:last-of-type")?.textContent).toBe("Last group")
    })

    it("keeps a long submenu inside the viewport and makes its list scrollable", () => {
        act(() => {
            ReactDOM.render(
                <ContextMenus
                    onContext={() => undefined}
                    menus={[{
                        title: "Add to favorites",
                        children: Array.from({ length: 30 }, (_, index) => ({ title: `Group ${index + 1}` })),
                    }]}
                />,
                container
            )
        })

        const parentItem = container.querySelector<HTMLElement>(".wk-contextmenus > ul > li")!
        const submenu = container.querySelector<HTMLElement>(".wk-ctx-submenu")!
        const submenuList = container.querySelector<HTMLElement>(".wk-ctx-submenu-list")!
        Object.defineProperty(submenuList, "scrollHeight", { configurable: true, value: 1200 })
        vi.spyOn(parentItem, "getBoundingClientRect").mockReturnValue({
            top: 740,
            bottom: 780,
            left: 0,
            right: 160,
            width: 160,
            height: 40,
            x: 0,
            y: 740,
            toJSON: () => ({}),
        })

        act(() => {
            parentItem.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }))
        })

        expect(submenu.style.top).toBe("-732px")
        expect(submenuList.querySelectorAll(":scope > li")).toHaveLength(30)
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

describe("ContextMenus keyboard navigation", () => {
    it("moves focus, executes the focused action, and restores trigger focus", () => {
        const first = vi.fn()
        const second = vi.fn()
        const { context } = renderContextMenus(vi.fn(), [
            { title: "Reply", actionKey: "reply", onClick: first },
            { separator: true } as ContextMenusData,
            { title: "Copy", actionKey: "copy", onClick: second },
        ])
        const trigger = container.querySelector<HTMLButtonElement>(".trigger")!
        act(() => {
            context?.hide()
            trigger.focus()
        })
        dispatchContextMenu(trigger)

        const items = container.querySelectorAll<HTMLElement>('[role="menuitem"]')
        expect(document.activeElement).toBe(items[0])
        act(() => items[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })))
        expect(document.activeElement).toBe(items[1])
        act(() => items[1].dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })))
        expect(second).toHaveBeenCalledTimes(1)
        expect(document.activeElement).toBe(trigger)
    })

    it("closes on Escape and restores focus", () => {
        const { context } = renderContextMenus()
        const trigger = container.querySelector<HTMLButtonElement>(".trigger")!
        act(() => {
            context?.hide()
            trigger.focus()
        })
        dispatchContextMenu(trigger)
        const item = container.querySelector<HTMLElement>('[role="menuitem"]')!
        act(() => item.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })))
        expect(context?.isShow()).toBe(false)
        expect(document.activeElement).toBe(trigger)
    })

    it("restores the previously focused element after a mouse-opened menu closes", () => {
        const { context } = renderContextMenus()
        const composer = document.createElement("input")
        container.prepend(composer)
        act(() => {
            context?.hide()
            composer.focus()
        })

        dispatchContextMenu(container.querySelector(".trigger")!)
        act(() => context?.hide())

        expect(document.activeElement).toBe(composer)
    })

    it("does not override focus intentionally moved by an executed action", () => {
        const actionTarget = document.createElement("input")
        const { context } = renderContextMenus(vi.fn(), [{
            title: "Reply",
            onClick: () => actionTarget.focus(),
        }])
        container.prepend(actionTarget)
        const trigger = container.querySelector<HTMLButtonElement>(".trigger")!
        act(() => {
            context?.hide()
            trigger.focus()
        })
        dispatchContextMenu(trigger)

        const item = container.querySelector<HTMLElement>('[role="menuitem"]')!
        act(() => item.click())

        expect(document.activeElement).toBe(actionTarget)
    })

    it("keeps the original return target when an open menu is shown again", () => {
        const { context } = renderContextMenus()
        const trigger = container.querySelector<HTMLButtonElement>(".trigger")!
        act(() => {
            context?.hide()
            trigger.focus()
        })
        dispatchContextMenu(trigger)

        act(() => context?.show({
            clientX: 140,
            clientY: 100,
            preventDefault: vi.fn(),
        }))
        act(() => context?.hide())

        expect(document.activeElement).toBe(trigger)
    })
})
