import { describe, expect, it } from "vitest"
import { resolveDraftAfterSend, resolveDraftToPersist } from "../draftLifecycle"

describe("resolveDraftAfterSend", () => {
    it("clears the unchanged remote draft after a successful send", () => {
        expect(resolveDraftAfterSend({
            remoteDraft: "hello",
            remoteDraftAtSend: "hello",
            draftSavedAfterSend: false,
            sentDraft: "hello",
            pendingDrafts: ["hello"],
        })).toBe("")
    })

    it("does not touch live input typed after compose consumption", () => {
        expect(resolveDraftAfterSend({
            liveDraft: "hello",
            remoteDraft: "hello",
            remoteDraftAtSend: "hello",
            draftSavedAfterSend: false,
            sentDraft: "hello",
            pendingDrafts: ["hello"],
        })).toBeUndefined()
    })

    it("does not clear a newer live draft even when its text equals the sent text", () => {
        expect(resolveDraftAfterSend({
            liveDraft: "same text",
            remoteDraft: "",
            remoteDraftAtSend: "",
            draftSavedAfterSend: false,
            sentDraft: "same text",
            pendingDrafts: ["same text"],
        })).toBeUndefined()
    })

    it("clears the provisional draft written for this send", () => {
        expect(resolveDraftAfterSend({
            remoteDraft: "A",
            remoteDraftAtSend: "A",
            draftSavedAfterSend: true,
            latestSavedDraft: "A",
            latestSavedDraftSource: "pending",
            sentDraft: "A",
            pendingDrafts: ["A"],
        })).toBe("")
    })

    it("reduces queued provisional drafts as each send succeeds", () => {
        expect(resolveDraftAfterSend({
            remoteDraft: "A\nB",
            remoteDraftAtSend: "",
            draftSavedAfterSend: true,
            latestSavedDraft: "A\nB",
            latestSavedDraftSource: "pending",
            sentDraft: "A",
            pendingDrafts: ["A", "B"],
        })).toBe("B")

        expect(resolveDraftAfterSend({
            remoteDraft: "B",
            remoteDraftAtSend: "",
            draftSavedAfterSend: true,
            latestSavedDraft: "B",
            latestSavedDraftSource: "pending",
            sentDraft: "B",
            pendingDrafts: ["B"],
        })).toBe("")
    })

    it("does not erase a later live draft saved while the send was pending", () => {
        expect(resolveDraftAfterSend({
            remoteDraft: "C",
            remoteDraftAtSend: "",
            draftSavedAfterSend: true,
            latestSavedDraft: "C",
            latestSavedDraftSource: "live",
            sentDraft: "B",
            pendingDrafts: ["B"],
        })).toBeUndefined()
    })

    it("does not mistake same-text live input for a provisional send draft", () => {
        expect(resolveDraftAfterSend({
            remoteDraft: "A",
            remoteDraftAtSend: "",
            draftSavedAfterSend: true,
            latestSavedDraft: "A",
            latestSavedDraftSource: "live",
            sentDraft: "A",
            pendingDrafts: ["A"],
        })).toBeUndefined()
    })

    it("does not clear when the executing send does not own the first pending slot", () => {
        expect(resolveDraftAfterSend({
            remoteDraft: "A\nB",
            remoteDraftAtSend: "",
            draftSavedAfterSend: true,
            latestSavedDraft: "A\nB",
            latestSavedDraftSource: "pending",
            sentDraft: "B",
            pendingDrafts: ["A", "B"],
        })).toBeUndefined()
    })

    it("does not let an attachment-only send consume the next text draft", () => {
        expect(resolveDraftAfterSend({
            remoteDraft: "B",
            remoteDraftAtSend: "",
            draftSavedAfterSend: true,
            latestSavedDraft: "B",
            latestSavedDraftSource: "pending",
            sentDraft: "B",
            pendingDrafts: ["", "B"],
        })).toBeUndefined()
    })

    it("does not clear a remote draft changed outside this send", () => {
        expect(resolveDraftAfterSend({
            remoteDraft: "remote update",
            remoteDraftAtSend: "A",
            draftSavedAfterSend: false,
            sentDraft: "A",
            pendingDrafts: ["A"],
        })).toBeUndefined()
    })
})

describe("resolveDraftToPersist (octo-web#1280)", () => {
    it("persists live input with live ownership", () => {
        expect(resolveDraftToPersist({
            liveDraft: "typing this",
            pendingSendText: "",
        })).toEqual({ draft: "typing this", source: "live" })
    })

    it("persists an in-flight compose as a provisional draft", () => {
        expect(resolveDraftToPersist({
            liveDraft: "",
            pendingSendText: "message being sent",
        })).toEqual({ draft: "message being sent", source: "pending" })
    })

    it("still lets live input win over an in-flight compose", () => {
        expect(resolveDraftToPersist({
            liveDraft: "next message",
            pendingSendText: "message being sent",
        })).toEqual({ draft: "next message", source: "live" })
    })

    it("persists an empty draft when nothing is live or pending", () => {
        expect(resolveDraftToPersist({
            liveDraft: "",
            pendingSendText: "",
        })).toEqual({ draft: "", source: "empty" })
    })
})
