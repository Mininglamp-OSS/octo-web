// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import React from "react"
import ReactDOM from "react-dom"
import { act } from "react-dom/test-utils"

// Mock wukongimjssdk channel + type constants (person=1, group=2).
vi.mock("wukongimjssdk", () => {
  class Channel {
    channelID: string
    channelType: number
    constructor(channelID: string, channelType: number) {
      this.channelID = channelID
      this.channelType = channelType
    }
  }
  return { Channel, ChannelTypePerson: 1, ChannelTypeGroup: 2 }
})

// Heavy host deps are stubbed so the row renders in isolation. Paths are relative to THIS test
// file (ForwardModal/ui/__tests__), matching how vi.mock resolves specifiers.
vi.mock("../../../WKAvatar", () => ({ default: () => <div data-testid="avatar" /> }))
vi.mock("../../../AiBadge", () => ({ default: () => <span data-testid="ai-badge" /> }))
vi.mock("@douyinfe/semi-ui", () => ({ Tag: ({ children }: { children: React.ReactNode }) => <span>{children}</span> }))
vi.mock("@octo/ui", () => ({
  Checkbox: ({
    checked,
    disabled,
    onCheckedChange,
  }: {
    checked?: boolean
    disabled?: boolean
    onCheckedChange?: (checked: boolean) => void
  }) => (
    <div
      role="checkbox"
      aria-checked={!!checked}
      aria-disabled={!!disabled}
      onClick={() => {
        if (!disabled) onCheckedChange?.(!checked)
      }}
    />
  ),
}))
vi.mock("../../../../Service/Const", () => ({ ChannelTypeCommunityTopic: 99 }))
vi.mock("../../../../i18n", () => ({
  useI18n: () => ({
    t: (key: string, opts?: { values?: Record<string, unknown> }) =>
      opts?.values ? `${key}:${JSON.stringify(opts.values)}` : key,
  }),
}))

import { ItemRow } from "../ItemRow"

// Inline the ForwardItem shape the row needs so the test never imports the ForwardModal module
// chain (which pulls host Message modules requiring a fuller wukongimjssdk mock).
type ForwardItem = {
  channelID: string
  channelType: number
  displayName: string
  isThread?: boolean
  isAI?: boolean
  isExternal?: boolean
  parentChannelID?: string
}

const person: ForwardItem = { channelID: "u_ada", channelType: 1, displayName: "Ada" }
const group: ForwardItem = { channelID: "g_1", channelType: 2, displayName: "Team" }
const threadPerson: ForwardItem = { channelID: "u_ada", channelType: 1, displayName: "Ada", isThread: true }

describe("ItemRow Bot preview (UX #4)", () => {
  let container: HTMLDivElement
  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
  })
  afterEach(() => {
    act(() => { ReactDOM.unmountComponentAtNode(container) })
    container.remove()
  })

  function renderRow(props: React.ComponentProps<typeof ItemRow>) {
    act(() => {
      ReactDOM.render(<ItemRow {...props} />, container)
    })
  }

  const previewWith = (bots: Record<string, Array<{ uid: string; name: string }>>) => ({
    botsFor: (uid: string) => bots[uid] ?? [],
  })

  it("renders no expander when there is no botPreview binding", () => {
    renderRow({ item: person, selected: false, flat: false, showMeta: false, onToggle: () => {} })
    expect(container.querySelector(".wk-fm-item-bot-expand")).toBeNull()
  })

  it("shows an expander on an UNSELECTED person row and previews their Bots read-only", () => {
    const onToggle = vi.fn()
    renderRow({
      item: person,
      selected: false,
      flat: false,
      showMeta: false,
      onToggle,
      botPreview: previewWith({ u_ada: [{ uid: "b_1", name: "Writer Bot" }] }),
    })
    const expand = container.querySelector(".wk-fm-item-bot-expand") as HTMLButtonElement
    expect(expand).not.toBeNull()
    // Expanding must NOT select the target (stopPropagation) and must reveal the Bot preview.
    act(() => { expand.click() })
    expect(onToggle).not.toHaveBeenCalled()
    const bots = container.querySelectorAll(".wk-fm-item-bot")
    expect(bots).toHaveLength(1)
    // The preview checkbox is disabled (display-only) and unchecked.
    const cb = bots[0].querySelector('[role="checkbox"]') as HTMLElement
    expect(cb.getAttribute("aria-disabled")).toBe("true")
    expect(cb.getAttribute("aria-checked")).toBe("false")
  })

  it("never renders an expander on a group/thread row (no whole-space bots there)", () => {
    // A group row: even if botsFor returned bots for its id, the row is not a person peer.
    renderRow({
      item: group,
      selected: false,
      flat: false,
      showMeta: false,
      onToggle: () => {},
      botPreview: previewWith({ g_1: [{ uid: "b_x", name: "Whole Space Bot" }] }),
    })
    expect(container.querySelector(".wk-fm-item-bot-expand")).toBeNull()

    // A thread person row is not a plain person peer either.
    act(() => { ReactDOM.unmountComponentAtNode(container) })
    renderRow({
      item: threadPerson,
      selected: false,
      flat: false,
      showMeta: false,
      onToggle: () => {},
      botPreview: previewWith({ u_ada: [{ uid: "b_1", name: "Writer Bot" }] }),
    })
    expect(container.querySelector(".wk-fm-item-bot-expand")).toBeNull()
  })

  it("clicking the row body still toggles selection when a preview exists", () => {
    const onToggle = vi.fn()
    renderRow({
      item: person,
      selected: false,
      flat: false,
      showMeta: false,
      onToggle,
      botPreview: previewWith({ u_ada: [{ uid: "b_1", name: "Writer Bot" }] }),
    })
    act(() => { (container.querySelector(".wk-fm-item") as HTMLElement).click() })
    expect(onToggle).toHaveBeenCalledTimes(1)
  })
})
