// @vitest-environment jsdom
import React from "react"
import { describe, expect, it, vi } from "vitest"
import { render } from "@testing-library/react"

const searchState: any = {
  overview: { conversations: [], status: "idle", isTruncated: false },
  result: { status: "idle", items: [], hasMore: false, isLoadingMore: false },
  selectedConversation: undefined, selectedKey: undefined,
  selectConversation: vi.fn(), loadMore: vi.fn(),
}
vi.mock("../../../bridge/globalChatSearch/useGlobalChatSearch", () => ({ default: () => searchState }))
vi.mock("../../../i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock("../../../ui/GlobalChatSearchLayout", () => ({ default: (props: any) => <div data-state={props.state.status}>{props.result.content}</div> }))
vi.mock("../../../Components/ChannelSearch", () => ({
  ChannelSearchEmpty: () => <div>empty</div>, MixedResultItem: () => <div>result</div>,
}))
import GlobalChatSearchPanel from "../GlobalChatSearchPanel"

describe("GlobalChatSearchPanel result states", () => {
  it("renders empty, error, loading, ready and populated results", () => {
    const props: any = { keyword: "hello", dataSource: { getSender: vi.fn() }, onLocateMessage: vi.fn(), filters: {} }
    const { container, rerender } = render(<GlobalChatSearchPanel {...props} />)
    expect(container.textContent).toContain("empty")
    searchState.selectedConversation = { key: "g", matchCount: 2 }
    searchState.result = { status: "error", items: [], hasMore: false, isLoadingMore: false }
    rerender(<GlobalChatSearchPanel {...props} />)
    expect(container.textContent).toContain("base.globalSearch.searchFailedRetry")
    searchState.result = { status: "loading", items: [], hasMore: true, isLoadingMore: false }
    rerender(<GlobalChatSearchPanel {...props} />)
    expect(container.textContent).toContain("base.channelSearch.loading")
    searchState.result = { status: "ready", items: [], hasMore: false, isLoadingMore: false }
    rerender(<GlobalChatSearchPanel {...props} />)
    expect(container.textContent).toContain("empty")
    searchState.result = { status: "ready", items: [{ id: "m", channelId: "g", channelType: 2 }], hasMore: false, isLoadingMore: true }
    rerender(<GlobalChatSearchPanel {...props} />)
    expect(container.textContent).toContain("result")
  })
})
