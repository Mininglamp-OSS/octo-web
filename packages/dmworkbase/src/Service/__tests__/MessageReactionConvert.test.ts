import { describe, expect, it } from "vitest"
import { Convert } from "../Convert"

describe("Convert.toMessage reaction passthrough", () => {
  it("maps inline server reactions onto the SDK message", () => {
    const message = Convert.toMessage({
      message_idstr: "123",
      client_msg_no: "c1",
      message_seq: 1,
      channel_id: "group-1",
      channel_type: 2,
      from_uid: "u1",
      timestamp: 1,
      payload: { type: 1, content: "hello" },
      reactions: [
        {
          seq: 42,
          uid: "u2",
          name: "Bob",
          emoji: "👍",
          is_deleted: 0,
          created_at: "2026-07-21 10:00:00",
        },
      ],
    })

    expect(message.reactions).toEqual([
      {
        seq: 42,
        uid: "u2",
        name: "Bob",
        reactionType: "emoji",
        reactionKey: "👍",
        emoji: "👍",
        isDeleted: 0,
        createdAt: "2026-07-21 10:00:00",
      },
    ])
  })

  it("uses an empty list when the server omits reactions", () => {
    const message = Convert.toMessage({
      message_idstr: "124",
      client_msg_no: "c2",
      message_seq: 2,
      channel_id: "group-1",
      channel_type: 2,
      from_uid: "u1",
      timestamp: 2,
      payload: { type: 1, content: "hello" },
    })

    expect(message.reactions).toEqual([])
  })
})
