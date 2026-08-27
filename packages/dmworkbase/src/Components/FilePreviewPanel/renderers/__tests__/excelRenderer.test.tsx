// @vitest-environment jsdom
import React from "react"
import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
vi.mock("react-virtuoso", () => ({ TableVirtuoso: () => null, Virtuoso: () => null, VirtuosoGrid: () => null }))
const fileState: any = { content: null, loading: false, error: null, reload: vi.fn() }
vi.mock("../../hooks/useFileContent", () => ({ useFileContent: () => fileState }))
vi.mock("../../../../i18n", () => ({ useI18n: () => ({ t: (key: string) => key }), t: (key: string) => key, I18nContext: {} }))
import ExcelRenderer from "../ExcelRenderer"

describe("ExcelRenderer states", () => {
  it("renders empty and oversized file states", () => {
    const file: any = { url: "https://cdn/book.xlsx", name: "book.xlsx", size: 1 }
    expect(render(<ExcelRenderer file={file} onError={vi.fn()} />).container).toBeTruthy()
    expect(render(<ExcelRenderer file={{ ...file, size: 1024 * 1024 * 100 } as any} />).container).toBeTruthy()
  })

  it("renders loading and fetch-error states with retry", () => {
    const file: any = { url: "u", name: "book.xlsx", size: 1 }
    fileState.loading = true; fileState.error = null; fileState.content = null
    const { rerender } = render(<ExcelRenderer file={file} />)
    expect(screen.getByText("base.filePreview.loading")).toBeInTheDocument()
    fileState.loading = false; fileState.error = "network"; rerender(<ExcelRenderer file={file} />)
    expect(screen.getByText("network")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button"))
    expect(fileState.reload).toHaveBeenCalled()
    fileState.error = null
  })

  it("parses duplicate headers and exposes sheet switching", async () => {
    const XLSX = await import("xlsx")
    const first = XLSX.utils.aoa_to_sheet([["Name", "Name", ""], ["Alice", "", "x"], ["", "", ""]])
    const second = XLSX.utils.aoa_to_sheet([["Other"], ["value"]])
    const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, first, "First"); XLSX.utils.book_append_sheet(workbook, second, "Second")
    fileState.loading = false; fileState.error = null; fileState.content = XLSX.write(workbook, { type: "array", bookType: "xlsx" })
    const { container } = render(<ExcelRenderer file={{ url: "u", name: "book.xlsx", size: 1 }} />)
    await vi.waitFor(() => expect(container.textContent).toContain("First"))
    expect(container.textContent).toContain("base.filePreview.rowsCount")
    fireEvent.click(screen.getByRole("button", { name: "Second" }))
    expect(container.textContent).toContain("Second")
    fileState.content = null
  })
})
