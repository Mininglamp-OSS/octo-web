import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { app, handlers } = vi.hoisted(() => {
    const handlers = new Set<(event: { menuId?: string }) => void>()
    return {
        handlers,
        app: {
            currentMenuId: "chat",
            mittBus: {
                on: (_: string, handler: (event: { menuId?: string }) => void) => handlers.add(handler),
                off: (_: string, handler: (event: { menuId?: string }) => void) => handlers.delete(handler),
            },
        },
    }
})
vi.mock("../../App", () => ({ default: app }))

import { subscribePageActivation } from "../pageActivation"

function activate(menuId: string) {
    app.currentMenuId = menuId
    handlers.forEach(handler => handler({ menuId }))
}

describe("retained page activation", () => {
    let off: (() => void) | undefined
    beforeEach(() => {
        app.currentMenuId = "chat"
        delete document.documentElement.dataset.hostVisibility
        vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible")
    })
    afterEach(() => {
        off?.()
        vi.restoreAllMocks()
    })

    it("refreshes only the active page on host resume and coalesces visibility notifications", async () => {
        const refresh = vi.fn()
        off = subscribePageActivation("chat", refresh)
        window.dispatchEvent(new Event("octobuddy:resume"))
        document.dispatchEvent(new Event("visibilitychange"))
        await Promise.resolve()
        expect(refresh).toHaveBeenCalledTimes(1)
        activate("contacts")
        window.dispatchEvent(new Event("octobuddy:resume"))
        await Promise.resolve()
        expect(refresh).toHaveBeenCalledTimes(1)
    })

    it("refreshes on menu return without resume, not on navigation within the same menu", async () => {
        const refresh = vi.fn()
        off = subscribePageActivation("chat", refresh)
        activate("chat")
        await Promise.resolve()
        expect(refresh).not.toHaveBeenCalled()
        activate("contacts")
        activate("chat")
        await Promise.resolve()
        expect(refresh).toHaveBeenCalledTimes(1)
    })

    it("honors host resume before the browser visibility state catches up", async () => {
        const refresh = vi.fn()
        off = subscribePageActivation("chat", refresh)
        vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden")
        document.dispatchEvent(new Event("visibilitychange"))
        await Promise.resolve()
        expect(refresh).not.toHaveBeenCalled()
        window.dispatchEvent(new Event("octobuddy:resume"))
        await Promise.resolve()
        expect(refresh).toHaveBeenCalledTimes(1)
    })

    it("waits for resume when a hidden host navigates and drops queued work after leaving", async () => {
        const refresh = vi.fn()
        off = subscribePageActivation("contacts", refresh)
        document.documentElement.dataset.hostVisibility = "hidden"
        activate("contacts")
        await Promise.resolve()
        expect(refresh).not.toHaveBeenCalled()
        document.documentElement.dataset.hostVisibility = "visible"
        window.dispatchEvent(new Event("octobuddy:resume"))
        await Promise.resolve()
        expect(refresh).toHaveBeenCalledTimes(1)
        window.dispatchEvent(new Event("octobuddy:resume"))
        activate("chat")
        await Promise.resolve()
        expect(refresh).toHaveBeenCalledTimes(1)
    })

    it("unsubscribes all listeners and cancels queued refreshes", async () => {
        const refresh = vi.fn()
        off = subscribePageActivation("chat", refresh)
        window.dispatchEvent(new Event("octobuddy:resume"))
        off()
        await Promise.resolve()
        window.dispatchEvent(new Event("octobuddy:resume"))
        activate("contacts")
        activate("chat")
        document.dispatchEvent(new Event("visibilitychange"))
        await Promise.resolve()
        expect(refresh).not.toHaveBeenCalled()
        expect(handlers.size).toBe(0)
    })
})
