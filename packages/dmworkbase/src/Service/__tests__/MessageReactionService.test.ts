import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../APIClient", () => ({
  default: {
    shared: {
      post: vi.fn(),
    },
  },
}))

import APIClient from "../APIClient"
import MessageReactionService, {
  mergeMessageReaction,
  normalizeMessageReactions,
} from "../MessageReactionService"

const apiPost = APIClient.shared.post as unknown as ReturnType<typeof vi.fn>

describe("MessageReactionService", () => {
  beforeEach(() => {
    apiPost.mockReset()
  })

  it("posts the deployed toggle wire contract and returns the authoritative state", async () => {
    apiPost.mockResolvedValueOnce({
      message_id: "123",
      channel_id: "group-1",
      channel_type: 2,
      emoji: "👍",
      seq: 42,
      is_deleted: 0,
    })

    await expect(
      MessageReactionService.toggle({
        messageId: "123",
        channelId: "group-1",
        channelType: 2,
        emoji: "👍",
      }),
    ).resolves.toEqual({
      messageId: "123",
      channelId: "group-1",
      channelType: 2,
      emoji: "👍",
      seq: 42,
      isDeleted: 0,
    })
    expect(apiPost).toHaveBeenCalledWith("reactions", {
      message_id: "123",
      channel_id: "group-1",
      channel_type: 2,
      emoji: "👍",
    })
  })

  it("syncs by channel and seq and normalizes message-scoped records", async () => {
    apiPost.mockResolvedValueOnce([
      {
        message_id: "123",
        channel_id: "group-1",
        channel_type: 2,
        seq: 43,
        uid: "u1",
        name: "Alice",
        emoji: "[收到]",
        is_deleted: 1,
        created_at: "2026-07-21 10:00:00",
      },
    ])

    await expect(
      MessageReactionService.sync({
        channelId: "group-1",
        channelType: 2,
        seq: 42,
        limit: 1000,
      }),
    ).resolves.toEqual([
      {
        messageId: "123",
        channelId: "group-1",
        channelType: 2,
        seq: 43,
        uid: "u1",
        name: "Alice",
        reactionType: "emoji",
        reactionKey: "[收到]",
        emoji: "[收到]",
        isDeleted: 1,
        createdAt: "2026-07-21 10:00:00",
      },
    ])
    expect(apiPost).toHaveBeenCalledWith("reaction/sync", {
      channel_id: "group-1",
      channel_type: 2,
      seq: 42,
      limit: 1000,
    })
  })

  it("normalizes inline reactions and drops malformed records", () => {
    expect(
      normalizeMessageReactions([
        {
          seq: 4,
          uid: "u1",
          name: "Alice",
          emoji: "❤️",
          is_deleted: 0,
          created_at: "2026-07-21 10:00:00",
        },
        { seq: 5, uid: "u2", name: "Bob", emoji: "" },
        null,
      ]),
    ).toEqual([
      {
        seq: 4,
        uid: "u1",
        name: "Alice",
        reactionType: "emoji",
        reactionKey: "❤️",
        emoji: "❤️",
        isDeleted: 0,
        createdAt: "2026-07-21 10:00:00",
      },
    ])
  })

  it("merges by uid and emoji without allowing an older seq to overwrite a newer state", () => {
    const current = normalizeMessageReactions([
      { seq: 10, uid: "u1", name: "Alice", emoji: "👍", is_deleted: 0 },
      { seq: 8, uid: "u2", name: "Bob", emoji: "❤️", is_deleted: 0 },
    ])
    const stale = normalizeMessageReactions([
      { seq: 9, uid: "u1", name: "Alice", emoji: "👍", is_deleted: 1 },
    ])[0]
    const fresh = normalizeMessageReactions([
      { seq: 11, uid: "u1", name: "Alice 2", emoji: "👍", is_deleted: 1 },
    ])[0]

    expect(mergeMessageReaction(current, stale)).toEqual(current)
    expect(mergeMessageReaction(current, fresh)).toEqual([
      {
        seq: 11,
        uid: "u1",
        name: "Alice 2",
        reactionType: "emoji",
        reactionKey: "👍",
        emoji: "👍",
        isDeleted: 1,
        createdAt: undefined,
      },
      current[1],
    ])
  })
})
