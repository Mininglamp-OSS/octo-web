// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest"
const runtime = vi.hoisted(() => ({
  subscribers: new Map<string, Array<{ uid?: string; orgData?: { robot?: unknown } }>>(),
  syncSubscribers: vi.fn(async () => undefined),
}))
vi.mock("react-virtuoso", () => ({ TableVirtuoso: () => null, Virtuoso: () => null, VirtuosoGrid: () => null }))
vi.mock("../../../Service/ForwardService", () => ({
  ForwardService: { send: vi.fn(async () => ({ targets: 1, failedTargets: 0, messageAttempts: 1, failedMessages: 0, disbanded: 0, failures: [] })) },
}))
vi.mock("../../../im-runtime/currentChannelRuntime", () => ({
  getCurrentImChannelSubscribers: (channel: { channelID: string }) =>
    runtime.subscribers.get(channel.channelID) ?? [],
  syncCurrentImChannelSubscribers: runtime.syncSubscribers,
}))
import WKBase, { createDefaultExternalViewerGate } from "../index"
import { Channel } from "wukongimjssdk"

describe("WKBase context methods", () => {
  beforeEach(() => {
    runtime.subscribers = new Map()
    runtime.syncSubscribers.mockReset().mockResolvedValue(undefined)
  })

  it("covers modal state transitions and external viewer routing", () => {
    const base: any = new WKBase({ children: null })
    base.setState = (update: any) => {
      const next = typeof update === "function" ? update(base.state, base.props) : update
      if (next) base.state = { ...base.state, ...next }
    }
    const done = vi.fn()
    base.showConversationSelect(done, "Forward", { canGrant: true, disabledReason: undefined, defaultRole: "reader" } as any)
    expect(base.state.showConversationSelect).toBe(true)
    base.hideUserInfo()
    base.showAlert({ content: "alert", title: "title", onOk: done })
    base.cancelAlert()
    base.showGlobalModal({ body: "body", width: "400px" })
    base.hideGlobalModal()
    base.showJoinOrgInfo("org", "u", "code")
    base.showUserInfo("iwh_invalid", new Channel("g", 2))
    base.dispatchUserInfo("u", new Channel("g", 2), "v", false)
    base.componentDidMount()
    base.componentWillUnmount()
    const gate = createDefaultExternalViewerGate()
    expect(gate.isExternal("u", new Channel("g", 2), { orgData: { is_external: 0 } } as any)).toBe(false)
    expect(base.state).toBeTruthy()
  })

  it("collects forward recipients and runs the document forward orchestration", async () => {
    const base: any = new WKBase({ children: null })
    base.context = { t: (key: string) => key }
    base.setState = (update: any) => {
      const next = typeof update === "function" ? update(base.state, base.props) : update
      if (next) base.state = { ...base.state, ...next }
    }
    const person = new Channel("peer", 1)
    const group = new Channel("group", 2)
    expect(await base.collectForwardUids([person, group])).toContain("peer")
    const result = vi.fn()
    await base.runDocForward([person], undefined, {
      messageTitle: "Doc", link: "https://docs.test/d1", shareAsCard: false, onResult: result,
    })
    expect(result).toHaveBeenCalledWith(expect.objectContaining({ sent: 1, failed: 0 }))
  })

  it("uses the reviewed grant snapshot instead of re-expanding group members", async () => {
    const base: any = new WKBase({ children: null })
    base.context = { t: (key: string) => key }
    const grantAccess = vi.fn(async () => ({ granted: 2, failed: 0 }))

    await base.runDocForward(
      [new Channel("group", 2)],
      { role: "reader", humanUids: ["u_human"], botUids: ["b_kept"] },
      { messageTitle: "Doc", link: "https://docs.test/d1", grantAccess },
    )

    expect(grantAccess).toHaveBeenCalledWith(["u_human", "b_kept"], "reader")
  })

  it("preserves the legacy role-only grant fallback for callers without a reviewed snapshot", async () => {
    const base: any = new WKBase({ children: null })
    base.context = { t: (key: string) => key }
    runtime.subscribers.set("group", [
      { uid: "legacy_member" },
      { uid: "legacy_bot", orgData: { robot: 1 } },
    ])
    const grantAccess = vi.fn(async () => ({ granted: 1, failed: 0 }))

    await base.runDocForward(
      [new Channel("group", 2)],
      { role: "reader" },
      { messageTitle: "Doc", link: "https://docs.test/d1", grantAccess },
    )

    expect(grantAccess).toHaveBeenCalledWith(["legacy_member"], "reader")
  })
})
