import { describe, it, expect } from "vitest"
import { ReminderType } from "wukongimjssdk"

import {
    selectDoneReminderIDs,
    isReadToLatest,
    ReminderLike,
} from "../reminderDone"

// #1408: category header 的 `@` 角标永久亮着但展开每行都没 @。根因是 mention reminder
// 只在消息当前处于视口内可见时才被标 done，历史 mention 被滚出视口后永不 done。
// Fix A：用户已真实读到会话底部时，会话内所有未 done 的 mention reminder 一律标 done；
// 其它类型（入群申请等）保持基于视口可见性的处理，避免被兜底静默清掉。
describe("isReadToLatest", () => {
    it("is true when scrolled to the latest rendered message and no more history", () => {
        expect(
            isReadToLatest({
                lastMessageSeq: 30,
                lastVisibleSeq: 30,
                pullupHasMore: false,
            })
        ).toBe(true)
    })

    it("is false when there is still older history to pull up (mentions may be unloaded)", () => {
        // 核心回归：即使 last message 已在视口内，只要还有更早历史未加载，就不能兜底，
        // 否则会把未加载区里用户没看过的 @ 静默标 done。对应 self-send 把 browseTo 强推
        // 到最新、但历史尚未加载的场景。
        expect(
            isReadToLatest({
                lastMessageSeq: 30,
                lastVisibleSeq: 30,
                pullupHasMore: true,
            })
        ).toBe(false)
    })

    it("is false when the latest message is not actually visible in the viewport", () => {
        // 视口里最后可见的是 seq 20，最新是 30 —— 用户没真的滚到底。
        expect(
            isReadToLatest({
                lastMessageSeq: 30,
                lastVisibleSeq: 20,
                pullupHasMore: false,
            })
        ).toBe(false)
    })

    it("is false when there is no last message or nothing visible", () => {
        expect(
            isReadToLatest({
                lastMessageSeq: undefined,
                lastVisibleSeq: 30,
                pullupHasMore: false,
            })
        ).toBe(false)
        expect(
            isReadToLatest({
                lastMessageSeq: 30,
                lastVisibleSeq: undefined,
                pullupHasMore: false,
            })
        ).toBe(false)
    })
})

describe("selectDoneReminderIDs", () => {
    const mention = (
        reminderID: number,
        messageSeq: number,
        done = false
    ): ReminderLike => ({
        reminderID,
        messageSeq,
        reminderType: ReminderType.ReminderTypeMentionMe,
        done,
    })

    const joinRequest = (
        reminderID: number,
        messageSeq: number,
        done = false
    ): ReminderLike => ({
        reminderID,
        messageSeq,
        reminderType: ReminderType.ReminderTypeApplyJoinGroup,
        done,
    })

    it("marks every un-done mention reminder done when read to latest, regardless of visibility", () => {
        const reminders = [mention(1, 10), mention(2, 20), mention(3, 30)]
        // 视口只覆盖最新一条（seq 30），但已读到最新 → 所有 mention 都标 done。
        const ids = selectDoneReminderIDs(reminders, {
            readToLatest: true,
            isVisible: (r) => r.messageSeq === 30,
        })
        expect(ids).toEqual([1, 2, 3])
    })

    it("does NOT dismiss non-mention reminders via the read-to-latest fallback (mixed types)", () => {
        // 会话里既有 mention 又有入群申请。用户已读到最新，但入群申请消息不在视口内。
        // 只有 mention 应被标 done，入群申请必须保留。
        const reminders = [mention(1, 10), joinRequest(2, 15), mention(3, 30)]
        const ids = selectDoneReminderIDs(reminders, {
            readToLatest: true,
            isVisible: (r) => r.messageSeq === 30, // 只有最新那条 mention 可见
        })
        expect(ids).toEqual([1, 3])
        expect(ids).not.toContain(2)
    })

    it("still marks a visible non-mention reminder done even when read to latest", () => {
        // 入群申请当前在视口内可见 → 沿用原有基于可见性的处理，标 done。
        const reminders = [mention(1, 10), joinRequest(2, 30)]
        const ids = selectDoneReminderIDs(reminders, {
            readToLatest: true,
            isVisible: (r) => r.messageSeq === 30,
        })
        expect(ids).toEqual([1, 2])
    })

    it("skips already-done reminders even when read to latest", () => {
        const reminders = [
            mention(1, 10, true),
            mention(2, 20, false),
            mention(3, 30, true),
        ]
        const ids = selectDoneReminderIDs(reminders, {
            readToLatest: true,
            isVisible: () => true,
        })
        expect(ids).toEqual([2])
    })

    it("only marks visible reminders done when NOT read to latest (existing behavior)", () => {
        const reminders = [mention(1, 10), mention(2, 20), joinRequest(3, 30)]
        const ids = selectDoneReminderIDs(reminders, {
            readToLatest: false,
            isVisible: (r) => r.messageSeq === 20,
        })
        expect(ids).toEqual([2])
    })

    it("returns empty when there are no reminders", () => {
        expect(
            selectDoneReminderIDs(undefined, {
                readToLatest: true,
                isVisible: () => true,
            })
        ).toEqual([])
        expect(
            selectDoneReminderIDs([], {
                readToLatest: true,
                isVisible: () => true,
            })
        ).toEqual([])
    })

    it("returns empty when all reminders are already done", () => {
        const reminders = [mention(1, 10, true), joinRequest(2, 20, true)]
        expect(
            selectDoneReminderIDs(reminders, {
                readToLatest: true,
                isVisible: () => true,
            })
        ).toEqual([])
    })

    it("returns empty when not read to latest and nothing is visible", () => {
        const reminders = [mention(1, 10), joinRequest(2, 20)]
        expect(
            selectDoneReminderIDs(reminders, {
                readToLatest: false,
                isVisible: () => false,
            })
        ).toEqual([])
    })
})
