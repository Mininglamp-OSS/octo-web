// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"
vi.mock("react-virtuoso", () => ({ TableVirtuoso: () => null, Virtuoso: () => null, VirtuosoGrid: () => null }))
import ChatPage from "../index"

describe("ChatPage local state transitions", () => {
  it("changes sidebar tabs and increments the unread navigation token", () => {
    const page: any = new ChatPage({})
    let state = page.state
    page.setState = (next: any) => {
      state = { ...state, ...(typeof next === "function" ? next(state) : next) }
      page.state = state
    }
    page._handleTabChange("follow")
    expect(page.state.activeTab).toBe("follow")
    page._handleTabChange("recent")
    expect(page.state.activeTab).toBe("recent")
    const before = page.state.recentUnreadJumpToken
    page._handleRecentUnreadNavigate()
    expect(page.state.recentUnreadJumpToken).toBe(before + 1)
  })

  it("maps legacy sidebar events and cleans up subscriptions", () => {
    const page: any = new ChatPage({})
    let state = page.state
    page.setState = (next: any) => {
      state = { ...state, ...(typeof next === "function" ? next(state) : next) }
      page.state = state
    }
    page.componentDidMount()
    page._onSwitchTab("group")
    page._onSwitchTab("dm")
    expect(page.state.activeTab).toBe("recent")
    page.componentWillUnmount()
  })

  it("builds the loading sidebar render tree", () => {
    const page: any = new ChatPage({})
    const vm: any = {
      selectedConversation: undefined,
      showAddPopover: false,
      conversations: [],
      filteredConversations: [],
      loading: true,
      clearMessages: vi.fn(),
      reloadRequestConversationList: vi.fn(),
      notifyListener: vi.fn(),
    }
    const providerElement: any = page.render()
    const rendered = providerElement.props.render(vm)
    expect(rendered.props.className).toBe("wk-chat")
    expect(rendered.props.children).toBeTruthy()
    vm.loading = false
    page.state.activeTab = "recent"
    const emptyRecent = providerElement.props.render(vm)
    expect(emptyRecent.props.children).toBeTruthy()
  })

  it("builds right-panel render trees for selection, thread, search, and previews", () => {
    const page: any = new ChatPage({ channel: { channelID: "g", channelType: 2 } })
    const vm: any = {
      selectedConversation: { channel: { channelID: "g", channelType: 2 } },
      showAddPopover: false, conversations: [], filteredConversations: [], loading: false,
      clearMessages: vi.fn(), reloadRequestConversationList: vi.fn(), notifyListener: vi.fn(),
    }
    const provider: any = page.render()
    const variants = [
      { selectionMode: true, selectedCount: 2 },
      { showThreadPanel: true, activeThread: { short_id: "t", group_no: "g", channel_id: "g____t" } },
      { showChannelSearch: true },
      { previewFile: { url: "u", name: "a.txt", extension: "txt" } },
      { showSummaryPanel: true, summaryPanelView: "summary" },
      { webhookIssuePreviewTarget: { url: "https://example.com" } },
    ]
    for (const variant of variants) {
      page.state = { ...page.state, ...variant }
      expect(provider.props.render(vm)).toBeTruthy()
    }
  })
})
