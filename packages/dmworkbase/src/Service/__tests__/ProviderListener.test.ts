/**
 * ProviderListener fan-out subscriber regression test (octo-web#95 / YUJ-1772).
 *
 * Background — bug fixed by this test's companion change:
 *   `PersonaCreate` is a function component pushed into a RoutePage via
 *   `routeContext.push()`. RoutePage stashes the JSX inside `WKViewQueue`'s
 *   own state, so when the parent `<Provider>` re-renders on
 *   `vm.notifyListener()` the pushed view does *not* re-render — it has been
 *   captured by WKViewQueue's state and is only re-rendered when WKViewQueue
 *   itself gets new children, which Provider can't trigger.
 *
 *   `Provider.componentDidMount` claims the *single* `callback` slot on the
 *   VM via `listen()`, so any other view that wanted to observe
 *   `notifyListener()` would either overwrite Provider's callback (breaking
 *   the list page) or be silently ignored.
 *
 *   `addListener(fn)` opens a side-channel: a `Set` of subscribers that
 *   `notifyListener()` fans out to *in addition to* the legacy callback.
 *
 * What this test pins down:
 *   1. `addListener` returns an unsubscribe handle that actually unhooks.
 *   2. `notifyListener()` invokes BOTH the legacy `callback` (set by `listen`)
 *      AND every active subscriber — order independent, but both must fire.
 *   3. A subscriber that throws does not break sibling subscribers or the
 *      legacy callback (so a buggy view can't take down PersonaListBody).
 *   4. `clearListeners()` drops both the callback slot and the subscriber Set,
 *      matching `Provider.componentWillUnmount` semantics.
 *   5. A subscriber that synchronously unsubscribes during fan-out does not
 *      crash iteration (Set-snapshot guarantee).
 */

import { describe, it, expect, vi } from "vitest"
import { ProviderListener } from "../Provider"

describe("ProviderListener.addListener — octo-web#95 fan-out", () => {
    it("fires registered subscribers on notifyListener()", () => {
        const vm = new ProviderListener()
        const sub = vi.fn()
        vm.addListener(sub)
        vm.notifyListener()
        expect(sub).toHaveBeenCalledTimes(1)
    })

    it("fires alongside the legacy listen() callback (does not replace it)", () => {
        const vm = new ProviderListener()
        const legacy = vi.fn()
        const sub = vi.fn()
        vm.listen(legacy)
        vm.addListener(sub)
        vm.notifyListener()
        expect(legacy).toHaveBeenCalledTimes(1)
        expect(sub).toHaveBeenCalledTimes(1)
    })

    it("returns an unsubscribe handle that detaches the subscriber", () => {
        const vm = new ProviderListener()
        const sub = vi.fn()
        const unsubscribe = vm.addListener(sub)
        vm.notifyListener()
        expect(sub).toHaveBeenCalledTimes(1)
        unsubscribe()
        vm.notifyListener()
        // No additional call after unsubscribe.
        expect(sub).toHaveBeenCalledTimes(1)
    })

    it("removeListener also detaches", () => {
        const vm = new ProviderListener()
        const sub = vi.fn()
        vm.addListener(sub)
        vm.removeListener(sub)
        vm.notifyListener()
        expect(sub).not.toHaveBeenCalled()
    })

    it("isolates a throwing subscriber from siblings and from the legacy callback", () => {
        const vm = new ProviderListener()
        const legacy = vi.fn()
        const ok = vi.fn()
        const boom = vi.fn(() => {
            throw new Error("subscriber blew up")
        })
        vm.listen(legacy)
        vm.addListener(boom)
        vm.addListener(ok)

        // Should not throw out of notifyListener.
        expect(() => vm.notifyListener()).not.toThrow()
        expect(legacy).toHaveBeenCalledTimes(1)
        expect(ok).toHaveBeenCalledTimes(1)
        expect(boom).toHaveBeenCalledTimes(1)
    })

    it("clearListeners() drops both the callback and the subscriber Set", () => {
        const vm = new ProviderListener()
        const legacy = vi.fn()
        const sub = vi.fn()
        vm.listen(legacy)
        vm.addListener(sub)
        vm.clearListeners()
        vm.notifyListener()
        expect(legacy).not.toHaveBeenCalled()
        expect(sub).not.toHaveBeenCalled()
    })

    it("tolerates a subscriber that synchronously unsubscribes during fan-out", () => {
        // Snapshot semantics: notifyListener iterates a copy of the Set so a
        // subscriber removing itself (or a sibling) mid-loop doesn't crash.
        const vm = new ProviderListener()
        const order: string[] = []
        const a = (): void => {
            order.push("a")
            vm.removeListener(a)
        }
        const b = (): void => {
            order.push("b")
        }
        vm.addListener(a)
        vm.addListener(b)
        expect(() => vm.notifyListener()).not.toThrow()
        expect(order).toEqual(["a", "b"])

        // a unsubscribed itself; only b should fire next time.
        order.length = 0
        vm.notifyListener()
        expect(order).toEqual(["b"])
    })
})
