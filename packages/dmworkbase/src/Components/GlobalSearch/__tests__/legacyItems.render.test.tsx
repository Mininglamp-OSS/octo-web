// @vitest-environment jsdom
import React from "react"
import { describe, expect, it, vi } from "vitest"
import { fireEvent, render } from "@testing-library/react"
import ItemMessage from "../item-message"
import ItemContacts from "../item-contacts"
import ItemFile from "../item-file"

vi.mock("../../WKAvatar", () => ({ default: () => <span data-testid="avatar" /> }))
vi.mock("../../AiBadge", () => ({ default: () => <span data-testid="ai" /> }))

describe("legacy global-search result items", () => {
  it("renders message and contact highlights, source labels, and click callbacks", () => {
    const click = vi.fn()
    const { container, rerender } = render(<ItemMessage avatar="a" name="Chat" digest="<mark>hello</mark>" sender="Alice" senderSourceSpaceName="External" onClick={click} />)
    fireEvent.click(container.firstElementChild!)
    expect(click).toHaveBeenCalled()
    rerender(<ItemContacts avatar="a" name="<mark>Alice</mark>" isBot sourceSpaceName="External" onClick={click} />)
    expect(container.textContent).toContain("@External")
    expect(container.querySelector("[data-testid=ai]")).toBeInTheDocument()
  })

  it("renders file metadata and tolerates missing optional size", () => {
    const click = vi.fn()
    const { container } = render(<ItemFile sender="Alice" onClick={click} message={{ payload: { name: "report.pdf", size: 0 }, channel: { channel_name: "Docs" }, timestamp: 1 }} />)
    fireEvent.click(container.firstElementChild!)
    expect(click).toHaveBeenCalled()
    expect(container.textContent).toContain("report.pdf")
    expect(container.textContent).toContain("Docs")
  })
})
