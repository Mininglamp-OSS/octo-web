// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"
import { Channel } from "wukongimjssdk"
vi.mock("react-virtuoso", () => ({ TableVirtuoso: () => null, Virtuoso: () => null, VirtuosoGrid: () => null }))
import ThreadPanel from "../index"
import WKApp from "../../../App"

describe("ThreadPanel file mode and layout lifecycle", () => {
  it("loads, paginates, maps, and renders conversation files", async () => {
    const channelFiles = vi.fn()
      .mockResolvedValueOnce({ page: 1, has_more: true, files: [
        { message_id: 1, message_seq: 1, name: "old.txt", url: "https://cdn/old", timestamp: 1 },
        { message_id: 2, message_seq: 2, name: "new.pdf", url: "https://cdn/new", timestamp: 2, from_uid: "u" },
      ] })
      .mockResolvedValueOnce({ page: 2, has_more: false, files: [
        { message_id: 3, name: "more.png", url: "https://cdn/more", timestamp: 3 },
      ] })
    ;(WKApp as any).dataSource = { channelDataSource: { channelFiles } }
    const panel: any = new ThreadPanel({
      groupNo: "group-files", filePreview: {
        url: "https://cdn/new.pdf", name: "new.pdf", extension: "pdf", size: 2,
        sourceChannelId: "group-files", sourceChannelType: 2, messageId: "2",
      },
      onClose: vi.fn(), onFilePreviewClose: vi.fn(), onFilePreviewChange: vi.fn(),
    })
    panel.setState = (update: any) => {
      const next = typeof update === "function" ? update(panel.state, panel.props) : update
      panel.state = { ...panel.state, ...next }
    }
    await panel.componentDidMount()
    expect(panel.state.conversationFiles[0].id).toBe("2")
    await panel.loadMoreConversationFiles()
    expect(panel.state.conversationFiles).toHaveLength(3)
    panel.state.fileViewMode = "source"
    panel.state.isFilePanelOpen = true
    expect(panel.render()).toBeTruthy()
    panel.onPanelDragStart({ preventDefault: vi.fn(), clientX: 500 } as any)
    panel.onPanelDragMove({ clientX: 450 } as any)
    panel.onPanelDragEnd()
    panel.onPanelDoubleClick()
    panel.componentWillUnmount()
    expect(channelFiles).toHaveBeenCalledTimes(2)
  })

  it("handles empty file channel and defensive pagination paths", async () => {
    const panel: any = new ThreadPanel({ onClose: vi.fn(), filePreview: { url: "u", name: "x", extension: "txt" } })
    panel.setState = (update: any) => {
      const next = typeof update === "function" ? update(panel.state, panel.props) : update
      panel.state = { ...panel.state, ...next }
    }
    expect(panel.getFileChannelInfo()).toBeNull()
    panel.state.conversationFilesHasMore = false
    await panel.loadMoreConversationFiles()
    panel.state.conversationFilesHasMore = true
    panel._loadingMore = true
    await panel.loadMoreConversationFiles()
    panel._loadingMore = false
    expect(panel.mapFileToConversationFile({ message_id: 9, name: "README", url: "u" }).extension).toBe("")
    panel.componentWillUnmount()
  })

  it("renders list and detail states with archive and reply data", () => {
    const thread: any = {
      short_id: "t1", channel_id: "group-render____t1", name: "Thread one",
      group_no: "group-render", status: 1, creator_uid: "u1", creator_name: "User",
      created_at: "2024-01-01", updated_at: "2024-01-02", is_member: true,
      member_count: 2, message_count: 3,
    }
    const panel: any = new ThreadPanel({ groupNo: "group-render", onClose: vi.fn(), onThreadSelect: vi.fn(), onCreateThread: vi.fn() })
    panel.state.threads = [thread]
    panel.state.threadsLoading = false
    panel.state.archivedExpanded = true
    panel.state.vmState = { loading: false, thread, parentMessage: { messageID: "m1" }, replies: [], hasMore: false, error: null }
    expect(panel.render()).toBeTruthy()
    panel.state.view = "detail"
    panel.state.showMoreMenu = true
    panel.state.showWebhookPanel = true
    expect(panel.render()).toBeTruthy()
    panel.componentWillUnmount()
  })

  it("covers thread list sorting, selection, and archive state transitions", async () => {
    const thread: any = {
      short_id: "t-archive", channel_id: "group-actions____t-archive", name: "Archive me",
      group_no: "group-actions", status: 1, creator_uid: "u1", created_at: "2024-01-01",
      updated_at: "2024-01-03", last_message_at: "2024-01-04",
    }
    const updated = { ...thread, status: 2 }
    const threadList = vi.fn().mockResolvedValue([thread])
    const threadArchive = vi.fn().mockResolvedValue(undefined)
    const threadUnarchive = vi.fn().mockResolvedValue(undefined)
    const threadGet = vi.fn().mockResolvedValue(updated)
    ;(WKApp as any).dataSource = { channelDataSource: { threadList, threadArchive, threadUnarchive, threadGet } }
    const panel: any = new ThreadPanel({ groupNo: "group-actions", thread, onClose: vi.fn(), onThreadSelect: vi.fn() })
    panel.setState = (update: any) => {
      const next = typeof update === "function" ? update(panel.state, panel.props) : update
      panel.state = { ...panel.state, ...next }
    }
    panel.state.vmState.thread = thread
    await panel.loadThreads()
    expect(panel.state.threads).toHaveLength(1)
    expect(panel.threadSortTime(thread)).toBeGreaterThan(0)
    expect(panel.getThreadSearchChannel(thread)?.channelID).toBe(thread.channel_id)
    expect(panel.getThreadSearchChannel(null)).toBeNull()
    await panel.archiveThreadById(thread)
    expect(threadArchive).toHaveBeenCalledWith("group-actions", "t-archive")
    panel.state.vmState.thread = { ...thread, status: 2 }
    await panel.archiveThreadById(panel.state.vmState.thread)
    expect(threadUnarchive).toHaveBeenCalled()
    panel.handleOpenThreadWebhook()
    panel.handleCloseThreadWebhook()
    panel.handleBackToList()
    panel.handleThreadClick(thread)
    panel.componentWillUnmount()
  })

  it("covers thread refresh, preview transitions, and archived reactivation guards", async () => {
    const thread: any = {
      short_id: "t-refresh", channel_id: "group-refresh____t-refresh",
      name: "Refresh", group_no: "group-refresh", status: 1,
      updated_at: "2024-01-02", creator_uid: "u1",
    }
    const panel: any = new ThreadPanel({
      groupNo: "group-refresh", thread, onClose: vi.fn(), onThreadSelect: vi.fn(),
      filePreview: { url: "u", name: "a.txt", extension: "txt", sourceChannelId: "group-refresh", sourceChannelType: 2 },
    })
    panel.setState = (update: any) => {
      const next = typeof update === "function" ? update(panel.state, panel.props) : update
      if (next) panel.state = { ...panel.state, ...next }
    }
    const threadList = vi.fn().mockResolvedValue([thread])
    ;(WKApp as any).dataSource = { channelDataSource: {
      threadList, channelFiles: vi.fn().mockRejectedValue(new Error("files")),
      threadGet: vi.fn().mockResolvedValue({ ...thread, status: 1 }),
    } }
    ;(WKApp as any).shared.deviceId = "device"
    await panel.loadThreads(true)
    expect(panel.state.threads[0].is_followed).toBe(false)
    await panel.loadConversationFiles()
    expect(panel.state.conversationFilesLoading).toBe(false)
    panel.componentDidUpdate({ groupNo: "group-refresh", thread: null, filePreview: null } as any)
    panel.props = { ...panel.props, thread: null, filePreview: null }
    panel.componentDidUpdate({ groupNo: "group-refresh", thread, filePreview: panel.props.filePreview } as any)
    panel.state.vmState.thread = thread
    panel.handleThreadClick(thread)
    panel.handleBackToList()
    panel.handleOpenFullView()
    panel.state.vmState.thread = { ...thread, channel_id: "" }
    panel.handleOpenChannelSearch()
    panel.handleThreadMessageSent()
    panel.applyThreadUpdate({ ...thread, status: 2 })
    expect(panel.threadSortTime({ name: "bad", updated_at: "bad" })).toBe(0)
    panel.componentWillUnmount()
  })

  it("covers create, file selection, open-view, and archived message recovery paths", async () => {
    const onCreateThread = vi.fn()
    const onFilePreviewChange = vi.fn()
    const archived: any = {
      short_id: "t-archived", channel_id: "group-archived____t-archived",
      name: "Archived", group_no: "group-archived", status: 2,
    }
    const panel: any = new ThreadPanel({
      groupNo: "group-archived", thread: archived, onClose: vi.fn(),
      onCreateThread, onFilePreviewChange,
      filePreview: { url: "u", name: "a.txt", extension: "txt", sourceChannelId: "group-archived", sourceChannelType: 2 },
    })
    panel.setState = (update: any) => {
      const next = typeof update === "function" ? update(panel.state, panel.props) : update
      if (next) panel.state = { ...panel.state, ...next }
    }
    panel.handleCreateThread()
    expect(onCreateThread).toHaveBeenCalled()
    panel.handleFileSelect({ id: "m", name: "a.txt", extension: "txt", url: "u" })
    expect(onFilePreviewChange).toHaveBeenCalled()
    panel.props = { ...panel.props, onFilePreviewChange: undefined }
    panel.handleFileSelect({ id: "m", name: "a.txt", extension: "txt", url: "u" })
    ;(WKApp as any).endpoints.showConversation = vi.fn()
    panel.props = { ...panel.props, onFilePreviewChange }
    panel.state.vmState.thread = archived
    panel.handleOpenFullView()
    expect((WKApp as any).endpoints.showConversation).toHaveBeenCalled()
    ;(WKApp as any).dataSource.channelDataSource.threadGet = vi.fn().mockResolvedValue({ ...archived, status: 1 })
    panel.sleep = () => Promise.resolve()
    await panel.handleThreadMessageSent()
    panel.props = { ...panel.props, groupNo: undefined }
    panel.handleCreateThread()
    await expect(panel.fetchThreadAfterMessageSent("g", { ...archived, status: 1 })).resolves.toBeTruthy()
    panel.componentWillUnmount()
  })

  it("covers thread permission, creator-name, and optimistic status helpers", () => {
    const panel: any = new ThreadPanel({ groupNo: "g", onClose: vi.fn() })
    panel.setState = (update: any) => {
      const next = typeof update === "function" ? update(panel.state, panel.props) : update
      panel.state = { ...panel.state, ...next }
    }
    ;(WKApp as any).loginInfo = { uid: "me", name: "Me" }
    expect(panel.getCreatorName({ creator_uid: "me", creator_name: "Creator" })).toBe("Creator")
    expect(panel.getCreatorName({ creator_uid: "other", creator_name: "Creator" })).toBe("Creator")
    expect(panel.getCreatorName({ creator_uid: "other" })).toBe("other")
    panel.state.threads = [{ short_id: "t", status: 1 }]
    panel.setThreadStatusOptimistic("t", 2)
    expect(panel.state.threads[0].status).toBe(2)
    ;(WKApp as any).loginInfo.uid = "u1"
    expect(panel.canEditThread({ creator_uid: "u1", is_member: true, status: 1 })).toBe(true)
    expect(panel.canEditThread({ creator_uid: "other", is_member: false, status: 1 })).toBe(false)
    expect(panel.canEditThread({ creator_uid: "other", is_member: true, status: 2 })).toBe(false)
    expect(panel.getParentGroupChannel("parent").channelID).toBe("parent")
  })
})
