// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import React from "react"
import ReactDOM from "react-dom"
import { act } from "react-dom/test-utils"

// No wukongimjssdk or WKApp mocks needed — ForwardModalView is pure UI.
vi.mock("../../Checkbox", () => ({
  default: ({ checked, onCheck }: { checked?: boolean; onCheck?: () => void }) => (
    <div role="checkbox" aria-checked={!!checked} onClick={() => onCheck?.()} />
  ),
}))
vi.mock("../../AiBadge", () => ({ default: () => <span data-testid="ai-badge" /> }))
vi.mock("../../../i18n", () => ({
  useI18n: () => ({
    t: (key: string, opts?: { values?: Record<string, unknown> }) =>
      opts?.values ? `${key}:${JSON.stringify(opts.values)}` : key,
  }),
}))

import { ForwardModalView, type ForwardModalViewItem, type ForwardAvatarRenderer } from "../ForwardModalView"

const items: ForwardModalViewItem[] = [
  { channelID: "u1", channelType: 1, displayName: "Alice" },
  { channelID: "g1", channelType: 2, displayName: "Team" },
]

const renderAvatar: ForwardAvatarRenderer = ({ displayName, avatarURL }) => {
  if (avatarURL) return <img data-testid="avatar-img" src={avatarURL} alt="" />
  return <span data-testid="avatar-initials">{displayName[0]}</span>
}

describe("ForwardModalView (pure, no wukong deps)", () => {
  let container: HTMLDivElement
  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
  })
  afterEach(() => {
    act(() => { ReactDOM.unmountComponentAtNode(container) })
    container.remove()
  })

  function renderView(props: Partial<React.ComponentProps<typeof ForwardModalView>> = {}) {
    const defaults = {
      items, selectedIDs: [] as string[], inputValue: "",
      onInputChange: vi.fn(), onToggleSelect: vi.fn(),
      onConfirm: vi.fn(), activeTab: "recent" as const,
      onTabChange: vi.fn(), renderAvatar,
    }
    act(() => { ReactDOM.render(<ForwardModalView {...defaults} {...props} />, container) })
  }

  it("renders items and default title", () => {
    renderView()
    expect(container.textContent).toContain("Alice")
    expect(container.textContent).toContain("Team")
    expect(container.textContent).toContain("base.forwardModal.title")
  })

  it("renders avatar via injected renderer (no WKAvatar)", () => {
    renderView()
    const initials = container.querySelectorAll("[data-testid='avatar-initials']")
    expect(initials.length).toBe(2)
  })

  it("renders avatar with URL when provided", () => {
    const itemsWithUrl: ForwardModalViewItem[] = [
      { channelID: "b1", channelType: 1, displayName: "Bot", avatarURL: "https://example.com/avatar.png" },
    ]
    renderView({ items: itemsWithUrl })
    const imgs = container.querySelectorAll("[data-testid='avatar-img']")
    expect(imgs.length).toBe(1)
    expect(imgs[0].getAttribute("src")).toBe("https://example.com/avatar.png")
  })

  it("shows empty state when no items", () => {
    renderView({ items: [] })
    expect(container.textContent).toContain("base.forwardModal.noContacts")
  })

  it("shows loading state", () => {
    renderView({ items: [], loading: true })
    expect(container.textContent).toContain("base.forwardModal.loading")
  })

  it("shows load error with retry", () => {
    const onRetry = vi.fn()
    renderView({ loadError: true, onRetry })
    expect(container.textContent).toContain("base.forwardModal.loadError")
    const retryBtn = container.querySelector(".wk-fm-btn--cancel") as HTMLButtonElement
    act(() => { retryBtn.click() })
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it("fires onToggleSelect when clicking an item row", () => {
    const onToggleSelect = vi.fn()
    renderView({ onToggleSelect })
    const row = container.querySelector(".wk-fm-item") as HTMLElement
    act(() => { row.click() })
    expect(onToggleSelect).toHaveBeenCalledTimes(1)
    expect(onToggleSelect.mock.calls[0][0].channelID).toBe("u1")
  })

  it("shows selected items in right panel", () => {
    renderView({ selectedIDs: ["u1"] })
    expect(container.textContent).toContain("base.forwardModal.selectedCount")
  })

  it("fires onConfirm via footer button", () => {
    const onConfirm = vi.fn()
    renderView({ selectedIDs: ["u1"], onConfirm })
    const confirmBtn = container.querySelector(".wk-fm-btn--confirm") as HTMLButtonElement
    act(() => { confirmBtn.click() })
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it("fires onCancel via footer button", () => {
    const onCancel = vi.fn()
    renderView({ onCancel })
    const cancelBtn = container.querySelectorAll(".wk-fm-btn--cancel")[0] as HTMLButtonElement
    act(() => { cancelBtn.click() })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
