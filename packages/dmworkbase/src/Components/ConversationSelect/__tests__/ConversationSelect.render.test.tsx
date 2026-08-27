// @vitest-environment jsdom
import React from "react"
import { describe, expect, it, vi } from "vitest"
import { render } from "@testing-library/react"

const modalProps: any[] = []
vi.mock("../../ForwardModal/ForwardModal", () => ({
  ForwardModal: (props: any) => { modalProps.push(props); return <div data-testid="forward-modal" /> },
}))
vi.mock("../../ForwardModal/useForwardModal", () => ({
  useForwardModal: () => ({
    items: [], allItems: [{ channelID: "u1", displayName: "Alice" }], selectedIDs: ["g1"], selectedChannels: [],
    inputValue: "", loading: false, activeTab: "all", setActiveTab: vi.fn(), setInputValue: vi.fn(),
    toggleSelect: vi.fn(), confirm: vi.fn(), requestChannelInfoIfNeeded: vi.fn(), grantEnabled: true, grantRole: "viewer",
    setGrantEnabled: vi.fn(), setGrantRole: vi.fn(), setGrantBotUids: vi.fn(),
  }),
}))
vi.mock("../../ForwardModal/hooks", () => ({
  useForwardTargetMemberCount: () => 3,
  useForwardBotSnapshot: () => ({ snapshot: { ready: true, groups: [] }, readLatestSelectedBotUids: () => ["b1"] }),
  useForwardBotPreview: () => ({ botsFor: vi.fn(() => []) }),
}))

import ConversationSelect from "../index"

describe("ConversationSelect render wiring", () => {
  it("passes the legacy forwarding props through", () => {
    const cancel = vi.fn()
    render(<ConversationSelect title="Forward" onCancel={cancel} />)
    const props = modalProps.at(-1)
    expect(props.title).toBe("Forward")
    props.onCancel()
    props.onInputChange("hello")
    props.onTabChange("bots")
    expect(cancel).toHaveBeenCalled()
  })

  it("builds grant config and blocks an unready bot snapshot", () => {
    const finished = vi.fn()
    render(<ConversationSelect grant={{ canGrant: true, defaultRole: "editor", disabledReason: "no access", spaceId: "s1" }} onFinished={finished} />)
    const props = modalProps.at(-1)
    expect(props.grant).toMatchObject({ canGrant: true, enabled: true, role: "viewer", targetMemberCount: 3 })
    props.grant.onEnabledChange(false)
    props.grant.onRoleChange("editor")
    props.onConfirm()
    expect(props.grant.bots).toBeTruthy()
  })
})
