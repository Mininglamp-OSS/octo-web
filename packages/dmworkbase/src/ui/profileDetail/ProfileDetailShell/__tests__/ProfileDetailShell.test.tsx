// @vitest-environment jsdom
import React from "react"
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import ProfileDetailShell, { ProfileDetailFooter, ProfileDetailHeader } from "../index"

describe("profile detail layout primitives", () => {
  it("renders loading and content modes with a close action", () => {
    const onClose = vi.fn()
    const { rerender } = render(<ProfileDetailShell loading loadingNode={<span>wait</span>} closeLabel="Close" onClose={onClose}><span>body</span></ProfileDetailShell>)
    fireEvent.click(screen.getByRole("button", { name: "Close" }))
    expect(onClose).toHaveBeenCalled()
    expect(screen.getByText("wait")).toBeTruthy()
    rerender(<ProfileDetailShell loading={false} loadingNode={null} footer={<span>footer</span>}><span>body</span></ProfileDetailShell>)
    expect(screen.getByText("body")).toBeTruthy()
    expect(screen.getByText("footer")).toBeTruthy()
  })

  it("filters empty metadata and switches footer between hint and action", () => {
    render(<>
      <ProfileDetailHeader avatar={<span>a</span>} title="Title" subtitle="Sub"
        metaItems={[{ label: "A", value: "1" }, { label: "B", value: "" }, { label: "C", value: null }]} />
      <ProfileDetailFooter hint="Hint" action={<button>Action</button>} />
    </>)
    expect(screen.getByText("1")).toBeTruthy()
    expect(screen.queryByText("B")).toBeNull()
    expect(screen.getByText("Hint")).toBeTruthy()
    expect(screen.queryByText("Action")).toBeNull()
  })
})
