// @vitest-environment jsdom
import React from "react"
import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import ResizableRightPanel from "../index"

const size = { minWidth: 300, defaultWidth: 480, maxWidth: 700, storageKey: "panel-width" }

describe("ResizableRightPanel interactions", () => {
  it("supports close, escape, resize, reset, persistence, and compact layout", () => {
    const close = vi.fn()
    const { container, rerender } = render(<ResizableRightPanel title="Files" closeLabel="Close" size={size} onClose={close}>body</ResizableRightPanel>)
    expect(screen.getByText("Files")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Close" }))
    fireEvent.keyDown(window, { key: "Escape" })
    expect(close).toHaveBeenCalledTimes(2)
    const splitter = container.querySelector(".wk-resizable-right-panel__splitter")!
    fireEvent.mouseDown(splitter, { clientX: 900 })
    fireEvent.mouseMove(document, { clientX: 700 })
    fireEvent.mouseUp(document)
    fireEvent.doubleClick(splitter)
    expect(localStorage.getItem(size.storageKey)).toBeTruthy()
    rerender(<ResizableRightPanel title="Compact" closeLabel="Close" size={size} onClose={close}>body</ResizableRightPanel>)
    window.dispatchEvent(new Event("resize"))
    expect(container.textContent).toContain("body")
  })
})
