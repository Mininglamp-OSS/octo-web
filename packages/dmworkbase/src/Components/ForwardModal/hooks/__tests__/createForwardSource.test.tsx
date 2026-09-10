import React from "react"
import { act, cleanup, render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createForwardSource, FORWARD_SOURCE_TTL_MS, type ForwardSource } from "../createForwardSource"

const identity = vi.hoisted(() => ({ scope: "account-a/space-a", cacheable: true }))
vi.mock("../useForwardScope", () => ({
  readForwardScope: () => identity.scope,
  canCacheForwardSources: () => identity.cacheable,
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
async function flush() {
  await act(async () => { for (let i = 0; i < 20; i++) await Promise.resolve() })
}

describe("forward source snapshots", () => {
  let useSource: ReturnType<typeof createForwardSource<string[]>>
  let latest: ForwardSource<string[]>
  const load = vi.fn<() => Promise<string[]>>()
  function Probe() { latest = useSource(identity.scope, load); return null }

  beforeEach(() => {
    identity.scope = "account-a/space-a"
    identity.cacheable = true
    useSource = createForwardSource<string[]>()
    load.mockReset().mockResolvedValue(["cached"])
  })
  afterEach(() => { cleanup(); vi.restoreAllMocks() })

  it("reuses a completed result on reopen, then revalidates after expiry", async () => {
    let now = 1000
    vi.spyOn(Date, "now").mockImplementation(() => now)
    let view = render(<Probe />)
    await flush()
    view.unmount()
    view = render(<Probe />)
    expect(latest.data).toEqual(["cached"])
    expect(latest.loading).toBe(false)
    await flush()
    expect(load).toHaveBeenCalledTimes(1)
    view.unmount()
    now += FORWARD_SOURCE_TTL_MS + 1
    load.mockResolvedValue(["new"])
    render(<Probe />)
    expect(latest.data).toBeUndefined()
    expect(latest.loading).toBe(true)
    await flush()
    expect(latest.data).toEqual(["new"])
    expect(load).toHaveBeenCalledTimes(2)
  })

  it("coalesces an in-flight request across unmount and reopen", async () => {
    const request = deferred<string[]>()
    load.mockReturnValue(request.promise)
    const first = render(<Probe />)
    await flush()
    first.unmount()
    render(<Probe />)
    await flush()
    expect(load).toHaveBeenCalledTimes(1)
    request.resolve(["loaded"])
    await flush()
    expect(latest.data).toEqual(["loaded"])
  })

  it("does not reuse another scope or commit its late response", async () => {
    const old = deferred<string[]>()
    const current = deferred<string[]>()
    load.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)
    const view = render(<Probe />)
    await flush()
    identity.scope = "account-b/space-b"
    view.rerender(<Probe />)
    expect(latest.data).toBeUndefined()
    await flush()
    current.resolve(["current"])
    await flush()
    old.resolve(["old"])
    await flush()
    expect(latest.data).toEqual(["current"])
    view.unmount()
    render(<Probe />)
    expect(latest.data).toEqual(["current"])
    expect(load).toHaveBeenCalledTimes(2)
  })

  it("reports a failed source and retries it without caching the failure", async () => {
    load.mockRejectedValueOnce(new Error("offline"))
    render(<Probe />)
    await flush()
    expect(latest).toMatchObject({ data: undefined, error: true, loading: false })
    act(() => latest.retry())
    await flush()
    expect(latest).toMatchObject({ data: ["cached"], error: false, loading: false })
    expect(load).toHaveBeenCalledTimes(2)
  })

  it("never caches a completed or pending source without a verified session key", async () => {
    identity.cacheable = false
    const first = render(<Probe />)
    await flush()
    first.unmount()
    render(<Probe />)
    await flush()
    expect(load).toHaveBeenCalledTimes(2)
  })
})
