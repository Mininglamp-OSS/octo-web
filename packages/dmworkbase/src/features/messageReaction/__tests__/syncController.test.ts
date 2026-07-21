import { describe, expect, it, vi } from "vitest"
import { createMessageReactionSyncController } from "../syncController"

const channel = { channelID: "group-1", channelType: 2 }

function message(messageID: string, reactions: unknown[] = []) {
  return { messageID, reactions }
}

describe("message reaction realtime sync controller", () => {
  it("syncs from the highest inline seq and applies message-scoped records", async () => {
    const messages = [
      message("123", [
        {
          seq: 40,
          uid: "u1",
          name: "Alice",
          reactionType: "emoji",
          reactionKey: "👍",
          emoji: "👍",
          isDeleted: 0,
        },
      ]),
    ]
    const sync = vi.fn().mockResolvedValue([
      {
        messageId: "123",
        channelId: "group-1",
        channelType: 2,
        seq: 42,
        uid: "u2",
        name: "Bob",
        reactionType: "emoji",
        reactionKey: "❤️",
        emoji: "❤️",
        isDeleted: 0,
      },
    ])
    const notify = vi.fn()
    const controller = createMessageReactionSyncController({
      channel,
      getMessages: () => messages,
      sync,
      notify,
    })

    await controller.request(42)

    expect(sync).toHaveBeenCalledWith({
      channelId: "group-1",
      channelType: 2,
      seq: 40,
      limit: 1000,
    })
    expect(messages[0].reactions).toEqual([
      expect.objectContaining({ uid: "u1", seq: 40 }),
      expect.objectContaining({ uid: "u2", seq: 42 }),
    ])
    expect(notify).toHaveBeenCalledTimes(1)
  })

  it("ignores an announced seq already represented by inline data", async () => {
    const messages = [
      message("123", [
        {
          seq: 42,
          uid: "u1",
          name: "Alice",
          reactionType: "emoji",
          reactionKey: "👍",
          emoji: "👍",
          isDeleted: 0,
        },
      ]),
    ]
    const sync = vi.fn()
    const controller = createMessageReactionSyncController({
      channel,
      getMessages: () => messages,
      sync,
      notify: vi.fn(),
    })

    await controller.request(42)

    expect(sync).not.toHaveBeenCalled()
  })

  it("keeps a newer local record when sync returns an older seq", async () => {
    const messages = [
      message("123", [
        {
          seq: 50,
          uid: "u1",
          name: "Alice",
          reactionType: "emoji",
          reactionKey: "👍",
          emoji: "👍",
          isDeleted: 0,
        },
      ]),
    ]
    const sync = vi.fn().mockResolvedValue([
      {
        messageId: "123",
        channelId: "group-1",
        channelType: 2,
        seq: 49,
        uid: "u1",
        name: "Alice",
        reactionType: "emoji",
        reactionKey: "👍",
        emoji: "👍",
        isDeleted: 1,
      },
    ])
    const controller = createMessageReactionSyncController({
      channel,
      getMessages: () => messages,
      sync,
      notify: vi.fn(),
    })

    await controller.request(51)

    expect(messages[0].reactions[0]).toEqual(
      expect.objectContaining({ seq: 50, isDeleted: 0 }),
    )
  })
})
