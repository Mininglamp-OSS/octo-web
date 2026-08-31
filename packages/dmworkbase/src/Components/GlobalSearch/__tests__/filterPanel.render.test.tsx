// @vitest-environment jsdom
import React from "react"
import { describe, expect, it, vi } from "vitest"
import { render } from "@testing-library/react"
import GlobalSearchFilterPanel from "../GlobalSearchFilterPanel"

describe("GlobalSearchFilterPanel rendering", () => {
  it("renders the messages sidebar with populated candidates", () => {
    const source: any = {
      getSelfUid: () => "self",
      getSenders: () => [{ uid: "u1", name: "Alice" }],
      getSender: (uid: string) => ({ uid, name: uid }),
      searchSenders: vi.fn(async () => [{ uid: "u1", name: "Alice" }]),
      searchChannels: vi.fn(async () => [{ channelId: "g", channelType: 2, name: "Group" }]),
    }
    const { container } = render(<GlobalSearchFilterPanel tab="messages" keyword="" filters={{
      senderUids: [], memberUids: [], channels: [], channelTypes: [], contentTypes: [], fileExts: [], sort: "time_desc",
    } as any} dataSource={source} mode="sidebar" onApply={vi.fn()} />)
    expect(container.querySelector(".wk-global-search-filter-panel")).toBeInTheDocument()
    expect(container.querySelectorAll("button").length).toBeGreaterThan(3)
  })

  it("renders the file-specific sections in sidebar mode", () => {
    const source: any = {
      getSelfUid: () => "self",
      getSenders: () => [],
      getSender: (uid: string) => ({ uid, name: uid }),
      getFileTypeCategories: vi.fn(async () => [{ key: "docs", label: "Docs", exts: ["pdf"] }]),
    }
    const { container } = render(<GlobalSearchFilterPanel tab="files" keyword="" filters={{
      senderUids: [], memberUids: [], channels: [], channelTypes: [], contentTypes: [], fileExts: [], sort: "time_desc",
    } as any} dataSource={source} mode="sidebar" onApply={vi.fn()} />)
    expect(container.querySelectorAll("input[type=number]")).toHaveLength(2)
    expect(container.textContent).toContain("文件类型")
  })

})
