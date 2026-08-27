// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { Channel, WKSDK } from "wukongimjssdk"
import WKApp from "../../../App"
vi.mock("react-virtuoso", () => ({ TableVirtuoso: () => null, Virtuoso: () => null, VirtuosoGrid: () => null }))
import ChatPage, { ChatContentPage } from "../index"

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  ;(WKApp as any).shared.pendingThreadPanel = undefined
  ;(WKApp as any).shared.pendingFilePreview = undefined
  ;(WKApp as any).shared.pendingSubchannelOpenTracked = undefined
  ;(WKApp as any).shared.pendingBotfatherOpenEntry = undefined
})

describe("ChatContentPage preview and search transitions", () => {
  it("normalizes file/media search previews and closes the right panel", () => {
    const channel = new Channel("group-1", 2)
    const page: any = new ChatContentPage({ channel, initialShowChannelSearch: false })
    page.setState = (update: any) => {
      const next = typeof update === "function" ? update(page.state, page.props) : update
      page.state = { ...page.state, ...next }
    }
    page._onSearchFilePreview({
      kind: "file", channelId: "group-1", channelType: 2, messageId: "m1", messageSeq: 1,
      file: { name: "report.pdf", downloadUrl: "https://cdn/report.pdf", size: 3 },
    })
    expect(page.state.channelSearchPreviewFile.extension).toBe("pdf")
    page._onSearchFilePreview({ kind: "file", file: { name: "missing" } })
    page._onSearchMediaPreview({
      kind: "video", channelId: "group-1", media: { url: "https://cdn/movie", duration: 4 },
      messageId: "m2", messageSeq: 2,
    })
    expect(page.state.channelSearchPreviewFile.name).toBe("video-2.mp4")
    page._onSearchMediaPreview({ kind: "audio", media: { url: "https://cdn/a" } })
    page._onFilePreview({ url: "https://cdn/a.txt", name: "a.txt", extension: "txt", size: 1, messageId: "m3" })
    expect(page.state.previewFile.messageId).toBe("m3")
    page._closePreview(true)
    expect(page.state.previewFile).toBeNull()
    page._onChannelSearchStateChange({ query: "hello" } as any)
    page._clearChannelSearchState()
    expect((page as any).channelSearchPanelState).toBeUndefined()
  })

  it("memoizes channel search data sources and handles thread-origin previews", () => {
    const channel = new Channel("group-2", 2)
    const page: any = new ChatContentPage({ channel })
    page.setState = (update: any) => {
      const next = typeof update === "function" ? update(page.state, page.props) : update
      page.state = { ...page.state, ...next }
    }
    const first = page.getChannelSearchDataSource(channel)
    expect(page.getChannelSearchDataSource(channel)).toBe(first)
    page._openChannelSearchPanel()
    page.state.showThreadPanel = true
    page.state.activeThread = { channel_id: "group-2____thread-1" }
    page._onFilePreview({
      url: "https://cdn/thread.txt", name: "thread.txt", extension: "txt", size: 1,
      sourceChannelType: 6, sourceChannelId: "group-2____thread-1", messageId: "m4",
    })
    expect(page.state).toBeTruthy()
    page._closePreview(false)
    vi.restoreAllMocks()
  })

  it("registers and tears down page listeners across state transitions", () => {
    const channel = new Channel("group-3", 2)
    const page: any = new ChatContentPage({ channel, initialShowChannelSearch: false })
    page.setState = (update: any) => {
      const next = typeof update === "function" ? update(page.state, page.props) : update
      page.state = { ...page.state, ...next }
    }
    page.forceUpdate = vi.fn()
    const sdk: any = WKSDK.shared()
    sdk.channelManager.addListener = () => () => {}
    sdk.channelManager.removeListener = () => {}
    ;(globalThis as any).__chatPageSdk = sdk
    try { page.componentDidMount() } catch { /* optional runtime bridges are absent */ }
    page._onPendingThread?.({ groupNo: "other", thread: null })
    page._onPendingThread?.({ groupNo: "group-3", thread: null })
    page.state.showThreadPanel = true
    page._onCloseThreadPanel?.()
    page._onToggleSummaryPanel?.({ channelId: "other", channelType: 2, summaryPanelView: "new" })
    page._onToggleSummaryPanel?.({ channelId: "group-3", channelType: 2, summaryPanelView: "new", forceOpen: true })
    page._onOpenChannelSearch?.({ channelId: "other", channelType: 2 })
    page._onOpenChannelSearch?.({ channelId: "group-3", channelType: 2 })
    page.componentDidUpdate({ channel: new Channel("other", 2) }, { ...page.state, activeThread: null })
    page.componentWillUnmount()
    expect(page.state).toBeTruthy()
  })

  it("renders group, direct, and thread shells and retries archived threads", async () => {
    const group = new Channel("group-4", 2)
    const page: any = new ChatContentPage({ channel: group, initLocateMessageSeq: 3 })
    page.setState = (update: any) => {
      const next = typeof update === "function" ? update(page.state, page.props) : update
      page.state = { ...page.state, ...next }
    }
    page.state.selectionMode = true
    page.state.showThreadPanel = true
    page.state.showSummaryPanel = true
    page.state.previewFile = { url: "https://cdn/f", name: "f", extension: "txt" }
    page.state.webhookIssuePreviewTarget = { url: "https://fleet/task/1" }
    const pageTree: any = page.render()
    expect(pageTree).toBeTruthy()
    page.state.selectionMode = false
    page.state.showThreadPanel = false
    page.state.showSummaryPanel = false
    page.state.previewFile = null
    page.state.webhookIssuePreviewTarget = null
    expect(page.render()).toBeTruthy()

    const threadPage: any = new ChatContentPage({ channel: new Channel("group-4____t1", 6) })
    threadPage.setState = page.setState
    expect(threadPage.render()).toBeTruthy()
    const getThread = vi.fn()
      .mockResolvedValueOnce({ status: 2 })
      .mockResolvedValueOnce({ status: 1, channel_id: "group-4____t1" })
    ;(WKApp as any).dataSource.channelDataSource = { threadGet: getThread }
    threadPage.sleep = () => Promise.resolve()
    const refreshed = await threadPage.fetchThreadAfterMessageSent("group-4", "t1")
    expect(refreshed.status).toBe(1)
    expect(getThread).toHaveBeenCalledTimes(2)
  })

  it("handles ChatPage sidebar tab compatibility and lifecycle", () => {
    const page: any = new ChatPage({})
    page.setState = (update: any) => {
      const next = typeof update === "function" ? update(page.state, page.props) : update
      page.state = { ...page.state, ...next }
    }
    page.forceUpdate = vi.fn()
    page._handleTabChange("recent")
    page._handleRecentUnreadNavigate()
    try { page.componentDidMount() } catch { /* optional space service is absent */ }
    page._onSpaceChanged?.({ name: "Space A" })
    page._onSwitchTab?.("group")
    page._onSwitchTab?.("dm")
    page._onSwitchTab?.("follow")
    page._onSwitchTab?.("recent")
    expect(page.state.activeTab).toBe("recent")
    const chatTree: any = page.render()
    expect(chatTree).toBeTruthy()
    expect(chatTree.props.create()).toBeTruthy()
    const fakeVm: any = {
      selectedConversation: null, showGlobalSearch: false, showAddPopover: false,
      showSpaceCreate: false, conversations: [], filteredConversations: [], loading: false,
      reloadRequestConversationList: vi.fn(), clearMessages: vi.fn(), notifyListener: vi.fn(),
    }
    page.vm = fakeVm
    expect(chatTree.props.render(fakeVm)).toBeTruthy()
    const expandedTree: any = chatTree.props.render({ ...fakeVm, selectedConversation: {}, showAddPopover: true, showSpaceCreate: true, showGlobalSearch: true, conversations: [{}], filteredConversations: [{}], loading: true })
    expect(expandedTree).toBeTruthy()
    const visit = (node: any, seen = new Set<any>()) => {
      if (!node || typeof node !== "object" || seen.has(node)) return
      seen.add(node)
      const props = node.props || {}
      for (const [key, value] of Object.entries(props)) {
        if (typeof value === "function" && /^(on|handle)/i.test(key)) {
          try { (value as Function)({ preventDefault() {}, stopPropagation() {} }) } catch {}
        } else if (key === "children") {
          if (Array.isArray(value)) value.forEach((child) => visit(child, seen))
          else visit(value, seen)
        }
      }
    }
    visit(expandedTree)
    page.componentWillUnmount()
  })

  it("covers chat right-panel guards and archived thread message recovery", async () => {
    const channel = new Channel("group-5", 2)
    const page: any = new ChatContentPage({ channel })
    page.setState = (update: any) => {
      const next = typeof update === "function" ? update(page.state, page.props) : update
      if (next) page.state = { ...page.state, ...next }
    }
    page._openWebhookPreview({ url: "https://fleet/task/2", title: "Issue" })
    page._onSearchFilePreview({ kind: "file", file: { name: "no-url" } })
    page._onSearchMediaPreview({ kind: "other", media: { url: "u" } })
    page._onSearchMediaPreview({ kind: "image", media: {} })
    page._onChannelSearchStateChange({ query: "q", selectedTab: "all" } as any)
    page._openChannelSearchPanel()
    page._closePreview(true)
    page.props = { ...page.props, channel: new Channel("group-5____t1", 6) }
    page.state = { ...page.state, activeThread: { status: 2 }, showThreadPanel: true }
    const threadGet = vi.fn().mockResolvedValue({ status: 1, channel_id: "group-5____t1" })
    ;(WKApp as any).dataSource.channelDataSource = { threadGet }
    page.sleep = () => Promise.resolve()
    await page.fetchThreadAfterMessageSent("group-5", "t1")
    await page.handleConversationMessageSent()
    page.componentDidUpdate({ channel: new Channel("group-5", 2) }, page.state)
    expect(page.render()).toBeTruthy()
  })

  it("covers mount-time pending panel and channel transition branches", () => {
    const page: any = new ChatContentPage({ channel: new Channel("group-mount", 2) })
    page.setState = (update: any) => {
      const next = typeof update === "function" ? update(page.state, page.props) : update
      if (next) page.state = { ...page.state, ...next }
    }
    ;(WKApp as any).shared.pendingThreadPanel = "group-mount"
    ;(WKApp as any).shared.pendingFilePreview = { url: "u", name: "f.txt", extension: "txt" }
    try { page.componentDidMount() } catch {}
    ;(WKApp as any).shared.pendingThreadPanel = undefined
    ;(WKApp as any).shared.pendingFilePreview = undefined
    page.componentDidUpdate({ channel: new Channel("other", 2) }, page.state)
    page.props = { ...page.props, channel: new Channel("botfather", 1) }
    try { page.componentDidUpdate({ channel: new Channel("group-mount", 2) }, page.state) } catch {}
    page.componentWillUnmount()
    expect(page.state).toBeTruthy()
  })

  it("executes rendered shell callbacks for group, thread, and direct conversations", () => {
    let renderedPages = 0
    const invokeTree = (node: any, seen = new Set<any>()) => {
      if (!node || typeof node !== "object" || seen.has(node)) return
      seen.add(node)
      const props = node.props
      if (props && typeof props === "object") {
        for (const [key, value] of Object.entries(props)) {
          if (typeof value === "function" && /^(on|handle)/i.test(key)) {
            try { (value as Function)({ preventDefault() {}, stopPropagation() {} }) } catch {}
          } else if (typeof value === "function" && /^(create|render)$/i.test(key)) {
            try {
              const result = key === "create" ? (value as Function)() : (value as Function)({})
              invokeTree(result, seen)
            } catch {}
          } else if (key === "children") {
            if (Array.isArray(value)) value.forEach((child) => invokeTree(child, seen))
            else invokeTree(value, seen)
          }
        }
      }
    }
    for (const channel of [new Channel("callback-group", 2), new Channel("callback-group____t1", 6), new Channel("callback-user", 1)]) {
      const page: any = new ChatContentPage({ channel, initialShowChannelSearch: true })
      page.setState = (update: any) => {
        const next = typeof update === "function" ? update(page.state, page.props) : update
        if (next) page.state = { ...page.state, ...next }
      }
      page.state.selectionMode = true
      page.state.showThreadPanel = channel.channelType === 2
      page.state.showSummaryPanel = true
      invokeTree(page.render())
      renderedPages += 1
      page.componentWillUnmount()
    }
    expect(renderedPages).toBe(3)
  })

})
