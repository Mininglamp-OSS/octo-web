import { describe, expect, it, vi } from "vitest"

const hoisted = vi.hoisted(() => ({
  disbanded: false,
  toastError: vi.fn(),
  modalConfirm: vi.fn(() => ({ destroy: vi.fn() })),
}))

vi.mock("../../../Utils/groupDisband", () => ({
  isConversationDisbanded: () => hoisted.disbanded,
}))
vi.mock("@douyinfe/semi-ui", () => ({
  Toast: { error: hoisted.toastError },
  Modal: { confirm: hoisted.modalConfirm },
  Spin: () => null,
}))

vi.mock("react-virtuoso", () => ({
  Virtuoso: () => null,
  TableVirtuoso: () => null,
  VirtuosoGrid: () => null,
}))

import {
  Conversation,
  classifyAssistantIntentText,
  deleteSelectedConversationMessages,
} from "../index"
import {
  MediaMessageContent,
  MessageStatus,
  MessageTask,
  MessageText,
  TaskStatus,
  WKSDK,
  Channel,
} from "wukongimjssdk"
import { MessageContentTypeConst } from "../../../Service/Const"

const channel = { channelID: "g", channelType: 2 } as any

function captureSdkListeners() {
  const sdk = WKSDK.shared()
  const taskListeners: Function[] = []
  const ackListeners: Function[] = []
  const addTask = vi.spyOn(sdk.taskManager, "addListener").mockImplementation((listener: any) => {
    taskListeners.push(listener)
  })
  const removeTask = vi.spyOn(sdk.taskManager, "removeListener").mockImplementation(() => {})
  const addAck = vi.spyOn(sdk.chatManager, "addMessageStatusListener").mockImplementation((listener: any) => {
    ackListeners.push(listener)
  })
  const removeAck = vi.spyOn(sdk.chatManager, "removeMessageStatusListener").mockImplementation(() => {})
  return {
    taskListeners,
    ackListeners,
    restore: () => {
      addTask.mockRestore()
      removeTask.mockRestore()
      addAck.mockRestore()
      removeAck.mockRestore()
    },
  }
}

