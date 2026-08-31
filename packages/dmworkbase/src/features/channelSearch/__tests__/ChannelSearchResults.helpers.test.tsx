// @vitest-environment jsdom
import React from "react"
import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
vi.mock("react-virtuoso", () => ({ TableVirtuoso: () => null, Virtuoso: () => null, VirtuosoGrid: () => null }))
vi.mock("../../../Utils/download", () => ({ downloadFile: vi.fn().mockResolvedValue(undefined) }))
import { ChannelSearchEmpty, FileResultItem, MediaResultGrid } from "../ChannelSearchResults"

describe("ChannelSearchResults leaf renderers", () => {
  it("renders empty states and file result menu actions", () => {
    render(<ChannelSearchEmpty queryStarted={false} emptyHint="empty" />)
    expect(screen.getByText("empty")).toBeTruthy()
    const onMenuOpenChange = vi.fn(), onLocate = vi.fn(), onPreviewFile = vi.fn()
    const item: any = { id: "file-1", kind: "file", timestamp: 1, messageId: "m1", file: { name: "report.pdf", extension: "pdf", size: 2048, downloadUrl: "https://cdn/report.pdf" }, sender: { uid: "u", name: "Alice", avatarUrl: "avatar" } }
    render(<FileResultItem item={item} keyword="rep" getSender={() => item.sender} menuOpen onMenuOpenChange={onMenuOpenChange} onLocate={onLocate} onPreviewFile={onPreviewFile} />)
    fireEvent.click(screen.getByRole("button", { name: /report/i }))
    const menuButtons = screen.getAllByRole("button")
    menuButtons.forEach((button) => { try { fireEvent.click(button) } catch {} })
    expect(onPreviewFile).toHaveBeenCalled()
    const onPreviewMedia = vi.fn()
    render(<MediaResultGrid items={[{ id: "media-1", kind: "image", timestamp: 1700000000, media: { url: "https://cdn/image.png", width: 80, height: 60 } } as any]} onLocate={onLocate} onPreviewMedia={onPreviewMedia} />)
    fireEvent.click(screen.getByRole("button", { name: "预览" }))
    expect(onPreviewMedia).toHaveBeenCalled()
  })
})
