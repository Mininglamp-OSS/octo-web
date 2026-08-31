import { describe, expect, it, vi } from "vitest"
import { StreamFlag } from "wukongimjssdk"

const sdk = vi.hoisted(() => ({
  uid: "me",
  subscribers: [] as any[],
  emojiPattern: /(?!)/,
}))

vi.mock("wukongimjssdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("wukongimjssdk")>()
  return {
    ...actual,
    WKSDK: { shared: () => ({ config: { uid: sdk.uid } }) },
  }
})
vi.mock("../../App", () => ({
  default: {
    loginInfo: { uid: "me" },
    shared: { currentSpaceId: "", avatarChannel: () => "avatar", getChannelAvatarTag: () => "tag" },
    dataSource: { commonDataSource: { getImageURL: (url: string) => url } },
  },
}))
vi.mock("../EmojiService", () => ({ DefaultEmojiService: { shared: { emojiRegExp: () => sdk.emojiPattern } } }))
vi.mock("../TypingManager", () => ({ TypingManager: { shared: { getFakeTypingMessage: () => undefined } } }))
vi.mock("../SpaceService", () => ({ getSpaceFilteredLastMessage: (conversation: any) => conversation.lastMessage, SYSTEM_BOTS: new Set() }))
vi.mock("./messageContinuity", () => ({ isMessageContinuation: () => false }))
vi.mock("../../im-runtime/channelRuntime", () => ({
  getImChannelInfo: () => undefined,
  getImChannelSubscribers: () => sdk.subscribers,
}))

import { BubblePosition, ConversationWrap, MessageWrap, Part, PartType } from "../Model"
import { MessageContentTypeConst, MessageReasonCode } from "../Const"
import WKApp from "../../App"

function message(overrides: Record<string, any> = {}) {
  return {
    channel: { channelID: "g", channelType: 2 },
    messageSeq: 1,
    clientSeq: 0,
    clientMsgNo: "m1",
    messageID: "id-1",
    fromUID: "me",
    timestamp: 1,
    contentType: 1,
    status: 1,
    header: {},
    setting: {},
    remoteExtra: {},
    content: { contentType: 1, text: "hello" },
    ...overrides,
  } as any
}

describe("MessageWrap", () => {
  it("stores message parts and exposes ordering/status fields", () => {
    const wrap = new MessageWrap(message({ messageSeq: 3, clientSeq: 4 }))

    expect(wrap.order).toBe(30000)
    expect(wrap.clientSeq).toBe(4)
    expect(wrap.send).toBe(true)
    expect(wrap.parts).toEqual([new Part(PartType.text, "hello")])
    expect(wrap.reasonCode).toBe(MessageReasonCode.reasonSuccess)
  })

  it("parses legacy mentions while skipping broadcast labels", () => {
    const wrap = new MessageWrap(message({
      content: {
        contentType: 1,
        text: "Hi @alice @all @所有人",
        mention: { uids: ["u-alice", "u-all", "u-human"] },
      },
    }))

    expect(wrap.parts.filter((part) => part.type === PartType.mention).map((part) => part.data.uid)).toEqual(["u-alice"])
    expect(wrap.parts.map((part) => part.text)).toEqual(["Hi ", "@alice", " @all @所有人"])
  })

  it("uses valid mention entities, ignores overlap, and preserves literal broadcast entities", () => {
    const wrap = new MessageWrap(message({
      content: {
        contentType: 1,
        text: "@alice and @所有AI",
        mention: {
          entities: [
            { uid: "alice", offset: 0, length: 6 },
            { uid: "overlap", offset: 2, length: 4 },
            { uid: "-3", offset: 11, length: 5 },
          ],
        },
      },
    }))

    expect(wrap.parts).toEqual([
      new Part(PartType.mention, "@alice", { uid: "alice" }),
      new Part(PartType.text, " and "),
      new Part(PartType.text, "@所有AI"),
    ])
  })

  it("rebases parsing to edited text and resets cached parts", () => {
    const raw = message({
      content: { contentType: 1, text: "old", mention: { uids: ["old-user"] } },
      remoteExtra: {
        isEdit: true,
        contentEdit: { contentType: 1, text: "new @user", mention: { uids: ["new-user"] } },
      },
    })
    const wrap = new MessageWrap(raw)

    expect(wrap.parts.map((part) => part.text)).toEqual(["new ", "@user"])
    raw.remoteExtra.contentEdit.text = "changed"
    wrap.resetParts()
    expect(wrap.parts.map((part) => part.text)).toEqual(["changed"])
  })

  it("handles broadcast-only mentions and invalid entities without crashing", () => {
    const wrap = new MessageWrap(message({
      content: {
        contentType: 1,
        text: "@all",
        mention: { all: true, entities: [{ uid: "bad", offset: -1, length: 2 }] },
      },
    }))

    expect(wrap.parts).toEqual([new Part(PartType.mention, "@all", { uid: "all" })])
  })

  it("maps bubble positions from continuation flags", () => {
    const first = new MessageWrap(message({ clientMsgNo: "first" }))
    const middle = new MessageWrap(message({ clientMsgNo: "middle" }))
    const last = new MessageWrap(message({ clientMsgNo: "last" }))
    Object.defineProperties(first, { isContinueFromPrevious: { get: () => false }, isContinueToNext: { get: () => true } })
    Object.defineProperties(middle, { isContinueFromPrevious: { get: () => true }, isContinueToNext: { get: () => true } })
    Object.defineProperties(last, { isContinueFromPrevious: { get: () => true }, isContinueToNext: { get: () => false } })

    expect(first.bubblePosition).toBe(BubblePosition.first)
    expect(middle.bubblePosition).toBe(BubblePosition.middle)
    expect(last.bubblePosition).toBe(BubblePosition.last)
  })

  it("parses emoji and links only in text parts", () => {
    sdk.emojiPattern = /😀/
    const wrap = new MessageWrap(message({ content: { contentType: 1, text: "see 😀 www.example.com" } }))

    expect(wrap.parts).toEqual([
      new Part(PartType.text, "see "),
      new Part(PartType.emoji, "😀"),
      new Part(PartType.text, " "),
      new Part(PartType.link, "www.example.com"),
    ])
    sdk.emojiPattern = /(?!)/
  })

  it("exposes mutable message state and stream metadata", () => {
    const raw = message({
      status: 0,
      streamOn: true,
      streamFlag: 0,
      streams: [{ content: { text: " world" } }, { content: { text: "!" } }],
      remoteExtra: { unreadCount: 2, readedCount: 1, revoke: false },
      content: { contentType: 1, text: "hello", contentObj: { flame: 1 } },
    })
    const wrap = new MessageWrap(raw)

    expect(wrap.reasonCode).toBe(MessageReasonCode.reasonUnknown)
    wrap.reasonCode = MessageReasonCode.reasonAuthFail
    expect(wrap.reasonCode).toBe(MessageReasonCode.reasonAuthFail)
    wrap.readedCount = 3
    wrap.revoke = true
    wrap.revoker = "admin"
    wrap.isDeleted = true
    expect(wrap.readedCount).toBe(3)
    expect(wrap.revoke).toBe(true)
    expect(wrap.revoker).toBe("admin")
    expect(wrap.isDeleted).toBe(true)
    expect(wrap.streamOn).toBe(true)
    expect(wrap.isStreaming).toBe(true)
    expect(wrap.fullStreamContent).toBe("hello world!")
    expect(wrap.flame).toBe(true)
  })

  it("handles non-text, empty and ended stream content", () => {
    const wrap = new MessageWrap(message({
      contentType: 99,
      content: { contentType: 99, text: "ignored" },
      streamOn: true,
      streamFlag: StreamFlag.END,
      streams: [],
    }))
    expect(wrap.parts).toEqual([])
    expect(wrap.isStreaming).toBe(false)
    expect(wrap.fullStreamContent).toBe("ignored")
    expect(wrap.parseEmoji([])).toEqual([])
    expect(wrap.parseLinks([])).toEqual([])
  })
})

