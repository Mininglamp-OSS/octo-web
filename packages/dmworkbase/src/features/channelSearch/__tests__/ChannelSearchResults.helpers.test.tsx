// @vitest-environment jsdom
import React from "react"
import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
vi.mock("react-virtuoso", () => ({ TableVirtuoso: () => null, Virtuoso: () => null, VirtuosoGrid: () => null }))
vi.mock("../../../Utils/download", () => ({ downloadFile: vi.fn().mockResolvedValue(undefined) }))
import { ChannelSearchEmpty, FileResultItem, MediaResultGrid, MixedResultItem } from "../ChannelSearchResults"

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

  // V6 rev-002 (sketches/002-snippet-below-card): chat-tab file message renders
  // a separate quote block below the file card when the server returned a
  // body-hit content_snippet. File card stays untouched (no welded shell).
  it("renders below-card snippet block when file.contentSnippet is present (chat tab)", () => {
    const sender = { uid: "u1", name: "Hui", avatarUrl: "avatar" }
    const item: any = {
      id: "msg-hit-1",
      kind: "file",
      timestamp: 1700000000,
      messageId: "m1",
      senderUid: "u1",
      sender,
      file: {
        name: "gateway.xlsx",
        extension: "xlsx",
        size: 36864,
        contentSnippet: "预充值<mark>渠道</mark>,如用量很大请提前联系陈鹤鸣",
      },
    }
    const { container } = render(
      <MixedResultItem item={item} keyword="渠道" getSender={() => sender} onLocate={vi.fn()} />
    )
    const snippet = container.querySelector(".wk-channel-search-file-snippet-below")
    expect(snippet).toBeTruthy()
    // Badge label present.
    expect(container.querySelector(".wk-channel-search-file-snippet-below-label")).toBeTruthy()
    // Keyword highlighted inside the snippet.
    expect(snippet!.querySelector("mark")).toBeTruthy()
    // File card still rendered (component untouched, sits above the snippet).
    expect(container.querySelector(".wk-channel-search-inline-file-card")).toBeTruthy()
  })

  it("does NOT render below-card snippet when file.contentSnippet is absent (name-only hit)", () => {
    const sender = { uid: "u2", name: "Chen", avatarUrl: "avatar" }
    const item: any = {
      id: "msg-hit-2",
      kind: "file",
      timestamp: 1700000000,
      messageId: "m2",
      senderUid: "u2",
      sender,
      file: {
        name: "2026Q3-渠道报告.pdf",
        extension: "pdf",
        size: 2 * 1024 * 1024,
        // contentSnippet: undefined  -> name-only hit, no body snippet
      },
    }
    const { container } = render(
      <MixedResultItem item={item} keyword="渠道" getSender={() => sender} onLocate={vi.fn()} />
    )
    expect(container.querySelector(".wk-channel-search-file-snippet-below")).toBeNull()
    // Legacy shape must still render the plain file card.
    expect(container.querySelector(".wk-channel-search-inline-file-card")).toBeTruthy()
  })
})
