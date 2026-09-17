import React from "react"
import { act, cleanup, render, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { CategoryItem } from "../../Service/CategoryService"
import type { SidebarSyncResp } from "../../Service/SidebarService"

const { app, listeners, list, sync, update, memoEpoch } = vi.hoisted(() => {
    const listeners = new Map<string, Set<(event: any) => void>>()
    return {
        listeners,
        list: vi.fn(),
        sync: vi.fn(),
        update: vi.fn(),
        memoEpoch: { value: 0 },
        app: {
            currentMenuId: "chat",
            shared: { currentSpaceId: "space-a", deviceId: "device-a" },
            mittBus: {
                on: (name: string, handler: (event: any) => void) => {
                    if (!listeners.has(name)) listeners.set(name, new Set())
                    listeners.get(name)!.add(handler)
                },
                off: (name: string, handler: (event: any) => void) => listeners.get(name)?.delete(handler),
            },
        },
    }
})
vi.mock("react", async (importOriginal) => {
    const actual = await importOriginal<typeof import("react")>()
    return {
        ...actual,
        useCallback: <T extends (...args: never[]) => unknown>(callback: T, deps: React.DependencyList) =>
            actual.useCallback(callback, [...deps, memoEpoch.value]),
        useMemo: <T,>(factory: () => T, deps?: React.DependencyList) =>
            actual.useMemo(factory, [...(deps || []), memoEpoch.value]),
    }
})
vi.mock("../../App", () => ({ default: app }))
vi.mock("../../Service/CategoryService", () => ({ default: { list, update } }))
vi.mock("../../Service/SidebarService", () => ({ default: { sync } }))
vi.mock("../../Service/FollowService", () => ({ default: {} }))
vi.mock("../../i18n", () => ({ t: (key: string) => key }))
vi.mock("wukongimjssdk", () => ({
    default: { shared: () => ({ conversationManager: {} }) },
    ConversationAction: { add: 1, update: 2, remove: 3 },
}))

import { useCategoryList } from "../useCategoryList"
import { useFollowSidebar } from "../useFollowSidebar"

function deferred<T>() {
    let resolve!: (value: T) => void
    let reject!: (error: Error) => void
    const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail })
    return { promise, resolve, reject }
}

function categories(name: string): CategoryItem[] {
    return [{ category_id: name, name, sort: 0, groups: [] }]
}
function sidebar(name: string, version = 1): SidebarSyncResp {
    return {
        version, follow_version: version,
        items: [{
            target_type: 2, target_id: name, channel_id: name, channel_type: 2,
            category_id: name, timestamp: 1, unread: 0, is_pinned: false, is_followed: true,
        }],
    }
}
function useDirectories() {
    return { categories: useCategoryList(), sidebar: useFollowSidebar() }
}
function renderHook(hook: typeof useDirectories) {
    const result = {} as { current: ReturnType<typeof useDirectories> }
    function Probe() {
        result.current = hook()
        return null
    }
    const view = render(<Probe />)
    return { result, unmount: view.unmount, rerender: () => view.rerender(<Probe />) }
}
async function resume() {
    await act(async () => { window.dispatchEvent(new Event("octobuddy:resume")) })
}
async function activate(menuId: string) {
    await act(async () => {
        app.currentMenuId = menuId
        listeners.get("wk:active-menu-changed")?.forEach(handler => handler({ menuId }))
    })
}

