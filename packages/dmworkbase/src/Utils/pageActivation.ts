import WKApp from "../App"

/** Revalidate retained pages on return without treating every in-page navigation as a refresh. */
export function subscribePageActivation(menuId: string, listener: () => void): () => void {
    let active = WKApp.currentMenuId === menuId
    let queued = false
    let disposed = false
    const isVisible = () => WKApp.currentMenuId === menuId &&
        document.documentElement.dataset.hostVisibility !== "hidden"
    const refresh = () => {
        if (disposed || queued || !isVisible()) return
        queued = true
        queueMicrotask(() => {
            queued = false
            if (!disposed && isVisible()) listener()
        })
    }
    const onMenuChanged = ({ menuId: next }: { menuId?: string }) => {
        const wasActive = active
        active = next === menuId
        if (active && !wasActive) refresh()
    }
    const onVisibilityChanged = () => {
        if (document.visibilityState === "visible") refresh()
    }
    WKApp.mittBus.on("wk:active-menu-changed", onMenuChanged)
    // The host resume is authoritative even if Chromium's visibility event arrives later.
    window.addEventListener("octobuddy:resume", refresh)
    document.addEventListener("visibilitychange", onVisibilityChanged)
    return () => {
        disposed = true
        WKApp.mittBus.off("wk:active-menu-changed", onMenuChanged)
        window.removeEventListener("octobuddy:resume", refresh)
        document.removeEventListener("visibilitychange", onVisibilityChanged)
    }
}
