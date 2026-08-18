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

// Heavy host deps stubbed so the panel renders in isolation.
vi.mock("../../../WKAvatar", () => ({ default: () => <div data-testid="avatar" /> }))
vi.mock("../../../AiBadge", () => ({ default: () => <span data-testid="ai-badge" /> }))
vi.mock("lucide-react", () => ({ X: () => <span data-testid="x-icon" /> }))
vi.mock("@octo/ui", () => ({
  Checkbox: ({
    checked,
    disabled,
    onCheckedChange,
    "aria-label": ariaLabel,
  }: {
    checked?: boolean
    disabled?: boolean
    onCheckedChange?: (checked: boolean) => void
    "aria-label"?: string
  }) => (
    <div
      role="checkbox"
      aria-checked={!!checked}
      aria-disabled={!!disabled}
      aria-label={ariaLabel}
      onClick={() => {
        if (!disabled) onCheckedChange?.(!checked)
      }}
    />
  ),
}))
vi.mock("../../../../i18n", () => ({
  useI18n: () => ({
    t: (key: string, opts?: { values?: Record<string, unknown> }) =>
      opts?.values ? `${key}:${JSON.stringify(opts.values)}` : key,
  }),
}))

import { SelectedPanel } from "../SelectedPanel"
import type { ForwardBotSnapshot } from "../../grant"

type ForwardItem = {
  channelID: string
  channelType: number
  displayName: string
  isThread?: boolean
}

const ada: ForwardItem = { channelID: "u_ada", channelType: 1, displayName: "Ada" }
const grace: ForwardItem = { channelID: "u_grace", channelType: 1, displayName: "Grace" }
const team: ForwardItem = { channelID: "g_1", channelType: 2, displayName: "Team" }
const threadPerson: ForwardItem = { channelID: "u_ada", channelType: 1, displayName: "Ada", isThread: true }

/** Build a ready snapshot whose per-creator groups mirror the 授权区 selection. */
function snapshot(
  groups: Array<{ uid: string; name: string; bots: Array<{ uid: string; name: string; selected: boolean }> }>,
  toggleBot = vi.fn(),
): ForwardBotSnapshot {
  return { ready: true, peopleCount: groups.length, botCount: 0, groups, toggleBot }
}

