import { describe, it, expect } from "vitest"
import { ReminderType } from "wukongimjssdk"

import { selectDoneReminderIDs, ReminderLike } from "../reminderDone"

// #1408: category header 的 `@` 角标永久亮着但展开每行都没 @。根因是 mention reminder
// 只在消息当前处于视口内可见时才被标 done，历史 mention 被滚出视口后永不 done。
// Fix A：用户已读到会话最新时，该会话内所有未 done 的 mention reminder 一律标 done
// （包括当前不在视口里的历史 @）；其它类型（入群申请等）保持基于视口可见性的处理。
//
// 注意：这里只测抽出的纯逻辑（哪些 reminderID 应进 done 列表）。「哪个 vm/DOM 值喂给
// scrolledToBottom / isVisible」这层 wiring 由 assistantIntent.test.ts 里对
// updateReminderDoneIfNeed 的组件级测试覆盖。
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

    it("sweeps every un-done mention reminder when scrolled to bottom, incl. ones not in the viewport", () => {
        const reminders = [mention(1, 10), mention(2, 20), mention(3, 30)]
        // 视口只覆盖最新一条（seq 30），但已读到最新 → 所有 mention 都标 done。
        const ids = selectDoneReminderIDs(reminders, {
            scrolledToBottom: true,
            isVisible: (r) => r.messageSeq === 30,
        })
        expect(ids).toEqual([1, 2, 3])
    })

    it("does NOT sweep non-mention reminders when scrolled to bottom (mixed types)", () => {
        // 会话里既有 mention 又有入群申请。用户已读到最新，但入群申请消息不在视口内。
        // 只有 mention 应被标 done，入群申请必须保留。
        const reminders = [mention(1, 10), joinRequest(2, 15), mention(3, 30)]
        const ids = selectDoneReminderIDs(reminders, {
            scrolledToBottom: true,
            isVisible: (r) => r.messageSeq === 30, // 只有最新那条 mention 可见
        })
        expect(ids).toEqual([1, 3])
        expect(ids).not.toContain(2)
    })

    it("still marks a visible non-mention reminder done even when scrolled to bottom", () => {
        // 入群申请当前在视口内可见 → 沿用原有基于可见性的处理，标 done。
        const reminders = [mention(1, 10), joinRequest(2, 30)]
        const ids = selectDoneReminderIDs(reminders, {
            scrolledToBottom: true,
            isVisible: (r) => r.messageSeq === 30,
        })
        expect(ids).toEqual([1, 2])
    })

    it("skips already-done reminders even when scrolled to bottom", () => {
        const reminders = [
            mention(1, 10, true),
            mention(2, 20, false),
            mention(3, 30, true),
        ]
        const ids = selectDoneReminderIDs(reminders, {
            scrolledToBottom: true,
            isVisible: () => true,
        })
        expect(ids).toEqual([2])
    })

    it("only marks visible reminders done when NOT scrolled to bottom (existing behavior)", () => {
        const reminders = [mention(1, 10), mention(2, 20), joinRequest(3, 30)]
        const ids = selectDoneReminderIDs(reminders, {
            scrolledToBottom: false,
            isVisible: (r) => r.messageSeq === 20,
        })
        expect(ids).toEqual([2])
    })

    it("returns empty when there are no reminders", () => {
        expect(
            selectDoneReminderIDs(undefined, {
                scrolledToBottom: true,
                isVisible: () => true,
            })
        ).toEqual([])
        expect(
            selectDoneReminderIDs([], {
                scrolledToBottom: true,
                isVisible: () => true,
            })
        ).toEqual([])
    })

    it("returns empty when all reminders are already done", () => {
        const reminders = [mention(1, 10, true), joinRequest(2, 20, true)]
        expect(
            selectDoneReminderIDs(reminders, {
                scrolledToBottom: true,
                isVisible: () => true,
            })
        ).toEqual([])
    })

    it("returns empty when not scrolled to bottom and nothing is visible", () => {
        const reminders = [mention(1, 10), joinRequest(2, 20)]
        expect(
            selectDoneReminderIDs(reminders, {
                scrolledToBottom: false,
                isVisible: () => false,
            })
        ).toEqual([])
    })
})
