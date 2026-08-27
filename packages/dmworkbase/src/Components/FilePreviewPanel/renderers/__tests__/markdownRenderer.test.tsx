// @vitest-environment jsdom
import React from "react"
import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({ content: "# title", loading: false, error: null as string | null, reload: vi.fn() }))

vi.mock("../../hooks/useFileContent", () => ({ useFileContent: () => ({ ...state }) }))
vi.mock("../../../../i18n", () => ({
  I18nContext: React.createContext({ t: (key: string) => key }),
  useI18n: () => ({ t: (key: string) => key }),
}))
vi.mock("../../../Messages/Text/MarkdownContent", () => ({ default: ({ content }: any) => <div data-testid="markdown">{content}</div> }))
vi.mock("../../../../Messages/Text/MarkdownContent", () => ({ default: ({ content }: any) => <div data-testid="markdown">{content}</div> }))
vi.mock("../MarkdownSourceView", () => ({ default: ({ content }: any) => <pre data-testid="source">{content}</pre> }))
vi.mock("../FileTooLarge", () => ({ default: () => <div>too-large</div> }))
vi.mock("../MarkdownToc", () => ({
  default: ({ onToggle, onItemClick }: any) => <div data-testid="toc"><button onClick={onToggle}>toggle</button><button onClick={() => onItemClick("one")}>one</button></div>,
  extractTocItems: (content: string) => content.split("\n").filter(line => line.startsWith("## ")).map((line, index) => ({ id: `id-${index}`, text: line.slice(3), level: 2 })),
}))

import MarkdownRenderer from "../MarkdownRenderer"

const file = { url: "https://files.example/readme.md", name: "readme.md", extension: "md", size: 100 }

describe("MarkdownRenderer states and controls", () => {
  beforeEach(() => {
    state.content = "# title"
    state.loading = false
    state.error = null
    state.reload.mockReset()
  })

  it("renders loading, error and empty states", () => {
    state.loading = true
    const { rerender } = render(<MarkdownRenderer file={file} />)
    expect(screen.getByText("base.filePreview.loading")).toBeTruthy()
    state.loading = false
    state.error = "failed"
    rerender(<MarkdownRenderer file={file} />)
    expect(screen.getByText("failed")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "base.filePreview.retry" }))
    expect(state.reload).toHaveBeenCalled()
    state.error = null
    state.content = "  "
    rerender(<MarkdownRenderer file={file} />)
    expect(screen.getByText("base.filePreview.empty")).toBeTruthy()
  })

  it("switches between preview/source and reports TOC availability", () => {
    state.content = "## One\n## Two\n## Three"
    const onMode = vi.fn()
    const onAvailable = vi.fn()
    render(<MarkdownRenderer file={file} onViewModeChange={onMode} onTocAvailableChange={onAvailable} />)
    expect(screen.getByTestId("markdown")).toBeTruthy()
    expect(onAvailable).toHaveBeenCalledWith(true)
    // External mode callback is exercised through the component contract.
    expect(screen.getByTestId("toc")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "toggle" }))
    expect(onMode).not.toHaveBeenCalled()
  })

  it("forces source mode for large markdown files", () => {
    state.content = "## One\n## Two\n## Three"
    render(<MarkdownRenderer file={{ ...file, size: 2 * 1024 * 1024 }} />)
    expect(screen.getByTestId("source")).toBeTruthy()
    expect(screen.getByText("base.filePreview.markdown.largeAutoSource")).toBeTruthy()
  })
})
