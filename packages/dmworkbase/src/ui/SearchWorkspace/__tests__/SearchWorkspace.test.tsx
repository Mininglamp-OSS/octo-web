// @vitest-environment jsdom
import React from "react"
import { describe, expect, it, vi } from "vitest"
import { fireEvent, render } from "@testing-library/react"
import SearchWorkspace from "../index"

describe("SearchWorkspace", () => {
  it("renders tabs, actions, errors and forwards input events", () => {
    const onChange = vi.fn(), onTabChange = vi.fn(), onStart = vi.fn(), onEnd = vi.fn()
    const { container } = render(<SearchWorkspace search={{ value: "q", placeholder: "Search", autoFocus: true, trailing: <button>clear</button>, onChange, onCompositionStart: onStart, onCompositionEnd: onEnd }} tabs={[{ key: "all", label: "All" }, { key: "files", label: "Files" }]} activeTab="all" onTabChange={onTabChange} actions={<button>filter</button>} error="error"><div>content</div></SearchWorkspace>)
    const input = container.querySelector("input")!
    fireEvent.change(input, { target: { value: "next" } })
    fireEvent.compositionStart(input)
    fireEvent.compositionEnd(input)
    fireEvent.click(container.querySelectorAll("button")[2])
    expect(onChange).toHaveBeenCalledWith("next")
    expect(onStart).toHaveBeenCalled()
    expect(onEnd).toHaveBeenCalled()
    expect(onTabChange).toHaveBeenCalledWith("files")
    expect(container.textContent).toContain("content")
  })
})