describe("ConversationWrap", () => {
  function conversation(overrides: Record<string, any> = {}) {
    return {
      channel: { channelID: "g", channelType: 2 },
      channelInfo: { orgData: { category: "", agent_uid: "" } },
      unread: 3,
      timestamp: 10,
      lastMessage: message(),
      reminders: [],
      extra: {},
      isEqual: () => true,
      reloadIsMentionMe: vi.fn(),
      ...overrides,
    } as any
  }

  it("uses per-space person unread and last-message values", () => {
    const original = { ...WKApp.shared }
    WKApp.shared.currentSpaceId = "space-1"
    const spaceMessage = message({ messageID: "space-message" })
    const wrap = new ConversationWrap(conversation({
      channel: { channelID: "person", channelType: 1 },
      extra: { spaceUnread: 7, spaceLastMessage: spaceMessage },
    }))

    expect(wrap.unread).toBe(7)
    expect(wrap.lastMessage).toBe(spaceMessage)
    WKApp.shared.currentSpaceId = original.currentSpaceId
  })

  it("filters system unread and calculates conversation categories", () => {
    const wrap = new ConversationWrap(conversation({
      unread: 1,
      lastMessage: message({ contentType: MessageContentTypeConst.addMembers }),
      channelInfo: { orgData: { category: "", agent_uid: "" } },
    }))
    expect(wrap.unread).toBe(0)
    expect(wrap.category).toBe("new")
    wrap.conversation.channelInfo.orgData.agent_uid = "me"
    expect(wrap.category).toBe("assignMe")
    wrap.conversation.channelInfo.orgData.agent_uid = "other"
    expect(wrap.category).toBe("allAssigned")
    wrap.conversation.channelInfo.orgData.category = "solved"
    expect(wrap.category).toBe("solved")
  })

  it("recognizes active reminders or direct mentions, but not broadcast alone", () => {
    const wrap = new ConversationWrap(conversation({
      reminders: [{ reminderType: 1, done: false }],
      lastMessage: message({ content: { mention: { uids: ["other"], all: true } } }),
    }))
    expect(wrap.isMentionMe).toBe(true)
    wrap.conversation.reminders = []
    wrap.conversation.lastMessage.content.mention.uids = ["me"]
    expect(wrap.isMentionMe).toBe(true)
    wrap.conversation.lastMessage.content.mention.uids = ["other"]
    expect(wrap.isMentionMe).toBe(false)
  })

  it("initializes extras and delegates identity and reload operations", () => {
    const raw = conversation({ extra: undefined })
    const wrap = new ConversationWrap(raw)
    expect(wrap.extra).toEqual({})
    wrap.timestamp = 22
    expect(wrap.timestamp).toBe(22)
    wrap.isMentionMe = true
    wrap.reloadIsMentionMe()
    expect(raw.isMentionMe).toBe(true)
    expect(raw.reloadIsMentionMe).toHaveBeenCalled()
    expect(wrap.isEqual(new ConversationWrap(conversation()))).toBe(true)
  })
})
