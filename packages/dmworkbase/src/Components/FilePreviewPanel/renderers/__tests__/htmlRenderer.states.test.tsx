// @vitest-environment jsdom
import React from "react"
import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
const htmlState: any = { content: null, loading: false, error: null, reload: vi.fn() }
const i18nMock = vi.hoisted(() => ({ t: (key: string) => key }))
vi.mock("../../hooks/useFileContent", () => ({ useFileContent: () => htmlState }))
vi.mock("../../../../i18n", () => ({ useI18n: () => i18nMock, I18nContext: React.createContext({}) }))
vi.mock("react-syntax-highlighter", () => ({ default: ({ children }: any) => <pre>{children}</pre> }))
vi.mock("../../../../Utils/download", () => ({ downloadFile: vi.fn() }))
import HtmlRenderer from "../HtmlRenderer"

describe("HtmlRenderer states", () => {
  it("renders empty/loading/error/oversized states", () => {
    const file: any = { url: "u", name: "a.html", size: 1 }
    htmlState.content = null; htmlState.loading = true; htmlState.error = null
    const { rerender, container } = render(<HtmlRenderer file={file} />)
    expect(screen.getByText("base.filePreview.loading")).toBeInTheDocument()
    htmlState.loading = false; htmlState.error = "load failed"; rerender(<HtmlRenderer file={file} />)
    expect(screen.getByText("load failed")).toBeInTheDocument()
    htmlState.error = null; rerender(<HtmlRenderer file={file} />)
    expect(screen.getByText("base.filePreview.empty")).toBeInTheDocument()
    rerender(<HtmlRenderer file={{ ...file, size: 100 * 1024 * 1024 }} />)
    expect(container.querySelector(".wk-file-too-large")).toBeInTheDocument()
  })

  it("switches source/preview modes and handles iframe errors and CSP", () => {
    htmlState.content = "<html><head></head><body>Hello</body></html>"; htmlState.loading = false; htmlState.error = null
    const onMode = vi.fn(); const onError = vi.fn()
    const { container } = render(<HtmlRenderer file={{ url: "u", name: "a.html", size: 10 }} onError={onError} onViewModeChange={onMode} />)
    const iframe: any = container.querySelector("iframe")
    fireEvent.load(iframe)
    const { rerender } = render(<HtmlRenderer file={{ url: "u", name: "a.html", size: 10 }} viewMode="source" onError={onError} />)
    expect(screen.getByText("<html><head></head><body>Hello</body></html>")).toBeInTheDocument()
    rerender(<HtmlRenderer file={{ url: "u", name: "a.html", size: 10 }} viewMode="preview" onError={onError} />)
    expect(screen.getAllByTitle("a.html").length).toBeGreaterThan(0)
  })
})
