// @vitest-environment jsdom
import React from "react"
import { describe, expect, it, vi } from "vitest"
import { fireEvent, render } from "@testing-library/react"
vi.mock("../../../../i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }))
class ResizeObserverMock { observe() {} disconnect() {} unobserve() {} }
vi.stubGlobal("ResizeObserver", ResizeObserverMock)
import SingleImage from "../SingleImage"

describe("SingleImage transfer states", () => {
  it("renders normal, sending, uploading and failed image states", () => {
    const retry = vi.fn()
    const normal = render(<SingleImage src="image.png" width={1200} height={800} onClick={vi.fn()} />)
    expect(normal.container.querySelector("img")).toBeInTheDocument()
    const uploading = render(<SingleImage src="image.png" width={120} height={80} transferState={{ status: "uploading", progress: 42 }} />)
    expect(uploading.container.textContent).toContain("42%")
    const sending = render(<SingleImage src="image.png" width={120} height={80} transferState={{ status: "sending" }} />)
    expect(sending.container.textContent).toContain("base.message.sending")
    const failed = render(<SingleImage src="image.png" width={120} height={80} transferState={{ status: "failed", onRetry: retry }} />)
    const retryBox = failed.container.querySelector("[role=button]")!
    fireEvent.click(retryBox)
    fireEvent.keyDown(retryBox, { key: "Enter" })
    expect(retry).toHaveBeenCalledTimes(2)
  })
})