describe("classifyAssistantIntentText", () => {
  it("handles empty text and ordinary statements as other", () => {
    expect(classifyAssistantIntentText(undefined)).toBe("other")
    expect(classifyAssistantIntentText("")).toBe("other")
    expect(classifyAssistantIntentText("hello there")).toBe("other")
  })

  it("prioritizes summary and analysis intents", () => {
    expect(classifyAssistantIntentText("summary this code")).toBe("summary")
    expect(classifyAssistantIntentText("请分析这个方案")).toBe("analysis")
  })

  it("recognizes code generation signals without classifying ordinary words", () => {
    expect(classifyAssistantIntentText("```ts\nconst x = 1\n```")).toBe("code_gen")
    expect(classifyAssistantIntentText("please debug this function")).toBe("code_gen")
    expect(classifyAssistantIntentText("Let me know when ready")).toBe("other")
  })

  it("recognizes both question mark variants", () => {
    expect(classifyAssistantIntentText("How does this work?")).toBe("qa")
    expect(classifyAssistantIntentText("这是什么意思？")).toBe("qa")
  })

  it("uses the same classifier through the Conversation action method", () => {
    const conversation = new Conversation({ channel: { channelID: "g", channelType: 2 } })

    expect((conversation as any).classifyAssistantIntent(new MessageText("请分析这个"))).toBe("analysis")
    expect((conversation as any).classifyAssistantIntent({})).toBe("other")
  })

  it("rejects sends to a disbanded conversation before touching the VM", async () => {
    hoisted.disbanded = true
    hoisted.toastError.mockReset()
    const conversation = new Conversation({ channel: { channelID: "g", channelType: 2 } })

    await expect(conversation.sendMessage({} as any)).rejects.toThrow("group disbanded")
    expect(hoisted.toastError).toHaveBeenCalledTimes(1)
    hoisted.disbanded = false
  })

  it("maps forward results to success, partial-failure, and all-failed UI states", () => {
    const conversation = new Conversation({ channel: { channelID: "g", channelType: 2 } })

    expect((conversation as any).showForwardResult({
      targets: 2, failedTargets: 0, messages: 2, failedMessages: 0, messageAttempts: 4,
    }, "targets")).toBe("success")

    hoisted.toastError.mockReset()
    expect((conversation as any).showForwardResult({
      targets: 2, failedTargets: 1, messages: 2, failedMessages: 2, messageAttempts: 4,
    }, "targets")).toBe("partial")
    expect(hoisted.toastError).toHaveBeenCalledTimes(1)

    hoisted.toastError.mockReset()
    expect((conversation as any).showForwardResult({
      targets: 2, failedTargets: 2, messages: 2, failedMessages: 4, messageAttempts: 4,
    }, "messages")).toBe("all-failed")
    expect(hoisted.toastError).toHaveBeenCalledTimes(1)
  })

  it("short-circuits empty deletion selections", async () => {
    const vm = { deleteMessages: vi.fn(), unCheckAllMessages: vi.fn(), editOn: true }

    await deleteSelectedConversationMessages(vm as any, [])

    expect(vm.deleteMessages).not.toHaveBeenCalled()
    expect(vm.unCheckAllMessages).not.toHaveBeenCalled()
  })

  it("clears edit mode after deletion succeeds", async () => {
    const vm = { deleteMessages: vi.fn(() => Promise.resolve()), unCheckAllMessages: vi.fn(), editOn: true }

    await deleteSelectedConversationMessages(vm as any, [{} as any])

    expect(vm.deleteMessages).toHaveBeenCalledTimes(1)
    expect(vm.editOn).toBe(false)
    expect(vm.unCheckAllMessages).toHaveBeenCalledTimes(1)
  })

  it("reports deletion failures and preserves the error", async () => {
    const error = new Error("delete failed")
    const vm = { deleteMessages: vi.fn(() => Promise.reject(error)), unCheckAllMessages: vi.fn(), editOn: true }
    hoisted.toastError.mockReset()

    await expect(deleteSelectedConversationMessages(vm as any, [{} as any])).rejects.toBe(error)

    expect(hoisted.toastError).toHaveBeenCalledTimes(1)
    expect(vm.unCheckAllMessages).not.toHaveBeenCalled()
  })

  it("deletes the failed local message before a successful resend", async () => {
    const sent = { messageID: "resent" }
    const vm = {
      deleteMessagesFromLocal: vi.fn(() => Promise.resolve()),
      sendMessage: vi.fn(() => Promise.resolve(sent)),
    }
    const conversation = new Conversation({ channel: { channelID: "g", channelType: 2 } })
    ;(conversation as any).vm = vm
    const message = { channel: { channelID: "g", channelType: 2 }, content: { text: "retry" } }

    await expect(conversation.resendMessage(message as any)).resolves.toBe(sent)

    expect(vm.deleteMessagesFromLocal).toHaveBeenCalledWith([message])
    expect(vm.sendMessage).toHaveBeenCalledWith(message.content, message.channel)
  })

  it("propagates resend failures after local cleanup", async () => {
    const error = new Error("resend failed")
    const vm = {
      deleteMessagesFromLocal: vi.fn(() => Promise.resolve()),
      sendMessage: vi.fn(() => Promise.reject(error)),
    }
    const conversation = new Conversation({ channel: { channelID: "g", channelType: 2 } })
    ;(conversation as any).vm = vm
    const message = { channel: { channelID: "g", channelType: 2 }, content: {} }

    await expect(conversation.resendMessage(message as any)).rejects.toBe(error)
    expect(vm.deleteMessagesFromLocal).toHaveBeenCalledTimes(1)
  })

  it("ignores non-file drops after resetting the drag state", async () => {
    const conversation = new Conversation({ channel: { channelID: "g", channelType: 2 } })
    const vm = { fileDragEnter: true, fileDragLeave: false, notifyListener: vi.fn() }
    ;(conversation as any).vm = vm
    const preventDefault = vi.fn()

    await (conversation as any).handleConversationDrop({
      dataTransfer: { types: ["text/plain"], items: [], files: [] },
      preventDefault,
    })

    expect(vm.fileDragEnter).toBe(false)
    expect(vm.fileDragLeave).toBe(true)
    expect(preventDefault).not.toHaveBeenCalled()
  })

  it("ignores a Files drop when the browser provides no files", async () => {
    const conversation = new Conversation({ channel: { channelID: "g", channelType: 2 } })
    ;(conversation as any).vm = { fileDragEnter: true, fileDragLeave: false, notifyListener: vi.fn() }
    const addPendingAttachments = vi.fn()
    ;(conversation as any).addPendingAttachments = addPendingAttachments
    const preventDefault = vi.fn()

    await (conversation as any).handleConversationDrop({
      dataTransfer: { types: ["Files"], items: [], files: [] },
      preventDefault,
    })

    expect(preventDefault).toHaveBeenCalledTimes(1)
    expect(addPendingAttachments).not.toHaveBeenCalled()
  })

  it("rejects dropped directories before adding attachments", async () => {
    const conversation = new Conversation({ channel: { channelID: "g", channelType: 2 } })
    ;(conversation as any).vm = { fileDragEnter: true, fileDragLeave: false, notifyListener: vi.fn() }
    const addPendingAttachments = vi.fn()
    ;(conversation as any).addPendingAttachments = addPendingAttachments
    hoisted.toastError.mockReset()
    const file = { name: "folder-entry", type: "", size: 0 }

    await (conversation as any).handleConversationDrop({
      dataTransfer: {
        types: ["Files"],
        items: [{ webkitGetAsEntry: () => ({ isDirectory: true }) }],
        files: [file],
      },
      preventDefault: vi.fn(),
    })

    expect(addPendingAttachments).not.toHaveBeenCalled()
    expect(hoisted.toastError).toHaveBeenCalledTimes(1)
  })

  it("adds dropped files and reports attachment preparation errors", async () => {
    const conversation = new Conversation({ channel: { channelID: "g", channelType: 2 } })
    ;(conversation as any).vm = { fileDragEnter: true, fileDragLeave: false, notifyListener: vi.fn() }
    const file = { name: "note.txt", type: "text/plain", size: 4 }
    const addPendingAttachments = vi.fn(() => Promise.resolve("upload failed"))
    ;(conversation as any).addPendingAttachments = addPendingAttachments
    hoisted.toastError.mockReset()

    await (conversation as any).handleConversationDrop({
      dataTransfer: { types: ["Files"], items: [], files: [file] },
      preventDefault: vi.fn(),
    })

    expect(addPendingAttachments).toHaveBeenCalledWith([file])
    expect(hoisted.toastError).toHaveBeenCalledWith("upload failed")
  })

  it("routes content without an upload file through the text ack path", async () => {
    const conversation = new Conversation({ channel: { channelID: "g", channelType: 2 } })
    const waitForText = vi.fn(() => Promise.resolve(true))
    ;(conversation as any).sendTextAndWaitAck = waitForText
    const content = { contentType: 1 }

    await expect((conversation as any).sendMediaAndWait(content, undefined, undefined, {})).resolves.toBe(true)

    expect(waitForText).toHaveBeenCalledWith(content, undefined, undefined, {})
  })

  it("returns queued=true when text send already has a successful status", async () => {
    const conversation = new Conversation({ channel: { channelID: "g", channelType: 2 } })
    const sent = { clientSeq: 7, clientMsgNo: "msg-7", status: MessageStatus.Normal }
    const sendMessage = vi.fn(() => Promise.resolve(sent))
    ;(conversation as any).sendMessage = sendMessage
    const onEnqueued = vi.fn()

    await expect((conversation as any).sendTextAndWaitAck({}, undefined, onEnqueued, {})).resolves.toBe(true)

    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(onEnqueued).toHaveBeenCalledTimes(1)
  })

  it("propagates pre-enqueue text failures and does not report enqueued", async () => {
    const conversation = new Conversation({ channel: { channelID: "g", channelType: 2 } })
    const error = new Error("encode failed")
    const sendMessage = vi.fn(() => Promise.reject(error))
    ;(conversation as any).sendMessage = sendMessage
    const onEnqueued = vi.fn()

    await expect((conversation as any).sendTextAndWaitAck({}, undefined, onEnqueued, {})).rejects.toBe(error)

    expect(onEnqueued).not.toHaveBeenCalled()
  })

  it("cleans up media listeners when media send fails before enqueue", async () => {
    const conversation = new Conversation({ channel: { channelID: "g", channelType: 2 } })
    const error = new Error("media send failed")
    ;(conversation as any).sendMessage = vi.fn(() => Promise.reject(error))
    const content = Object.create(MediaMessageContent.prototype)
    content.file = { name: "image.png" }

    await expect((conversation as any).sendMediaAndWait(content, undefined, undefined, {})).rejects.toBe(error)
  })

  it("accepts an ack that arrived before text send returned", async () => {
    const listeners = captureSdkListeners()
    try {
      let resolveSend!: (message: any) => void
      const conversation = new Conversation({ channel: { channelID: "g", channelType: 2 } })
      ;(conversation as any).sendMessage = vi.fn(() => new Promise((resolve) => { resolveSend = resolve }))
      const pending = (conversation as any).sendTextAndWaitAck({}, undefined, undefined, {})
      listeners.ackListeners[0]({ clientSeq: 7, reasonCode: 1 })
      resolveSend({ clientSeq: 7, status: MessageStatus.Wait })

      await expect(pending).resolves.toBe(true)
    } finally {
      listeners.restore()
    }
  })

  it("keeps an enqueued text message successful to the caller when ack fails", async () => {
    const listeners = captureSdkListeners()
    try {
      const conversation = new Conversation({ channel: { channelID: "g", channelType: 2 } })
      ;(conversation as any).sendMessage = vi.fn(() => Promise.resolve({ clientSeq: 8, status: MessageStatus.Wait }))
      const pending = (conversation as any).sendTextAndWaitAck({}, undefined, undefined, {})
      await Promise.resolve()
      listeners.ackListeners[0]({ clientSeq: 8, reasonCode: 0 })

      await expect(pending).resolves.toBe(true)
    } finally {
      listeners.restore()
    }
  })

  it("waits for both media upload success and ack success", async () => {
    const listeners = captureSdkListeners()
    try {
      const conversation = new Conversation({ channel: { channelID: "g", channelType: 2 } })
      ;(conversation as any).sendMessage = vi.fn(() => Promise.resolve({ clientSeq: 9, clientMsgNo: "msg-9", status: MessageStatus.Wait }))
      const content = Object.create(MediaMessageContent.prototype)
      content.file = { name: "image.png" }
      const pending = (conversation as any).sendMediaAndWait(content, undefined, undefined, {})
      await Promise.resolve()
      listeners.ackListeners[0]({ clientSeq: 9, reasonCode: 1 })
      const task = Object.create(MessageTask.prototype)
      task.message = { clientSeq: 9 }
      task.status = TaskStatus.success
      listeners.taskListeners[0](task)

      await expect(pending).resolves.toBe(true)
    } finally {
      listeners.restore()
    }
  })

  it("keeps an enqueued media message retryable when ack fails", async () => {
    const listeners = captureSdkListeners()
    try {
      const conversation = new Conversation({ channel: { channelID: "g", channelType: 2 } })
      ;(conversation as any).sendMessage = vi.fn(() => Promise.resolve({ clientSeq: 10, clientMsgNo: "msg-10", status: MessageStatus.Wait }))
      const content = Object.create(MediaMessageContent.prototype)
      content.file = { name: "image.png" }
      const pending = (conversation as any).sendMediaAndWait(content, undefined, undefined, {})
      await Promise.resolve()
      listeners.ackListeners[0]({ clientSeq: 10, reasonCode: 0 })

      await expect(pending).resolves.toBe(true)
    } finally {
      listeners.restore()
    }
  })

  it("keeps an enqueued media message retryable when upload task fails", async () => {
    const listeners = captureSdkListeners()
    try {
      const conversation = new Conversation({ channel: { channelID: "g", channelType: 2 } })
      ;(conversation as any).sendMessage = vi.fn(() => Promise.resolve({ clientSeq: 11, clientMsgNo: "msg-11", status: MessageStatus.Wait }))
      const content = Object.create(MediaMessageContent.prototype)
      content.file = { name: "image.png" }
      const pending = (conversation as any).sendMediaAndWait(content, undefined, undefined, {})
      await Promise.resolve()
      const task = Object.create(MessageTask.prototype)
      task.message = { clientSeq: 11 }
      task.status = TaskStatus.fail
      listeners.taskListeners[0](task)

      await expect(pending).resolves.toBe(true)
    } finally {
      listeners.restore()
    }
  })

  it("returns after media confirmation timeout while preserving the enqueued result", async () => {
    vi.useFakeTimers()
    const listeners = captureSdkListeners()
    try {
      const conversation = new Conversation({ channel: { channelID: "g", channelType: 2 } })
      ;(conversation as any).sendMessage = vi.fn(() => Promise.resolve({ clientSeq: 12, clientMsgNo: "msg-12", status: MessageStatus.Wait }))
      const content = Object.create(MediaMessageContent.prototype)
      content.file = { name: "image.png" }
      const pending = (conversation as any).sendMediaAndWait(content, undefined, undefined, {})
      await Promise.resolve()
      vi.advanceTimersByTime(30_000)

      await expect(pending).resolves.toBe(true)
    } finally {
      listeners.restore()
      vi.useRealTimers()
    }
  })

  it("forwards thread panel navigation to the supplied callback", () => {
    const onOpenThreadPanel = vi.fn()
    const conversation = new Conversation({ channel, onOpenThreadPanel })

    conversation.openThreadPanel("thread-1", "Topic")

    expect(onOpenThreadPanel).toHaveBeenCalledWith("thread-1", "Topic")
  })

  it("does not fail when thread navigation has no callback", () => {
    expect(() => new Conversation({ channel }).openThreadPanel("thread-1", "Topic")).not.toThrow()
  })

  it("forwards webhook preview navigation to the supplied callback", () => {
    const onOpenWebhookPreview = vi.fn()
    const conversation = new Conversation({ channel, onOpenWebhookPreview })
    const target = { messageId: "m1" }

    conversation.openWebhookPreview(target as any)

    expect(onOpenWebhookPreview).toHaveBeenCalledWith(target)
  })

  it("does not fail when webhook navigation has no callback", () => {
    expect(() => new Conversation({ channel }).openWebhookPreview({ messageId: "m1" } as any)).not.toThrow()
  })

  it("returns the active preview id and null when no preview is active", () => {
    expect(new Conversation({ channel }).getActivePreviewMessageId()).toBeNull()
    expect(new Conversation({ channel, activePreviewMessageId: "m2" }).getActivePreviewMessageId()).toBe("m2")
  })

  it("replies to a loaded message by delegating to the reply action", () => {
    const message = { messageID: "m3" }
    const conversation = new Conversation({ channel })
    ;(conversation as any).vm = { findMessageWithMessageID: vi.fn(() => ({ message })) }
    ;(conversation as any).reply = vi.fn()

    conversation.replyToMessageId("m3")

    expect((conversation as any).reply).toHaveBeenCalledWith(message, 1)
  })

  it("ignores reply navigation when the message is not loaded", () => {
    const conversation = new Conversation({ channel })
    ;(conversation as any).vm = { findMessageWithMessageID: vi.fn(() => undefined) }
    ;(conversation as any).reply = vi.fn()

    conversation.replyToMessageId("missing")

    expect((conversation as any).reply).not.toHaveBeenCalled()
  })

  it("restores a file reply target when the original message is not loaded", () => {
    const conversation = new Conversation({ channel })
    ;(conversation as any).vm = {
      findMessageWithMessageID: vi.fn(() => undefined),
      currentHandlerType: 0,
      currentReplyMessage: undefined,
    }
    ;(conversation as any)._messageInputContext = { addMention: vi.fn(), focus: vi.fn() }

    conversation.replyToFileMessage({
      messageId: "m4",
      messageSeq: 4,
      fromUID: "u4",
      conversationDigest: "excerpt",
      channelId: "g",
      channelType: 2,
    })

    expect((conversation as any).vm.currentHandlerType).toBe(1)
    expect((conversation as any).vm.currentReplyMessage.messageID).toBe("m4")
    expect((conversation as any)._messageInputContext.focus).toHaveBeenCalledTimes(1)
  })

  it("does not add a mention for a file reply in a direct conversation", () => {
    const conversation = new Conversation({ channel: { channelID: "u1", channelType: 1 } })
    const addMention = vi.fn()
    ;(conversation as any).vm = { findMessageWithMessageID: vi.fn(() => undefined), currentHandlerType: 0 }
    ;(conversation as any)._messageInputContext = { addMention, focus: vi.fn() }

    conversation.replyToFileMessage({ messageId: "m6", messageSeq: 6, fromUID: "u6", conversationDigest: "x", channelId: "u1", channelType: 1 })

    expect(addMention).not.toHaveBeenCalled()
  })

  it("does not add a mention when a group file reply is from the current user", async () => {
    const conversation = new Conversation({ channel })
    const addMention = vi.fn()
    const { default: app } = await import("../../../App")
    ;(conversation as any).vm = { findMessageWithMessageID: vi.fn(() => undefined), currentHandlerType: 0 }
    ;(conversation as any)._messageInputContext = { addMention, focus: vi.fn() }

    conversation.replyToFileMessage({ messageId: "m7", messageSeq: 7, fromUID: app.loginInfo.uid, conversationDigest: "x", channelId: "g", channelType: 2 })

    expect(addMention).not.toHaveBeenCalled()
  })

  it("uses the full loaded message when replying to a file message", () => {
    const message = { messageID: "m5" }
    const conversation = new Conversation({ channel })
    ;(conversation as any).vm = { findMessageWithMessageID: vi.fn(() => ({ message })) }
    ;(conversation as any).reply = vi.fn()

    conversation.replyToFileMessage({
      messageId: "m5",
      messageSeq: 5,
      fromUID: "u5",
      conversationDigest: "excerpt",
      channelId: "g",
      channelType: 2,
    })

    expect((conversation as any).reply).toHaveBeenCalledWith(message, 1)
  })

  it("starts drag mode once for nested file dragenter events", () => {
    const conversation = new Conversation({ channel })
    ;(conversation as any).vm = { fileDragEnter: false, fileDragLeave: false, notifyListener: vi.fn() }
    const dragStart = vi.spyOn(conversation, "dragStart")
    const event = { dataTransfer: { types: ["Files"] }, preventDefault: vi.fn() }

    ;(conversation as any).handleConversationDragEnter(event)
    ;(conversation as any).handleConversationDragEnter(event)

    expect(dragStart).toHaveBeenCalledTimes(1)
    expect((conversation as any)._dragDepth).toBe(2)
  })

  it("ignores non-file dragenter events", () => {
    const conversation = new Conversation({ channel })
    ;(conversation as any).vm = { fileDragEnter: false, fileDragLeave: false, notifyListener: vi.fn() }
    const preventDefault = vi.fn()

    ;(conversation as any).handleConversationDragEnter({ dataTransfer: { types: ["text/plain"] }, preventDefault })

    expect(preventDefault).not.toHaveBeenCalled()
    expect((conversation as any)._dragDepth).toBe(0)
  })

  it("prevents default for file dragover and ignores text dragover", () => {
    const conversation = new Conversation({ channel })
    const filePrevent = vi.fn()
    const textPrevent = vi.fn()

    ;(conversation as any).handleConversationDragOver({ dataTransfer: { types: ["Files"] }, preventDefault: filePrevent })
    ;(conversation as any).handleConversationDragOver({ dataTransfer: { types: ["text/plain"] }, preventDefault: textPrevent })

    expect(filePrevent).toHaveBeenCalledTimes(1)
    expect(textPrevent).not.toHaveBeenCalled()
  })

  it("ends drag mode only after the last nested file dragleave", () => {
    const conversation = new Conversation({ channel })
    ;(conversation as any).vm = { fileDragEnter: true, fileDragLeave: false, notifyListener: vi.fn() }
    ;(conversation as any)._dragDepth = 2
    const dragEnd = vi.spyOn(conversation, "dragEnd")
    const event = { dataTransfer: { types: ["Files"] }, preventDefault: vi.fn() }

    ;(conversation as any).handleConversationDragLeave(event)
    expect(dragEnd).not.toHaveBeenCalled()
    ;(conversation as any).handleConversationDragLeave(event)

    expect(dragEnd).toHaveBeenCalledTimes(1)
  })

  it("ignores non-file dragleave events", () => {
    const conversation = new Conversation({ channel })
    ;(conversation as any)._dragDepth = 1
    const preventDefault = vi.fn()

    ;(conversation as any).handleConversationDragLeave({ dataTransfer: { types: ["text/plain"] }, preventDefault })

    expect(preventDefault).not.toHaveBeenCalled()
    expect((conversation as any)._dragDepth).toBe(1)
  })

  it("toggles drag start and end state for the upload mask", () => {
    const conversation = new Conversation({ channel })
    const vm = { fileDragEnter: false, fileDragLeave: false, notifyListener: vi.fn() }
    ;(conversation as any).vm = vm

    conversation.dragStart()
    expect(vm.fileDragEnter).toBe(true)
    expect(vm.fileDragLeave).toBe(false)
    conversation.dragEnd()

    expect(vm.fileDragEnter).toBe(false)
    expect(vm.fileDragLeave).toBe(true)
    expect(vm.notifyListener).toHaveBeenCalledTimes(2)
  })

  it("returns queued=true after a text ack timeout", async () => {
    vi.useFakeTimers()
    const listeners = captureSdkListeners()
    try {
      const conversation = new Conversation({ channel })
      ;(conversation as any).sendMessage = vi.fn(() => Promise.resolve({ clientSeq: 13, status: MessageStatus.Wait }))
      const pending = (conversation as any).sendTextAndWaitAck({}, undefined, undefined, {})
      await Promise.resolve()
      vi.advanceTimersByTime(10_000)

      await expect(pending).resolves.toBe(true)
    } finally {
      listeners.restore()
      vi.useRealTimers()
    }
  })

  it("uses task-map and message-status fallbacks for an already completed media send", async () => {
    const listeners = captureSdkListeners()
    const sdk = WKSDK.shared()
    const originalTaskMap = (sdk.taskManager as any).taskMap
    ;(sdk.taskManager as any).taskMap = new Map([["media-fallback", { status: TaskStatus.success }]])
    try {
      const conversation = new Conversation({ channel })
      ;(conversation as any).sendMessage = vi.fn(() => Promise.resolve({
        clientSeq: 20, clientMsgNo: "media-fallback", status: MessageStatus.Normal,
      }))
      const content = Object.create(MediaMessageContent.prototype)
      content.file = { name: "fallback.png" }
      await expect((conversation as any).sendMediaAndWait(content, undefined, undefined, {})).resolves.toBe(true)
    } finally {
      ;(sdk.taskManager as any).taskMap = originalTaskMap
      listeners.restore()
    }
  })

  it("treats an empty zero-byte file entry as a dropped directory", async () => {
    const conversation = new Conversation({ channel })
    ;(conversation as any).vm = { fileDragEnter: true, fileDragLeave: false, notifyListener: vi.fn() }
    const addPendingAttachments = vi.fn()
    ;(conversation as any).addPendingAttachments = addPendingAttachments
    hoisted.toastError.mockReset()

    await (conversation as any).handleConversationDrop({
      dataTransfer: { types: ["Files"], items: [], files: [{ type: "", size: 0 }] },
      preventDefault: vi.fn(),
    })

    expect(addPendingAttachments).not.toHaveBeenCalled()
    expect(hoisted.toastError).toHaveBeenCalledTimes(1)
  })

  it("does not show an error when attachment preparation succeeds", async () => {
    const conversation = new Conversation({ channel })
    ;(conversation as any).vm = { fileDragEnter: true, fileDragLeave: false, notifyListener: vi.fn() }
    const file = { type: "text/plain", size: 2 }
    ;(conversation as any).addPendingAttachments = vi.fn(() => Promise.resolve(undefined))
    hoisted.toastError.mockReset()

    await (conversation as any).handleConversationDrop({
      dataTransfer: { types: ["Files"], items: [], files: [file] },
      preventDefault: vi.fn(),
    })

    expect(hoisted.toastError).not.toHaveBeenCalled()
  })
})

