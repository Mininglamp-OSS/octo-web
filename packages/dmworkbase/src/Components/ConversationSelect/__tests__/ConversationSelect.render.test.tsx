// @vitest-environment jsdom
import React from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { render } from "@testing-library/react"

const hoisted = vi.hoisted(() => ({
  modalProps: [] as any[],
  confirm: vi.fn(),
  setGrantPrincipalsByTarget: vi.fn(),
  snapshot: { ready: true, peopleCount: 3, botCount: 1, groups: [] } as any,
}))
vi.mock("../../ForwardModal/ForwardModal", () => ({
  ForwardModal: (props: any) => { hoisted.modalProps.push(props); return <div data-testid="forward-modal" /> },
}))
vi.mock("../../ForwardModal/useForwardModal", () => ({
  useForwardModal: () => ({
    items: [], allItems: [{ channelID: "g1", displayName: "Group" }], selectedIDs: ["g1"],
    selectedChannels: [{ channelID: "g1", channelType: 2 }],
    inputValue: "", loading: false, activeTab: "all", setActiveTab: vi.fn(), setInputValue: vi.fn(),
    toggleSelect: vi.fn(), confirm: hoisted.confirm, requestChannelInfoIfNeeded: vi.fn(), grantEnabled: true, grantRole: "viewer",
    setGrantEnabled: vi.fn(), setGrantRole: vi.fn(), setGrantPrincipalsByTarget: hoisted.setGrantPrincipalsByTarget, setGrantBotUids: vi.fn(),
  }),
}))
vi.mock("../../ForwardModal/hooks", () => ({
  useForwardBotSnapshot: () => ({
    snapshot: hoisted.snapshot,
    readLatestPrincipalsByTarget: () => [
      { channelID: "g1", channelType: 2, uids: ["u1", "u2", "u3", "b1"] },
    ],
  }),
  useForwardBotPreview: () => ({ botsFor: vi.fn(() => []) }),
}))

import ConversationSelect from "../index"

describe("ConversationSelect render wiring", () => {
  beforeEach(() => {
    hoisted.modalProps.length = 0
    hoisted.confirm.mockClear()
    hoisted.setGrantPrincipalsByTarget.mockClear()
    hoisted.snapshot = { ready: true, peopleCount: 3, botCount: 1, groups: [] }
  })

  it("passes the legacy forwarding props through", () => {
    const cancel = vi.fn()
    render(<ConversationSelect title="Forward" onCancel={cancel} />)
    const props = hoisted.modalProps[hoisted.modalProps.length - 1]
    expect(props.title).toBe("Forward")
    props.onCancel()
    props.onInputChange("hello")
    props.onTabChange("bots")
    expect(cancel).toHaveBeenCalled()
  })

  it("builds grant config and confirms the authoritative human/Bot snapshot", () => {
    const finished = vi.fn()
    render(<ConversationSelect grant={{ canGrant: true, defaultRole: "writer", disabledReason: "no access", spaceId: "s1" }} onFinished={finished} />)
    const props = hoisted.modalProps[hoisted.modalProps.length - 1]
    expect(props.grant).toMatchObject({ canGrant: true, enabled: true, role: "viewer", targetMemberCount: 3 })
    props.grant.onEnabledChange(false)
    props.grant.onRoleChange("writer")
    props.onConfirm()
    expect(props.grant.bots).toBeTruthy()
    expect(hoisted.setGrantPrincipalsByTarget).toHaveBeenCalledWith([
      { channelID: "g1", channelType: 2, uids: ["u1", "u2", "u3", "b1"] },
    ])
    expect(hoisted.confirm).toHaveBeenCalledTimes(1)
  })

  it("blocks confirmation while the authoritative snapshot is not ready", () => {
    hoisted.snapshot = { ready: false, peopleCount: 0, botCount: 0, groups: [] }
    render(<ConversationSelect grant={{ canGrant: true, spaceId: "s1" }} />)
    const props = hoisted.modalProps[hoisted.modalProps.length - 1]

    props.onConfirm()

    expect(hoisted.setGrantPrincipalsByTarget).not.toHaveBeenCalled()
    expect(hoisted.confirm).not.toHaveBeenCalled()
  })
})
