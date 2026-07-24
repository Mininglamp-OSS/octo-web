// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import React from "react"
import ReactDOM from "react-dom"
import { act } from "react-dom/test-utils"

const hoisted = vi.hoisted(() => ({
  deviceId: "" as string,
  sidebarSync: vi.fn(async (_req: any) => ({
    items: [] as any[],
    version: 0,
    follow_version: 0,
  })),
}))

vi.mock("../../../../App", () => ({
  default: {
    get shared() {
      return {
        get deviceId() {
          return hoisted.deviceId
        },
      }
    },
  },
}))

vi.mock("../../../../Service/SidebarService", () => ({
  default: { sync: (...args: any[]) => hoisted.sidebarSync(...args) },
  SidebarTargetType: { DM: 1, CHANNEL: 2, THREAD: 5 },
}))

import { useSidebarScopes } from "../useSidebarScopes"

function Probe({
  onValue,
}: {
  onValue: (value: ReturnType<typeof useSidebarScopes>) => void
}) {
  const value = useSidebarScopes()
  onValue(value)
  return null
}

async function flushMicrotasks() {
  for (let i = 0; i < 4; i++) await Promise.resolve()
}

describe("useSidebarScopes", () => {
  let container: HTMLDivElement

  beforeEach(() => {
    hoisted.deviceId = ""
    hoisted.sidebarSync.mockReset()
    hoisted.sidebarSync.mockResolvedValue({
      items: [],
      version: 0,
      follow_version: 0,
    })
    container = document.createElement("div")
    document.body.appendChild(container)
  })

  afterEach(() => {
    act(() => {
      ReactDOM.unmountComponentAtNode(container)
    })
    container.remove()
  })

  it("short-circuits SidebarService.sync when deviceId is empty (validateSidebarRequest would reject)", async () => {
    hoisted.deviceId = ""

    let latest: ReturnType<typeof useSidebarScopes> | undefined
    await act(async () => {
      ReactDOM.render(<Probe onValue={(v) => (latest = v)} />, container)
      await flushMicrotasks()
    })

    // 0 次调用：既不发 follow 也不发 recent。
    expect(hoisted.sidebarSync).not.toHaveBeenCalled()
    // 空集合退化：与既有 useForwardModal 行为一致。
    expect(latest!.followedKeys.size).toBe(0)
    expect(latest!.recentKeys.size).toBe(0)
    expect(latest!.recentSortMeta.size).toBe(0)
  })

  it("issues one follow + one recent sync when deviceId is non-empty and merges results", async () => {
    hoisted.deviceId = "dev-uuid"
    hoisted.sidebarSync.mockImplementation(async (req: any) => {
      if (req.tab === "follow") {
        return {
          items: [{ target_type: 2, target_id: "g1", is_followed: true }],
          version: 0,
          follow_version: 0,
        }
      }
      return {
        items: [
          { target_type: 2, target_id: "g2", timestamp: 500, is_pinned: true },
        ],
        version: 0,
        follow_version: 0,
      }
    })

    let latest: ReturnType<typeof useSidebarScopes> | undefined
    await act(async () => {
      ReactDOM.render(<Probe onValue={(v) => (latest = v)} />, container)
      await flushMicrotasks()
    })

    expect(hoisted.sidebarSync).toHaveBeenCalledTimes(2)
    expect(latest!.followedKeys.has("2::g1")).toBe(true)
    expect(latest!.recentKeys.has("2::g2")).toBe(true)
    const meta = latest!.recentSortMeta.get("2::g2")
    expect(meta?.timestamp).toBe(500)
    expect(meta?.isPinned).toBe(true)
  })

  it("does not setState after unmount even if the sidebar sync resolves later (cancelled guard)", async () => {
    hoisted.deviceId = "dev-uuid"
    let resolveFollow: (v: any) => void = () => {}
    let resolveRecent: (v: any) => void = () => {}
    hoisted.sidebarSync.mockImplementation(
      async (req: any) =>
        new Promise((res) => {
          if (req.tab === "follow") resolveFollow = res
          else resolveRecent = res
        }),
    )

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    let latest: ReturnType<typeof useSidebarScopes> | undefined
    await act(async () => {
      ReactDOM.render(<Probe onValue={(v) => (latest = v)} />, container)
      await flushMicrotasks()
    })
    expect(latest!.recentKeys.size).toBe(0)

    act(() => {
      ReactDOM.unmountComponentAtNode(container)
    })

    // 卸载后 promise 才 resolve：cancelled=true 必须阻止 setState，否则触发 React warning。
    await act(async () => {
      resolveFollow({
        items: [{ target_type: 2, target_id: "g-late", is_followed: true }],
        version: 0,
        follow_version: 0,
      })
      resolveRecent({ items: [], version: 0, follow_version: 0 })
      await flushMicrotasks()
    })

    expect(errorSpy).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })
})
