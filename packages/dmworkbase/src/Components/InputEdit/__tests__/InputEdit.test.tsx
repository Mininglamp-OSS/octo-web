// @vitest-environment jsdom
import React from "react"
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import InputEdit from "../index"

;(globalThis as any).ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe("InputEdit", () => {
  it("reports changes, count overflow, and blocks Enter when wrapping is disabled", () => {
    const onChange = vi.fn()
    render(<InputEdit defaultValue="a" maxCount={2} onChange={onChange} placeholder="edit" />)
    const textarea = screen.getByPlaceholderText("edit")
    fireEvent.change(textarea, { target: { value: "abc" } })
    expect(onChange).toHaveBeenCalledWith("abc", true)
    expect(screen.getByText("3 / 2")).toBeTruthy()
    const event = new KeyboardEvent("keydown", { keyCode: 13, bubbles: true })
    const prevent = vi.spyOn(event, "preventDefault")
    textarea.dispatchEvent(event)
    expect(prevent).toHaveBeenCalled()
  })

  it("allows Enter when wrapping is enabled and omits the counter without a limit", () => {
    const onChange = vi.fn()
    render(<InputEdit allowWrap onChange={onChange} />)
    const textarea = screen.getByRole("textbox")
    fireEvent.change(textarea, { target: { value: "text" } })
    expect(onChange).toHaveBeenCalledWith("text", false)
    expect(screen.queryByText(/text \/ /)).toBeNull()
  })
})
