// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"
vi.mock("react-virtuoso", () => ({ TableVirtuoso: () => null, Virtuoso: () => null, VirtuosoGrid: () => null }))
import ChatPage from "../index"
import WKApp from "../../../App"
import { Channel, Conversation, ConversationAction, Message, MessageText, WKSDK } from "wukongimjssdk"
import ChatConversationList from "../../../Components/ChatConversationList"
import { openTemporaryConversation } from "../../../features/temporaryConversation/presentation"

function findElementByType(node: any, type: any): any {
  if (!node || typeof node !== "object") return undefined
  if (node.type === type) return node
  const children = node.props?.children
  for (const child of Array.isArray(children) ? children : [children]) {
    const match = findElementByType(child, type)
    if (match) return match
  }
  return undefined
}

function findElementByClassName(node: any, className: string): any {
  if (!node || typeof node !== "object") return undefined
  if (node.props?.className === className) return node
  const children = node.props?.children
  for (const child of Array.isArray(children) ? children : [children]) {
    const match = findElementByClassName(child, className)
    if (match) return match
  }
  return undefined
}

describe("ChatPage local state transitions", () => {
  it.each([false, true])("ignores another Space's own message for an existing=%s temporary row", (existing) => {
    const sdk = WKSDK.shared()
    const previousConversations = sdk.conversationManager.conversations
    const previousUid = WKApp.loginInfo.uid
    const previousSdkUid = sdk.config.uid
    const previousSpace = WKApp.shared.currentSpaceId
    const channel = new Channel("cross-space-temporary-peer", 1)
    const conversation = new Conversation()
    conversation.channel = channel
    sdk.conversationManager.conversations = existing ? [conversation] : []
    WKApp.loginInfo.uid = sdk.config.uid = "cross-space-sender"
    WKApp.shared.currentSpaceId = "space-a"
    const page = new ChatPage({})
    vi.spyOn(page, "setState").mockImplementation((next) => {
      const update = typeof next === "function" ? next(page.state, page.props) : next
      page.state = { ...page.state, ...update }
    })
    page.componentDidMount()
    const ownMessage = (spaceId: string) => {
      const message = new Message()
      message.channel = channel
      message.fromUID = WKApp.loginInfo.uid
      message.content = new MessageText("hello")
      message.content.contentObj = { type: 1, content: "hello", space_id: spaceId }
      message.timestamp = 100
      return message
    }
    try {
      WKApp.mittBus.emit("wk:temporarily-pin-conversation", { channel, fromSearch: true })
      const temporary = page.state.temporaryConversation
      const request = page.state.temporaryConversationScrollRequest
      expect(temporary.active?.origin).toBe(existing ? "existing" : "virtual")

      sdk.chatManager.notifyMessageListeners(ownMessage("space-b"))
      expect(page.state.temporaryConversation).toBe(temporary)
      expect(page.state.temporaryConversationScrollRequest).toBe(request)

      if (existing) {
        WKApp.mittBus.emit("conversation-list-refreshed")
        expect(page.state.temporaryConversation).toEqual({})
      }
      sdk.chatManager.notifyMessageListeners(ownMessage("space-a"))
      expect(page.state.temporaryConversation).toEqual({})
      expect(page.state.temporaryConversationScrollRequest).toBeUndefined()
    } finally {
      page.componentWillUnmount()
      sdk.conversationManager.conversations = previousConversations
      WKApp.loginInfo.uid = previousUid
      sdk.config.uid = previousSdkUid
      WKApp.shared.currentSpaceId = previousSpace
      vi.restoreAllMocks()
    }
  })

  it.each([false, true])("promotes an existing=%s temporary row only on an outgoing chat message", (existing) => {
    const sdk = WKSDK.shared()
    const previousConversations = sdk.conversationManager.conversations
    const previousUid = WKApp.loginInfo.uid
    const previousSdkUid = sdk.config.uid
    const listenerCount = sdk.chatManager.listeners.length
    const channel = new Channel("temporary-send-target", 1)
    const makeMessage = (target: Channel, sender: string, noPersist = false) => {
      const message = new Message()
      message.channel = target
      message.fromUID = sender
      message.header.noPersist = noPersist
      message.content = new MessageText("hello")
      message.timestamp = 100
      return message
    }
    WKApp.loginInfo.uid = "temporary-sender"
    sdk.config.uid = WKApp.loginInfo.uid
    const conversation = new Conversation()
    conversation.channel = channel
    conversation.lastMessage = makeMessage(channel, WKApp.loginInfo.uid)
    sdk.conversationManager.conversations = existing ? [conversation] : []
    const page = new ChatPage({})
    vi.spyOn(page, "setState").mockImplementation((next) => {
      const update = typeof next === "function" ? next(page.state, page.props) : next
      page.state = { ...page.state, ...update }
    })
    page.componentDidMount()
    try {
      expect(sdk.chatManager.listeners.length).toBe(listenerCount + 1)
      WKApp.mittBus.emit("wk:temporarily-pin-conversation", { channel, fromSearch: true })
      const temporary = page.state.temporaryConversation
      expect(temporary.active?.origin).toBe(existing ? "existing" : "virtual")

      // Clearing unread or refreshing metadata can retain an old own lastMessage.
      sdk.conversationManager.notifyConversationListeners(conversation, ConversationAction.update)
      expect(page.state.temporaryConversation).toBe(temporary)
      sdk.chatManager.notifyMessageListeners(makeMessage(channel, "peer"))
      expect(page.state.temporaryConversation).toBe(temporary)
      sdk.chatManager.notifyMessageListeners(makeMessage(new Channel("other-channel", 1), WKApp.loginInfo.uid))
      expect(page.state.temporaryConversation).toBe(temporary)
      sdk.chatManager.notifyMessageListeners(makeMessage(channel, WKApp.loginInfo.uid, true))
      expect(page.state.temporaryConversation).toBe(temporary)

      const outgoing = makeMessage(channel, WKApp.loginInfo.uid)
      sdk.chatManager.notifyMessageListeners(outgoing)
      expect(page.state.temporaryConversation).toEqual({})
      expect(page.state.temporaryConversationScrollRequest).toBeUndefined()
      expect(sdk.conversationManager.findConversation(channel)?.lastMessage).toBe(outgoing)
    } finally {
      page.componentWillUnmount()
      sdk.conversationManager.conversations = previousConversations
      WKApp.loginInfo.uid = previousUid
      sdk.config.uid = previousSdkUid
      vi.restoreAllMocks()
    }
    expect(sdk.chatManager.listeners.length).toBe(listenerCount)
  })

  it("requests scrolling only for search jumps and consumes or cancels it on other navigation", () => {
    const page: any = new ChatPage({})
    page.setState = (next: any) => {
      const update = typeof next === "function" ? next(page.state, page.props) : next
      page.state = { ...page.state, ...update }
    }
    page.componentDidMount()
    const channel = new Channel("temporary-scroll-target", 1)
    try {
      WKApp.mittBus.emit("wk:temporarily-pin-conversation", { channel })
      expect(page.state.temporaryConversationScrollRequest).toBeUndefined()
      expect(page.state.temporaryConversationJumpToken).toBe(0)
      WKApp.mittBus.emit("wk:temporarily-pin-conversation", { channel, fromSearch: true })
      const first = page.state.temporaryConversationJumpToken
      expect(first).toBeGreaterThan(0)
      expect(page.state.temporaryConversationScrollRequest).toEqual({ token: first, channel })
      page._handleTemporaryConversationScrolled(first)
      expect(page.state.temporaryConversationScrollRequest).toBeUndefined()
      WKApp.mittBus.emit("wk:temporarily-pin-conversation", { channel, fromSearch: true })
      expect(page.state.temporaryConversationJumpToken).toBe(first + 1)
      page._handleTemporaryConversationScrolled(first)
      expect(page.state.temporaryConversationScrollRequest).toEqual({ token: first + 1, channel })
      WKApp.mittBus.emit("wk:temporarily-pin-conversation", { channel: new Channel("contact-target", 1) })
      expect(page.state.temporaryConversationScrollRequest).toBeUndefined()
      expect(page.state.temporaryConversationJumpToken).toBe(first + 1)
      WKApp.mittBus.emit("wk:temporarily-pin-conversation", { channel, fromSearch: true })
      WKApp.mittBus.emit("wk:sidebar-conversation-opened", channel)
      expect(page.state.temporaryConversationScrollRequest).toBeUndefined()
      WKApp.mittBus.emit("wk:temporarily-pin-conversation", { channel, fromSearch: true })
      page._handleTabChange("follow")
      page._handleTabChange("recent")
      expect(page.state.temporaryConversationScrollRequest).toBeUndefined()
    } finally {
      page.componentWillUnmount()
    }
  })

  it("keeps an existing temporary conversation while switching, then releases it on refresh", () => {
    const page: any = new ChatPage({})
    page.vm = { findConversation: () => ({}) }
    page.setState = (next: any) => {
      const update = typeof next === "function" ? next(page.state, page.props) : next
      page.state = { ...page.state, ...update }
    }
    page.componentDidMount()
    const temporary = new Channel("existing-temporary", 1)
    const other = new Channel("other", 1)
    try {
      WKApp.mittBus.emit("wk:temporarily-pin-conversation", { channel: temporary })
      WKApp.mittBus.emit("wk:sidebar-conversation-opened", other)
      expect(page.state.temporaryConversation.active?.channel.channelID).toBe("existing-temporary")

      WKApp.mittBus.emit("conversation-list-refreshed")
      expect(page.state.temporaryConversation).toEqual({})
    } finally {
      page.componentWillUnmount()
    }
  })

  it("clears a temporary search row and its pending scroll on Space and account resets", () => {
    const page: any = new ChatPage({})
    page.setState = (next: any) => {
      const update = typeof next === "function" ? next(page.state, page.props) : next
      page.state = { ...page.state, ...update }
    }
    page.componentDidMount()
    try {
      WKApp.mittBus.emit("wk:temporarily-pin-conversation", {
        channel: new Channel("space-reset-target", 1), fromSearch: true,
      })
      WKApp.mittBus.emit("space-changed", { name: "Other Space" })
      expect(page.state.temporaryConversation).toEqual({})
      expect(page.state.temporaryConversationScrollRequest).toBeUndefined()

      WKApp.mittBus.emit("wk:temporarily-pin-conversation", {
        channel: new Channel("auth-reset-target", 1), fromSearch: true,
      })
      WKApp.mittBus.emit("wk:auth-state-changed")
      expect(page.state.temporaryConversation).toEqual({})
      expect(page.state.temporaryConversationScrollRequest).toBeUndefined()
    } finally {
      page.componentWillUnmount()
    }
  })

  it.each([false, true])("keeps an SDK-only existing=%s target visible while the ChatVM is hydrating", (existing) => {
    const sdk = WKSDK.shared()
    const previousConversations = sdk.conversationManager.conversations
    const channel = new Channel("sdk-only-temporary", 1)
    const conversation = new Conversation()
    conversation.channel = channel
    sdk.conversationManager.conversations = [conversation]
    const page: any = new ChatPage({})
    page.state = {
      ...page.state,
      activeTab: "recent",
      temporaryConversation: openTemporaryConversation({}, channel, () => existing),
    }
    const vm: any = {
      selectedConversation: undefined,
      showAddPopover: false,
      conversations: [],
      filteredConversations: [],
      loading: false,
      findConversation: () => undefined,
      clearMessages: vi.fn(),
      reloadRequestConversationList: vi.fn(),
      notifyListener: vi.fn(),
    }
    try {
      page.vm = vm
      const provider: any = page.render()
      const tree = provider.props.render(vm)
      const list = findElementByType(tree, ChatConversationList)
      expect(list).toBeTruthy()
      expect(list.props.temporaryConversationPresentation.conversations).toHaveLength(1)
      expect(list.props.temporaryConversationPresentation.conversations[0].channel).toBe(channel)
      expect(list.props.temporaryConversationPresentation.virtualChannelKeys.has(channel.getChannelKey()))
        .toBe(!existing)
    } finally {
      sdk.conversationManager.conversations = previousConversations
    }
  })

  it("replaces the empty Recent guide with a virtual temporary row", () => {
    const channel = new Channel("virtual-temporary", 1)
    const page: any = new ChatPage({})
    page.state = {
      ...page.state,
      activeTab: "recent",
      temporaryConversation: openTemporaryConversation({}, channel, () => false),
    }
    const vm: any = {
      selectedConversation: undefined,
      showAddPopover: false,
      conversations: [],
      filteredConversations: [],
      loading: false,
      findConversation: () => undefined,
      clearMessages: vi.fn(),
      reloadRequestConversationList: vi.fn(),
      notifyListener: vi.fn(),
    }
    page.vm = vm
    const provider: any = page.render()
    const tree = provider.props.render(vm)
    const list = findElementByType(tree, ChatConversationList)
    expect(findElementByClassName(tree, "wk-chat-empty-guide")).toBeUndefined()
    expect(list.props.temporaryConversationPresentation.conversations).toHaveLength(1)
    expect(list.props.temporaryConversationPresentation.virtualChannelKeys)
      .toEqual(new Set([channel.getChannelKey()]))
  })

  it("cancels a dismissed target's search request without cancelling a different target", () => {
    const channel = new Channel("dismiss-search-target", 1)
    const page = new ChatPage({})
    vi.spyOn(page, "setState").mockImplementation((next) => {
      const update = typeof next === "function" ? next(page.state, page.props) : next
      page.state = { ...page.state, ...update }
    })
    page.state = {
      ...page.state,
      activeTab: "recent",
      temporaryConversation: openTemporaryConversation({}, channel, () => false),
      temporaryConversationScrollRequest: { channel, token: 1 },
    }
    const vm: any = {
      conversations: [], filteredConversations: [], loading: false,
      findConversation: () => undefined, clearMessages: vi.fn(),
    }
    page.vm = vm
    try {
      const provider: any = page.render()
      const list = findElementByType(provider.props.render(vm), ChatConversationList)
      list.props.temporaryConversationPresentation.onDismiss(new Channel("old-target", 1))
      expect(page.state.temporaryConversationScrollRequest).toEqual({ channel, token: 1 })
      list.props.temporaryConversationPresentation.onDismiss(channel)
      expect(page.state.temporaryConversation).toEqual({})
      expect(page.state.temporaryConversationScrollRequest).toBeUndefined()
    } finally {
      vi.restoreAllMocks()
    }
  })

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
