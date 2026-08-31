// @vitest-environment jsdom
import React from "react"
import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"

vi.mock("../../../i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock("@douyinfe/semi-ui", () => ({
  Modal: ({ visible, footer, children, onCancel }: any) => visible ? <div><button aria-label="modal-cancel" onClick={onCancel} />{children}{footer}</div> : null,
  Input: React.forwardRef(({ value, onChange, onKeyDown, ...props }: any, ref: any) => <input ref={ref} value={value} onChange={(e) => onChange(e.target.value)} onKeyDown={onKeyDown} {...props} />),
  Button: ({ children, onClick, disabled, ...props }: any) => <button disabled={disabled} onClick={onClick} {...props}>{children}</button>,
}))
import CreateCategoryModal from "../index"

describe("CreateCategoryModal", () => {
  it("validates empty and duplicate names, then confirms a new name", async () => {
    const onConfirm = vi.fn(async () => undefined)
    const onCancel = vi.fn()
    const { rerender } = render(<CreateCategoryModal visible onConfirm={onConfirm} onCancel={onCancel} existingNames={["Existing"]} />)
    const input = screen.getByRole("textbox")
    const ok = screen.getByRole("button", { name: "base.common.ok" })
    expect(ok).toBeDisabled()
    fireEvent.change(input, { target: { value: "Existing" } })
    expect(screen.getByText("base.createCategory.error.duplicate")).toBeInTheDocument()
    expect(ok).toBeDisabled()
    fireEvent.change(input, { target: { value: " New Group " } })
    fireEvent.keyDown(input, { key: "Enter" })
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith("New Group"))
    fireEvent.click(screen.getByLabelText("modal-cancel"))
    expect(onCancel).toHaveBeenCalled()
    rerender(<CreateCategoryModal visible={false} onConfirm={onConfirm} onCancel={onCancel} />)
  })

  it("shows the create error and supports Escape", async () => {
    const onConfirm = vi.fn(async () => { throw new Error("failed") })
    const onCancel = vi.fn()
    render(<CreateCategoryModal visible onConfirm={onConfirm} onCancel={onCancel} />)
    const input = screen.getByRole("textbox")
    fireEvent.change(input, { target: { value: "Name" } })
    fireEvent.keyDown(input, { key: "Enter" })
    await waitFor(() => expect(screen.getByText("base.createCategory.error.createFailed")).toBeInTheDocument())
    fireEvent.keyDown(input, { key: "Escape" })
    expect(onCancel).toHaveBeenCalled()
  })
})
