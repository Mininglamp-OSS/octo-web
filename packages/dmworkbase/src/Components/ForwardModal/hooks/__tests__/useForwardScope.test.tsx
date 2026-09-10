import React, { useLayoutEffect } from "react"
import { act, cleanup, render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { canCacheForwardSources, useForwardScope } from "../useForwardScope"

const app = vi.hoisted(() => ({
  loginInfo: { uid: "user-a", token: "session-a" },
  shared: { currentSpaceId: "space-a", deviceId: "device-a" },
  listeners: new Map<string, Set<() => void>>(),
}))
vi.mock("../../../../App", () => ({ default: {
  loginInfo: app.loginInfo,
  shared: app.shared,
  mittBus: {
    on: (event: string, callback: () => void) => {
      if (!app.listeners.has(event)) app.listeners.set(event, new Set())
      app.listeners.get(event)!.add(callback)
    },
    off: (event: string, callback: () => void) => app.listeners.get(event)?.delete(callback),
  },
} }))

describe("forward picker scope", () => {
  let latest: string
  function Probe({ beforeSubscribe }: { beforeSubscribe?: () => void }) {
    latest = useForwardScope()
    useLayoutEffect(() => { beforeSubscribe?.() }, [])
    return null
  }
  beforeEach(() => {
    Object.assign(app.loginInfo, { uid: "user-a", token: "session-a" })
    Object.assign(app.shared, { currentSpaceId: "space-a", deviceId: "device-a" })
    app.listeners.clear()
  })
  afterEach(cleanup)

  it.each([
    ["uid", "wk:auth-state-changed"],
    ["token", "wk:auth-state-changed"],
    ["currentSpaceId", "space-changed"],
    ["deviceId", "conversation-list-refreshed"],
  ] as const)("invalidates on %s changes and removes subscriptions on unmount", (field, event) => {
    const view = render(<Probe />)
    const previous = latest
    act(() => {
      if (field === "uid" || field === "token") app.loginInfo[field] = "changed"
      else app.shared[field] = "changed"
      app.listeners.get(event)!.forEach((callback) => callback())
    })
    expect(latest).not.toBe(previous)
    view.unmount()
    expect([...app.listeners.values()].every((listeners) => listeners.size === 0)).toBe(true)
  })

  it("detects a scope change between render and subscription", () => {
    render(<Probe beforeSubscribe={() => { app.shared.currentSpaceId = "space-b" }} />)
    expect(JSON.parse(latest)[2]).toBe("space-b")
  })

  it("does not share snapshots after logout", () => {
    expect(canCacheForwardSources()).toBe(true)
    app.loginInfo.token = ""
    expect(canCacheForwardSources()).toBe(false)
  })
})
