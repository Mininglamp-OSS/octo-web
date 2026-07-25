import { describe, expect, it } from "vitest"

import { aggregateReactions } from "../aggregate"
import type { MessageReaction } from "../types"

const r = (over: Partial<MessageReaction>): MessageReaction => ({
  uid: "u1",
  name: "u1-name",
  reactionType: "emoji",
  reactionKey: "👍",
  emoji: "👍",
  ...over,
})

describe("aggregateReactions", () => {
  it("returns empty when input empty or nullish", () => {
    expect(aggregateReactions(undefined, "me")).toEqual([])
    expect(aggregateReactions([], "me")).toEqual([])
  })

  it("groups by reactionType + reactionKey", () => {
    const groups = aggregateReactions(
      [
        r({ uid: "u1", name: "A" }),
        r({ uid: "u2", name: "B" }),
        r({ uid: "u3", name: "C", reactionKey: "❤️", emoji: "❤️" }),
      ],
      "me",
    )
    expect(groups).toHaveLength(2)
    const thumbs = groups.find((g) => g.reactionKey === "👍")!
    expect(thumbs.users.map((u) => u.uid)).toEqual(["u1", "u2"])
    const heart = groups.find((g) => g.reactionKey === "❤️")!
    expect(heart.users.map((u) => u.uid)).toEqual(["u3"])
  })

  it("filters out isDeleted=1 records", () => {
    const groups = aggregateReactions(
      [r({ uid: "u1", name: "A" }), r({ uid: "u2", name: "B", isDeleted: 1 })],
      "me",
    )
    expect(groups).toHaveLength(1)
    expect(groups[0].users.map((u) => u.uid)).toEqual(["u1"])
  })

  it("dedupes same uid within a group, keeps first-seen name", () => {
    const groups = aggregateReactions(
      [
        r({ uid: "u1", name: "旧名", seq: 1 }),
        r({ uid: "u1", name: "新名", seq: 2 }),
      ],
      "me",
    )
    expect(groups[0].users).toEqual([{ uid: "u1", name: "旧名" }])
  })

  it("sorts users within a group by seq asc, then createdAt asc, then insertion order", () => {
    const groups = aggregateReactions(
      [
        r({ uid: "u3", name: "C", seq: 30 }),
        r({ uid: "u1", name: "A", seq: 10 }),
        r({ uid: "u2", name: "B", seq: 20 }),
      ],
      "me",
    )
    expect(groups[0].users.map((u) => u.uid)).toEqual(["u1", "u2", "u3"])
  })

  it("sorts by createdAt when seq missing", () => {
    const groups = aggregateReactions(
      [
        r({ uid: "u2", name: "B", createdAt: "2026-01-02T00:00:00Z" }),
        r({ uid: "u1", name: "A", createdAt: "2026-01-01T00:00:00Z" }),
      ],
      "me",
    )
    expect(groups[0].users.map((u) => u.uid)).toEqual(["u1", "u2"])
  })

  it("marks hasMine when currentUid participates", () => {
    const groups = aggregateReactions(
      [
        r({ uid: "u1", name: "A" }),
        r({ uid: "me", name: "Me" }),
        r({ uid: "u3", name: "C", reactionKey: "❤️", emoji: "❤️" }),
      ],
      "me",
    )
    const thumbs = groups.find((g) => g.reactionKey === "👍")!
    const heart = groups.find((g) => g.reactionKey === "❤️")!
    expect(thumbs.hasMine).toBe(true)
    expect(heart.hasMine).toBe(false)
  })

  it("keeps emoji and sticker as separate groups even if reactionKey collides", () => {
    const groups = aggregateReactions(
      [
        r({ uid: "u1", name: "A", reactionKey: "abc" }),
        r({
          uid: "u2",
          name: "B",
          reactionType: "sticker",
          reactionKey: "abc",
          emoji: undefined,
          sticker: { path: "s/abc.webp" },
        }),
      ],
      "me",
    )
    expect(groups).toHaveLength(2)
    expect(groups.map((g) => g.reactionType).sort()).toEqual([
      "emoji",
      "sticker",
    ])
  })

  it("orders groups by first arrival (min seq asc; fallback stable)", () => {
    const groups = aggregateReactions(
      [
        r({ uid: "u1", name: "A", reactionKey: "❤️", emoji: "❤️", seq: 5 }),
        r({ uid: "u2", name: "B", reactionKey: "👍", emoji: "👍", seq: 1 }),
        r({ uid: "u3", name: "C", reactionKey: "👍", emoji: "👍", seq: 3 }),
      ],
      "me",
    )
    expect(groups.map((g) => g.reactionKey)).toEqual(["👍", "❤️"])
  })

  it("keeps group order stable when an existing group gains a later participant", () => {
    // 👍 首次 seq=1（早于 ❤️ 的 seq=2），之后 👍 又新增 seq=9 的参与者。
    // 组间应按首次出现排序，👍 不能因为最新 seq 变大而跳到 ❤️ 之后。
    const groups = aggregateReactions(
      [
        r({ uid: "u1", name: "A", reactionKey: "👍", emoji: "👍", seq: 1 }),
        r({ uid: "u2", name: "B", reactionKey: "❤️", emoji: "❤️", seq: 2 }),
        r({ uid: "u3", name: "C", reactionKey: "👍", emoji: "👍", seq: 9 }),
      ],
      "me",
    )
    expect(groups.map((g) => g.reactionKey)).toEqual(["👍", "❤️"])
  })

  it("carries sticker metadata into the group", () => {
    const sticker = { stickerId: "s1", path: "sticker/a.webp", format: "webp" }
    const groups = aggregateReactions(
      [
        {
          uid: "u1",
          name: "A",
          reactionType: "sticker",
          reactionKey: "s1",
          sticker,
        },
      ],
      "me",
    )
    expect(groups[0].sticker).toEqual(sticker)
  })

  it("does not mutate input records", () => {
    const input: MessageReaction[] = [r({ uid: "u1", name: "A" })]
    const before = JSON.stringify(input)
    aggregateReactions(input, "me")
    expect(JSON.stringify(input)).toBe(before)
  })
})
