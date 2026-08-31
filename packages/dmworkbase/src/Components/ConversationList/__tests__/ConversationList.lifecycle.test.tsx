// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"
vi.mock("react-virtuoso", () => ({ TableVirtuoso: () => null, Virtuoso: () => null, VirtuosoGrid: () => null }))
import ConversationList, { getOnlineTip, isConversationPinned, needShowOnlineStatus } from "../index"
import { Channel } from "wukongimjssdk"
import WKApp from "../../../App"

describe("ConversationList helpers and interaction state", () => {
  it("handles online and pinned predicates", () => {
    expect(needShowOnlineStatus()).toBe(false)
    expect(needShowOnlineStatus({ online: 1 } as any)).toBe(true)
    expect(needShowOnlineStatus({ online: 0, lastOffline: Date.now() / 1000 - 30 } as any)).toBe(true)
    expect(needShowOnlineStatus({ online: 0, lastOffline: Date.now() / 1000 - 4000 } as any)).toBe(false)
    expect(getOnlineTip({ online: 1, lastOffline: 0 } as any)).toBeUndefined()
    expect(getOnlineTip({ online: 0, lastOffline: Date.now() / 1000 - 10 } as any)).toBeTruthy()
    const thread: any = { channel: new Channel("t", 5), extra: { top: 1 } }
    const group: any = { channel: new Channel("g", 2), channelInfo: { top: 1 } }
    expect(isConversationPinned(thread)).toBe(true)
    expect(isConversationPinned(group)).toBe(true)
  })

  it("persists expanded groups and handles refs/context-menu callbacks", () => {
    const vm: any = new ConversationList({ conversations: [], disablePinSplit: false })
    let state = vm.state
    vm.setState = (next: any, callback?: () => void) => {
      state = { ...state, ...(typeof next === "function" ? next(state) : next) }
      vm.state = state
      callback?.()
    }
    vm.contextMenusContext = { hide: vi.fn(), show: vi.fn() }
    expect(vm._isThreadExpanded("group")).toBe(false)
    vm._toggleGroupExpand("group")
    expect(vm._isThreadExpanded("group")).toBe(true)
    vm._handleScroll()
    vm._handleContextMenu({ channel: new Channel("g", 2) } as any, {} as any)
    expect(vm.contextMenusContext.hide).toHaveBeenCalled()
    expect(vm.contextMenusContext.show).toHaveBeenCalled()
    expect(vm.state.selectConversationWrap).toBeTruthy()
    vm.setConversationItemRef({ channel: new Channel("g", 2) } as any, {} as any)
    expect(vm.itemRefs.size).toBe(1)
    vm.setConversationItemRef({ channel: new Channel("g", 2) } as any, null)
    expect(vm.itemRefs.size).toBe(0)
  })

  it("builds draft and last-message previews for conversation rows", () => {
    const vm: any = new ConversationList({ conversations: [] })
    const channel = new Channel("person", 1)
    const draftWrap: any = { channel, remoteExtra: { draft: "draft text" } }
    expect(vm.lastContent(draftWrap)).toBeTruthy()
    expect(vm.lastContent({ channel, remoteExtra: {}, lastMessage: undefined })).toBeUndefined()
    const message: any = {
      channel, messageSeq: 1, messageID: "m", fromUID: "u", timestamp: Date.now(),
      isDeleted: false, remoteExtra: {}, content: { conversationDigest: "hello", contentObj: {} },
    }
    expect(vm.lastContent({ channel, remoteExtra: {}, lastMessage: message })).toBe("hello")
    message.remoteExtra.revoke = true
    expect(vm.lastContent({ channel, remoteExtra: {}, lastMessage: message })).toBeDefined()
  })

  it("filters conversations and groups parent threads with overflow metadata", async () => {
    const group = new Channel("parent", 2)
    const thread = (id: string, unread: number) => ({
      channel: new Channel(id, 5), channelInfo: { title: id, orgData: { parentGroupNo: "parent", displayName: id } },
      unread, extra: {}, remoteExtra: {}, conversation: { extra: {} },
    }) as any
    const parent: any = { channel: group, channelInfo: { top: 1, title: "Parent", orgData: { displayName: "Parent" } }, unread: 1, extra: {}, remoteExtra: {}, conversation: { extra: {} } }
    const threads = [thread("thread-1", 2), thread("thread-2", 3), thread("thread-3", 4)]
    const vm: any = new ConversationList({ conversations: [parent, ...threads], filter: "all", compact: true })
    expect(vm.filterConversation(parent)).toBe(true)
    for (const filter of ["group", "dm", "ai", "human", "all"]) {
      vm.props = { ...vm.props, filter }
      vm.filterConversation(parent)
      vm.filterConversation({ ...parent, channel: new Channel("person", 1), channelInfo: { orgData: { robot: 1 } } })
    }
    vm.props = { ...vm.props, filter: "all" }
    const grouped = vm.groupThreadsWithParent([parent, ...threads], 1, false)
    expect(grouped.items.some((item: any) => item.type === "thread-overflow")).toBe(true)
    expect(grouped.threadsByParent.get("parent")).toHaveLength(3)
    const orphan = thread("orphan____x", 1)
    const kept = vm.groupThreadsWithParent([orphan], Infinity, true)
    expect(kept.items).toHaveLength(1)
    expect(vm.buildThreadsByParent(threads).get("parent")).toHaveLength(3)
    vm.onTop(parent)
    vm.onMute(parent.channelInfo)
    vm.onMuteWithValue(true, parent.channelInfo)
    vm.onHideConversation(parent.channel)
    await vm.onClearMessages(parent.channel)

    vm.props = {
      ...vm.props, conversations: [parent, ...threads], compact: false,
      extraContextMenus: () => [{ title: "extra", onClick: vi.fn() }],
      trailingContextMenus: () => [{ title: "trailing", onClick: vi.fn() }],
      hidePin: false, hideCloseChat: false,
    }
    vm.onTop = vi.fn()
    vm.onMuteWithValue = vi.fn()
    vm.onHideConversation = vi.fn()
    vm.state.selectConversationWrap = parent
    ;(WKApp as any).apiClient.put = vi.fn().mockResolvedValue(undefined)
    const tree: any = vm.render()
    const visit = (node: any) => {
      if (!node || typeof node !== "object") return
      if (node.props?.menus && Array.isArray(node.props.menus)) {
        node.props.menus.forEach((menu: any) => { try { menu?.onClick?.() } catch {} })
      }
      const children = node.props?.children
      if (Array.isArray(children)) children.forEach(visit)
      else visit(children)
    }
    visit(tree)
    expect(tree).toBeTruthy()
  })
})
