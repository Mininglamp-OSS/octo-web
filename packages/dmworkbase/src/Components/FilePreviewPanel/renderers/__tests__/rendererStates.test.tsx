// @vitest-environment jsdom
import React from "react"
import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  content: "<html><head></head><body>safe</body></html>",
  loading: false,
  error: null as string | null,
  reload: vi.fn(),
  downloadFile: vi.fn(),
}))

vi.mock("../../hooks/useFileContent", () => ({
  useFileContent: () => ({
    content: mocks.content,
    loading: mocks.loading,
    error: mocks.error,
    reload: mocks.reload,
  }),
}))

vi.mock("../../../../i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
  t: (key: string) => key,
}))

vi.mock("../../../../Utils/download", () => ({
  downloadFile: mocks.downloadFile,
}))

vi.mock("@react-pdf-viewer/core", () => ({
  Viewer: ({ renderError }: { renderError?: (error: { message: string }) => React.ReactNode }) =>
    renderError?.({ message: "corrupt pdf" }),
  Worker: ({ children }: { children: React.ReactNode }) => children,
  SpecialZoomLevel: { PageWidth: "PageWidth", PageFit: "PageFit", ActualSize: "ActualSize" },
}))
vi.mock("@react-pdf-viewer/thumbnail", () => ({ thumbnailPlugin: () => ({ Thumbnails: () => null }) }))
vi.mock("@react-pdf-viewer/bookmark", () => ({ bookmarkPlugin: () => ({ Bookmarks: () => null }) }))
vi.mock("@react-pdf-viewer/zoom", () => ({
  zoomPlugin: () => ({ ZoomIn: () => null, ZoomOut: () => null, zoomTo: vi.fn() }),
}))
vi.mock("@react-pdf-viewer/page-navigation", () => ({ pageNavigationPlugin: () => ({ jumpToPage: vi.fn() }) }))
vi.mock("@douyinfe/semi-ui", () => ({ Tooltip: ({ children }: { children: React.ReactNode }) => children }))
vi.mock("../../icons", () => ({
  IconMenuFold: () => null,
  IconMinus: () => null,
  IconPlus: () => null,
}))

const resizeObserver = class {
  observe() {}
  disconnect() {}
}

import ImageRenderer from "../ImageRenderer"
import VideoRenderer from "../VideoRenderer"
import PdfRenderer from "../PdfRenderer"
import HtmlRenderer from "../HtmlRenderer"
import FallbackRenderer from "../FallbackRenderer"

const file = {
  url: "https://files.example/file",
  name: "file.bin",
  extension: "bin",
  size: 100,
}

describe("file preview renderer failure states", () => {
  beforeEach(() => {
    mocks.content = "<html><head></head><body>safe</body></html>"
    mocks.loading = false
    mocks.error = null
    mocks.reload.mockReset()
    mocks.downloadFile.mockReset()
    vi.stubGlobal("ResizeObserver", resizeObserver)
  })

  it("shows an image load error, notifies the caller, and allows retry", () => {
    const onError = vi.fn()
    const { container } = render(<ImageRenderer file={{ ...file, extension: "png" }} onError={onError} />)
    const image = container.querySelector("img")!

    fireEvent.error(image)

    expect(onError).toHaveBeenCalledWith("base.filePreview.image.loadFailed")
    expect(screen.getByText("base.filePreview.image.loadFailed")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "base.filePreview.retry" }))
    expect(container.querySelector("img")).toBeTruthy()
  })

  it("shows a video load error, notifies the caller, and allows retry", () => {
    const onError = vi.fn()
    const { container } = render(<VideoRenderer file={{ ...file, extension: "mp4" }} onError={onError} />)
    fireEvent.error(container.querySelector("video")!)

    expect(onError).toHaveBeenCalledWith("base.filePreview.video.loadFailed")
    expect(screen.getByText("base.filePreview.video.loadFailed")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "base.filePreview.retry" }))
    expect(container.querySelector("video")).toBeTruthy()
  })

  it("fails closed for a PDF without a URL", () => {
    render(<PdfRenderer file={{ ...file, url: "", extension: "pdf" }} />)

    expect(screen.getByText("base.filePreview.pdf.loadUnavailable")).toBeTruthy()
    expect(screen.queryByText("base.filePreview.loading")).toBeNull()
  })

  it("shows a PDF parse error and preserves the viewer error detail", () => {
    render(<PdfRenderer file={{ ...file, extension: "pdf" }} />)

    expect(screen.getByText("base.filePreview.pdf.loadFailed")).toBeTruthy()
    expect(screen.getByText("corrupt pdf")).toBeTruthy()
  })

  it("uses the unsupported-file fallback for Office formats", () => {
    render(<FallbackRenderer file={{ ...file, name: "report.docx", extension: "docx" }} />)

    expect(screen.getByText("base.filePreview.unsupportedType")).toBeTruthy()
  })

  it("renders HTML in a sandbox and injects the CSP monitor", () => {
    const { container } = render(<HtmlRenderer file={{ ...file, extension: "html" }} />)
    const iframe = container.querySelector("iframe")!

    expect(iframe.getAttribute("sandbox")).toBe("allow-scripts")
    expect(iframe.getAttribute("sandbox")).not.toContain("allow-same-origin")
    expect(iframe.srcdoc).toContain('data-wk="csp-monitor"')
    expect(iframe.srcdoc).toContain("securitypolicyviolation")
  })

  it("disables HTML preview after a CSP violation from its own iframe", () => {
    const { container } = render(<HtmlRenderer file={{ ...file, extension: "html" }} />)
    const iframe = container.querySelector("iframe")!
    const source = iframe.contentWindow

    window.dispatchEvent(new MessageEvent("message", {
      source,
      data: { type: "html-csp-violation", directive: "script-src" },
    }))

    expect(screen.getByText("base.filePreview.html.safePreviewBlockedTitle")).toBeTruthy()
    expect(container.querySelector("iframe")).toBeNull()
  })

  it("reports content loading failures and exposes retry", () => {
    mocks.error = "network failed"
    render(<HtmlRenderer file={{ ...file, extension: "html" }} />)

    expect(screen.getByText("network failed")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "base.filePreview.retry" }))
    expect(mocks.reload).toHaveBeenCalledTimes(1)
  })
})
