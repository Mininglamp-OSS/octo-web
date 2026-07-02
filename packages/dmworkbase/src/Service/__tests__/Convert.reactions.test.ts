import { describe, expect, it } from "vitest"
import { Convert } from "../Convert"

// 服务端 /message/channel/sync 的 reactions 是「每个 actor 一条」
// {seq,uid,name,emoji,is_deleted}；Convert.toReactions 负责过滤已撤回 +
// 按 emoji 聚合成 SDK 的 {seq,count,emoji,users[]}。这些断言锁住聚合契约，
// 防止后续改动悄悄破坏前端拿到的 reaction 形状。
const row = (over: Record<string, unknown> = {}) => ({
    seq: 1,
    uid: "u1",
    name: "n1",
    emoji: "👍",
    is_deleted: 0,
    ...over,
})

describe("Convert.toReactions", () => {
    it("returns [] for non-array / empty input", () => {
        expect(Convert.toReactions(undefined)).toEqual([])
        expect(Convert.toReactions(null)).toEqual([])
        expect(Convert.toReactions("nope")).toEqual([])
        expect(Convert.toReactions([])).toEqual([])
    })

    it("aggregates a single actor into one emoji group", () => {
        const out = Convert.toReactions([row({ uid: "u1", name: "n1", emoji: "👍", seq: 5 })])
        expect(out).toHaveLength(1)
        expect(out[0].emoji).toBe("👍")
        expect(out[0].count).toBe(1)
        expect(out[0].users).toEqual([{ uid: "u1", name: "n1" }])
        // seq 以字符串形式带出（SDK Reaction.seq:string）
        expect(out[0].seq).toBe("5")
    })

    it("aggregates multiple actors of the same emoji: count = 人数, users 全保留", () => {
        const out = Convert.toReactions([
            row({ uid: "u1", name: "n1", emoji: "👍", seq: 3 }),
            row({ uid: "u2", name: "n2", emoji: "👍", seq: 7 }),
            row({ uid: "u3", name: "n3", emoji: "👍", seq: 4 }),
        ])
        expect(out).toHaveLength(1)
        expect(out[0].count).toBe(3)
        expect(out[0].users).toEqual([
            { uid: "u1", name: "n1" },
            { uid: "u2", name: "n2" },
            { uid: "u3", name: "n3" },
        ])
        // 同组 seq 取最大值（最近一次变更），与顺序无关
        expect(out[0].seq).toBe("7")
    })

    it("splits different emojis into separate groups (insertion order)", () => {
        const out = Convert.toReactions([
            row({ emoji: "👍", uid: "u1" }),
            row({ emoji: "❤️", uid: "u2" }),
            row({ emoji: "👍", uid: "u3" }),
        ])
        expect(out.map((r) => r.emoji)).toEqual(["👍", "❤️"])
        const thumbs = out.find((r) => r.emoji === "👍")!
        const heart = out.find((r) => r.emoji === "❤️")!
        expect(thumbs.count).toBe(2)
        expect(heart.count).toBe(1)
    })

    it("skips撤回 (is_deleted=1) entries", () => {
        const out = Convert.toReactions([
            row({ uid: "u1", emoji: "👍", is_deleted: 0 }),
            row({ uid: "u2", emoji: "👍", is_deleted: 1 }),
        ])
        expect(out).toHaveLength(1)
        expect(out[0].count).toBe(1)
        expect(out[0].users).toEqual([{ uid: "u1", name: "n1" }])
    })

    it("returns [] when every entry is撤回", () => {
        const out = Convert.toReactions([
            row({ emoji: "👍", is_deleted: 1 }),
            row({ emoji: "❤️", is_deleted: 1 }),
        ])
        expect(out).toEqual([])
    })

    it("skips malformed entries (null / missing emoji)", () => {
        const out = Convert.toReactions([
            null,
            row({ emoji: "" }),
            row({ emoji: undefined }),
            row({ emoji: "👍", uid: "u9", name: "n9" }),
        ])
        expect(out).toHaveLength(1)
        expect(out[0].emoji).toBe("👍")
        expect(out[0].users).toEqual([{ uid: "u9", name: "n9" }])
    })

    it("coerces missing/NaN seq to 0", () => {
        const out = Convert.toReactions([row({ emoji: "👍", seq: undefined })])
        expect(out[0].seq).toBe("0")
    })
})
