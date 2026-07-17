import React from "react"
import ReactDOM from "react-dom"
import { act } from "react-dom/test-utils"
import { fireEvent } from "@testing-library/dom"
import { describe, expect, it, vi } from "vitest"
import ThreadCreateDialog, { ThreadCreateLabels } from "../index"

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
})
