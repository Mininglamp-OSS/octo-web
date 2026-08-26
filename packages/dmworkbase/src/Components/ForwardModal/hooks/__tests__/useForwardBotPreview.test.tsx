// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import React from "react"
import ReactDOM from "react-dom"
import { act } from "react-dom/test-utils"

const hoisted = vi.hoisted(() => ({
  listShared: vi.fn(async (_spaceId: string) => [] as Array<{ uid?: string; name?: string; creator_uid?: string }>),
}))

vi.mock("../../../../Service/SpaceBotService", () => ({
  default: { listShared: hoisted.listShared, list: hoisted.listShared },
}))

import { useForwardBotPreview } from "../useForwardBotPreview"

function Probe({
  spaceId,
  onValue,
}: {
  spaceId?: string
  onValue: (r: { ready: boolean; botsFor: (u: string) => Array<{ uid: string; name: string }> }) => void
}) {
  const r = useForwardBotPreview(spaceId)
  onValue(r)
  return null
}

async function flush() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe("useForwardBotPreview", () => {
  let container: HTMLDivElement
  let latest: { ready: boolean; botsFor: (u: string) => Array<{ uid: string; name: string }> }

  beforeEach(() => {
    hoisted.listShared.mockReset().mockResolvedValue([])
    container = document.createElement("div")
    document.body.appendChild(container)
  })
  afterEach(() => {
    act(() => ReactDOM.unmountComponentAtNode(container))
    container.remove()
  })

  async function render(spaceId?: string) {
    await act(async () => {
      ReactDOM.render(<Probe spaceId={spaceId} onValue={(v) => (latest = v)} />, container)
      await flush()
    })
  }

  it("does not touch the catalog when no space is given, exposes no Bots", async () => {
    await render(undefined)
    expect(hoisted.listShared).not.toHaveBeenCalled()
    expect(latest.ready).toBe(false)
    expect(latest.botsFor("u_ada")).toEqual([])
  })

  it("groups catalog Bots by creator and reports them per person", async () => {
    hoisted.listShared.mockResolvedValue([
      { uid: "b_1", name: "Writer Bot", creator_uid: "u_ada" },
      { uid: "b_2", name: "Review Bot", creator_uid: "u_ada" },
      { uid: "b_3", name: "Grace Bot", creator_uid: "u_grace" },
    ])
    await render("s_1")
    expect(latest.ready).toBe(true)
    expect(latest.botsFor("u_ada").map((b) => b.uid)).toEqual(["b_1", "b_2"])
    expect(latest.botsFor("u_grace").map((b) => b.uid)).toEqual(["b_3"])
    // A person with no Bots gets an empty list.
    expect(latest.botsFor("u_none")).toEqual([])
  })

  it("skips catalog entries with no creator_uid (never previewed under anyone)", async () => {
    hoisted.listShared.mockResolvedValue([{ uid: "b_orphan", name: "Orphan" }])
    await render("s_1")
    expect(latest.ready).toBe(true)
    expect(latest.botsFor("u_ada")).toEqual([])
  })

  it("fails closed: on a catalog error it stays not-ready with no Bots", async () => {
    hoisted.listShared.mockRejectedValue(new Error("boom"))
    await render("s_1")
    expect(latest.ready).toBe(false)
    expect(latest.botsFor("u_ada")).toEqual([])
  })
})
