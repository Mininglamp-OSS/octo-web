import React from "react"
import { act, cleanup, fireEvent, render } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ItemList } from "../ItemList"
import type { ForwardItem } from "../../ForwardModal"

vi.mock("../../../../i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock("../../../VisibilityTrigger", () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }))
vi.mock("../ItemRow", () => ({
  ItemRow: ({ item, onToggle }: { item: ForwardItem; onToggle: (item: ForwardItem) => void }) =>
    <button onClick={() => onToggle(item)}>{item.displayName}</button>,
}))
const item = { channelID: "g1", channelType: 2, displayName: "Available group" }
const defaults = { selectedSet: new Set<string>(), flat: true, showMeta: true, onToggleSelect: vi.fn() }
afterEach(cleanup)

describe("progressive candidate rendering", () => {
  it("keeps available rows selectable while another source is loading", () => {
    const onToggleSelect = vi.fn()
    const view = render(<ItemList {...defaults} items={[item]} loading onToggleSelect={onToggleSelect} />)
    fireEvent.click(view.getByText(item.displayName))
    expect(onToggleSelect).toHaveBeenCalledWith(item)
    expect(view.getByRole("status").textContent).toContain("base.forwardModal.loading")
    expect(view.queryByText("base.forwardModal.noContacts")).toBeNull()
  })

  it("shows a retryable failure beside available rows instead of an empty state", () => {
    const retry = vi.fn()
    const view = render(<ItemList {...defaults} items={[item]} loading={false} loadError onRetry={retry} />)
    expect(view.getByText(item.displayName)).toBeTruthy()
    expect(view.getByRole("alert")).toBeTruthy()
    act(() => fireEvent.click(view.getByText("base.forwardModal.retry")))
    expect(retry).toHaveBeenCalledOnce()
    expect(view.queryByText("base.forwardModal.noContacts")).toBeNull()
  })

  it("only declares an empty result when loading has settled without an error", () => {
    const view = render(<ItemList {...defaults} items={[]} loading />)
    expect(view.queryByText("base.forwardModal.noContacts")).toBeNull()
    view.rerender(<ItemList {...defaults} items={[]} loading={false} loadError />)
    expect(view.queryByText("base.forwardModal.noContacts")).toBeNull()
    view.rerender(<ItemList {...defaults} items={[]} loading={false} />)
    expect(view.getByText("base.forwardModal.noContacts")).toBeTruthy()
  })
})