describe("communication directory activation", () => {
    beforeEach(() => {
        app.currentMenuId = "chat"
        app.shared.currentSpaceId = "space-a"
        delete document.documentElement.dataset.hostVisibility
        vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible")
        list.mockReset().mockResolvedValue(categories("original"))
        sync.mockReset().mockResolvedValue(sidebar("original"))
    })
    afterEach(() => {
        cleanup()
        vi.restoreAllMocks()
    })

    it("refreshes categories and followed items silently after resume", async () => {
        const { result } = renderHook(useDirectories)
        await waitFor(() => expect(result.current.categories.categories[0]?.name).toBe("original"))
        const nextCategories = deferred<CategoryItem[]>()
        const nextSidebar = deferred<SidebarSyncResp>()
        list.mockReturnValueOnce(nextCategories.promise)
        sync.mockReturnValueOnce(nextSidebar.promise)
        await resume()
        expect(list).toHaveBeenCalledTimes(2)
        expect(sync).toHaveBeenCalledTimes(2)
        expect(result.current.categories.isLoading).toBe(false)
        expect(result.current.sidebar.isLoading).toBe(false)
        expect(result.current.categories.categories[0].name).toBe("original")
        await act(async () => {
            nextCategories.resolve(categories("renamed"))
            nextSidebar.resolve(sidebar("new-follow", 2))
        })
        expect(result.current.categories.categories[0].name).toBe("renamed")
        expect(result.current.sidebar.followedGroupNos.has("new-follow")).toBe(true)
        expect(result.current.sidebar.versionRef.current).toBe(2)
    })

    it("keeps foreground directory loads alive when silent activation refresh fails", async () => {
        const initialCategories = deferred<CategoryItem[]>()
        const initialSidebar = deferred<SidebarSyncResp>()
        list.mockReturnValueOnce(initialCategories.promise)
        sync.mockReturnValueOnce(initialSidebar.promise)
        const { result } = renderHook(useDirectories)
        list.mockRejectedValueOnce(new Error("category offline"))
        sync.mockRejectedValueOnce(new Error("sidebar offline"))
        await resume()
        expect(result.current.categories.isLoading).toBe(true)
        expect(result.current.sidebar.isLoading).toBe(true)
        expect(result.current.categories.error).toBeNull()
        expect(result.current.sidebar.error).toBeNull()
        await act(async () => {
            initialCategories.resolve(categories("initial"))
            initialSidebar.resolve(sidebar("initial", 4))
        })
        expect(result.current.categories.isLoading).toBe(false)
        expect(result.current.sidebar.isLoading).toBe(false)
        expect(result.current.categories.categories[0].name).toBe("initial")
        expect(result.current.sidebar.items[0].target_id).toBe("initial")
        expect(result.current.sidebar.versionRef.current).toBe(4)
    })

    it("keeps successful silent snapshots after older foreground directory loads resolve", async () => {
        const initialCategories = deferred<CategoryItem[]>()
        const initialSidebar = deferred<SidebarSyncResp>()
        list.mockReturnValueOnce(initialCategories.promise)
        sync.mockReturnValueOnce(initialSidebar.promise)
        const { result } = renderHook(useDirectories)
        list.mockResolvedValue(categories("latest"))
        sync.mockResolvedValue(sidebar("latest", 4))
        await resume()
        expect(result.current.categories.categories[0].name).toBe("latest")
        expect(result.current.sidebar.items[0].target_id).toBe("latest")
        expect(result.current.categories.isLoading).toBe(false)
        expect(result.current.sidebar.isLoading).toBe(false)
        await act(async () => {
            initialCategories.resolve(categories("stale"))
            initialSidebar.resolve(sidebar("stale", 1))
        })
        expect(result.current.categories.categories[0].name).toBe("latest")
        expect(result.current.sidebar.items[0].target_id).toBe("latest")
        expect(result.current.sidebar.versionRef.current).toBe(4)
        expect(result.current.categories.isLoading).toBe(false)
        expect(result.current.sidebar.isLoading).toBe(false)
    })

    it("refreshes on contacts-to-chat return, without reloading for each conversation", async () => {
        renderHook(useDirectories)
        await waitFor(() => expect(list).toHaveBeenCalledTimes(1))
        await activate("chat")
        expect(list).toHaveBeenCalledTimes(1)
        await activate("contacts")
        await resume()
        expect(list).toHaveBeenCalledTimes(1)
        list.mockResolvedValue(categories("remote"))
        sync.mockResolvedValue(sidebar("remote"))
        await activate("chat")
        expect(list).toHaveBeenCalledTimes(2)
        expect(sync).toHaveBeenCalledTimes(2)
    })

    it("keeps the latest activation result when earlier requests arrive late", async () => {
        const { result } = renderHook(useDirectories)
        await waitFor(() => expect(result.current.categories.isLoading).toBe(false))
        const slowCategories = deferred<CategoryItem[]>()
        const slowSidebar = deferred<SidebarSyncResp>()
        list.mockReturnValueOnce(slowCategories.promise)
        sync.mockReturnValueOnce(slowSidebar.promise)
        await resume()
        list.mockResolvedValue(categories("latest"))
        sync.mockResolvedValue(sidebar("latest", 3))
        await resume()
        await act(async () => {
            slowCategories.resolve(categories("stale"))
            slowSidebar.resolve(sidebar("stale", 2))
        })
        expect(result.current.categories.categories[0].name).toBe("latest")
        expect(result.current.sidebar.items[0].target_id).toBe("latest")
        expect(result.current.sidebar.versionRef.current).toBe(3)
    })

    it("ignores old-space responses and failures, including after switching away and back", async () => {
        const { result, rerender } = renderHook(useDirectories)
        await waitFor(() => expect(result.current.categories.categories).toHaveLength(1))
        const slowCategories = deferred<CategoryItem[]>()
        const slowSidebar = deferred<SidebarSyncResp>()
        list.mockReturnValueOnce(slowCategories.promise)
        sync.mockReturnValueOnce(slowSidebar.promise)
        await resume()
        app.shared.currentSpaceId = "space-b"
        list.mockResolvedValue(categories("space-b"))
        sync.mockResolvedValue(sidebar("space-b", 5))
        rerender()
        await waitFor(() => expect(result.current.categories.categories[0]?.name).toBe("space-b"))
        app.shared.currentSpaceId = "space-a"
        list.mockResolvedValue(categories("fresh-a"))
        sync.mockResolvedValue(sidebar("fresh-a", 6))
        rerender()
        await waitFor(() => expect(result.current.categories.categories[0]?.name).toBe("fresh-a"))
        await act(async () => {
            slowCategories.reject(new Error("old-space failure"))
            slowSidebar.resolve(sidebar("stale-a", 1))
        })
        expect(result.current.categories.error).toBeNull()
        expect(result.current.sidebar.items[0].target_id).toBe("fresh-a")
        expect(result.current.sidebar.versionRef.current).toBe(6)
    })

    it("finishes initial loading if a resume supersedes its request, and cleans up on unmount", async () => {
        const initialCategories = deferred<CategoryItem[]>()
        const initialSidebar = deferred<SidebarSyncResp>()
        list.mockReturnValueOnce(initialCategories.promise)
        sync.mockReturnValueOnce(initialSidebar.promise)
        const { result, unmount } = renderHook(useDirectories)
        await resume()
        expect(result.current.categories.isLoading).toBe(false)
        expect(result.current.sidebar.isLoading).toBe(false)
        unmount()
        await resume()
        expect(list).toHaveBeenCalledTimes(2)
        expect(sync).toHaveBeenCalledTimes(2)
        expect(listeners.get("wk:active-menu-changed")?.size).toBe(0)
        await act(async () => {
            initialCategories.resolve(categories("discarded"))
            initialSidebar.resolve(sidebar("discarded", 10))
        })
        expect(result.current.sidebar.versionRef.current).toBe(1)
    })
})

