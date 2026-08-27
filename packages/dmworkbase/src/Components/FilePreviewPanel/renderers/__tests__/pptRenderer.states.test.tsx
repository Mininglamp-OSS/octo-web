// @vitest-environment jsdom
import React from "react"
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
const i18nMock = vi.hoisted(() => ({ t: (key: string) => key }))
vi.mock("../../../../i18n", () => ({ useI18n: () => i18nMock, t: i18nMock.t, I18nContext: React.createContext({}) }))
vi.mock("../PptPageRenderer", () => ({ default: (p: any) => <div data-testid="ppt-page">{p.index}:{"content" in p ? p.content : p.url}</div> }))
import PptRenderer from "../PptRenderer"

const originalScrollIntoView = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView")

describe("PptRenderer states", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    if (originalScrollIntoView) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", originalScrollIntoView)
    else delete (HTMLElement.prototype as any).scrollIntoView
  })

  it("renders loading, invalid data, and fetch errors", async () => {
    const file: any = { url: "ppt.json", name: "deck.ppt" }
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })))
    const onError = vi.fn()
    const { rerender } = render(<PptRenderer file={file} onError={onError} />)
    expect(screen.getByText("base.filePreview.ppt.loadingPresentation")).toBeInTheDocument()
    await waitFor(() => expect(onError).toHaveBeenCalled())
    expect(screen.getByText("base.filePreview.ppt.loadDataFailed")).toBeInTheDocument()
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline") }))
    rerender(<PptRenderer file={{ ...file, url: "bad.json" }} onError={onError} />)
    await waitFor(() => expect(screen.getByText("offline")).toBeInTheDocument())
  })

  it("renders pages, empty data, and exposes page navigation", async () => {
    const file: any = { url: "ppt.json", name: "deck.ppt" }
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ total: 2, data: [{ index: 0, content: "<h1>A</h1>" }, { index: 1, url: "page.html" }] }) })))
    const ref = React.createRef<any>()
    const { container } = render(<PptRenderer ref={ref} file={file} previewOnly />)
    await waitFor(() => expect(screen.getAllByTestId("ppt-page")).toHaveLength(2))
    expect(container.textContent).toContain("A")
    ref.current?.jumpToPage(1)
    ref.current?.jumpToPage(99)
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ total: 0, data: [] }) })))
    render(<PptRenderer file={{ ...file, url: "empty.json" }} />)
    await waitFor(() => expect(screen.getByText("base.filePreview.ppt.noContent")).toBeInTheDocument())
  })
})