describe("SelectedPanel right-side Bot parity (Scope C)", () => {
  let container: HTMLDivElement
  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
  })
  afterEach(() => {
    act(() => {
      ReactDOM.unmountComponentAtNode(container)
    })
    container.remove()
  })

  function renderPanel(props: React.ComponentProps<typeof SelectedPanel>) {
    act(() => {
      ReactDOM.render(<SelectedPanel {...props} />, container)
    })
  }

  it("renders no nested Bots when no snapshot is provided (legacy behaviour)", () => {
    renderPanel({ selectedItems: [ada], onRemove: () => {} })
    expect(container.querySelector(".wk-fm-selected-bots")).toBeNull()
  })

  it("shows a selected person's default-selected Bots nested beneath them", () => {
    renderPanel({
      selectedItems: [ada],
      onRemove: () => {},
      bots: snapshot([
        {
          uid: "u_ada",
          name: "Ada",
          bots: [
            { uid: "b_1", name: "Writer Bot", selected: true },
            { uid: "b_2", name: "Review Bot", selected: true },
          ],
        },
      ]),
    })
    const nested = container.querySelectorAll(".wk-fm-selected-bot")
    expect(nested).toHaveLength(2)
    // Both default-checked, mirroring the 授权区.
    const boxes = container.querySelectorAll(".wk-fm-selected-bot [role='checkbox']")
    expect([...boxes].every((b) => b.getAttribute("aria-checked") === "true")).toBe(true)
    expect(container.textContent).toContain("Writer Bot")
    expect(container.textContent).toContain("Review Bot")
  })

  it("reflects a cancelled Bot (checkbox unchecked) and delegates toggling to the SAME snapshot.toggleBot", () => {
    const toggleBot = vi.fn()
    renderPanel({
      selectedItems: [ada],
      onRemove: () => {},
      bots: snapshot(
        [
          {
            uid: "u_ada",
            name: "Ada",
            bots: [
              { uid: "b_1", name: "Writer Bot", selected: true },
              { uid: "b_2", name: "Review Bot", selected: false },
            ],
          },
        ],
        toggleBot,
      ),
    })
    const boxes = container.querySelectorAll(".wk-fm-selected-bot [role='checkbox']")
    expect(boxes[0].getAttribute("aria-checked")).toBe("true")
    // A cancelled Bot in the shared snapshot shows unchecked on the right immediately.
    expect(boxes[1].getAttribute("aria-checked")).toBe("false")
    // Interacting delegates to the authoritative toggle — no independent right-side state.
    act(() => {
      ;(boxes[1] as HTMLElement).click()
    })
    expect(toggleBot).toHaveBeenCalledWith("b_2")
  })

  it("nests each person's Bots under the RIGHT person (no flattening across people)", () => {
    renderPanel({
      selectedItems: [ada, grace],
      onRemove: () => {},
      bots: snapshot([
        { uid: "u_ada", name: "Ada", bots: [{ uid: "b_1", name: "Ada Bot", selected: true }] },
        { uid: "u_grace", name: "Grace", bots: [{ uid: "b_2", name: "Grace Bot", selected: true }] },
      ]),
    })
    const wraps = container.querySelectorAll(".wk-fm-selected-item-wrap")
    expect(wraps).toHaveLength(2)
    // Each person's wrapper contains only their own Bot.
    expect(wraps[0].textContent).toContain("Ada Bot")
    expect(wraps[0].textContent).not.toContain("Grace Bot")
    expect(wraps[1].textContent).toContain("Grace Bot")
    expect(wraps[1].textContent).not.toContain("Ada Bot")
  })

  it("does NOT nest Bots under a GROUP target (right panel keeps groups flat)", () => {
    renderPanel({
      selectedItems: [team],
      onRemove: () => {},
      // A group's members might create Bots, but the snapshot groups are keyed by PERSON uid; the
      // group's own channelID never matches, so nothing nests under the group row.
      bots: snapshot([{ uid: "u_ada", name: "Ada", bots: [{ uid: "b_1", name: "Ada Bot", selected: true }] }]),
    })
    expect(container.querySelector(".wk-fm-selected-bots")).toBeNull()
    expect(container.textContent).not.toContain("Ada Bot")
  })

  it("does NOT nest Bots under a THREAD person target", () => {
    renderPanel({
      selectedItems: [threadPerson],
      onRemove: () => {},
      bots: snapshot([{ uid: "u_ada", name: "Ada", bots: [{ uid: "b_1", name: "Ada Bot", selected: true }] }]),
    })
    expect(container.querySelector(".wk-fm-selected-bots")).toBeNull()
  })

  it("removing a person removes the person AND their nested Bots", () => {
    const onRemove = vi.fn()
    renderPanel({
      selectedItems: [ada],
      onRemove,
      bots: snapshot([{ uid: "u_ada", name: "Ada", bots: [{ uid: "b_1", name: "Ada Bot", selected: true }] }]),
    })
    const removeBtn = container.querySelector(".wk-fm-remove-btn") as HTMLButtonElement
    act(() => {
      removeBtn.click()
    })
    expect(onRemove).toHaveBeenCalledWith(ada)
  })

  it("renders no nested Bots while the snapshot is not ready (loading)", () => {
    renderPanel({
      selectedItems: [ada],
      onRemove: () => {},
      bots: { ready: false, peopleCount: 0, botCount: 0, groups: [], toggleBot: vi.fn() },
    })
    expect(container.querySelector(".wk-fm-selected-bots")).toBeNull()
  })
})
