import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Channel, ChannelInfo, Conversation as SdkConversation, Message, MessageText, Reminder, ReminderType, WKSDK } from "wukongimjssdk"

// Keep the conversation, VM, SDK models and read-attention decisions real.
// These unrelated UI libraries cannot run their layout machinery in jsdom.
vi.mock("@douyinfe/semi-ui", () => ({
  Toast: { error: vi.fn() },
  Modal: { confirm: vi.fn() },
  Spin: () => null,
}))
vi.mock("react-virtuoso", () => ({
  Virtuoso: () => null,
  TableVirtuoso: () => null,
  VirtuosoGrid: () => null,
}))

import WKApp from "../../../App"
import { Conversation } from "../index"
import ConversationVM from "../vm"
import { MessageWrap } from "../../../Service/Model"

const originalMenu = WKApp.currentMenuId

function fixture() {
  const channel = new Channel("mention-location", 2)
  const conversation = new Conversation({ channel })
  const vm = new ConversationVM(channel)
  conversation.vm = vm
  // Model the mounted component without starting network/subscriber listeners.
  Object.assign(conversation, { _attentionMounted: true })
  const message = new Message()
  message.messageSeq = 70
  message.clientMsgNo = "located-mention"
  message.content = new MessageText("@me")
  const wrap = new MessageWrap(message)
  vm.messages = [wrap]
  vm.browseToMessageSeq = 1
  const current = new SdkConversation()
  current.channel = channel
  current.lastMessage = Object.assign(new Message(), { messageSeq: 250 })
  current.reminders = [70, 200].map((seq, index) => Object.assign(new Reminder(), {
    reminderID: 101 + index,
    messageSeq: seq,
    reminderType: ReminderType.ReminderTypeMentionMe,
    done: false,
  }))
  vm.currentConversation = current

  const viewport = document.createElement("div")
  viewport.id = vm.messageContainerId
  viewport.scrollTop = 100
  Object.defineProperties(viewport, {
    scrollHeight: { value: 2000 },
    clientHeight: { value: 200 },
  })
  vi.spyOn(viewport, "getBoundingClientRect").mockReturnValue(new DOMRect(10, 100, 400, 200))
  const row = document.createElement("div")
  row.id = message.clientMsgNo
  row.dataset.locateMessageRow = "true"
  row.dataset.messageSeq = "70"
  Object.defineProperties(row, {
    offsetTop: { value: 100 },
    clientHeight: { value: 40 },
  })
  vi.spyOn(row, "getBoundingClientRect").mockReturnValue(new DOMRect(10, 100, 400, 40))
  viewport.append(row)
  document.body.append(viewport)

  const commits: Array<() => void> = []
  vm.listen(callback => { if (callback) commits.push(callback) })
  const done = vi.spyOn(WKSDK.shared().reminderManager, "done").mockImplementation(() => {})
  // Stop the external conversation reconciliation, not the visible-message scan.
  vi.spyOn(vm, "refreshNewMsgCount").mockResolvedValue(undefined)
  return { conversation, vm, viewport, row, commits, done }
}

function foldedFixture(targetIsSummary: boolean) {
  const f = fixture()
  const target = f.vm.messages[0]
  const sibling = new MessageWrap(Object.assign(new Message(), {
    messageSeq: targetIsSummary ? 69 : 71,
    clientMsgNo: "fold-sibling",
    content: new MessageText("bot context"),
    fromUID: "location-bot",
    timestamp: 100,
  }))
  target.message.fromUID = "location-bot"
  target.message.timestamp = 100
  vi.spyOn(WKSDK.shared().channelManager, "getChannelInfo").mockReturnValue(
    Object.assign(new ChannelInfo(), {
      channel: new Channel("location-bot", 1),
      orgData: { robot: 1 },
    }),
  )
  f.vm.messages = targetIsSummary ? [sibling, target] : [target, sibling]
  f.vm.messagesOfOrigin = f.vm.messages
  f.vm.renderItems = f.vm.buildRenderItems(f.vm.messages)
  const fold = f.vm.findFoldSessionByMessageSeq(70)!
  if (targetIsSummary) f.row.id = fold.anchorId
  return f
}

beforeEach(() => {
  WKApp.currentMenuId = "chat"
  vi.spyOn(document, "hasFocus").mockReturnValue(true)
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible")
})
afterEach(() => {
  document.body.replaceChildren()
  WKApp.currentMenuId = originalMenu
  vi.restoreAllMocks()
})

describe("mention location completion", () => {
  it("completes the visible mention after DOM commit even when scrollTop does not change", () => {
    const { conversation, vm, viewport, commits, done } = fixture()
    conversation.locateMessage(70)
    expect(done).not.toHaveBeenCalled()
    expect(vm.browseToMessageSeq).toBe(1)
    commits.shift()!()
    expect(viewport.scrollTop).toBe(100)
    expect(done).toHaveBeenCalledExactlyOnceWith([101])
    expect(vm.browseToMessageSeq).toBe(70)
  })

  it("completes a folded summary mention after its highlight render commits", () => {
    const { conversation, commits, done } = foldedFixture(true)
    conversation.locateMessage(70)
    expect(done).not.toHaveBeenCalled()
    commits.shift()!()
    expect(done).toHaveBeenCalledExactlyOnceWith([101])
  })

  it("waits for expansion and message rendering before completing a collapsed mention", () => {
    const { conversation, commits, done } = foldedFixture(false)
    conversation.locateMessage(70)
    expect(done).not.toHaveBeenCalled()
    commits.shift()!()
    expect(done).not.toHaveBeenCalled()
    commits.shift()!()
    expect(done).toHaveBeenCalledExactlyOnceWith([101])
  })

  it("does not complete a located reminder after the window loses focus", () => {
    const { conversation, vm, commits, done } = fixture()
    conversation.locateMessage(70)
    vi.mocked(document.hasFocus).mockReturnValue(false)
    commits.shift()!()
    expect(done).not.toHaveBeenCalled()
    expect(vm.browseToMessageSeq).toBe(1)
  })

  it("does not complete reminders from a late render callback after unmount", () => {
    const { conversation, vm, commits, done } = fixture()
    conversation.locateMessage(70)
    Object.assign(conversation, { _attentionMounted: false })
    commits.shift()!()
    expect(done).not.toHaveBeenCalled()
    expect(vm.browseToMessageSeq).toBe(1)
  })

  it("keeps the reminder pending if its message is no longer rendered at commit", () => {
    const { conversation, row, commits, done } = fixture()
    conversation.locateMessage(70)
    row.remove()
    commits.shift()!()
    expect(done).not.toHaveBeenCalled()
  })

  it("does not consume reminders while the conversation viewport is hidden", () => {
    const { conversation, viewport, commits, done } = fixture()
    conversation.locateMessage(70)
    viewport.style.display = "none"
    commits.shift()!()
    expect(done).not.toHaveBeenCalled()
  })
})
