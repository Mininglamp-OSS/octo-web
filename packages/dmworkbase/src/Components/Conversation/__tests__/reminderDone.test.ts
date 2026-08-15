import { describe, it, expect } from "vitest"

import { selectDoneReminderIDs, ReminderLike } from "../reminderDone"

// #1408: category header 的 `@` 角标永久亮着但展开每行都没 @。根因是 mention reminder
// 只在消息当前处于视口内可见时才被标 done，历史 mention 被滚出视口后永不 done。
// Fix A：用户已滚到会话底部时，会话内所有未 done 的 mention reminder 一律标 done。
describe("selectDoneReminderIDs", () => {
    const mkReminder = (
        reminderID: number,
        messageSeq: number,
        done = false
    ): ReminderLike => ({ reminderID, messageSeq, done })

    it("marks every un-done reminder done when scrolled to bottom, regardless of visibility", () => {
        const reminders = [
            mkReminder(1, 10),
            mkReminder(2, 20),
            mkReminder(3, 30),
        ]
        // 视口只覆盖最新一条（seq 30），但已滚到底 → 全部标 done。
        const ids = selectDoneReminderIDs(reminders, {
            scrolledToBottom: true,
            isVisible: (r) => r.messageSeq === 30,
        })
        expect(ids).toEqual([1, 2, 3])
    })

    it("skips already-done reminders even when scrolled to bottom", () => {
        const reminders = [
            mkReminder(1, 10, true),
            mkReminder(2, 20, false),
            mkReminder(3, 30, true),
        ]
        const ids = selectDoneReminderIDs(reminders, {
            scrolledToBottom: true,
            isVisible: () => true,
        })
        expect(ids).toEqual([2])
    })

    it("only marks visible reminders done when NOT scrolled to bottom (existing behavior)", () => {
        const reminders = [
            mkReminder(1, 10),
            mkReminder(2, 20),
            mkReminder(3, 30),
        ]
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
        const reminders = [mkReminder(1, 10, true), mkReminder(2, 20, true)]
        expect(
            selectDoneReminderIDs(reminders, {
                scrolledToBottom: true,
                isVisible: () => true,
            })
        ).toEqual([])
    })

    it("returns empty when not scrolled to bottom and nothing is visible", () => {
        const reminders = [mkReminder(1, 10), mkReminder(2, 20)]
        expect(
            selectDoneReminderIDs(reminders, {
                scrolledToBottom: false,
                isVisible: () => false,
            })
        ).toEqual([])
    })
})
