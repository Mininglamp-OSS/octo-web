import React from "react"
import ReactDOM from "react-dom"
import { act } from "react-dom/test-utils"
import { fireEvent } from "@testing-library/dom"
import { describe, expect, it, vi } from "vitest"
import ThreadCreateDialog, { ThreadCreateForm, ThreadCreateLabels } from "../index"

vi.mock("../../../Components/WKModal", () => ({
  default: ({ visible, children }: { visible: boolean; children: React.ReactNode }) => (
    <div data-visible={visible ? "true" : "false"}>{children}</div>
  ),
}))

vi.mock("../../../Components/VoiceInputButton", () => ({
  default: () => <button type="button">Voice</button>,
}))

const labels: ThreadCreateLabels = {
  cancel: "Cancel",
  create: "Create",
  creating: "Creating",
  maxLength: "Too long",
  nameRequired: "Required",
}

describe("ThreadCreateDialog", () => {
  it("resets local form state after closing and reopening", () => {
    const container = document.createElement("div")
    document.body.appendChild(container)

    const renderDialog = (visible: boolean) => {
      act(() => {
        ReactDOM.render(
          <ThreadCreateDialog
            visible={visible}
            title="Create thread"
            placeholder="Thread name"
            labels={labels}
            onSubmit={vi.fn()}
            onCancel={vi.fn()}
          />,
          container
        )
      })
    }

    try {
      renderDialog(true)

      const input = container.querySelector<HTMLInputElement>('input[placeholder="Thread name"]')
      expect(input).not.toBeNull()
      fireEvent.change(input!, { target: { value: "Draft topic" } })

      renderDialog(false)
      renderDialog(true)

      const reopenedInput = container.querySelector<HTMLInputElement>(
        'input[placeholder="Thread name"]'
      )

      expect(reopenedInput?.value).toBe("")
    } finally {
      ReactDOM.unmountComponentAtNode(container)
      container.remove()
    }
  })

  it("clears parent-supplied errors when the user edits the name", () => {
    const container = document.createElement("div")
    document.body.appendChild(container)

    function FormWithParentError() {
      const [error, setError] = React.useState<string | null>("Server error")
      return (
        <ThreadCreateForm
          placeholder="Thread name"
          labels={labels}
          error={error}
          onChange={() => setError(null)}
          onSubmit={vi.fn()}
        />
      )
    }

    try {
      act(() => {
        ReactDOM.render(<FormWithParentError />, container)
      })

      expect(container.textContent).toContain("Server error")
      const input = container.querySelector<HTMLInputElement>('input[placeholder="Thread name"]')
      expect(input).not.toBeNull()

      act(() => {
        fireEvent.change(input!, { target: { value: "New topic" } })
      })

      expect(container.textContent).not.toContain("Server error")
    } finally {
      ReactDOM.unmountComponentAtNode(container)
      container.remove()
    }
  })

  it("resets a directly used form when resetKey changes", () => {
    const container = document.createElement("div")
    document.body.appendChild(container)

    const renderForm = (resetKey: number) => {
      act(() => {
        ReactDOM.render(
          <ThreadCreateForm
            placeholder="Thread name"
            labels={labels}
            resetKey={resetKey}
            onSubmit={vi.fn()}
          />,
          container
        )
      })
    }

    try {
      renderForm(1)
      const input = container.querySelector<HTMLInputElement>('input[placeholder="Thread name"]')
      expect(input).not.toBeNull()
      fireEvent.change(input!, { target: { value: "Draft topic" } })

      renderForm(2)

      const resetInput = container.querySelector<HTMLInputElement>('input[placeholder="Thread name"]')
      expect(resetInput?.value).toBe("")
    } finally {
      ReactDOM.unmountComponentAtNode(container)
      container.remove()
    }
  })
})
