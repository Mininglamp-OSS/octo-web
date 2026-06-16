import { describe, expect, it } from "vitest"
import {
    isSuccessfulSendAck,
    messageStatusWaitResult,
    taskStatusWaitResult,
} from "../sendWaitResult"

describe("send wait result helpers", () => {
    it("treats only successful ack reason code as sent", () => {
        expect(isSuccessfulSendAck({ reasonCode: 1 })).toBe(true)
        expect(isSuccessfulSendAck({ reasonCode: 0 })).toBe(false)
        expect(isSuccessfulSendAck({ reasonCode: 42 })).toBe(false)
        expect(isSuccessfulSendAck()).toBe(false)
    })

    it("maps normal and failed message status to explicit wait results", () => {
        expect(messageStatusWaitResult("normal", "normal", "fail")).toBe(true)
        expect(messageStatusWaitResult("fail", "normal", "fail")).toBe(false)
        expect(messageStatusWaitResult("wait", "normal", "fail")).toBeUndefined()
    })

    it("maps successful and failed upload task status to explicit wait results", () => {
        expect(taskStatusWaitResult("success", "success", "fail")).toBe(true)
        expect(taskStatusWaitResult("fail", "success", "fail")).toBe(false)
        expect(taskStatusWaitResult("processing", "success", "fail")).toBeUndefined()
    })
})
