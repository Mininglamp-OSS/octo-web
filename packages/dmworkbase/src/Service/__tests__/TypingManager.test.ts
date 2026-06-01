import { describe, it, expect, beforeEach, vi } from "vitest"
import { Channel } from "wukongimjssdk"

// TypingManager imports `../App` (heavy module) only for WKApp.loginInfo.uid.
// Mock it so the singleton can be exercised in isolation.
vi.mock("../../App", () => ({
    default: { loginInfo: { uid: "me" } },
}))

// `../../Messages/Typing` transitively pulls in lottie/react-spinners (DOM-heavy,
// crashes under jsdom). resetAll/addTyping don't need the real TypingContent.
vi.mock("../../Messages/Typing", () => ({
    TypingContent: class {
        constructor(public fromUID: string, public fromName: string) {}
    },
}))

import { TypingManager } from "../TypingManager"

const ChannelTypePerson = 1

describe("TypingManager.resetAll", () => {
    beforeEach(() => {
        // 清掉上一个用例的残留 typing（singleton 跨用例共享）
        TypingManager.shared.resetAll()
        vi.useFakeTimers()
    })

    it("clears every active typing and notifies each affected channel with add=false", () => {
        const a = new Channel("alice", ChannelTypePerson)
        const b = new Channel("bob", ChannelTypePerson)

        const events: Array<{ key: string; add: boolean }> = []
        const listener = (channel: Channel, add: boolean) => {
            events.push({ key: channel.getChannelKey(), add })
        }
        TypingManager.shared.addTypingListener(listener)

        TypingManager.shared.addTyping(a, "u1", "Alice")
        TypingManager.shared.addTyping(b, "u2", "Bob")
        expect(TypingManager.shared.hasTyping(a)).toBe(true)
        expect(TypingManager.shared.hasTyping(b)).toBe(true)

        // 只保留 add 事件后清空，便于断言 reset 的 remove 通知
        const addEvents = events.filter((e) => e.add)
        expect(addEvents.length).toBe(2)
        events.length = 0

        TypingManager.shared.resetAll()

        expect(TypingManager.shared.hasTyping(a)).toBe(false)
        expect(TypingManager.shared.hasTyping(b)).toBe(false)
        const removedKeys = events.filter((e) => !e.add).map((e) => e.key).sort()
        expect(removedKeys).toEqual([a.getChannelKey(), b.getChannelKey()].sort())

        TypingManager.shared.removeTypingListener(listener)
    })

    it("is a no-op (no notify) when there is no active typing", () => {
        const listener = vi.fn()
        TypingManager.shared.addTypingListener(listener)
        TypingManager.shared.resetAll()
        expect(listener).not.toHaveBeenCalled()
        TypingManager.shared.removeTypingListener(listener)
    })

    it("stops the 8s timer so a cleared typing does not fire a late removal", () => {
        const a = new Channel("carol", ChannelTypePerson)
        const listener = vi.fn()
        TypingManager.shared.addTypingListener(listener)

        TypingManager.shared.addTyping(a, "u3", "Carol")
        TypingManager.shared.resetAll()
        listener.mockClear()

        // resetAll 后推进超过 8s，原 timer 不应再触发任何 notify
        vi.advanceTimersByTime(10_000)
        expect(listener).not.toHaveBeenCalled()

        TypingManager.shared.removeTypingListener(listener)
    })
})
