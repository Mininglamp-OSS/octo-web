/**
 * PersonaCreate notifyListener fan-out regression (octo-web#95 / YUJ-1772).
 *
 * Bug repro:
 *   - PersonaCreate is pushed via routeContext.push(<PersonaCreate vm={vm} />).
 *   - Provider's setState → re-runs the render prop, but the pushed JSX is
 *     already captured by WKViewQueue's state and is NOT re-created.
 *   - vm.loadMyBots() finishes, sets vm.myBots, calls notifyListener() — but
 *     PersonaCreate has no subscription path, so its DOM stays on
 *     "暂无可关联的 Bot" forever.
 *
 * Fix being verified here: PersonaCreate calls vm.addListener(forceUpdate) in
 * a useEffect, opting back into the VM update stream via the new fan-out
 * channel on ProviderListener (see ../../../Service/Provider.tsx).
 *
 * Why we don't use @testing-library/react:
 *   This monorepo's dmworkbase package is React 17, but the installed RTL
 *   transitively pulls in react-dom@18 (root devDep). Mounting a function
 *   component with hooks via RTL's render() crashes with
 *   "Invalid hook call" — see the same workaround in createRouteStack.test.
 *   We use ReactDOM.render legacy + react-dom/test-utils.act, which targets
 *   the same React 17 instance the component imports and lets useEffect run.
 */

import React from "react"
import ReactDOM from "react-dom"
import { act } from "react-dom/test-utils"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const hoisted = vi.hoisted(() => {
    const get = vi.fn()
    const post = vi.fn()
    const del = vi.fn()
    const put = vi.fn()
    const toastError = vi.fn()
    const toastWarning = vi.fn()
    return { get, post, del, put, toastError, toastWarning }
})

vi.mock("../../../App", () => ({
    default: {
        apiClient: {
            get: hoisted.get,
            post: hoisted.post,
            delete: hoisted.del,
            put: hoisted.put,
        },
        shared: { currentSpaceId: "" },
        // #111 (YUJ-1964): loadMyBots filters my_bots by creator_uid===loginInfo.uid;
        // give a stable uid so mocked bots flagged with creator_uid: "me" pass through.
        loginInfo: { uid: "me" },
    },
    __esModule: true,
}))

vi.mock("@douyinfe/semi-ui", () => ({
    Toast: {
        error: hoisted.toastError,
        warning: hoisted.toastWarning,
    },
    // PersonaCreate uses native <textarea>/<button>; nothing else from Semi
    // is reached on this render path, so a single Toast stub is enough.
}))

import { PersonaCreate, PersonaSettingsVM } from "../index"

let container: HTMLDivElement

beforeEach(() => {
    hoisted.get.mockReset()
    hoisted.post.mockReset()
    hoisted.del.mockReset()
    hoisted.put.mockReset()
    hoisted.toastError.mockReset()
    hoisted.toastWarning.mockReset()
    container = document.createElement("div")
    document.body.appendChild(container)
})

afterEach(() => {
    act(() => {
        ReactDOM.unmountComponentAtNode(container)
    })
    container.remove()
    vi.restoreAllMocks()
})

/**
 * Helper: yield to microtasks so Promise.then/await chains in the VM's
 * loadMyBots resolve, then re-render with `act` so React flushes effects.
 */
const flush = async (): Promise<void> => {
    await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
    })
}

describe("PersonaCreate — notifyListener fan-out (octo-web#95)", () => {
    it("re-renders the bot list once loadMyBots resolves (was stuck on '暂无')", async () => {
        // VM hits /robot/my_bots and /robot/space_bots (leading slash) for the
        // picker, and obo/grants (no leading slash) for the dedupe set. Match
        // both spellings just in case.
        hoisted.get.mockImplementation((url: string) => {
            if (url === "/robot/my_bots" || url === "robot/my_bots") {
                return Promise.resolve([{ uid: "bot-x", name: "Picker Bot X", creator_uid: "me" }])
            }
            if (url === "/robot/space_bots" || url === "robot/space_bots") {
                return Promise.resolve([])
            }
            if (url === "obo/grants") return Promise.resolve([])
            return Promise.resolve([])
        })

        const vm = new PersonaSettingsVM()

        await act(async () => {
            ReactDOM.render(
                <PersonaCreate
                    vm={vm}
                    onCreated={async () => {
                        /* not exercised */
                    }}
                />,
                container,
            )
        })

        // First paint: loadMyBots is in flight → "加载中..." or initial empty.
        // We don't pin the exact label here because both states are valid
        // before the fan-out fires; the contract is that AFTER fan-out the
        // bot row is visible. Pre-fix, that never happened.
        await flush()
        await flush()

        // Bot row must be in the DOM now.
        const row = container.querySelector('[data-testid="persona-create-bot-bot-x"]')
        expect(row).toBeTruthy()
        expect(row?.textContent).toContain("Picker Bot X")
        // The empty-state must be gone.
        expect(container.textContent || "").not.toMatch(/暂无可关联的 Bot/)
    })

    it("clean unsubscribe — VM still functions after PersonaCreate unmounts", async () => {
        hoisted.get.mockImplementation((url: string) => {
            if (url === "/robot/my_bots" || url === "robot/my_bots") {
                return Promise.resolve([])
            }
            if (url === "/robot/space_bots" || url === "robot/space_bots") {
                return Promise.resolve([])
            }
            if (url === "obo/grants") return Promise.resolve([])
            return Promise.resolve([])
        })
        const vm = new PersonaSettingsVM()

        await act(async () => {
            ReactDOM.render(
                <PersonaCreate vm={vm} onCreated={async () => {}} />,
                container,
            )
        })
        await flush()

        // Unmount.
        act(() => {
            ReactDOM.unmountComponentAtNode(container)
        })

        // notifyListener must not throw after the subscriber detaches —
        // the unsubscribe path on useEffect cleanup is the contract that
        // makes this safe even when other Provider listeners are still
        // active.
        expect(() => vm.notifyListener()).not.toThrow()
    })

    it("hides bots that already have a grant (dedupe runs through the rendered tree)", async () => {
        hoisted.get.mockImplementation((url: string) => {
            if (url === "obo/grants") {
                return Promise.resolve([
                    {
                        id: 1,
                        grantor_uid: "me",
                        grantee_bot_uid: "bot-x",
                        grantee_bot_name: "Bot X",
                        mode: "auto",
                        global_enabled: true,
                        active: true,
                    },
                ])
            }
            if (url === "/robot/my_bots" || url === "robot/my_bots") {
                return Promise.resolve([
                    { uid: "bot-x", name: "Bot X", creator_uid: "me" },
                    { uid: "bot-y", name: "Bot Y", creator_uid: "me" },
                ])
            }
            if (url === "/robot/space_bots" || url === "robot/space_bots") {
                return Promise.resolve([])
            }
            return Promise.resolve([])
        })

        const vm = new PersonaSettingsVM()
        // loadGrants must run first so the dedupe set is populated when
        // loadMyBots filters.
        await vm.loadGrants()

        await act(async () => {
            ReactDOM.render(
                <PersonaCreate vm={vm} onCreated={async () => {}} />,
                container,
            )
        })
        await flush()
        await flush()

        // Bot Y is showable; Bot X must be filtered out (already granted).
        expect(
            container.querySelector('[data-testid="persona-create-bot-bot-y"]'),
        ).toBeTruthy()
        expect(
            container.querySelector('[data-testid="persona-create-bot-bot-x"]'),
        ).toBeNull()
    })
})
