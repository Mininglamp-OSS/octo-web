import { useEffect, useState } from "react"
import WKApp from "../../../App"

/** In-memory identity only. Never persist or log this key: it includes the session token. */
export function readForwardScope(): string {
  return JSON.stringify([
    WKApp.loginInfo?.uid ?? "",
    WKApp.loginInfo?.token ?? "",
    WKApp.shared.currentSpaceId ?? "",
    WKApp.shared.deviceId ?? "",
  ])
}

export function canCacheForwardSources(): boolean {
  return !!WKApp.loginInfo?.uid && !!WKApp.loginInfo?.token
}

/** A supplied scope shares the parent's subscription; direct hook consumers subscribe themselves. */
export function useForwardScope(provided?: string): string {
  const [, refresh] = useState(0)
  const scope = provided ?? readForwardScope()
  useEffect(() => {
    if (provided !== undefined) return
    let previous = scope
    const update = () => {
      const next = readForwardScope()
      if (next === previous) return
      previous = next
      refresh((value) => value + 1)
    }
    const events = ["space-changed", "space-ready", "wk:auth-state-changed", "conversation-list-refreshed"] as const
    for (const event of events) WKApp.mittBus.on(event, update)
    update()
    return () => {
      for (const event of events) WKApp.mittBus.off(event, update)
    }
  }, [provided])
  // Read live fields on every render as well, so a parent rerender cannot expose the old scope.
  return scope
}
