// @vitest-environment jsdom
import React from "react"
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import AIMessageCard from "../index"
import AITag from "../../AITag"

describe("AI message visuals", () => {
  it("renders single, multi, collapsed, and expanded participant states", () => {
    const onToggle = vi.fn()
    const one = [{ id: "1", name: "One", avatar: "/one.png" }]
    const many = Array.from({ length: 6 }, (_, i) => ({ id: String(i), name: `AI${i}`, avatar: `/ai${i}.png` }))
    const { rerender } = render(<AIMessageCard participants={one} content="preview" messageCount={2} onToggle={onToggle} />)
    fireEvent.click(screen.getByRole("button"))
    expect(onToggle).toHaveBeenCalled()
    rerender(<AIMessageCard participants={many} content="hidden" messageCount={6} isExpanded />)
    expect(screen.getByText("AI0")).toBeTruthy()
    expect(screen.queryByText("hidden")).toBeNull()
    render(<AITag aiCount={1} />)
    render(<AITag aiCount={2} />)
  })
})