describe("same-space and A-B-A mutation identity guards", () => {
    beforeEach(() => {
        app.currentMenuId = "chat"
        app.shared.currentSpaceId = "space-a"
        delete document.documentElement.dataset.hostVisibility
        vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible")
        list.mockReset().mockResolvedValue(categories("original"))
        sync.mockReset().mockResolvedValue(sidebar("original"))
    })
    afterEach(() => {
        cleanup()
        vi.restoreAllMocks()
    })

    it("does not destructively reset data on a same-space re-render with regenerated load callback", async () => {
        const { result, rerender } = renderHook(useDirectories)
        await waitFor(() => expect(result.current.categories.categories[0]?.name).toBe("original"))
        const previous = result.current.categories.categories
        const reload = result.current.categories.reload
        // Simulate React discarding both callback and memo caches without changing Space.
        memoEpoch.value += 1
        rerender()
        expect(result.current.categories.reload).not.toBe(reload)
        expect(result.current.categories.categories).toBe(previous)
        expect(result.current.categories.isLoading).toBe(false)
        expect(list).toHaveBeenCalledTimes(1)
        expect(sync).toHaveBeenCalledTimes(1)
        list.mockResolvedValue(categories("resumed"))
        sync.mockResolvedValue(sidebar("resumed"))
        await resume()
        expect(result.current.categories.categories[0].name).toBe("resumed")
        expect(result.current.sidebar.items[0].target_id).toBe("resumed")
    })

    it("prevents old A-B-A mutation (rename) from applying after space returns", async () => {
        const { result, rerender } = renderHook(useDirectories)
        await waitFor(() => expect(result.current.categories.categories[0]?.name).toBe("original"))
        const pending = deferred<void>()
        update.mockReturnValueOnce(pending.promise)
        const renamePromise = result.current.categories.renameCategory("original", "new-name")
        app.shared.currentSpaceId = "space-b"
        list.mockResolvedValue(categories("space-b"))
        rerender()
        await waitFor(() => expect(result.current.categories.categories[0]?.name).toBe("space-b"))
        app.shared.currentSpaceId = "space-a"
        list.mockResolvedValue([{ ...categories("original")[0], name: "fresh-a" }])
        rerender()
        await waitFor(() => expect(result.current.categories.categories[0]?.name).toBe("fresh-a"))
        await act(async () => { pending.resolve(); await renamePromise })
        expect(result.current.categories.categories[0]).toMatchObject({ category_id: "original", name: "fresh-a" })
    })
})
