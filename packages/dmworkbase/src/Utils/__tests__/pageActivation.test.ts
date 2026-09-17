import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { PageActivationApp } from "../pageActivation"
import { subscribePageActivation } from "../pageActivation"

type TestApp = PageActivationApp & { handlers: Set<(event: { menuId?: string }) => void> }

function stubApp(menuId: string): TestApp {
    const handlers = new Set<(event: { menuId?: string }) => void>()
    return {
        currentMenuId: menuId,
        mittBus: {
            on: (_: string, handler: (event: { menuId?: string }) => void) => handlers.add(handler),
            off: (_: string, handler: (event: { menuId?: string }) => void) => handlers.delete(handler),
        },
        handlers,
    }
}

function activate(app: TestApp, menuId: string) {
    app.currentMenuId = menuId
    app.handlers.forEach(handler => handler({ menuId }))
}

describe("retained page activation", () => {
    let app: TestApp
    let off: (() => void) | undefined

    beforeEach(() => {
        vi.useFakeTimers({ shouldAdvanceTime: false })
        app = stubApp("chat")
        delete document.documentElement.dataset.hostVisibility
        Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true })
    })

    afterEach(() => {
        off?.()
        vi.useRealTimers()
        vi.restoreAllMocks()
    })

    it("refreshes only the active page on host resume and coalesces visibility notifications", async () => {
        const refresh = vi.fn()
        off = subscribePageActivation("chat", refresh, app)
        window.dispatchEvent(new Event("octobuddy:resume"))
        document.dispatchEvent(new Event("visibilitychange"))
        await vi.runAllTimersAsync()
        expect(refresh).toHaveBeenCalledTimes(1)
        activate(app, "contacts")
        window.dispatchEvent(new Event("octobuddy:resume"))
        await vi.runAllTimersAsync()
        expect(refresh).toHaveBeenCalledTimes(1)
    })

    it("refreshes on menu return without resume, not on navigation within the same menu", async () => {
        const refresh = vi.fn()
        off = subscribePageActivation("chat", refresh, app)
        activate(app, "chat")
        await vi.runAllTimersAsync()
        expect(refresh).not.toHaveBeenCalled()
        activate(app, "contacts")
        activate(app, "chat")
        await vi.runAllTimersAsync()
        expect(refresh).toHaveBeenCalledTimes(1)
    })

    it("honors host resume before the browser visibility state catches up", async () => {
        const refresh = vi.fn()
        off = subscribePageActivation("chat", refresh, app)
        Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true })
        document.dispatchEvent(new Event("visibilitychange"))
        await vi.runAllTimersAsync()
        expect(refresh).not.toHaveBeenCalled()
        window.dispatchEvent(new Event("octobuddy:resume"))
        await vi.runAllTimersAsync()
        expect(refresh).toHaveBeenCalledTimes(1)
    })

    it("waits for resume when a hidden host navigates and drops queued work after leaving", async () => {
        const refresh = vi.fn()
        off = subscribePageActivation("contacts", refresh, app)
        document.documentElement.dataset.hostVisibility = "hidden"
        activate(app, "contacts")
        await vi.runAllTimersAsync()
        expect(refresh).not.toHaveBeenCalled()
        document.documentElement.dataset.hostVisibility = "visible"
        window.dispatchEvent(new Event("octobuddy:resume"))
        await vi.runAllTimersAsync()
        expect(refresh).toHaveBeenCalledTimes(1)
        window.dispatchEvent(new Event("octobuddy:resume"))
        activate(app, "chat")
        await vi.runAllTimersAsync()
        expect(refresh).toHaveBeenCalledTimes(1)
    })

    it("unsubscribes all listeners and cancels queued refreshes", async () => {
        const refresh = vi.fn()
        off = subscribePageActivation("chat", refresh, app)
        window.dispatchEvent(new Event("octobuddy:resume"))
        off()
        await vi.runAllTimersAsync()
        window.dispatchEvent(new Event("octobuddy:resume"))
        activate(app, "contacts")
        activate(app, "chat")
        document.dispatchEvent(new Event("visibilitychange"))
        await vi.runAllTimersAsync()
        expect(refresh).not.toHaveBeenCalled()
        expect(app.handlers.size).toBe(0)
    })

    it("does not fire when queued work is cancelled by leaving the page", async () => {
        const refresh = vi.fn()
        off = subscribePageActivation("chat", refresh, app)
        document.documentElement.dataset.hostVisibility = "hidden"
        window.dispatchEvent(new Event("octobuddy:resume"))
        expect(refresh).not.toHaveBeenCalled()
        activate(app, "contacts")
        document.documentElement.dataset.hostVisibility = "visible"
        await vi.runAllTimersAsync()
        expect(refresh).not.toHaveBeenCalled()
    })
})
