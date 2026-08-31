// @vitest-environment jsdom
import React from "react"
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
const i18nMock = vi.hoisted(() => ({ t: (key: string) => key }))
vi.mock("../../../../i18n", () => ({ useI18n: () => i18nMock, I18nContext: React.createContext({}) }))
vi.mock("../HtmlIframeRenderer", () => ({ default: (p: any) => <iframe title="preview" srcDoc={p.srcDoc} /> }))
vi.mock("react-syntax-highlighter", () => ({ Prism: ({ children }: any) => <pre>{children}</pre> }))
vi.mock("react-syntax-highlighter/dist/esm/styles/prism", () => ({ vscDarkPlus: {} }))
import PptPageRenderer from "../PptPageRenderer"

describe("PptPageRenderer states", () => {
  beforeEach(() => { vi.stubGlobal("ResizeObserver", class { observe() {}; disconnect() {} }) })
  afterEach(() => vi.unstubAllGlobals())

  it("renders code/preview modes, sizing messages, and preview-only mode", () => {
    const { container } = render(<PptPageRenderer content="<body>Hello</body>" index={1} total={3} pageId="p1" />)
    expect(screen.getByText("1")).toBeInTheDocument()
    fireEvent.click(container.querySelectorAll("button")[1])
    expect(screen.getByText("<body>Hello</body>")).toBeInTheDocument()
    fireEvent.click(container.querySelectorAll("button")[0])
    window.dispatchEvent(new MessageEvent("message", { data: { type: "ppt_page_size", pageId: "p1", width: 800, height: 600 } }))
    render(<PptPageRenderer content="<p>Preview</p>" index={2} total={3} previewOnly />)
    expect(screen.getAllByTitle("preview").length).toBeGreaterThan(0)
  })

  it("loads URL content and reports failed responses", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url.includes("ok")
      ? ({ ok: true, text: async () => "<body>loaded</body>" })
      : ({ ok: false, text: async () => "" })))
    const { rerender } = render(<PptPageRenderer url="ok.html" index={1} total={1} />)
    await waitFor(() => expect(screen.getByText("HTML")).toBeInTheDocument())
    rerender(<PptPageRenderer url="bad.html" index={1} total={1} />)
    await waitFor(() => expect(screen.getByText("base.filePreview.loadFailed")).toBeInTheDocument())
  })
})
