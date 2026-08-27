// @vitest-environment jsdom
import React from "react"
import { describe, expect, it, vi } from "vitest"
import { fireEvent, render } from "@testing-library/react"
import GlobalChatSearchLayout from "../index"

const labels: any = { filterTitle: "Filter", startHint: "Start", emptyHint: "Empty", errorHint: "Error", truncatedHint: "Truncated" }
const conversations: any = [
  { key: "g", name: "Group", countLabel: "2", avatarUrl: "avatar" },
  { key: "thread", name: "Thread", subtitle: "Group", countLabel: "1", isThread: true },
]

describe("GlobalChatSearchLayout", () => {
  it("renders pane states, conversations, filters and result content", () => {
    const onSelect = vi.fn()
    const { container, rerender } = render(<GlobalChatSearchLayout conversations={[]} labels={labels} state={{ status: "idle" }} result={{ content: <span>content</span> }} onSelectConversation={onSelect} />)
    expect(container.textContent).toContain("Start")
    rerender(<GlobalChatSearchLayout conversations={[]} labels={labels} state={{ status: "loading" }} result={{ content: <span>loading-content</span> }} onSelectConversation={onSelect} />)
    rerender(<GlobalChatSearchLayout conversations={[]} labels={labels} state={{ status: "error" }} result={{ content: <span>error-content</span> }} onSelectConversation={onSelect} />)
    rerender(<GlobalChatSearchLayout conversations={[]} labels={labels} state={{ status: "ready" }} result={{ countLabel: "3", content: <span>ready-content</span> }} filterContent={<div>filters</div>} onSelectConversation={onSelect} />)
    rerender(<GlobalChatSearchLayout conversations={conversations} selectedKey="thread" labels={labels} state={{ status: "ready", isTruncated: true }} result={{ countLabel: "3", content: <span>results</span> }} onSelectConversation={onSelect} />)
    expect(container.textContent).toContain("Truncated")
    fireEvent.click(container.querySelectorAll("button")[1])
    expect(onSelect).toHaveBeenCalledWith("thread")
  })
})