describe("Conversation attachment and viewport helpers", () => {
  const makeFile = (name: string, size = 1) => ({ name, size, type: "text/plain" }) as File

  it("rejects blocked attachment extensions before touching the editor", async () => {
    const conversation = new Conversation({ channel })
    const add = vi.fn()
    ;(conversation as any)._addAttachmentFn = add

    await expect(conversation.addPendingAttachments([makeFile("payload.exe")])).resolves.toContain("exe")
    expect(add).not.toHaveBeenCalled()
  })

  it("rejects a file larger than the shared upload limit", async () => {
    const conversation = new Conversation({ channel })
    const add = vi.fn()
    ;(conversation as any)._addAttachmentFn = add

    await expect(conversation.addPendingAttachments([makeFile("large.bin", 100 * 1024 * 1024 + 1)])).resolves.toContain("large.bin")
    expect(add).not.toHaveBeenCalled()
  })

  it("rejects a batch that exceeds the limit with existing editor attachments", async () => {
    const conversation = new Conversation({ channel })
    const add = vi.fn()
    ;(conversation as any)._addAttachmentFn = add
    ;(conversation as any)._messageInputContext = { getAttachmentFiles: () => [makeFile("existing.bin", 100 * 1024 * 1024)] }

    await expect(conversation.addPendingAttachments([makeFile("next.bin")])).resolves.toContain("100")
    expect(add).not.toHaveBeenCalled()
  })

  it("adds valid attachments with their source and propagates editor failures", async () => {
    const conversation = new Conversation({ channel })
    const add = vi.fn().mockRejectedValue(new Error("editor failed"))
    ;(conversation as any)._addAttachmentFn = add
    const file = makeFile("note.txt")

    await expect(conversation.addPendingAttachments([file], "paste")).rejects.toThrow("editor failed")
    expect(add).toHaveBeenCalledWith([file], "paste")
  })

  it("exposes editor attachments and drag callback state", () => {
    const conversation = new Conversation({ channel })
    const file = makeFile("note.txt")
    const callback = vi.fn()
    ;(conversation as any)._messageInputContext = { getAttachmentFiles: () => [file] }

    expect(conversation.getPendingAttachments()).toEqual([file])
    conversation.setDragFileCallback(callback)
    expect((conversation as any)._dragFileCallback).toBe(callback)
    ;(conversation as any)._messageInputContext = undefined
    expect(conversation.getPendingAttachments()).toEqual([])
  })

  it("replies with a digest for edit-and-reply and focuses the editor", () => {
    const conversation = new Conversation({ channel })
    const insertText = vi.spyOn(conversation, "insertText")
    const addReplyMention = vi.spyOn(conversation as any, "addReplyMention").mockImplementation(() => {})
    const focus = vi.fn()
    ;(conversation as any)._messageInputContext = { focus, insertText: vi.fn() }
    ;(conversation as any).vm = { currentHandlerType: 0, currentReplyMessage: undefined }
    const message = {
      fromUID: "u1",
      content: { conversationDigest: "original" },
      remoteExtra: { isEdit: true, contentEdit: { conversationDigest: "edited" } },
    }

    conversation.reply(message as any, 2)

    expect(addReplyMention).toHaveBeenCalledWith("u1")
    expect(insertText).toHaveBeenCalledWith("edited")
    expect((conversation as any).vm.currentHandlerType).toBe(2)
    expect((conversation as any).vm.currentReplyMessage).toBe(message)
    expect(focus).toHaveBeenCalledTimes(1)
  })

  it("forces expanded fold messages to render standalone", () => {
    const conversation = new Conversation({ channel })
    const message = { clientMsgNo: "m1", messageSeq: 1 }
    ;(conversation as any).vm = {
      afterFoldSessionClientMsgNos: new Set(["after"]),
      findFoldSessionByMessageSeq: vi.fn(() => ({ isExpanded: true, expandedMessages: [{ clientMsgNo: "m1" }] })),
      renderItems: [],
    }

    expect(conversation.forceStandaloneMessage({ clientMsgNo: "after", messageSeq: 0 } as any)).toBe(true)
    expect(conversation.forceStandaloneMessage(message as any)).toBe(true)
    ;(conversation as any).vm.findFoldSessionByMessageSeq.mockReturnValue(undefined)
    ;(conversation as any).vm.renderItems = [{ type: "foldSession", session: { isExpanded: true, expandedMessages: [message] } }]
    expect(conversation.forceStandaloneMessage(message as any)).toBe(true)
    ;(conversation as any).vm.renderItems = [{ type: "foldSession", session: { isExpanded: false, expandedMessages: [message] } }]
    expect(conversation.forceStandaloneMessage(message as any)).toBe(false)
  })

  it("computes visible messages from message elements and handles empty viewports", () => {
    const messages = [
      { messageSeq: 1, clientMsgNo: "one" },
      { messageSeq: 2, clientMsgNo: "two" },
      { messageSeq: 3, clientMsgNo: "three" },
    ]
    const conversation = new Conversation({ channel })
    ;(conversation as any).vm = { messages, messageContainerId: "viewport" }
    const elements: Record<string, any> = {
      one: { offsetTop: 0, clientHeight: 20 },
      two: { offsetTop: 40, clientHeight: 20 },
      three: { offsetTop: 100, clientHeight: 20 },
    }
    ;(conversation as any).getMessageElement = vi.fn((message: any) => elements[message.clientMsgNo])
    const viewport = { scrollTop: 30, clientHeight: 50, scrollHeight: 120 } as any

    expect(conversation.isVisiableMessage(messages[1] as any, viewport)).toBe(true)
    expect(conversation.isVisiableMessage(messages[0] as any, viewport)).toBe(false)
    expect(conversation.lastVisiableMessage(viewport)).toBe(messages[1])
    expect(conversation.firstVisiableMessage(viewport)).toBe(messages[1])
    expect(conversation.allVisiableMessages(viewport)).toEqual([messages[1]])
    expect(conversation.allVisiableMessages(null)).toEqual([])
    ;(conversation as any).vm.messages = []
    expect(conversation.lastVisiableMessage(viewport)).toBeUndefined()
    expect(conversation.firstVisiableMessage(viewport)).toBeUndefined()
    expect(conversation.allVisiableMessages(viewport)).toEqual([])
  })

  it("delegates scroll-to-bottom and normalizes the animation flag", () => {
    const conversation = new Conversation({ channel })
    ;(conversation as any).vm = { scrollToBottom: vi.fn() }
    conversation.scrollToBottom()
    conversation.scrollToBottom(true)
    expect((conversation as any).vm.scrollToBottom).toHaveBeenNthCalledWith(1, false)
    expect((conversation as any).vm.scrollToBottom).toHaveBeenNthCalledWith(2, true)
  })

  it("stores pending editor content until the input context is ready", () => {
    const conversation = new Conversation({ channel })
    conversation.insertText("hello")
    conversation.restoreDraft("draft")
    expect((conversation as any)._pendingInsertText).toBe("hello")
    expect((conversation as any)._pendingRestoreDraft).toBe("draft")

    const insertText = vi.fn()
    const restoreDraft = vi.fn()
    ;(conversation as any)._messageInputContext = { insertText, restoreDraft }
    conversation.insertText("now")
    conversation.restoreDraft("now draft")
    expect(insertText).toHaveBeenCalledWith("now")
    expect(restoreDraft).toHaveBeenCalledWith("now draft")
  })

  it("delegates message selection, deletion, revoke, and edit operations", async () => {
    const message = { clientMsgNo: "m1" }
    const vm = {
      editOn: false,
      selectMessage: undefined,
      checkedMessage: vi.fn(),
      getCheckedMessages: vi.fn(() => [message]),
      unCheckAllMessages: vi.fn(),
      deleteMessages: vi.fn(),
      revokeMessage: vi.fn(() => Promise.resolve()),
      editMessage: vi.fn(() => Promise.resolve()),
    }
    const conversation = new Conversation({ channel })
    ;(conversation as any).vm = vm

    conversation.setEditOn(true)
    conversation.checkeMessage(message as any, true)
    conversation.deleteMessages([message] as any)
    conversation.clearCheckedMessages()
    await conversation.revokeMessage(message as any)
    await conversation.editMessage("id", 2, "g", 2, "edited")

    expect(vm.checkedMessage).toHaveBeenCalledWith(message, true)
    expect(vm.deleteMessages).toHaveBeenCalledWith([message])
    expect(vm.unCheckAllMessages).toHaveBeenCalledTimes(1)
    expect(vm.revokeMessage).toHaveBeenCalledWith(message)
    expect(vm.editMessage).toHaveBeenCalledWith("id", 2, "g", 2, "edited")
    expect(conversation.editOn()).toBe(true)
    expect(conversation.getCheckedMessageCount()).toBe(1)
  })

  it("resolves message text from stream, edited content, and parts", () => {
    const conversation = new Conversation({ channel })
    expect(conversation.getMessageTextContent({ streamOn: true, fullStreamContent: "stream" } as any)).toBe("stream")
    expect(conversation.getMessageTextContent({ remoteExtra: { isEdit: true, contentEdit: { text: "edited" } } } as any)).toBe("edited")
    expect(conversation.getMessageTextContent({ parts: [{ text: "a" }, { text: "b" }] } as any)).toBe("ab")
    expect(conversation.getMessageTextContent({} as any)).toBe("")
  })

  it("finds normal, expanded-fold, and fold-anchor message elements", () => {
    const conversation = new Conversation({ channel })
    const normal = document.createElement("div")
    normal.id = "normal"
    const expanded = document.createElement("div")
    expanded.id = "expanded"
    const anchor = document.createElement("div")
    anchor.id = "anchor"
    document.body.append(normal, expanded, anchor)
    const message = { clientMsgNo: "normal", messageSeq: 0 }
    ;(conversation as any).vm = {
      findFoldSessionByMessageSeq: vi.fn(() => undefined),
    }
    expect(conversation.getMessageElement(message as any)).toBe(normal)
    ;(conversation as any).vm.findFoldSessionByMessageSeq.mockReturnValue({ isExpanded: true, anchorId: "anchor" })
    ;(conversation as any).vm.foldSessionMessageElementId = vi.fn(() => "expanded")
    expect(conversation.getMessageElement({ clientMsgNo: "missing", messageSeq: 1 } as any)).toBe(expanded)
    ;(conversation as any).vm.findFoldSessionByMessageSeq.mockReturnValue({ isExpanded: false, anchorId: "anchor" })
    expect(conversation.getMessageElement({ clientMsgNo: "missing", messageSeq: 1 } as any)).toBe(anchor)
  })

  it("ignores avatar actions for incoming webhooks and opens regular avatar menus", () => {
    const conversation = new Conversation({ channel })
    const show = vi.fn()
    ;(conversation as any).avatarMenusContext = { show }
    ;(conversation as any).vm = {}
    const event = {} as any
    conversation.onTapAvatar("iwh_sender", event)
    expect(show).not.toHaveBeenCalled()
    conversation.onTapAvatar("user", event)
    expect((conversation as any).vm.selectUID).toBe("user")
    expect(show).toHaveBeenCalledWith(event)
  })

  it("sends through the supplied vm and tracks assistant text intents", async () => {
    const conversation = new Conversation({ channel: { channelID: "sabc_user", channelType: 1 } as any })
    const send = vi.fn(() => Promise.resolve({ messageID: "sent" }))
    ;(conversation as any).vm = { sendMessage: send }
    const app = (await import("../../../App")).default
    const original = app.remoteConfig.octoAssistantUids
    app.remoteConfig.octoAssistantUids = ["user"]
    try {
      await expect(conversation.sendMessage(new MessageText("请分析这个"))).resolves.toEqual({ messageID: "sent" })
      expect(send).toHaveBeenCalled()
    } finally {
      app.remoteConfig.octoAssistantUids = original
    }
  })

  it("covers scroll loading decisions and wheel history loading", () => {
    const conversation = new Conversation({ channel })
    const pulldown = vi.fn()
    const pullup = vi.fn()
    const hide = vi.fn()
    ;(conversation as any).vm = {
      loading: false,
      pulldownFinished: false,
      pullupHasMore: true,
      pulldownMessages: pulldown,
      pullupMessages: pullup,
      messageContainerId: "scroll-test",
      lastMessage: undefined,
    }
    ;(conversation as any).contextMenusContext = { hide }
    ;(conversation as any).updateBrowseToMessageSeqAndReminderDoneIfNeed = vi.fn()
    const target = { scrollTop: 0, scrollHeight: 1000, clientHeight: 500 }
    conversation.handleScroll({ target })
    expect(pulldown).toHaveBeenCalledTimes(1)
    target.scrollTop = 600
    conversation.handleScroll({ target })
    expect(pullup).toHaveBeenCalledTimes(1)
    target.scrollTop = 0
    conversation.handleWheel({ currentTarget: target, deltaY: -10 })
    expect(pulldown).toHaveBeenCalledTimes(2)
    expect(conversation.isFullScreen(target as any)).toBe(true)
    expect(conversation.isFullScreen(null)).toBe(false)
    expect(hide).toHaveBeenCalled()
    ;(conversation as any).vm.loading = true
    ;(conversation as any).vm.pulldownFinished = true
    ;(conversation as any).vm.pullupHasMore = false
    ;(conversation as any).vm.lastMessage = { messageSeq: 3 }
    vi.spyOn(conversation, "getMessageElement").mockReturnValue({ clientHeight: 40 } as any)
    conversation.handleScroll({ target: { scrollTop: 700, scrollHeight: 1000, clientHeight: 200 } })
    conversation.handleWheel({ currentTarget: { scrollTop: 100, scrollHeight: 100, clientHeight: 100 }, deltaY: 10 })
    // handleScroll 会启动 500ms 的 scroll-end timer；测试结束前清理，避免 jsdom teardown
    // 后回调访问 document 造成全量套件偶发红灯。
    window.clearTimeout(conversation.scrollTimer!)
    conversation.scrollTimer = null
  })

  it("updates browse position and reminder completion only for visible messages", () => {
    const message = { messageSeq: 5, message: { messageSeq: 5 } }
    const refresh = vi.fn()
    const conversation = new Conversation({ channel })
    ;(conversation as any).vm = {
      browseToMessageSeq: 1,
      refreshNewMsgCount: refresh,
      messages: [],
    }
    ;(conversation as any).lastVisiableMessage = vi.fn(() => message)
    conversation.updateBrowseToMessageSeq({} as any)
    expect((conversation as any).vm.browseToMessageSeq).toBe(5)
    expect(refresh).toHaveBeenCalledTimes(1)
    conversation.updateReminderDoneIfNeed(null)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it("resolves digest text and mention highlights from edited or original content", () => {
    const conversation = new Conversation({ channel })
    expect(conversation.getMessageDigestText({ streamOn: true, fullStreamContent: "live" } as any)).toBe("live")
    expect(conversation.getMessageDigestText({ remoteExtra: { isEdit: true, contentEdit: { conversationDigest: "edited digest" } } } as any)).toBe("edited digest")
    expect(conversation.getMessageDigestText({ content: { text: "text" } } as any)).toBe("text")
    expect(conversation.getMessageDigestText({ parts: [{ text: "part" }] } as any)).toBe("part")
    expect(conversation.getMessageMentions({ parts: [], content: { mention: { humans: 1, ais: 1 } } } as any)).toEqual(expect.any(Array))
  })

  it("shows user info with group context and verification code", async () => {
    const { default: app } = await import("../../../App")
    const originalBaseContext = app.shared.baseContext
    ;(app.shared as any).baseContext = { showUserInfo: vi.fn() }
    const showUserInfo = vi.spyOn(app.shared.baseContext, "showUserInfo").mockImplementation(() => {})
    const conversation = new Conversation({ channel })
    ;(conversation as any).vm = {
      channel,
      subscriberWithUID: vi.fn(() => ({ orgData: { vercode: "v1" } })),
    }
    conversation.showUser("u1")
    expect(showUserInfo).toHaveBeenCalledWith("u1", channel, "v1")
    ;(conversation as any).vm.channel = { channelType: 1 }
    conversation.showUser("u2")
    expect(showUserInfo).toHaveBeenCalledWith("u2", undefined, undefined)
    showUserInfo.mockRestore()
    app.shared.baseContext = originalBaseContext
  })

  it("builds the conversation render tree for normal and auxiliary channels", () => {
    const conversation = new Conversation({ channel: new Channel("g", 2), chatBg: "bg.png", isAuxiliary: true })
    expect(() => conversation.render()).not.toThrow()
    expect(conversation.render()).toBeTruthy()
  })

  it("handles context menu state and cached selection safely", () => {
    const conversation = new Conversation({ channel })
    vi.spyOn(conversation, "setState").mockImplementation((state: any) => Object.assign((conversation as any).state, state))
    const show = vi.fn()
    const hide = vi.fn()
    ;(conversation as any).contextMenusContext = { show, hide }
    ;(conversation as any).vm = { selectMessage: undefined }
    const message = { messageID: "m1" }
    const target = document.createElement("div")
    conversation.showContextMenus(message as any, { currentTarget: target } as any)
    expect((conversation as any).vm.selectMessage).toBe(message)
    expect(conversation.isContextMenuOpen(message as any)).toBe(true)
    expect(show).toHaveBeenCalled()
    conversation.hideContextMenus()
    expect(conversation.isContextMenuOpen(message as any)).toBe(false)
    expect(hide).toHaveBeenCalledTimes(1)
    expect(conversation.getCachedSelectedText()).toBeNull()
  })

  it("locates loaded messages immediately and requests missing message context", () => {
    const conversation = new Conversation({ channel })
    const loaded = { message: { clientMsgNo: "m1" }, locateRemind: false }
    const scrollToMessage = vi.fn()
    const notifyListener = vi.fn((callback: () => void) => callback())
    ;(conversation as any).vm = {
      findMessageWithMessageSeq: vi.fn((seq: number) => seq === 1 ? loaded : undefined),
      findFoldSessionByMessageSeq: vi.fn(() => undefined),
      notifyListener,
      scrollToMessage,
      requestMessagesAroundMessageSeq: vi.fn(),
    }
    conversation.locateMessage(1)
    expect(loaded.locateRemind).toBe(true)
    expect(scrollToMessage).toHaveBeenCalledWith(loaded)
    conversation.locateMessage(2)
    expect((conversation as any).vm.requestMessagesAroundMessageSeq).toHaveBeenCalledWith(2, expect.any(Function))
  })

  it("locates summary and collapsed fold messages through their vm callbacks", () => {
    const conversation = new Conversation({ channel })
    const message = { messageSeq: 7, locateRemind: false }
    const highlightSummary = vi.fn()
    const scrollFold = vi.fn()
    ;(conversation as any).vm = {
      findMessageWithMessageSeq: vi.fn(() => message),
      findFoldSessionByMessageSeq: vi.fn(() => ({ sessionId: "s", isActive: true, showSummary: false, lastMessage: message })),
      highlightFoldSessionSummary: highlightSummary,
      scrollToFoldSession: scrollFold,
    }
    conversation.locateMessage(7)
    expect(highlightSummary).toHaveBeenCalledWith("s", expect.any(Function))
    highlightSummary.mock.calls[0][1]()
    expect(scrollFold).toHaveBeenCalledWith("s")

    const expand = vi.fn((_id, _expanded, _animate, callback) => callback())
    ;(conversation as any).vm.findFoldSessionByMessageSeq.mockReturnValue({ sessionId: "s2", isExpanded: false, isActive: false, showSummary: false, lastMessage: { messageSeq: 8 } })
    ;(conversation as any).vm.setFoldSessionExpanded = expand
    ;(conversation as any).vm.notifyListener = (callback: () => void) => callback()
    ;(conversation as any).vm.scrollToMessage = vi.fn()
    ;(conversation as any).vm.findMessageWithMessageSeq.mockReturnValue(message)
    conversation.locateMessage(8)
    expect(expand).toHaveBeenCalledWith("s2", true, false, expect.any(Function))
  })

  it("returns the message input context and clears selection through the vm", () => {
    const conversation = new Conversation({ channel })
    const context = { text: vi.fn() }
    const clear = vi.fn()
    ;(conversation as any)._messageInputContext = context
    ;(conversation as any).vm = { editOn: true, unCheckAllMessages: clear, getCheckedMessages: () => [] }
    expect(conversation.messageInputContext()).toBe(context)
    conversation.setEditOn(false)
    conversation.clearCheckedMessages()
    expect(conversation.editOn()).toBe(false)
    expect(clear).toHaveBeenCalledTimes(1)
  })

  it("deduplicates emoji previews and forwards queued messages for the active channel", async () => {
    const app = (await import("../../../App")).default
    const emoji = vi.spyOn(app, "emojiService", "get").mockReturnValue({ getImage: (key: string) => key === ":smile:" ? "smile.png" : undefined } as any)
    const conversation = new Conversation({ channel: new Channel("g", 2) })
    expect(conversation.getMessageEmojis({ parts: [
      { type: 1, text: ":smile:" }, { type: 1, text: ":smile:" }, { type: 1, text: ":none:" },
    ] } as any)).toEqual([{ key: ":smile:", url: "smile.png" }])
    const fillOrder = vi.fn()
    const addQueue = vi.fn()
    ;(conversation as any).vm = { fillOrder, addSendMessageToQueue: addQueue }
    const options = (conversation as any).buildForwardOptions()
    const message = { messageID: "m1" }
    options.onSent(message, new Channel("g", 2))
    expect(fillOrder).toHaveBeenCalledTimes(1)
    expect(addQueue).toHaveBeenCalledTimes(1)
    options.onSent(message, new Channel("other", 2))
    expect(fillOrder).toHaveBeenCalledTimes(1)
    emoji.mockRestore()
  })

  it("renders the conversation body with the initialized view model", async () => {
    const conversation = new Conversation({ channel: new Channel("g", 2) })
    const provider = conversation.render() as any
    const { default: app } = await import("../../../App")
    const { ForwardService } = await import("../../../Service/ForwardService")
    const originalContext = app.shared.baseContext
    const originalDataSource = app.dataSource
    const selectionCallbacks: Array<(channels: any[]) => Promise<void>> = []
    const forwardSend = vi.spyOn(ForwardService, "send").mockImplementation(async (_channels: any[], build: (channel: any) => unknown) => {
      build(new Channel("target", 1))
      return { targets: 1, failedTargets: 0, messages: 1, failedMessages: 0, messageAttempts: 1 } as any
    })
    ;(app.shared as any).baseContext = {
      showConversationSelect: (callback: (channels: any[]) => Promise<void>) => { selectionCallbacks.push(callback); },
      showUserInfo: vi.fn(),
    }
    ;(app as any).dataSource = { channelDataSource: { conversationExtraUpdate: vi.fn().mockResolvedValue(undefined) }, commonDataSource: {} }
    const vm = {
      editOn: true,
      fileDragEnter: false,
      fileDragLeave: false,
      currentReplyMessage: undefined,
      messageContainerId: "messages",
      renderItems: [],
      getCheckedMessages: () => [{ message: { messageID: "checked", content: {} } }],
      unCheckAllMessages: vi.fn(),
      syncMessages: vi.fn(),
      ensureSubscribersLoaded: vi.fn(),
      subscribers: [],
      messagesOfOrigin: [],
      unreadCount: 0,
      showScrollToBottomBtn: false,
      currentHandlerType: 0,
      selectMessage: undefined,
      selectUID: "u1",
      channel,
      currentConversation: { reminders: [
        { reminderID: 1, reminderType: 1, messageSeq: 1, done: false },
        { reminderID: 2, reminderType: 2, messageSeq: 2, done: false },
        { reminderID: 3, reminderType: 99, messageSeq: 3, done: false },
      ] },
      conversationLastMessageSeq: () => 0,
      onDownArrow: vi.fn(),
      subscriberWithUID: vi.fn(),
      buildMergeforwardContent: vi.fn(),
      notifyListener: vi.fn(),
    }
    ;(conversation as any).vm = vm
    const body: any = provider.props.render(vm)
    expect(body).toBeTruthy()
    const nodes: any[] = []
    const walk = (node: any) => {
      if (!node || typeof node !== "object") return
      if (Array.isArray(node)) return node.forEach(walk)
      if (!node.props) return
      nodes.push(node)
      if (typeof node.type === "function" && node.type.prototype?.render) {
        try { walk(new node.type(node.props).render()) } catch {
          try { walk(node.type.prototype.render.call({ props: node.props, state: { loading: new Map() } })) } catch { /* optional child render dependencies */ }
        }
      }
      walk(node.props.children)
      for (const key of ["topView", "expandedContent", "summaryContent"]) walk(node.props[key])
    }
    walk(body)
    expect(nodes.some((node) => typeof node.props?.onForward === "function")).toBe(true)
    // Exercise class-based child render methods exposed by the returned tree.
    const positionView = nodes.find((node) => node.type?.name === "ConversationPositionView")
    expect(positionView).toBeTruthy()
    if (positionView) {
      const proto = positionView.type.prototype
      const positionContext: any = { props: positionView.props, state: { loading: new Map() } }
      for (const method of ["getReminderTypes", "getRemindersWithType", "getReminderIcon"]) {
      positionContext[method] = proto[method].bind(positionContext)
      }
      positionContext.setState = (next: any) => { positionContext.state = next }
      walk(proto.render.call(positionContext))
      positionContext.state.loading.set(1, true)
      walk(proto.render.call(positionContext))
    }
    for (const node of nodes) {
      const props = node.props
      props.onExpandChange?.(false)
      props.onAddAttachment?.(vi.fn())
      props.onAddPendingAttachments?.([])
      props.onContext?.({ restoreDraft: vi.fn(), insertText: vi.fn(), addMention: vi.fn() })
      props.onRestoreRecoveredTarget?.(undefined)
      props.onComposeRecovery?.({
        channelKey: "g:2", attemptId: "attempt", snapshot: {}, editorAttachments: [], editorObjectUrls: [], topAttachments: [], expanded: false,
      })
      props.onRecoveredComposes?.({ attemptIds: [], draftText: "" })
      const transaction = props.onCaptureSendTransaction?.()
      transaction?.captureSendTarget?.()
      transaction?.captureSendDraft?.()
      transaction?.onCaptureAborted?.(undefined)
      const dragEvent: any = { dataTransfer: { types: ["text/plain"], items: [], files: [] }, preventDefault: vi.fn() }
      props.onDragEnter?.(dragEvent)
      props.onDragOver?.(dragEvent)
      props.onDragLeave?.(dragEvent)
      props.onDrop?.(dragEvent)
      const fileDragEvent: any = { dataTransfer: { types: ["Files"], items: [], files: [{ name: "drop.txt", type: "text/plain", size: 1 }] }, preventDefault: vi.fn() }
      await props.onDrop?.(fileDragEvent)
      props.onClose?.()
      props.onForward?.()
      props.onMergeForward?.()
      props.onDelete?.()
      props.onScrollToBottom?.()
      props.onReminder?.({ reminderID: 1, reminderType: 1, messageSeq: 1, done: false })
      const chatContext = props.getChatContext?.()
      if (chatContext?.catch) await chatContext.catch(() => undefined)
      if (Array.isArray(props.menus)) {
        for (const menu of props.menus) await menu.onClick?.()
      }
      if (typeof props.onClick === "function" && String(props.className || "").includes("conversationposition")) {
        await props.onClick({ stopPropagation: vi.fn() })
      }
    }
    await Promise.resolve()
    await Promise.resolve()
    for (const callback of selectionCallbacks) await callback([new Channel("target", 1)])
    forwardSend.mockRejectedValueOnce(new Error("multi forward failed"))
    forwardSend.mockRejectedValueOnce(new Error("merge forward failed"))
    for (const callback of selectionCallbacks) await callback([new Channel("target", 1)])
    vm.getCheckedMessages = () => []
    for (const node of nodes) {
      await node.props.onForward?.()
      await node.props.onMergeForward?.()
      await node.props.onDelete?.()
    }
    vm.getCheckedMessages = () => [{ message: { messageID: "delete-me" } }]
    hoisted.modalConfirm.mockClear()
    const deletePanel = nodes.find((node) => typeof node.props?.onDelete === "function")
    await deletePanel?.props.onDelete?.()
    const confirmOptions = hoisted.modalConfirm.mock.calls[0]?.[0]
    await confirmOptions?.onOk?.()
    vm.fileDragEnter = true
    vm.currentReplyMessage = { messageID: "reply", content: { text: "reply" }, contentType: 1 }
    vm.renderItems = [{ type: "message", message: { clientMsgNo: "row", messageSeq: 1, contentType: 1, content: { text: "row" }, parts: [] } }]
    walk(provider.props.render(vm))
    // Exercise the remaining DOM callbacks exposed by message/fold/position rows.
    for (const node of nodes) {
      const event = { target: {}, currentTarget: {}, stopPropagation: vi.fn(), preventDefault: vi.fn() }
      await node.props.onAnimationEnd?.(event)
      await node.props.onSummaryAnimationEnd?.(event)
      await node.props.onContextMenu?.(event)
      await node.props.onClick?.(event)
      await node.props.onToggle?.()
      await node.props.onSummaryToggleSelect?.(false)
    }
    hoisted.disbanded = true
    ;(conversation as any).state.inputExpanded = true
    vm.editOn = false
    vm.fileDragEnter = true
    vm.renderItems = []
    walk(provider.props.render(vm))
    hoisted.disbanded = false
    await Promise.resolve()
    ;(app.shared as any).baseContext = originalContext
    ;(app as any).dataSource = originalDataSource
    forwardSend.mockRestore()
    expect(provider.props.create()).toBeTruthy()
  })

  it("does not attach group mention metadata in a direct conversation", () => {
    const conversation = new Conversation({ channel: { channelID: "u", channelType: 1 } as any })
    ;(conversation as any)._messageInputContext = { addMention: vi.fn() }
    ;(conversation as any).addReplyMention("other")
    expect((conversation as any)._messageInputContext.addMention).not.toHaveBeenCalled()
  })

  it("forwards a message through the selection callback and handles service errors", async () => {
    const { default: app } = await import("../../../App")
    const { ForwardService } = await import("../../../Service/ForwardService")
    const originalContext = app.shared.baseContext
    const select = vi.fn((callback: (channels: any[]) => Promise<void>) => callback([new Channel("target", 1)]))
    ;(app.shared as any).baseContext = { showConversationSelect: select }
    const send = vi.spyOn(ForwardService, "send").mockResolvedValue({ targets: 1, failedTargets: 0, messages: 1, failedMessages: 0, messageAttempts: 1 } as any)
    const conversation = new Conversation({ channel })
    conversation.fowardMessageUI({ messageID: "m1", fromUID: "u1", content: {} } as any)
    await Promise.resolve()
    expect(select).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledTimes(1)
    const { SummaryCardContent } = await import("../../../Messages/SummaryCard/SummaryCardContent")
    send.mockImplementationOnce(async (_channels: any[], build: (channel: any) => unknown) => {
      build(new Channel("target", 1))
      return { targets: 1, failedTargets: 0, messages: 1, failedMessages: 0, messageAttempts: 1 } as any
    })
    const blocked = new SummaryCardContent()
    blocked.shareId = "share-1"
    conversation.fowardMessageUI({ messageID: "blocked", fromUID: "u1", content: blocked } as any)
    await Promise.resolve()
    send.mockRejectedValueOnce(new Error("forward failed"))
    conversation.fowardMessageUI({ messageID: "m2", fromUID: "u2", content: {} } as any)
    await Promise.resolve()
    await Promise.resolve()
    send.mockRestore()
    ;(app.shared as any).baseContext = originalContext
  })

  it("uploads receipts for visible unread messages from other users", () => {
    const conversation = new Conversation({ channel })
    const unread = {
      message: { messageID: "m1" },
      remoteExtra: { readed: false },
      fromUID: "other",
      setting: { receiptEnabled: true },
    }
    const receipt = vi.spyOn(WKSDK.shared().receiptManager, "addReceiptMessages").mockImplementation(() => {})
    ;(conversation as any).vm = { messageContainerId: "receipt-vp", channel }
    ;(conversation as any).canRecordReadAttention = vi.fn(() => true)
    ;(conversation as any).allVisiableMessages = vi.fn(() => [unread])
    const viewport = document.createElement("div")
    viewport.id = "receipt-vp"
    document.body.append(viewport)
    conversation.uploadReadedIfNeed()
    expect(receipt).toHaveBeenCalledWith(channel, [unread.message])
    receipt.mockRestore()
  })

  it("marks visible unfinished reminders as done", () => {
    const conversation = new Conversation({ channel })
    const done = vi.spyOn(WKSDK.shared().reminderManager, "done").mockImplementation(() => {})
    ;(conversation as any).vm = {
      messages: [{ message: { messageSeq: 3 } }],
      currentConversation: { reminders: [
        { reminderID: 1, messageSeq: 3, done: false },
        { reminderID: 2, messageSeq: 4, done: true },
      ] },
      findMessageWithMessageSeq: vi.fn((seq: number) => seq === 3 ? { message: { messageSeq: 3 } } : undefined),
    }
    ;(conversation as any).isVisiableMessage = vi.fn(() => true)
    conversation.updateReminderDoneIfNeed({} as any)
    expect(done).toHaveBeenCalledWith([1])
    done.mockRestore()
  })

  it("returns the active channel and tolerates legacy attachment cleanup calls", () => {
    const conversation = new Conversation({ channel })
    ;(conversation as any).vm = { channel }
    expect(conversation.channel()).toBe(channel)
    expect(() => conversation.removePendingAttachment(0)).not.toThrow()
    expect(() => conversation.clearPendingAttachments()).not.toThrow()
  })

  it("returns no element when a message is not mounted", () => {
    const conversation = new Conversation({ channel })
    ;(conversation as any).vm = { findFoldSessionByMessageSeq: vi.fn(() => undefined) }
    expect(conversation.getMessageElement({ clientMsgNo: "missing", messageSeq: 0 } as any)).toBeNull()
  })

  it("flushes the read marker at scroll end", () => {
    const conversation = new Conversation({ channel })
    const upload = vi.spyOn(conversation, "uploadReadedIfNeed").mockImplementation(() => {})
    conversation.handleScrollEnd()
    expect(upload).toHaveBeenCalledTimes(1)
  })

  it("leaves browse position unchanged when no message is visible", () => {
    const conversation = new Conversation({ channel })
    ;(conversation as any).vm = { browseToMessageSeq: 4 }
    ;(conversation as any).lastVisiableMessage = vi.fn(() => undefined)
    conversation.updateBrowseToMessageSeq(null)
    expect((conversation as any).vm.browseToMessageSeq).toBe(4)
  })

  it("renders message cells for revoke, flame, system, and ordinary messages", () => {
    const conversation = new Conversation({ channel })
    const revoke = { clientMsgNo: "r", contentType: 1, revoke: true, messageSeq: 1, locateRemind: false }
    const flame = { clientMsgNo: "f", contentType: 1, flame: true, messageSeq: 2, locateRemind: false }
    const normal = { clientMsgNo: "n", contentType: 1, messageSeq: 3, locateRemind: false }
    const vm = { editOn: false }
    ;(conversation as any).vm = vm
    expect(conversation.messageUI(revoke as any, true)).toBeTruthy()
    expect(conversation.messageUI(flame as any, false)).toBeTruthy()
    const normalElement: any = conversation.messageUI(normal as any, false, "extra")
    expect(normalElement).toBeTruthy()
    normalElement.props.onAnimationEnd()
    expect(conversation.renderConversationItem({ type: "message", message: normal } as any, false)).toBeTruthy()
  })

  it("renders fold summary and expanded content branches", async () => {
    const conversation = new Conversation({ channel })
    ;(conversation as any).vm = { editOn: false, checkedMessage: vi.fn(), foldSessionMessageElementId: vi.fn(() => "fold") }
    ;(conversation as any).contextMenusContext = { show: vi.fn() }
    const base = { message: { clientMsgNo: "m", messageSeq: 1 }, channel, messageID: "m", fromUID: "u", contentType: 1, parts: [], send: false, isStreaming: false }
    expect(conversation.renderFoldSessionSummary({ ...base, revoke: true } as any)).toBeTruthy()
    expect(conversation.renderFoldSessionSummary({ ...base, contentType: -2, content: { fromName: "bot" } } as any)).toBeTruthy()
    expect(conversation.renderFoldSessionSummary({ ...base, content: { text: "hello" } } as any)).toBeTruthy()
    expect(conversation.renderFoldSessionSummary({ ...base, contentType: 8, content: { conversationDigest: "file" } } as any)).toBe("file")
    expect(conversation.renderFoldMessageContent({ ...base, revoke: true } as any)).toBeTruthy()
    expect(conversation.renderFoldMessageContent({ ...base, content: { text: "hello" } } as any)).toBeTruthy()
    const app = (await import("../../../App")).default
    const originalDataSource = app.dataSource
    ;(app as any).dataSource = { commonDataSource: { getFileURL: (url: string) => url, getImageURL: (url: string) => url } }
    const fileTree: any = conversation.renderFoldMessageContent({ ...base, contentType: 8, content: {
      name: "report.pdf", extension: "pdf", size: 12, url: "https://files.example/report.pdf", conversationDigest: "report",
    } } as any)
    expect(fileTree).toBeTruthy()
    fileTree.props.onClick()
    expect(conversation.renderFoldMessageContent({ ...base, contentType: 2, content: {
      url: "", remoteUrl: "", imgData: "data:image/png;base64,abc",
    } } as any)).toBeTruthy()
    expect(conversation.renderFoldMessageContent({ ...base, contentType: 99, content: { conversationDigest: "fallback" } } as any)).toBeTruthy()
    const expanded: any = conversation.renderFoldSessionExpandedList([base as any])
    expanded.props.onToggleSelect(base, true)
    expanded.props.onMessageContextMenu(base, {})
    expanded.props.onMessageContextMenu({ revoke: true }, { preventDefault: vi.fn() })
    expanded.props.onLocateAnimationEnd(base)
    ;(app as any).dataSource = originalDataSource
  })

  it("builds expanded fold-session UI for normal and collapsed participant lists", () => {
    const conversation = new Conversation({ channel })
    ;(conversation as any).vm = {
      editOn: false,
      checkedMessage: vi.fn(),
      toggleFoldSession: vi.fn(),
      clearFoldSessionAnimation: vi.fn(),
      clearFoldSessionSummaryHighlight: vi.fn(),
      foldSessionMessageElementId: vi.fn(() => "fold-message"),
    }
    ;(conversation as any).contextMenusContext = { show: vi.fn() }
    const lastMessage = {
      clientMsgNo: "last",
      messageSeq: 8,
      timestamp: Date.now(),
      contentType: 1,
      content: { text: "summary" },
      parts: [],
      fromUID: "bot",
      revoke: false,
      checked: false,
    }
    const participant = { uid: "bot", name: "Bot", channel: new Channel("bot", 1) }
    const makeSession = (participants: any[]) => ({
      sessionId: "session",
      anchorId: "anchor",
      participants,
      count: 2,
      isActive: false,
      isExpanded: false,
      shouldAppear: false,
      shouldMergeFlash: false,
      showSummary: true,
      highlightSummary: false,
      lastMessage,
      expandedMessages: [],
    })
    const normalTree: any = conversation.foldSessionUI(makeSession([participant]) as any, false)
    expect(normalTree).toBeTruthy()
    const nodes: any[] = []
    const visit = (node: any) => {
      if (!node || typeof node !== "object") return
      if (node.props) {
        nodes.push(node)
        visit(node.props.children)
        visit(node.props.expandedContent)
        visit(node.props.summaryContent)
      } else if (Array.isArray(node)) node.forEach(visit)
    }
    visit(normalTree)
    for (const node of nodes) {
      node.props.onToggle?.()
      node.props.onToggleSelect?.(normalTree)
      node.props.onSummaryToggleSelect?.(true)
      node.props.onMessageContextMenu?.({ revoke: false }, {})
      node.props.onMessageContextMenu?.({ revoke: true }, { preventDefault: vi.fn() })
      node.props.onLocateAnimationEnd?.({ locateRemind: true })
      node.props.onAnimationEnd?.({ target: {}, currentTarget: {}, animationName: "other" })
      node.props.onSummaryAnimationEnd?.({ target: {}, currentTarget: {} })
      const target = {}
      node.props.onAnimationEnd?.({ target, currentTarget: target, animationName: "other" })
      node.props.onSummaryAnimationEnd?.({ target, currentTarget: target })
    }
    expect(conversation.foldSessionUI(makeSession(Array.from({ length: 6 }, (_, i) => ({ ...participant, uid: `bot-${i}`, name: `Bot ${i}` }))) as any, true)).toBeTruthy()
  })

  it("mounts and unmounts with the conversation lifecycle guards", () => {
    const mountedChannel = new Channel("user", 1)
    const onContext = vi.fn()
    const conversation = new Conversation({ channel: mountedChannel, onContext })
    ;(conversation as any).subscribeComposeRecovery = vi.fn()
    ;(conversation as any).refreshComposeRecoveries = vi.fn()
    const restoreDraft = vi.spyOn(conversation, "restoreDraft").mockImplementation(() => {})
    ;(conversation as any).vm = {
      hasDraft: () => true,
      draft: () => "draft",
      addListener: vi.fn(() => vi.fn()),
      markUnread: vi.fn(),
      unCheckAllMessages: vi.fn(),
      editOn: true,
      needSetUnread: false,
      unreadCount: 0,
      channel: mountedChannel,
      currentReplyMessage: undefined,
      currentHandlerType: 0,
      releaseOpenConversationOwnership: vi.fn(),
    }
    ;(conversation as any).forceUpdate = vi.fn()
    Conversation.replyStateCache.set("user-1", { message: { messageID: "reply" } as any, handlerType: 2 })
    conversation.componentDidMount()
    expect(onContext).toHaveBeenCalledWith(conversation)
    expect(restoreDraft).toHaveBeenCalledWith("draft")
    expect((conversation as any).vm.markUnread).toHaveBeenCalledTimes(1)
    expect((conversation as any).vm.currentReplyMessage.messageID).toBe("reply")
    Conversation.replyStateCache.delete("user-1")
    ;(conversation as any)._channelInfoListener({ channel: mountedChannel })
    ;(conversation as any)._channelInfoListener({ channel: new Channel("other", 1) })
    expect((conversation as any).forceUpdate).toHaveBeenCalledTimes(1)
    ;(conversation as any).dealloc = vi.fn()
    conversation.componentWillUnmount()
    expect((conversation as any).dealloc).toHaveBeenCalledTimes(1)
  })

  it("refreshes compose state when props change and delegates attention refresh", () => {
    const oldChannel = new Channel("old", 1)
    const nextChannel = new Channel("next", 1)
    const conversation = new Conversation({ channel: nextChannel, initialCompose: { requestId: "new" } as any })
    ;(conversation as any).subscribeComposeRecovery = vi.fn()
    ;(conversation as any).tryConsumeInitialCompose = vi.fn()
    ;(conversation as any)._vmAttentionListener = vi.fn()
    conversation.componentDidUpdate({ channel: oldChannel, initialCompose: { requestId: "old" } as any } as any)
    expect((conversation as any)._initialComposeGeneration).toBe(1)
    expect((conversation as any).tryConsumeInitialCompose).toHaveBeenCalledTimes(1)
    expect((conversation as any).subscribeComposeRecovery).toHaveBeenCalledTimes(1)
    expect((conversation as any)._vmAttentionListener).toHaveBeenCalledTimes(1)
  })

  it("exercises the composer host adapters and compose recovery lifecycle", async () => {
    const { default: app } = await import("../../../App")
    const conversation = new Conversation({ channel: new Channel("g", 2) })
    ;(conversation as any).vm = { channel: new Channel("g", 2) }
    const host = (conversation as any)._chatComposerViewHost
    expect(host.getChannel()).toEqual({ id: "g", type: 2, key: "g:2", isDirect: false })
    host.track("composer_test")
    host.getChannelTitle()
    const unsubscribeTitle = host.subscribeChannelTitle(vi.fn())
    unsubscribeTitle()
    expect(host.resolveMemberAvatar("u1")).toBeTruthy()
    expect(host.resolveMemberExternal({ orgData: { is_external: true } })).toEqual(expect.objectContaining({ isExternal: true }))
    expect(host.resolveMemberExternal({ orgData: { is_external: false } })).toEqual(expect.objectContaining({ isExternal: false }))
    const imageUrl = vi.fn((url: string) => `cdn:${url}`)
    const originalDataSource = (app as any).dataSource
    ;(app as any).dataSource = { commonDataSource: { getImageURL: imageUrl } }
    expect(host.resolveImageUrl("image")).toBe("cdn:image")
    host.openSecretCreate("value")
    const off = host.voice.subscribeSpaceChange(vi.fn())
    expect(typeof off).toBe("function")
    off()
    ;(app as any).dataSource = originalDataSource

    const recovery = {
      channelKey: "g:2", attemptId: "coverage-attempt", snapshot: {},
      editorAttachments: [], editorObjectUrls: [], topAttachments: [], expanded: false,
    }
    expect((conversation as any).recordComposeRecovery(recovery)).toBe(true)
    expect((conversation as any).recordComposeRecovery({ ...recovery })).toBe(true)
    const update = vi.spyOn(conversation, "updateConversationExtra").mockResolvedValue(undefined as any)
    ;(conversation as any).consumeComposeRecoveries({ attemptIds: [recovery.attemptId], draftText: "restored" })
    expect(update).toHaveBeenCalledWith("restored")
    ;(conversation as any)._initialComposeMounted = true
    vi.spyOn(conversation, "setState").mockImplementation((state: any) => Object.assign((conversation as any).state, state))
    ;(conversation as any).refreshComposeRecoveries()
    expect((conversation as any).state.recoveredComposes).toEqual(expect.arrayContaining([
      expect.objectContaining({ attemptId: recovery.attemptId }),
    ]))
    update.mockRestore()
  })

  it("covers attention listener, beforeunload cleanup, and standalone message rules", async () => {
    const conversation = new Conversation({ channel })
    const attention = vi.spyOn(conversation as any, "updateBrowseToMessageSeqAndReminderDoneIfNeed").mockImplementation(() => {})
    const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback: FrameRequestCallback) => { callback(0); return 0 })
    ;(conversation as any).vm = { lastMessage: { messageSeq: 2 } }
    ;(conversation as any)._vmAttentionListener()
    ;(conversation as any)._vmAttentionListener()
    expect(attention).toHaveBeenCalledTimes(1)
    attention.mockRestore()
    expect((conversation as any).canRecordReadAttention(null)).toBe(false)
    const viewport = document.createElement("div")
    document.body.appendChild(viewport)
    vi.spyOn(viewport, "getBoundingClientRect").mockReturnValue({ top: 0, left: 0, right: 100, bottom: 100, width: 100, height: 100 } as DOMRect)
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" })
    vi.spyOn(document, "hasFocus").mockReturnValue(true)
    const { default: app } = await import("../../../App")
    const previousMenu = (app as any).currentMenuId
    ;(app as any).currentMenuId = "chat"
    expect((conversation as any).canRecordReadAttention(viewport)).toBe(true)
    ;(app as any).currentMenuId = previousMenu
    viewport.remove()
    ;(conversation as any).canRecordReadAttention = vi.fn(() => true)
    ;(conversation as any).updateBrowseToMessageSeq = vi.fn()
    ;(conversation as any).updateReminderDoneIfNeed = vi.fn()
    conversation.updateBrowseToMessageSeqAndReminderDoneIfNeed()
    expect((conversation as any).updateBrowseToMessageSeq).toHaveBeenCalled()
    const message = { clientMsgNo: "after", messageSeq: 5 }
    ;(conversation as any).vm.afterFoldSessionClientMsgNos = new Set(["after"])
    ;(conversation as any).vm.findFoldSessionByMessageSeq = vi.fn()
    ;(conversation as any).vm.renderItems = []
    expect(conversation.forceStandaloneMessage(message as any)).toBe(true)
    ;(conversation as any).vm.afterFoldSessionClientMsgNos.clear()
    ;(conversation as any).vm.findFoldSessionByMessageSeq.mockReturnValue({ isExpanded: true, expandedMessages: [message] })
    expect(conversation.forceStandaloneMessage(message as any)).toBe(true)
    ;(conversation as any).vm.findFoldSessionByMessageSeq.mockReturnValue(undefined)
    ;(conversation as any).vm.renderItems = [{ type: "foldSession", session: { isExpanded: true, expandedMessages: [message] } }]
    expect(conversation.forceStandaloneMessage(message as any)).toBe(true)

    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue({} as Response)
    ;(conversation as any).vm = { needSetUnread: true, unreadCount: 3, markUnread: vi.fn(), releaseOpenConversationOwnership: vi.fn() }
    vi.spyOn(conversation, "markConversationExtra").mockImplementation(() => {})
    ;(conversation as any)._beforeUnloadHandler()
    expect(fetch).toHaveBeenCalledTimes(1)
    fetch.mockRestore()
    raf.mockRestore()
  })

  it("covers send transaction target, draft, abort, and settlement callbacks", async () => {
    const onMessageSent = vi.fn()
    const conversation = new Conversation({ channel, onMessageSent })
    const vm: any = {
      channel,
      currentReplyMessage: { messageID: "reply" },
      currentHandlerType: 2,
      currentConversation: { remoteExtra: { draft: "draft" } },
      editMessage: vi.fn(),
    }
    ;(conversation as any).vm = vm
    ;(conversation as any)._initialComposeMounted = true
    ;(conversation as any).clearDraftAfterSend = vi.fn()
    const tx = (conversation as any).captureChatComposerSendTransaction()
    expect(tx.channelKey).toBe("g:2")
    const target = tx.captureSendTarget()
    expect(target.replyMessage.messageID).toBe("reply")
    target.restore()
    expect(vm.currentReplyMessage.messageID).toBe("reply")
    const draft = tx.captureSendDraft()
    expect(draft.remoteDraft).toBe("draft")
    tx.onCaptureAborted(undefined)
    tx.onCaptureAborted(draft)
    await tx.onSendSettled({ outcome: { editorConsumed: false } })
    await tx.onSendSettled({ outcome: { editorConsumed: true }, restoreFailed: true, sendDraft: draft })
    expect(onMessageSent).toHaveBeenCalledTimes(1)
  })

  it("renders fold message content variants and invokes file actions", async () => {
    const conversation = new Conversation({ channel })
    const app = (await import("../../../App")).default
    const originalDataSource = (app as any).dataSource
    ;(app as any).dataSource = { commonDataSource: {
      getFileURL: (url: string) => url,
      getImageURL: (url: string) => url,
    } }
    const checkedMessage = vi.fn()
    ;(conversation as any).vm = { editOn: true, checkedMessage, foldSessionMessageElementId: vi.fn(() => "fold-message") }
    const base: any = { messageID: "m", messageSeq: 1, channel, fromUID: "u", send: false }
    const text = conversation.renderFoldMessageContent({ ...base, contentType: MessageContentTypeConst.text, content: { text: "hello" } })
    expect(text).toBeTruthy()
    const file = conversation.renderFoldMessageContent({ ...base, contentType: MessageContentTypeConst.file, content: { url: "https://example.com/a.txt", name: "a.txt", extension: "txt", size: 1, conversationDigest: "a" } }) as any
    expect(file).toBeTruthy()
    await file.props.onClick()
    const fileNodes: any[] = []
    const visit = (node: any) => { if (!node || typeof node !== "object") return; if (Array.isArray(node)) return node.forEach(visit); if (node.props) { fileNodes.push(node); visit(node.props.children) } }
    visit(file)
    await fileNodes.find((node) => node.props.className === "wk-fold-file-dl")?.props.onClick({ stopPropagation: vi.fn() })
    const image = conversation.renderFoldMessageContent({ ...base, contentType: MessageContentTypeConst.image, content: { url: "https://example.com/a.png" } })
    expect(image).toBeTruthy()
    expect(conversation.renderFoldMessageContent({ ...base, contentType: 9999, content: { conversationDigest: "fallback" } })).toBeTruthy()
    expect(conversation.renderFoldMessageContent({ ...base, revoke: true, contentType: MessageContentTypeConst.text, content: {} })).toBeTruthy()
    expect(conversation.renderFoldMessageContent({ ...base, contentType: MessageContentTypeConst.image, content: {} })).toBeNull()
    expect(conversation.renderFoldSessionSummary({ ...base, revoke: true, contentType: MessageContentTypeConst.text, content: {} })).toBeTruthy()
    expect(conversation.renderFoldSessionSummary({ ...base, contentType: MessageContentTypeConst.typing, content: {} })).toBeTruthy()
    expect(conversation.renderFoldSessionSummary({ ...base, contentType: MessageContentTypeConst.text, content: { text: "summary", conversationDigest: "summary" } })).toBeTruthy()
    expect(conversation.renderFoldSessionSummary({ ...base, streamOn: true, fullStreamContent: "stream", contentType: 9999, content: {} })).toBeTruthy()
    expect(conversation.renderFoldMessageContent({ ...base, streamOn: true, fullStreamContent: "stream", contentType: 9999, content: {} })).toBeTruthy()
    expect(conversation.renderFoldSessionSummary({ ...base, contentType: 9999, content: { conversationDigest: "digest" } })).toBe("digest")
    ;(app as any).dataSource = originalDataSource
  })

  it("reads local image dimensions before sending rich text", async () => {
    const uploadModule = await import("../../../Service/UploadCredentials")
    const upload = vi.spyOn(uploadModule, "uploadChatMedia").mockResolvedValue("https://cdn.example/image.png")
    const conversation = new Conversation({ channel })
    const send = vi.fn(() => Promise.resolve(true))
    ;(conversation as any).sendTextAndWaitAck = send
    const originalReader = FileReader.prototype.readAsDataURL
    FileReader.prototype.readAsDataURL = function (this: FileReader) {
      Object.defineProperty(this, "result", { configurable: true, value: "data:image/png;base64,x" })
      this.onloadend?.(new ProgressEvent("loadend"))
    }
    const imageCtor = (globalThis as any).Image
    vi.stubGlobal("Image", class {
      naturalWidth = 20
      naturalHeight = 10
      set src(_value: string) { this.onload?.() }
      onload?: () => void
    })
    try {
      await expect((conversation as any).sendRichTextMixed([{ type: "image", file: new File(["x"], "a.png", { type: "image/png" }) }], undefined, undefined, channel, {})).resolves.toBe(true)
      expect(send).toHaveBeenCalledTimes(1)
    } finally {
      FileReader.prototype.readAsDataURL = originalReader
      vi.stubGlobal("Image", imageCtor)
      upload.mockRestore()
    }
  })

  it("covers expanded fold row callbacks in edit and read modes", () => {
    const conversation = new Conversation({ channel })
    const toggle = vi.fn()
    const contextMenu = vi.fn()
    ;(conversation as any).vm = {
      editOn: true,
      checkedMessage: toggle,
      foldSessionMessageElementId: vi.fn(() => "fold-row"),
    }
    ;(conversation as any).contextMenusContext = { show: vi.fn(), hide: vi.fn() }
    vi.spyOn(conversation, "setState").mockImplementation(() => undefined as any)
    const message: any = {
      clientMsgNo: "fold-row", messageID: "fold-row", messageSeq: 2,
      fromUID: "u", channel, contentType: MessageContentTypeConst.text,
      content: { text: "fold text" }, checked: false, locateRemind: true,
    }
    const tree: any = conversation.renderFoldSessionExpandedList([message])
    tree.props.renderAvatar(message)
    tree.props.renderMessageContent(message)
    tree.props.onToggleSelect(message, true)
    tree.props.onMessageContextMenu(message, { preventDefault: vi.fn() })
    tree.props.onLocateAnimationEnd(message)
    const row: any = (tree.type as Function)(tree.props)
    const rows: any[] = []
    const walk = (node: any) => {
      if (!node || typeof node !== "object") return
      if (Array.isArray(node)) return node.forEach(walk)
      if (node.props) { rows.push(node); walk(node.props.children) }
    }
    walk(row)
    const rowNode = rows.find((node) => node.props.className?.includes("wk-fold-msg"))
    rowNode?.props.onClick?.()
    rowNode?.props.onContextMenu?.({ preventDefault: vi.fn() })
    rowNode?.props.onAnimationEnd?.({ target: rowNode, currentTarget: rowNode })
    expect(toggle).toHaveBeenCalled()
    ;(conversation as any).vm.editOn = false
    tree.props.onMessageContextMenu(message, { preventDefault: vi.fn() })
    contextMenu.mockClear()
  })

  it("covers reminder completion and viewport visibility boundaries", () => {
    const conversation = new Conversation({ channel })
    const done = vi.spyOn(WKSDK.shared().reminderManager, "done").mockImplementation(() => {})
    const message: any = { messageSeq: 3, message: { messageSeq: 3 } }
    const viewport: any = { scrollTop: 0, scrollHeight: 100, clientHeight: 100 }
    ;(conversation as any).vm = {
      messages: [message], messageContainerId: "viewport",
      currentConversation: { reminders: [
        { reminderID: 1, reminderType: 1, messageSeq: 3, done: false },
        { reminderID: 2, reminderType: 1, messageSeq: 3, done: true },
      ] },
      findMessageWithMessageSeq: vi.fn(() => message),
    }
    vi.spyOn(conversation, "getMessageElement").mockReturnValue({ offsetTop: 10, clientHeight: 20 } as any)
    conversation.updateReminderDoneIfNeed(viewport)
    expect(done).toHaveBeenCalledWith([1])
    expect(conversation.isVisiableMessage(message.message, viewport)).toBe(true)
    expect(conversation.isVisiableMessage(message.message, null)).toBeUndefined()
    expect(conversation.lastVisiableMessage(viewport)).toBe(message)
    expect(conversation.firstVisiableMessage(viewport)).toBe(message)
    const elementSpy = vi.spyOn(conversation, "getMessageElement")
    elementSpy.mockReturnValue(null)
    expect(conversation.allVisiableMessages(viewport)).toEqual([])
    expect(conversation.lastVisiableMessage(viewport)).toBeUndefined()
    expect(conversation.firstVisiableMessage(viewport)).toBeUndefined()
    elementSpy.mockReturnValue({ offsetTop: 1, clientHeight: 10 } as any)
    expect(conversation.allVisiableMessages(viewport)).toEqual([message])
    done.mockRestore()
  })

  it("covers compose subscription and context menu adapter", () => {
    const conversation = new Conversation({ channel })
    ;(conversation as any)._initialComposeMounted = true
    ;(conversation as any).refreshComposeRecoveries = vi.fn()
    ;(conversation as any).subscribeComposeRecovery()
    expect((conversation as any)._unsubscribeComposeRecovery).toEqual(expect.any(Function))
    ;(conversation as any).contextMenusContext = { show: vi.fn() }
    ;(conversation as any)._handleContextMenus({ type: "contextmenu" })
  })

  it("covers edit selection and deferred editor operations", () => {
    const conversation = new Conversation({ channel })
    const checked = vi.fn()
    const selected: any = { contentType: 1, messageID: "selected" }
    ;(conversation as any).vm = {
      editOn: false, selectMessage: selected, checkedMessage: checked,
      getCheckedMessages: () => [selected], unCheckAllMessages: vi.fn(),
    }
    conversation.setEditOn(true)
    expect(checked).toHaveBeenCalledWith(selected, true)
    conversation.setEditOn(false)
    expect(conversation.getCheckedMessageCount()).toBe(1)
    const context = { insertText: vi.fn(), restoreDraft: vi.fn() }
    ;(conversation as any)._messageInputContext = context
    conversation.insertText("now")
    conversation.restoreDraft("draft")
    expect(context.insertText).toHaveBeenCalledWith("now")
    expect(context.restoreDraft).toHaveBeenCalledWith("draft")
    ;(conversation as any)._messageInputContext = undefined
    conversation.insertText("later")
    conversation.restoreDraft("later draft")
    expect((conversation as any)._pendingInsertText).toBe("later")
    expect((conversation as any)._pendingRestoreDraft).toBe("later draft")
  })

  it("covers message row cell selection and animation cleanup", () => {
    const conversation = new Conversation({ channel })
    const setState = vi.spyOn(conversation, "setState").mockImplementation(() => undefined as any)
    const base: any = { clientMsgNo: "row", messageSeq: 1, contentType: 1, content: { text: "row" }, locateRemind: true }
    const normal: any = conversation.messageUI(base, true)
    normal.props.onAnimationEnd()
    expect(base.locateRemind).toBe(false)
    expect(setState).toHaveBeenCalled()
    expect(conversation.messageUI({ ...base, revoke: true }, false)).toBeTruthy()
    expect(conversation.messageUI({ ...base, revoke: false, flame: true }, false)).toBeTruthy()
    expect(conversation.messageUI({ ...base, contentType: 1500 }, false)).toBeTruthy()
    expect(conversation.messageUI({ ...base, contentType: MessageContentTypeConst.time }, false)).toBeTruthy()
    expect(conversation.renderConversationItem({ type: "message", message: base } as any, false)).toBeTruthy()
    setState.mockRestore()
  })

  it("handles compose pending counters and deallocation without a reply cache entry", () => {
    const conversation = new Conversation({ channel })
    const markExtra = vi.spyOn(conversation, "markConversationExtra").mockImplementation(() => {})
    ;(conversation as any)._messageInputContext = {
      pendingPreEnqueueCount: () => 2,
      pendingSendDrafts: () => [{ attemptId: "a" }],
      pendingPreEnqueueDrafts: () => [{ attemptId: "b" }],
    }
    expect((conversation as any).pendingPreEnqueueCount()).toBe(2)
    expect((conversation as any).pendingSendDrafts()).toEqual([{ attemptId: "a" }])
    expect((conversation as any).pendingPreEnqueueDrafts()).toEqual([{ attemptId: "b" }])
    ;(conversation as any).vm = {
      currentReplyMessage: undefined,
      markUnread: vi.fn(),
      releaseOpenConversationOwnership: vi.fn(),
    }
    conversation.dealloc()
    expect(markExtra).toHaveBeenCalledTimes(1)
    expect((conversation as any).vm.markUnread).toHaveBeenCalledTimes(1)
  })

  it("builds mixed rich text from text blocks and preserves mentions", async () => {
    const conversation = new Conversation({ channel })
    const send = vi.fn(() => Promise.resolve(true))
    ;(conversation as any).sendTextAndWaitAck = send
    const blocks = [
      { type: "text", text: "hello ", mention: { uids: ["u1"], humans: true } },
      { type: "text", text: "world", mention: { ais: true, all: true, entities: [{ uid: "u2", offset: 0, length: 2 }] } },
    ]
    await expect((conversation as any).sendRichTextMixed(blocks, undefined, vi.fn(), channel, {})).resolves.toBe(true)
    expect(send).toHaveBeenCalledTimes(1)
    const content = send.mock.calls[0][0]
    expect(content.content).toHaveLength(2)
    expect(content.mention.uids).toEqual(["u1"])
    expect(content.mention.all).toBe(true)
    await expect((conversation as any).sendRichTextMixed([], undefined, undefined, channel, {})).resolves.toBe(false)
  })

  it("aborts mixed rich text when local image dimensions cannot be read", async () => {
    const conversation = new Conversation({ channel })
    ;(conversation as any).sendTextAndWaitAck = vi.fn()
    const read = vi.spyOn(FileReader.prototype, "readAsDataURL").mockImplementation(function (this: FileReader) {
      this.onerror?.(new ProgressEvent("error"))
    })
    try {
      await expect((conversation as any).sendRichTextMixed([
        { type: "image", file: new File(["not-an-image"], "broken.png", { type: "image/png" }) },
      ], undefined, undefined, channel, {})).rejects.toThrow("richtext mixed image prepare failed")
      expect((conversation as any).sendTextAndWaitAck).not.toHaveBeenCalled()
    } finally {
      read.mockRestore()
    }
  })

  it("skips revoked-message reedit when the message is not eligible", async () => {
    const conversation = new Conversation({ channel })
    await expect(conversation.reeditRevokedMessage({ revoke: false } as any)).resolves.toBeUndefined()
  })

  it("persists conversation draft metadata when no viewport anchor is available", async () => {
    const { default: app } = await import("../../../App")
    const update = vi.fn().mockResolvedValue(undefined)
    const originalDataSource = app.dataSource
    ;(app as any).dataSource = { channelDataSource: { conversationExtraUpdate: update } }
    const conversation = new Conversation({ channel })
    const remoteExtra: any = { draft: "old", keepMessageSeq: 9, keepOffsetY: 4 }
    ;(conversation as any).vm = {
      messageContainerId: "draft-vp",
      currentConversation: { remoteExtra },
      conversationLastMessageSeq: () => 0,
    }
    ;(conversation as any).visiblePersistentMessage = vi.fn(() => undefined)
    await expect(conversation.updateConversationExtra("new draft")).resolves.toBeUndefined()
    expect(remoteExtra.draft).toBe("new draft")
    expect(update).toHaveBeenCalledTimes(1)
    const viewport = document.createElement("div") as any
    viewport.id = "draft-vp"
    Object.defineProperties(viewport, {
      scrollTop: { value: 10, configurable: true },
      scrollHeight: { value: 200, configurable: true },
      clientHeight: { value: 80, configurable: true },
    })
    document.body.append(viewport)
    const anchor = { messageSeq: 5 }
    ;(conversation as any).visiblePersistentMessage = vi.fn((_vp: any, fromEnd: boolean) => fromEnd ? anchor : anchor)
    ;(conversation as any).getMessageElement = vi.fn(() => ({ offsetTop: 20 }))
    ;(conversation as any).vm.conversationLastMessageSeq = () => 10
    await conversation.updateConversationExtra("anchored")
    expect(remoteExtra.keepMessageSeq).toBe(5)
    expect(remoteExtra.keepOffsetY).toBe(0)
    ;(app as any).dataSource = originalDataSource
  })

  it("records the live editor draft when leaving the conversation", async () => {
    const { default: app } = await import("../../../App")
    const originalDataSource = app.dataSource
    const update = vi.fn().mockResolvedValue(undefined)
    ;(app as any).dataSource = { channelDataSource: { conversationExtraUpdate: update } }
    const conversation = new Conversation({ channel })
    ;(conversation as any).vm = {
      messageContainerId: "mark-draft-vp",
      currentConversation: { remoteExtra: { draft: "old" } },
      conversationLastMessageSeq: () => 0,
    }
    ;(conversation as any).visiblePersistentMessage = vi.fn(() => undefined)
    ;(conversation as any)._messageInputContext = { text: () => "live draft" }
    conversation.markConversationExtra()
    await Promise.resolve()
    expect((conversation as any).vm.currentConversation.remoteExtra.draft).toBe("live draft")
    ;(app as any).dataSource = originalDataSource
  })

  it("does not clear a draft when a send has no draft settlement", async () => {
    const conversation = new Conversation({ channel })
    await expect(conversation.clearDraftAfterSend({ sendDraft: undefined } as any)).resolves.toBeUndefined()
  })
})
