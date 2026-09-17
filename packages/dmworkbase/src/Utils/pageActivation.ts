/** Use the caller's app identity instead of importing a second singleton graph. */
export interface PageActivationApp {
    currentMenuId?: string
    mittBus: {
        on(event: "wk:active-menu-changed", handler: (event: { menuId?: string }) => void): void
        off(event: "wk:active-menu-changed", handler: (event: { menuId?: string }) => void): void
    }
}

/** Revalidate retained pages on return without treating every in-page navigation as a refresh. */
export function subscribePageActivation(
    menuId: string,
    listener: () => void,
    app: PageActivationApp,
): () => void {
    let active = app.currentMenuId === menuId
    let queued = false
    let disposed = false
    const isVisible = () => app.currentMenuId === menuId &&
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
    app.mittBus.on("wk:active-menu-changed", onMenuChanged)
    // The host resume is authoritative even if Chromium's visibility event arrives later.
    window.addEventListener("octobuddy:resume", refresh)
    document.addEventListener("visibilitychange", onVisibilityChanged)
    return () => {
        disposed = true
        app.mittBus.off("wk:active-menu-changed", onMenuChanged)
        window.removeEventListener("octobuddy:resume", refresh)
        document.removeEventListener("visibilitychange", onVisibilityChanged)
    }
}
