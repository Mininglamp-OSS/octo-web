// @vitest-environment jsdom
import React from "react"
import ReactDOM from "react-dom"
import { act } from "react-dom/test-utils"
import { describe, expect, it, vi } from "vitest"
vi.mock("react-virtuoso", () => ({ TableVirtuoso: () => null, Virtuoso: () => null, VirtuosoGrid: () => null }))
vi.mock("../../../Service/ForwardService", () => ({
  ForwardService: { send: vi.fn(async () => ({ targets: 1, failedTargets: 0, messageAttempts: 1, failedMessages: 0, disbanded: 0, failures: [] })) },
}))
vi.mock("@octo/ui", () => ({
  Modal: ({ visible, title, children }: { visible?: boolean; title?: React.ReactNode; children?: React.ReactNode }) => (
    visible ? (
      <div data-testid="octo-modal">
        {title ? <div className="octo-ui-modal__title">{title}</div> : null}
        <div className="octo-ui-modal__body">{children}</div>
      </div>
    ) : null
  ),
}))
import WKBase, { createDefaultExternalViewerGate } from "../index"
import { Channel } from "wukongimjssdk"

describe("WKBase context methods", () => {
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
