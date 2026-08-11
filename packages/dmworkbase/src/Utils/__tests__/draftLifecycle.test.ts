import { describe, expect, it } from "vitest"
import { resolveDraftToPersist, shouldClearDraftAfterSend } from "../draftLifecycle"

describe("shouldClearDraftAfterSend", () => {
    it("clears the draft snapshot that belonged to the sent message", () => {
        expect(shouldClearDraftAfterSend({
            remoteDraft: "hello",
            remoteDraftAtSend: "hello",
            draftSavedAfterSend: false,
        })).toBe(true)
    })

    it("does not clear a live draft typed while the send is pending", () => {
        expect(shouldClearDraftAfterSend({
            liveDraft: "new draft",
            remoteDraft: "hello",
            remoteDraftAtSend: "hello",
            draftSavedAfterSend: false,
        })).toBe(false)
    })

    it("does not clear non-empty live input even when it equals the sent text", () => {
        expect(shouldClearDraftAfterSend({
            liveDraft: "hello",
            remoteDraft: "hello",
            remoteDraftAtSend: "hello",
            draftSavedAfterSend: false,
        })).toBe(false)
    })

    it("does not clear a newer draft saved while the send is pending", () => {
        expect(shouldClearDraftAfterSend({
            remoteDraft: "hello",
            remoteDraftAtSend: "hello",
            draftSavedAfterSend: true,
            latestSavedDraft: "new draft",
        })).toBe(false)
    })

    it("does not clear a non-empty draft saved after compose consumption", () => {
        expect(shouldClearDraftAfterSend({
            liveDraft: "hello",
            remoteDraft: "hello",
            remoteDraftAtSend: "hello",
            draftSavedAfterSend: true,
            latestSavedDraft: "hello",
        })).toBe(false)
    })

    it("allows the clear when the only later save is an empty editor", () => {
        expect(shouldClearDraftAfterSend({
            remoteDraft: "hello",
            remoteDraftAtSend: "hello",
            draftSavedAfterSend: true,
            latestSavedDraft: "",
        })).toBe(true)
    })

    it("does not clear edited live input after compose consumption", () => {
        expect(shouldClearDraftAfterSend({
            remoteDraft: "hello",
            remoteDraftAtSend: "hello",
            liveDraft: "hello edited",
            draftSavedAfterSend: false,
        })).toBe(false)
    })

    it("does not clear a remote draft updated while the send is pending", () => {
        expect(shouldClearDraftAfterSend({
            remoteDraft: "remote new draft",
            remoteDraftAtSend: "hello",
            liveDraft: "",
            draftSavedAfterSend: false,
        })).toBe(false)
    })

    it("does not let queued send B erase C saved while send A was pending", () => {
        expect(shouldClearDraftAfterSend({
            liveDraft: "",
            remoteDraft: "C",
            remoteDraftAtSend: "C",
            draftSavedAfterSend: true,
            latestSavedDraft: "C",
        })).toBe(false)
    })
})

describe("resolveDraftToPersist (octo-web#1280)", () => {
    it("persists what the composer currently holds", () => {
        expect(resolveDraftToPersist({
            liveDraft: "typing this",
            pendingSendText: "",
            existingDraft: "old",
        })).toBe("typing this")
    })

    it("does not clear the stored draft while a consumed compose is still in flight", () => {
        // Leaving the conversation mid-send used to persist "" over content that
        // had no bubble yet — composer, draft and message list all empty at once.
        expect(resolveDraftToPersist({
            liveDraft: "",
            pendingSendText: "message being sent",
            existingDraft: "older draft",
        })).toBe("older draft")
    })

    it("still lets the live composer win over an in-flight compose", () => {
        expect(resolveDraftToPersist({
            liveDraft: "next message",
            pendingSendText: "message being sent",
            existingDraft: "older draft",
        })).toBe("next message")
    })

    it("clears the draft normally when nothing is in flight", () => {
        expect(resolveDraftToPersist({
            liveDraft: "",
            pendingSendText: "",
            existingDraft: "older draft",
        })).toBe("")
    })
})
