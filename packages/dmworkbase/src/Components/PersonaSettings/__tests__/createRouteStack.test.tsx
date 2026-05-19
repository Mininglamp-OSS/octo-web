/**
 * PR-C / YUJ-1348 route stack regression test.
 *
 * Blocking review (Jerry-Xin on 8145f420, 2026-05-19 16:34Z) flagged that the
 * successful create flow used `routeContext.pop()` followed by
 * `routeContext.push(<PersonaEdit/>)` in the same tick. Both `RoutePage.pop`
 * and `WKViewQueue.pop` enqueue async state and leave the queue populated until
 * the pop animation ends; the same-tick `push` then reads stale
 * `this.state.pushViewCount` and appends the new view onto the still-present
 * queue. Net effect: the stack becomes
 *
 *     list → create → edit
 *
 * instead of the intended
 *
 *     list → edit
 *
 * so tapping back from edit re-reveals the create picker.
 *
 * Fix: a new `RouteContext.replace(view)` API (and matching
 * `WKViewQueue.replace`) that swaps the top entry in a single setState. This
 * test pins the contract two ways:
 *
 *   1. `WKViewQueue.replace` keeps `queues.length` the same when called after
 *      `push`, never grows the stack the way a same-tick pop+push would.
 *   2. `RoutePage.replace` keeps `pushViewCount` the same and only swaps the
 *      top `routeConfigs` entry, and delegates the view swap to its
 *      `viewQueueContext.replace`.
 *
 * We deliberately don't use `@testing-library/react` here because the repo
 * currently bundles testing-library@14 which expects `react-dom/client` —
 * that subpath does not exist on React 17. (Pre-existing infra debt, not in
 * scope for this PR.) ReactDOM legacy render + `act` works fine on React 17
 * and is enough to mount these primitives and assert their state machine.
 */

import React from "react"
import ReactDOM from "react-dom"
import { act } from "react-dom/test-utils"
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"

// `RoutePage` transitively pulls in WKViewQueueHeader → WKApp → the full app
// shell (lottie, semi theme, etc.), which jsdom can't render. Stub both the
// header and Semi UI down to the primitives our test actually needs. The
// header is rendered inside RoutePage's tree but doesn't participate in the
// route-stack logic we're testing here.
vi.mock("../../WKViewQueueHeader", () => ({
    default: () => null,
}))
vi.mock("../../../App", () => ({
    default: { shared: { themeMode: "light" } },
    ThemeMode: { light: "light", dark: "dark" },
    __esModule: true,
}))
vi.mock("@douyinfe/semi-ui", () => ({
    Button: (props: any) =>
        React.createElement("button", { ...props }, props.children),
}))

import WKViewQueue, { WKViewQueueContext } from "../../WKViewQueue"
import RoutePage from "../../RoutePage"
import type RouteContext from "../../../Service/Context"

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
})

describe("WKViewQueue.replace — YUJ-1348", () => {
    it("swaps the top view without growing queues.length", async () => {
        let ctx: WKViewQueueContext | undefined
        await act(async () => {
            ReactDOM.render(
                <WKViewQueue
                    onContext={(c) => {
                        ctx = c
                    }}
                >
                    <div data-testid="root">root</div>
                </WKViewQueue>,
                container,
            )
        })
        expect(ctx).toBeDefined()
        expect(ctx!.viewCount()).toBe(0)

        // Push view A — viewCount goes 0 -> 1
        await act(async () => {
            ctx!.push(<div data-testid="a">A</div>)
        })
        expect(ctx!.viewCount()).toBe(1)
        expect(container.querySelector('[data-testid="a"]')).toBeTruthy()

        // Replace top with view B — viewCount must STAY at 1, not bump to 2.
        // This is the exact contract that fixes the pop+push race.
        await act(async () => {
            ctx!.replace(<div data-testid="b">B</div>)
        })
        expect(ctx!.viewCount()).toBe(1)
        expect(container.querySelector('[data-testid="b"]')).toBeTruthy()
        expect(container.querySelector('[data-testid="a"]')).toBeNull()
    })

    it("on empty queue, replace degrades to push (viewCount goes 0 -> 1)", async () => {
        let ctx: WKViewQueueContext | undefined
        await act(async () => {
            ReactDOM.render(
                <WKViewQueue onContext={(c) => (ctx = c)}>
                    <div data-testid="root">root</div>
                </WKViewQueue>,
                container,
            )
        })
        expect(ctx!.viewCount()).toBe(0)
        await act(async () => {
            ctx!.replace(<div data-testid="x">X</div>)
        })
        expect(ctx!.viewCount()).toBe(1)
        expect(container.querySelector('[data-testid="x"]')).toBeTruthy()
    })
})

describe("RoutePage.replace — YUJ-1348", () => {
    it("after push + replace, the route stack has exactly one entry above root (not two)", async () => {
        let ctx: RouteContext<any> | undefined
        await act(async () => {
            ReactDOM.render(
                <RoutePage
                    title="root"
                    render={(c) => {
                        ctx = c
                        return <div data-testid="root">root</div>
                    }}
                />,
                container,
            )
        })
        expect(ctx).toBeDefined()

        // Push A — depth becomes 1 (root + A).
        await act(async () => {
            ctx!.push(<div data-testid="a">A</div>)
        })
        // RoutePage's internal pushViewCount is the authoritative depth marker
        // used by header rendering and by `push` itself when computing the next
        // depth. We assert via DOM presence + WKViewQueue route slot count.
        let route = container.querySelector(".wk-viewqueue-route") as HTMLElement
        // children: root slot + queued slots
        expect(route.querySelectorAll(":scope > .wk-viewqueue-view").length - 1).toBe(1)

        // Replace A -> B — depth must STAY at 1 (root + B), NOT become 2.
        // This is exactly the regression: the old `pop() + push()` ended up
        // with depth 2 because the pop's animation-deferred queue removal
        // collided with the same-tick push.
        await act(async () => {
            ctx!.replace(<div data-testid="b">B</div>)
        })
        route = container.querySelector(".wk-viewqueue-route") as HTMLElement
        const queuedSlotsAfter =
            route.querySelectorAll(":scope > .wk-viewqueue-view").length - 1
        expect(queuedSlotsAfter).toBe(1)
        expect(container.querySelector('[data-testid="b"]')).toBeTruthy()
        expect(container.querySelector('[data-testid="a"]')).toBeNull()
    })

    it("replace propagates through to WKViewQueue (not a separate stack)", async () => {
        // Smoke-test that RoutePage.replace doesn't accidentally bypass its
        // viewQueueContext — otherwise the visible DOM would lag the logical
        // stack and we'd be back to the bug.
        let ctx: RouteContext<any> | undefined
        await act(async () => {
            ReactDOM.render(
                <RoutePage
                    title="root"
                    render={(c) => {
                        ctx = c
                        return <div>root</div>
                    }}
                />,
                container,
            )
        })
        await act(async () => {
            ctx!.push(<div data-testid="picker">picker</div>)
        })
        expect(container.querySelector('[data-testid="picker"]')).toBeTruthy()
        await act(async () => {
            ctx!.replace(<div data-testid="editor">editor</div>)
        })
        expect(container.querySelector('[data-testid="picker"]')).toBeNull()
        expect(container.querySelector('[data-testid="editor"]')).toBeTruthy()
    })
})
