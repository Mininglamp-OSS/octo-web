// @vitest-environment jsdom
import React from "react"
import ReactDOM from "react-dom"
import { act } from "react-dom/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"

const runtime = vi.hoisted(() => ({
  subscribers: new Map<string, Array<{ uid?: string; orgData?: { robot?: unknown } }>>(),
  disbandedChannelIDs: new Set<string>(),
  syncSubscribers: vi.fn(async () => undefined),
  addChannelInfoListener: vi.fn(() => vi.fn()),
  addSubscriberChangeListener: vi.fn(() => vi.fn()),
}))

vi.mock("react-virtuoso", () => ({ TableVirtuoso: () => null, Virtuoso: () => null, VirtuosoGrid: () => null }))
vi.mock("../../../Service/ForwardService", () => ({
  ForwardService: { send: vi.fn(async () => ({ targets: 1, failedTargets: 0, messageAttempts: 1, failedMessages: 0, disbanded: 0, failures: [] })) },
}))
vi.mock("../../../im-runtime/currentChannelRuntime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../im-runtime/currentChannelRuntime")>()
  return {
    ...actual,
    getCurrentImChannelSubscribers: (channel: { channelID: string }) =>
      runtime.subscribers.get(channel.channelID) ?? [],
    syncCurrentImChannelSubscribers: runtime.syncSubscribers,
    addCurrentImChannelInfoListener: runtime.addChannelInfoListener,
    addCurrentImSubscriberChangeListener: runtime.addSubscriberChangeListener,
  }
})
vi.mock("../../../Utils/groupDisband", () => ({
  isConversationDisbanded: (channel: { channelID: string }) => runtime.disbandedChannelIDs.has(channel.channelID),
}))
vi.mock("@octo/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@octo/ui")>()
  return {
    ...actual,
    Modal: ({ visible, title, children }: { visible?: boolean; title?: React.ReactNode; children?: React.ReactNode }) => (
      visible ? (
        <div data-testid="octo-modal">
          {title ? <div className="octo-ui-modal__title">{title}</div> : null}
          <div className="octo-ui-modal__body">{children}</div>
        </div>
      ) : null
    ),
  }
})

import WKBase, { createDefaultExternalViewerGate } from "../index"
import { Channel } from "wukongimjssdk"

describe("WKBase context methods", () => {
  beforeEach(() => {
    runtime.subscribers = new Map()
    runtime.disbandedChannelIDs = new Set()
    runtime.syncSubscribers.mockReset().mockResolvedValue(undefined)
    runtime.addChannelInfoListener.mockReset().mockReturnValue(vi.fn())
    runtime.addSubscriberChangeListener.mockReset().mockReturnValue(vi.fn())
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

  it("normalizes Space-prefixed person ids in the legacy grant fallback", async () => {
    const base: any = new WKBase({ children: null })
    const prefixedUid = `s${"a".repeat(32)}_peer`

    expect(await base.collectForwardUids([new Channel(prefixedUid, 1)])).toEqual(["peer"])
  })

  it("uses the reviewed grant snapshot instead of re-expanding group members", async () => {
    const base: any = new WKBase({ children: null })
    base.context = { t: (key: string) => key }
    const grantAccess = vi.fn(async () => ({ granted: 2, failed: 0 }))

    await base.runDocForward(
      [new Channel("group", 2)],
      {
        role: "reader",
        principalsByTarget: [{ channelID: "group", channelType: 2, uids: ["u_human", "b_kept"] }],
      },
      { messageTitle: "Doc", link: "https://docs.test/d1", grantAccess }
    )

    expect(grantAccess).toHaveBeenCalledWith(["u_human", "b_kept"], "reader")
  })

  it("grants only principals attributed to targets that are still sendable", async () => {
    const base: any = new WKBase({ children: null })
    base.context = { t: (key: string) => key }
    runtime.disbandedChannelIDs.add("dead")
    const grantAccess = vi.fn(async () => ({ granted: 2, failed: 0 }))

    await base.runDocForward(
      [new Channel("live", 2), new Channel("dead", 2)],
      {
        role: "reader",
        principalsByTarget: [
          { channelID: "live", channelType: 2, uids: ["u_live", "b_shared"] },
          {
            channelID: "dead",
            channelType: 2,
            uids: ["u_dead", "b_shared", "b_dead"],
          },
        ],
      },
      { messageTitle: "Doc", link: "https://docs.test/d1", grantAccess }
    )

    expect(grantAccess).toHaveBeenCalledWith(["u_live", "b_shared"], "reader")
    expect(grantAccess).toHaveBeenCalledTimes(1)
  })

  it("fails closed on unscoped legacy Bots when any selected target is disbanded", async () => {
    const base: any = new WKBase({ children: null })
    base.context = { t: (key: string) => key }
    runtime.disbandedChannelIDs.add("dead")
    runtime.subscribers.set("live", [{ uid: "u_live", orgData: { robot: 0 } }])
    const grantAccess = vi.fn(async () => ({ granted: 1, failed: 0 }))

    await base.runDocForward([new Channel("live", 2), new Channel("dead", 2)], { role: "reader", botUids: ["b_unscoped"] }, { messageTitle: "Doc", link: "https://docs.test/d1", grantAccess })

    expect(grantAccess).toHaveBeenCalledWith(["u_live"], "reader")
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

  it("renders title-less alerts in the body instead of the ellipsized title slot", () => {
    const container = document.createElement("div")
    document.body.appendChild(container)

    let context: any
    act(() => {
      ReactDOM.render(<WKBase onContext={(value) => { context = value; }}>{null}</WKBase>, container)
    })
    act(() => {
      context.showAlert({ content: "Delete and exit this group permanently" })
    })

    expect(container.querySelector(".octo-ui-modal__title")?.textContent ?? "").toBe("")
    expect(container.querySelector(".octo-ui-modal-confirm__description")?.textContent).toBe(
      "Delete and exit this group permanently"
    )

    act(() => {
      ReactDOM.unmountComponentAtNode(container)
    })
    container.remove()
  })
})
